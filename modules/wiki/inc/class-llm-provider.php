<?php
/**
 * OpenAI-compatible LLM provider for OS Wiki.
 *
 * @package OS_Wiki
 */

defined( 'ABSPATH' ) || exit;

/**
 * Connects WordPress to an OpenAI-compatible service on the same host or a
 * remote server. The provider owns transport only; model runtimes and their
 * credentials stay in the configured service.
 */
final class Core_Index_AI_Library_LLM_Provider {
	private const OPTION        = 'core_index_llm_provider';
	private const SECRET_OPTION = 'core_index_llm_api_key';
	private const MAX_BODY      = 2097152;
	private const MAX_PROMPT    = 200000;

	/**
	 * Register the provider REST surface.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Register configuration, diagnostics, model, and completion routes.
	 */
	public static function register_routes(): void {
		register_rest_route(
			Core_Index_AI_Library::REST_NS,
			'/settings/llm-provider',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static fn(): bool => current_user_can( 'manage_options' ),
				'callback'            => array( __CLASS__, 'rest_save_settings' ),
			)
		);
		register_rest_route(
			Core_Index_AI_Library::REST_NS,
			'/llm/provider/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static fn(): bool => current_user_can( 'manage_options' ),
				'callback'            => array( __CLASS__, 'rest_test' ),
			)
		);
		register_rest_route(
			Core_Index_AI_Library::REST_NS,
			'/llm/models',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => array( __CLASS__, 'can_use' ),
				'callback'            => array( __CLASS__, 'rest_models' ),
			)
		);
		register_rest_route(
			Core_Index_AI_Library::REST_NS,
			'/llm/chat/completions',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => array( __CLASS__, 'can_use' ),
				'callback'            => array( __CLASS__, 'rest_complete' ),
			)
		);
	}

	/**
	 * Whether the current REST user may consume the configured provider.
	 */
	public static function can_use(): bool {
		$capability = (string) apply_filters( 'core_index_llm_capability', 'edit_posts' );
		return '' !== $capability && current_user_can( $capability );
	}

	/**
	 * Public, secret-free settings for the admin application.
	 *
	 * @return array<string,mixed>
	 */
	public static function public_settings(): array {
		$settings = self::settings();
		return array_merge(
			$settings,
			array(
				'api_key_set' => '' !== self::api_key(),
				'locked'      => array(
					'location'  => defined( 'CORE_INDEX_LLM_LOCATION' ),
					'base_url'  => defined( 'CORE_INDEX_LLM_BASE_URL' ),
					'model'     => defined( 'CORE_INDEX_LLM_MODEL' ),
					'client_id' => defined( 'CORE_INDEX_LLM_CLIENT_ID' ),
					'api_key'   => defined( 'CORE_INDEX_LLM_API_KEY' ),
				),
				'api_key_source' => defined( 'CORE_INDEX_LLM_API_KEY' ) ? 'constant' : ( '' !== self::api_key() ? 'database' : 'none' ),
			)
		);
	}

	/**
	 * Effective provider settings, with wp-config.php constants taking priority.
	 *
	 * @return array<string,mixed>
	 */
	public static function settings(): array {
		$stored = get_option( self::OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();
		$value  = wp_parse_args(
			$stored,
			array(
				'enabled'   => false,
				'location'  => 'remote',
				'base_url'  => '',
				'model'     => '',
				'client_id' => '',
				'timeout'   => 120,
			)
		);

		$value['enabled']   = (bool) $value['enabled'];
		$value['location']  = defined( 'CORE_INDEX_LLM_LOCATION' ) ? (string) CORE_INDEX_LLM_LOCATION : (string) $value['location'];
		$value['base_url']  = defined( 'CORE_INDEX_LLM_BASE_URL' ) ? (string) CORE_INDEX_LLM_BASE_URL : (string) $value['base_url'];
		$value['model']     = defined( 'CORE_INDEX_LLM_MODEL' ) ? (string) CORE_INDEX_LLM_MODEL : (string) $value['model'];
		$value['client_id'] = defined( 'CORE_INDEX_LLM_CLIENT_ID' ) ? (string) CORE_INDEX_LLM_CLIENT_ID : (string) $value['client_id'];
		$value['location']  = in_array( $value['location'], array( 'local', 'remote' ), true ) ? $value['location'] : 'remote';
		$value['base_url']  = untrailingslashit( esc_url_raw( $value['base_url'] ) );
		$value['model']     = sanitize_text_field( $value['model'] );
		$value['client_id'] = self::sanitize_client_id( $value['client_id'] );
		$value['timeout']   = max( 5, min( 300, (int) $value['timeout'] ) );
		return $value;
	}

	/**
	 * Save provider settings. Secrets are changed only when explicitly sent.
	 */
	public static function rest_save_settings( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$input    = $request->get_json_params();
		$input    = is_array( $input ) ? $input : array();
		$current  = self::settings();
		$settings = array(
			'enabled'   => array_key_exists( 'enabled', $input ) ? (bool) $input['enabled'] : $current['enabled'],
			'location'  => defined( 'CORE_INDEX_LLM_LOCATION' ) ? $current['location'] : sanitize_key( (string) ( $input['location'] ?? $current['location'] ) ),
			'base_url'  => defined( 'CORE_INDEX_LLM_BASE_URL' ) ? $current['base_url'] : untrailingslashit( esc_url_raw( (string) ( $input['base_url'] ?? $current['base_url'] ) ) ),
			'model'     => defined( 'CORE_INDEX_LLM_MODEL' ) ? $current['model'] : sanitize_text_field( (string) ( $input['model'] ?? $current['model'] ) ),
			'client_id' => defined( 'CORE_INDEX_LLM_CLIENT_ID' ) ? $current['client_id'] : self::sanitize_client_id( (string) ( $input['client_id'] ?? $current['client_id'] ) ),
			'timeout'   => max( 5, min( 300, (int) ( $input['timeout'] ?? $current['timeout'] ) ) ),
		);
		if ( ! in_array( $settings['location'], array( 'local', 'remote' ), true ) ) {
			return new WP_Error( 'core_index_llm_bad_location', 'Location must be local or remote.', array( 'status' => 400 ) );
		}
		if ( '' !== $settings['base_url'] ) {
			$valid = self::validate_base_url( $settings['base_url'], $settings['location'] );
			if ( is_wp_error( $valid ) ) {
				return $valid;
			}
		}
		if ( $settings['enabled'] && ( '' === $settings['base_url'] || '' === $settings['model'] ) ) {
			return new WP_Error( 'core_index_llm_incomplete', 'An enabled provider requires a base URL and model.', array( 'status' => 400 ) );
		}

		update_option( self::OPTION, $settings, false );
		if ( ! defined( 'CORE_INDEX_LLM_API_KEY' ) ) {
			if ( ! empty( $input['clear_api_key'] ) ) {
				delete_option( self::SECRET_OPTION );
			} elseif ( array_key_exists( 'api_key', $input ) && '' !== trim( (string) $input['api_key'] ) ) {
				update_option( self::SECRET_OPTION, trim( (string) $input['api_key'] ), false );
			}
		}
		return new WP_REST_Response( array( 'ok' => true, 'provider' => self::public_settings() ) );
	}

	/**
	 * Test authentication and network reachability without consuming tokens.
	 */
	public static function rest_test(): WP_REST_Response|WP_Error {
		$started = microtime( true );
		$result  = self::models();
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$models = array();
		foreach ( (array) ( $result['data'] ?? array() ) as $model ) {
			if ( is_array( $model ) && isset( $model['id'] ) ) {
				$models[] = sanitize_text_field( (string) $model['id'] );
			}
		}
		return new WP_REST_Response(
			array(
				'ok'         => true,
				'latency_ms' => (int) round( ( microtime( true ) - $started ) * 1000 ),
				'models'     => array_slice( $models, 0, 100 ),
			)
		);
	}

	/**
	 * Return provider models.
	 */
	public static function rest_models(): WP_REST_Response|WP_Error {
		$result = self::models();
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result );
	}

	/**
	 * Proxy a bounded, non-streaming OpenAI-compatible completion.
	 */
	public static function rest_complete( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$rate_limit = self::check_rate_limit();
		if ( is_wp_error( $rate_limit ) ) {
			return $rate_limit;
		}
		$input  = $request->get_json_params();
		$input  = is_array( $input ) ? $input : array();
		$result = self::complete( (array) ( $input['messages'] ?? array() ), $input );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result );
	}

	/**
	 * Fetch models from the configured OpenAI-compatible endpoint.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public static function models(): array|WP_Error {
		return self::request( 'GET', '/models' );
	}

	/**
	 * Complete a chat conversation through the configured provider.
	 *
	 * @param array<int,array<string,mixed>> $messages OpenAI-compatible messages.
	 * @param array<string,mixed>            $args     Optional completion fields.
	 * @return array<string,mixed>|WP_Error
	 */
	public static function complete( array $messages, array $args = array() ): array|WP_Error {
		$settings = self::settings();
		if ( empty( $settings['enabled'] ) ) {
			return new WP_Error( 'core_index_llm_disabled', 'The LLM provider is disabled.', array( 'status' => 503 ) );
		}
		$normalized = self::normalize_messages( $messages );
		if ( is_wp_error( $normalized ) ) {
			return $normalized;
		}
		$model = sanitize_text_field( (string) ( $args['model'] ?? $settings['model'] ) );
		if ( '' === $model ) {
			return new WP_Error( 'core_index_llm_model_missing', 'A model is required.', array( 'status' => 400 ) );
		}
		$body = array(
			'model'    => $model,
			'messages' => $normalized,
			'stream'   => false,
		);
		if ( isset( $args['max_tokens'] ) ) {
			$body['max_tokens'] = max( 1, min( 32768, (int) $args['max_tokens'] ) );
		}
		if ( isset( $args['temperature'] ) && is_numeric( $args['temperature'] ) ) {
			$body['temperature'] = max( 0.0, min( 2.0, (float) $args['temperature'] ) );
		}
		if ( isset( $args['top_p'] ) && is_numeric( $args['top_p'] ) ) {
			$body['top_p'] = max( 0.0, min( 1.0, (float) $args['top_p'] ) );
		}
		if ( isset( $args['stop'] ) && ( is_string( $args['stop'] ) || is_array( $args['stop'] ) ) ) {
			$body['stop'] = is_array( $args['stop'] )
				? array_slice( array_map( 'sanitize_text_field', $args['stop'] ), 0, 8 )
				: sanitize_text_field( $args['stop'] );
		}
		return self::request( 'POST', '/chat/completions', $body );
	}

	/**
	 * Make one authenticated provider request.
	 *
	 * @param array<string,mixed>|null $body JSON body.
	 * @return array<string,mixed>|WP_Error
	 */
	private static function request( string $method, string $path, ?array $body = null ): array|WP_Error {
		$settings = self::settings();
		if ( '' === $settings['base_url'] ) {
			return new WP_Error( 'core_index_llm_url_missing', 'The LLM provider base URL is not configured.', array( 'status' => 503 ) );
		}
		$valid = self::validate_base_url( $settings['base_url'], $settings['location'] );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		$url     = $settings['base_url'] . $path;
		$headers = array(
			'Accept'     => 'application/json',
			'User-Agent' => 'Core-Index-AI-Library/' . Core_Index_AI_Library::VERSION,
		);
		$key = self::api_key();
		if ( '' !== $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
		}
		if ( '' !== $settings['client_id'] ) {
			$headers['X-Core-Index-Client-ID'] = $settings['client_id'];
		}
		$args = array(
			'method'              => $method,
			'headers'             => $headers,
			'timeout'             => $settings['timeout'],
			'redirection'         => 0,
			'limit_response_size' => self::MAX_BODY,
			'reject_unsafe_urls'  => 'remote' === $settings['location'],
		);
		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
			$args['data_format']             = 'body';
		}
		$response = 'remote' === $settings['location']
			? wp_safe_remote_request( $url, $args )
			: wp_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'core_index_llm_unreachable', $response->get_error_message(), array( 'status' => 502 ) );
		}
		$status  = (int) wp_remote_retrieve_response_code( $response );
		$raw     = (string) wp_remote_retrieve_body( $response );
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return new WP_Error( 'core_index_llm_invalid_response', 'The LLM provider returned invalid JSON.', array( 'status' => 502 ) );
		}
		if ( $status < 200 || $status >= 300 ) {
			$message = sanitize_text_field( (string) ( $decoded['error']['message'] ?? $decoded['message'] ?? 'The LLM provider rejected the request.' ) );
			return new WP_Error( 'core_index_llm_provider_error', $message, array( 'status' => max( 400, min( 599, $status ) ) ) );
		}
		return $decoded;
	}

	/**
	 * Validate the configured transport boundary.
	 *
	 * Remote endpoints require HTTPS. Local HTTP is limited to loopback unless
	 * an operator explicitly allowlists another hostname in wp-config.php or a
	 * filter. Redirects remain disabled in all modes.
	 */
	public static function validate_base_url( string $url, string $location ): bool|WP_Error {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return new WP_Error( 'core_index_llm_bad_url', 'Enter an absolute provider base URL.', array( 'status' => 400 ) );
		}
		if ( isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) {
			return new WP_Error( 'core_index_llm_bad_url', 'The provider base URL cannot contain credentials, a query, or a fragment.', array( 'status' => 400 ) );
		}
		$scheme = strtolower( (string) $parts['scheme'] );
		$host   = strtolower( trim( (string) $parts['host'], '[]' ) );
		if ( 'remote' === $location ) {
			$allow_insecure = (bool) apply_filters( 'core_index_llm_allow_insecure_remote', false, $url );
			if ( 'https' !== $scheme && ! $allow_insecure ) {
				return new WP_Error( 'core_index_llm_https_required', 'Remote LLM providers must use HTTPS.', array( 'status' => 400 ) );
			}
			return true;
		}
		if ( 'local' !== $location || ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
			return new WP_Error( 'core_index_llm_bad_url', 'Local providers must use HTTP or HTTPS.', array( 'status' => 400 ) );
		}
		$allowed = array( 'localhost', '127.0.0.1', '::1' );
		if ( defined( 'CORE_INDEX_LLM_ALLOWED_LOCAL_HOSTS' ) ) {
			$allowed = array_merge( $allowed, explode( ',', (string) CORE_INDEX_LLM_ALLOWED_LOCAL_HOSTS ) );
		}
		$allowed = (array) apply_filters( 'core_index_llm_allowed_local_hosts', $allowed );
		$allowed = array_map( static fn( $item ): string => strtolower( trim( (string) $item, " \t\n\r\0\x0B[]" ) ), $allowed );
		if ( ! in_array( $host, $allowed, true ) ) {
			return new WP_Error(
				'core_index_llm_local_host_denied',
				'Local providers are loopback-only unless CORE_INDEX_LLM_ALLOWED_LOCAL_HOSTS explicitly allowlists the service hostname.',
				array( 'status' => 400 )
			);
		}
		return true;
	}

	/**
	 * Normalize text-only OpenAI messages and enforce a total prompt bound.
	 *
	 * @param array<int,mixed> $messages Messages.
	 * @return array<int,array<string,string>>|WP_Error
	 */
	private static function normalize_messages( array $messages ): array|WP_Error {
		if ( empty( $messages ) || count( $messages ) > 100 ) {
			return new WP_Error( 'core_index_llm_bad_messages', 'Provide between 1 and 100 messages.', array( 'status' => 400 ) );
		}
		$total = 0;
		$out   = array();
		foreach ( $messages as $index => $message ) {
			if ( ! is_array( $message ) || ! in_array( $message['role'] ?? '', array( 'system', 'user', 'assistant' ), true ) ) {
				return new WP_Error( 'core_index_llm_bad_messages', 'Every message needs a supported role.', array( 'status' => 400, 'index' => $index ) );
			}
			$content = $message['content'] ?? '';
			if ( is_array( $content ) ) {
				$text = array();
				foreach ( $content as $part ) {
					if ( ! is_array( $part ) || 'text' !== ( $part['type'] ?? '' ) ) {
						return new WP_Error( 'core_index_llm_text_only', 'This provider accepts text message parts only.', array( 'status' => 400 ) );
					}
					$text[] = (string) ( $part['text'] ?? '' );
				}
				$content = implode( "\n", $text );
			}
			if ( ! is_string( $content ) ) {
				return new WP_Error( 'core_index_llm_text_only', 'Message content must be text.', array( 'status' => 400 ) );
			}
			$total += strlen( $content );
			if ( $total > self::MAX_PROMPT ) {
				return new WP_Error( 'core_index_llm_prompt_too_large', 'The combined prompt is too large.', array( 'status' => 413 ) );
			}
			$row = array( 'role' => (string) $message['role'], 'content' => $content );
			if ( isset( $message['name'] ) ) {
				$row['name'] = sanitize_text_field( (string) $message['name'] );
			}
			$out[] = $row;
		}
		return $out;
	}

	/**
	 * Limit REST consumption per WordPress user without affecting PHP callers.
	 */
	private static function check_rate_limit(): bool|WP_Error {
		$user_id = get_current_user_id();
		$limit   = max( 1, (int) apply_filters( 'core_index_llm_requests_per_minute', 20, $user_id ) );
		$key     = 'core_index_llm_rate_' . $user_id;
		$bucket  = get_transient( $key );
		$bucket  = is_array( $bucket ) ? $bucket : array();
		$cutoff  = time() - MINUTE_IN_SECONDS;
		$bucket  = array_values( array_filter( $bucket, static fn( $timestamp ): bool => (int) $timestamp > $cutoff ) );
		if ( count( $bucket ) >= $limit ) {
			return new WP_Error( 'core_index_llm_rate_limited', 'The per-user LLM request limit has been reached.', array( 'status' => 429 ) );
		}
		$bucket[] = time();
		set_transient( $key, $bucket, MINUTE_IN_SECONDS );
		return true;
	}

	private static function api_key(): string {
		if ( defined( 'CORE_INDEX_LLM_API_KEY' ) ) {
			return trim( (string) CORE_INDEX_LLM_API_KEY );
		}
		return trim( (string) get_option( self::SECRET_OPTION, '' ) );
	}

	private static function sanitize_client_id( string $value ): string {
		$value = preg_replace( '/[^A-Za-z0-9._:-]/', '', $value );
		return substr( is_string( $value ) ? $value : '', 0, 128 );
	}
}

/**
 * Public PHP API for product plugins and site code.
 *
 * @param array<int,array<string,mixed>> $messages OpenAI-compatible messages.
 * @param array<string,mixed>            $args     Completion arguments.
 * @return array<string,mixed>|WP_Error
 */
function core_index_ai_library_llm_complete( array $messages, array $args = array() ): array|WP_Error {
	return Core_Index_AI_Library_LLM_Provider::complete( $messages, $args );
}
