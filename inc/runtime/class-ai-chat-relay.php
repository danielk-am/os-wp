<?php
/**
 * Server-owned A8C AI Bridge relay for one standalone product.
 *
 * This file is copied into each standalone product. The synchronisation script
 * replaces OS_Standalone_Admin in the class name so co-installed products never
 * share PHP runtime symbols or admin-post actions.
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'OS_Standalone_Admin_AI_Chat_Relay' ) ) {
	final class OS_Standalone_Admin_AI_Chat_Relay {
		private const MAX_REQUEST_BYTES    = 10 * 1024 * 1024;
		private const MAX_RESPONSE_BYTES   = 16 * 1024 * 1024;
		private const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
		private const MAX_ATTACHMENTS      = 3;
		private const MAX_MESSAGES         = 100;
		private const MAX_OUTPUT_TOKENS    = 8192;

		private array $config;
		private string $action;
		private bool $stream_started = false;
		private int $response_bytes  = 0;
		private string $content_type = 'application/json; charset=utf-8';

		private function __construct( array $config ) {
			$this->config = $config;
			$this->action = sanitize_key( (string) $config['slug'] ) . '-ai-chat';
		}

		public static function boot( array $config ): self {
			$relay = new self( $config );
			add_action( 'admin_post_' . $relay->action, array( $relay, 'handle' ) );
			return $relay;
		}

		/**
		 * Return browser-safe connection metadata.
		 *
		 * Upstream URLs, bridge bearers, and the bridge client identity are
		 * intentionally never included.
		 */
		public function client_config(): array {
			$providers = array();
			foreach ( $this->provider_definitions() as $provider => $definition ) {
				$providers[] = array(
					'provider'   => $provider,
					'endpoint'   => add_query_arg(
						array(
							'action'   => $this->action,
							'provider' => $provider,
						),
						admin_url( 'admin-post.php' )
					),
					'models'     => array_map(
						static fn( string $model ): array => array(
							'id'             => $model,
							'label'          => $model,
							'supportsImages' => ! empty( $definition['supports_images'] ),
						),
						$this->models_for( $provider, $definition )
					),
					'configured' => $this->is_configured( $provider ),
				);
			}

			return array(
				'appId'          => sanitize_key( (string) $this->config['slug'] ),
				'title'          => (string) ( $this->config['ai_chat_title'] ?? $this->config['name'] . ' assistant' ),
				'instructions'   => (string) ( $this->config['ai_chat_instructions'] ?? '' ),
				'appearance'     => 'system',
				'nonce'          => wp_create_nonce( $this->action ),
				'providers'      => $providers,
				'contextSummary' => (string) ( $this->config['name'] ?? 'Current WordPress app' ),
			);
		}

		/**
		 * Serve one authenticated OpenAI-compatible bridge request.
		 *
		 * admin-post.php exits after this action. Avoiding WP REST is
		 * deliberate: WP_REST_Server serialises the callback result after
		 * dispatch and cannot preserve an upstream event stream.
		 */
		public function handle(): void {
			if ( 'POST' !== strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) ) {
				$this->json_error( 405, 'method_not_allowed', 'Use POST for AI chat requests.' );
				return;
			}
			if ( ! current_user_can( 'manage_options' ) ) {
				$this->json_error( 403, 'forbidden', 'You are not allowed to use this assistant.' );
				return;
			}
			$nonce = sanitize_text_field( wp_unslash( (string) ( $_SERVER['HTTP_X_CI_AI_CHAT_NONCE'] ?? '' ) ) );
			if ( '' === $nonce || ! wp_verify_nonce( $nonce, $this->action ) ) {
				$this->json_error( 403, 'invalid_nonce', 'The assistant session has expired. Reload the page and try again.' );
				return;
			}
			if ( ! function_exists( 'curl_init' ) ) {
				$this->json_error( 501, 'curl_required', 'Streaming AI chat requires the PHP cURL extension.' );
				return;
			}

			$provider = sanitize_key( wp_unslash( (string) ( $_GET['provider'] ?? '' ) ) );
			$definitions = $this->provider_definitions();
			if ( ! isset( $definitions[ $provider ] ) ) {
				$this->json_error( 404, 'unknown_provider', 'Unknown AI bridge.' );
				return;
			}

			$connection = $this->connection_for( $provider, $definitions[ $provider ] );
			if ( is_wp_error( $connection ) ) {
				$this->json_error( 503, $connection->get_error_code(), $connection->get_error_message() );
				return;
			}

			$raw = (string) file_get_contents( 'php://input' );
			if ( '' === $raw || strlen( $raw ) > self::MAX_REQUEST_BYTES ) {
				$this->json_error( 413, 'request_too_large', 'The assistant request is empty or too large.' );
				return;
			}
			$input = json_decode( $raw, true );
			if ( ! is_array( $input ) ) {
				$this->json_error( 400, 'invalid_json', 'The assistant request must be valid JSON.' );
				return;
			}

			$validated = $this->validated_payload( $input, $provider, $connection['models'] );
			if ( is_wp_error( $validated ) ) {
				$status = (int) ( $validated->get_error_data()['status'] ?? 400 );
				$this->json_error( $status, $validated->get_error_code(), $validated->get_error_message() );
				return;
			}

			$this->relay( $connection, $validated );
		}

		private function relay( array $connection, array $payload ): void {
			$handle = curl_init( $connection['upstream_url'] );
			if ( false === $handle ) {
				$this->json_error( 502, 'upstream_unavailable', 'The AI bridge could not be started.' );
				return;
			}

			$header_status  = 0;
			$header_type    = '';
			$headers_sent   = false;
			$client_id      = $this->setting( 'AI_CHAT_CLIENT_ID' );
			$encoded        = wp_json_encode( $payload );
			$this->content_type = ! empty( $payload['stream'] )
				? 'text/event-stream; charset=utf-8'
				: 'application/json; charset=utf-8';
			$this->response_bytes = 0;
			$this->stream_started = false;

			$emit_headers = function () use ( &$headers_sent, &$header_status, &$header_type ): void {
				if ( $headers_sent ) {
					return;
				}
				$headers_sent = true;
				$status = $header_status >= 200 ? $header_status : 502;
				$type   = $this->safe_content_type( $header_type );
				$this->content_type = $type;
				status_header( $status );
				header( 'Content-Type: ' . $type );
				header( 'Cache-Control: no-cache, no-store, must-revalidate' );
				header( 'X-Accel-Buffering: no' );
				header( 'X-Content-Type-Options: nosniff' );
				if ( function_exists( 'ini_set' ) ) {
					ini_set( 'zlib.output_compression', '0' );
				}
				while ( ob_get_level() > 0 ) {
					$ended = ob_end_flush();
					if ( false === $ended ) {
						break;
					}
				}
				flush();
				$this->stream_started = true;
			};

			curl_setopt_array(
				$handle,
				array(
					CURLOPT_POST           => true,
					CURLOPT_POSTFIELDS     => $encoded,
					CURLOPT_HTTPHEADER     => array(
						'Authorization: Bearer ' . $connection['api_key'],
						'Content-Type: application/json',
						'Accept: text/event-stream, application/x-ndjson, application/json',
						'X-A8C-Client-ID: ' . $client_id,
					),
					CURLOPT_FOLLOWLOCATION => false,
					CURLOPT_CONNECTTIMEOUT => 10,
					CURLOPT_TIMEOUT        => 120,
					CURLOPT_NOSIGNAL       => true,
					CURLOPT_SSL_VERIFYPEER => true,
					CURLOPT_SSL_VERIFYHOST => 2,
					CURLOPT_HEADERFUNCTION => function ( $curl, string $line ) use ( &$header_status, &$header_type, &$headers_sent ): int {
						$length = strlen( $line );
						if ( preg_match( '#^HTTP/\S+\s+(\d{3})#i', trim( $line ), $matches ) ) {
							$header_status = (int) $matches[1];
							$header_type   = '';
							$headers_sent  = false;
							return $length;
						}
						if ( str_starts_with( strtolower( $line ), 'content-type:' ) ) {
							$header_type = trim( substr( $line, strlen( 'content-type:' ) ) );
						}
						return $length;
					},
					CURLOPT_WRITEFUNCTION  => function ( $curl, string $chunk ) use ( $emit_headers ): int {
						$length = strlen( $chunk );
						$emit_headers();
						if (
							connection_aborted()
							|| $this->response_bytes + $length > self::MAX_RESPONSE_BYTES
						) {
							return 0;
						}
						$this->response_bytes += $length;
						echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Validated, opaque upstream JSON stream.
						flush();
						return $length;
					},
				)
			);
			if ( defined( 'CURLOPT_PROTOCOLS_STR' ) ) {
				curl_setopt( $handle, CURLOPT_PROTOCOLS_STR, 'http,https' );
			} elseif ( defined( 'CURLOPT_PROTOCOLS' ) && defined( 'CURLPROTO_HTTP' ) && defined( 'CURLPROTO_HTTPS' ) ) {
				curl_setopt( $handle, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS );
			}

			ignore_user_abort( false );
			$result = curl_exec( $handle );
			$error  = curl_errno( $handle );
			curl_close( $handle );

			if ( false !== $result && 0 === $error ) {
				$emit_headers();
				return;
			}
			if ( connection_aborted() ) {
				return;
			}
			if ( ! $this->stream_started ) {
				$this->json_error( 502, 'upstream_failed', 'The AI bridge request failed.' );
				return;
			}
			$this->stream_error( 'The AI bridge stream ended unexpectedly.' );
		}

		private function validated_payload( array $input, string $provider, array $models ) {
			$model = sanitize_text_field( (string) ( $input['model'] ?? '' ) );
			if ( '' === $model || ! in_array( $model, $models, true ) ) {
				return new WP_Error( 'invalid_model', 'The selected model is not allowed.', array( 'status' => 400 ) );
			}
			$max_tokens = $input['max_tokens'] ?? null;
			if ( ! is_int( $max_tokens ) || $max_tokens < 1 || $max_tokens > self::MAX_OUTPUT_TOKENS ) {
				return new WP_Error( 'invalid_max_tokens', 'max_tokens must be an integer from 1 to 8192.', array( 'status' => 400 ) );
			}
			$messages = $input['messages'] ?? null;
			if ( ! is_array( $messages ) || count( $messages ) < 1 || count( $messages ) > self::MAX_MESSAGES ) {
				return new WP_Error( 'invalid_messages', 'messages must be a non-empty bounded array.', array( 'status' => 400 ) );
			}

			$attachments = 0;
			foreach ( $messages as $message ) {
				if ( ! is_array( $message ) || ! in_array( $message['role'] ?? '', array( 'system', 'user', 'assistant', 'tool' ), true ) ) {
					return new WP_Error( 'invalid_message', 'Each message must use a supported role.', array( 'status' => 400 ) );
				}
				$content = $message['content'] ?? null;
				if ( is_string( $content ) || null === $content ) {
					continue;
				}
				if ( ! is_array( $content ) ) {
					return new WP_Error( 'invalid_content', 'Message content is invalid.', array( 'status' => 400 ) );
				}
				foreach ( $content as $part ) {
					if ( ! is_array( $part ) || ! in_array( $part['type'] ?? '', array( 'text', 'image_url' ), true ) ) {
						return new WP_Error( 'invalid_content', 'Message content contains an unsupported part.', array( 'status' => 400 ) );
					}
					if ( 'text' === $part['type'] && ! is_string( $part['text'] ?? null ) ) {
						return new WP_Error( 'invalid_content', 'Text message parts must contain text.', array( 'status' => 400 ) );
					}
					if ( 'image_url' !== $part['type'] ) {
						continue;
					}
					if ( 'claude' === $provider ) {
						return new WP_Error( 'images_not_supported', 'Claude-a8c is text-only.', array( 'status' => 400 ) );
					}
					$url = is_array( $part['image_url'] ?? null ) ? (string) ( $part['image_url']['url'] ?? '' ) : '';
					if ( ! $this->valid_image_data_url( $url ) ) {
						return new WP_Error( 'invalid_image', 'Images must be bounded PNG, JPEG, GIF, or WebP data URLs.', array( 'status' => 400 ) );
					}
					++$attachments;
					if ( $attachments > self::MAX_ATTACHMENTS ) {
						return new WP_Error( 'too_many_images', 'A maximum of three images is allowed.', array( 'status' => 400 ) );
					}
				}
			}

			$payload = array(
				'model'      => $model,
				'max_tokens' => $max_tokens,
				'messages'   => $messages,
				'stream'     => true === ( $input['stream'] ?? false ),
			);
			if ( isset( $input['tools'] ) ) {
				if ( ! is_array( $input['tools'] ) || count( $input['tools'] ) > 32 ) {
					return new WP_Error( 'invalid_tools', 'tools must be a bounded array.', array( 'status' => 400 ) );
				}
				$payload['tools'] = $input['tools'];
			}
			return $payload;
		}

		private function valid_image_data_url( string $url ): bool {
			if ( ! preg_match( '#^data:image/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$#', $url, $matches ) ) {
				return false;
			}
			$decoded = base64_decode( $matches[2], true );
			return false !== $decoded && strlen( $decoded ) <= self::MAX_ATTACHMENT_BYTES;
		}

		private function connection_for( string $provider, array $definition ) {
			$prefix = 'AI_CHAT_' . strtoupper( $provider ) . '_';
			$url    = $this->setting( $prefix . 'UPSTREAM_URL' );
			$key    = $this->setting( $prefix . 'API_KEY' );
			$client = $this->setting( 'AI_CHAT_CLIENT_ID' );
			if ( '' === $url || '' === $key || '' === $client ) {
				return new WP_Error( 'bridge_not_configured', 'This A8C bridge is not configured on the server.' );
			}
			if (
				! $this->valid_upstream_url( $url )
				|| ! $this->valid_header_value( $key, 4096 )
				|| ! preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $client )
			) {
				return new WP_Error( 'invalid_bridge_config', 'The configured A8C bridge connection is invalid.' );
			}
			$models = $this->models_for( $provider, $definition );
			if ( ! $models ) {
				return new WP_Error( 'invalid_bridge_config', 'The configured A8C bridge connection is invalid.' );
			}
			return array(
				'upstream_url' => $url,
				'api_key'      => $key,
				'models'       => $models,
			);
		}

		private function is_configured( string $provider ): bool {
			$prefix = 'AI_CHAT_' . strtoupper( $provider ) . '_';
			$definitions = $this->provider_definitions();
			$url         = $this->setting( $prefix . 'UPSTREAM_URL' );
			$key         = $this->setting( $prefix . 'API_KEY' );
			$client      = $this->setting( 'AI_CHAT_CLIENT_ID' );
			return isset( $definitions[ $provider ] )
				&& $this->valid_upstream_url( $url )
				&& $this->valid_header_value( $key, 4096 )
				&& 1 === preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $client )
				&& (bool) $this->models_for( $provider, $definitions[ $provider ] );
		}

		private function models_for( string $provider, array $definition ): array {
			$value  = $this->setting( 'AI_CHAT_' . strtoupper( $provider ) . '_MODELS' );
			$models = '' === $value ? $definition['models'] : explode( ',', $value );
			return array_values(
				array_unique(
					array_filter(
						array_map( 'sanitize_text_field', array_map( 'trim', $models ) ),
						fn( string $model ): bool => $this->valid_model( $provider, $model )
					)
				)
			);
		}

		private function provider_definitions(): array {
			return array(
				'claude'  => array(
					'supports_images' => false,
					'models'          => array( 'claude-sonnet', 'claude-opus', 'claude-fable' ),
				),
				'gemini'  => array(
					'supports_images' => true,
					'models'          => array( 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview' ),
				),
				'chatgpt' => array(
					'supports_images' => true,
					'models'          => array( 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna' ),
				),
			);
		}

		private function valid_upstream_url( string $url ): bool {
			if ( '' === $url || preg_match( '/[\r\n]/', $url ) ) {
				return false;
			}
			$parts = wp_parse_url( $url );
			return is_array( $parts )
				&& in_array( strtolower( (string) ( $parts['scheme'] ?? '' ) ), array( 'http', 'https' ), true )
				&& '' !== (string) ( $parts['host'] ?? '' )
				&& empty( $parts['user'] )
				&& empty( $parts['pass'] )
				&& empty( $parts['fragment'] );
		}

		private function valid_header_value( string $value, int $max_length ): bool {
			return '' !== $value
				&& strlen( $value ) <= $max_length
				&& ! preg_match( '/[\r\n]/', $value );
		}

		private function valid_model( string $provider, string $model ): bool {
			if ( '' === $model || strlen( $model ) > 100 ) {
				return false;
			}
			$pattern = match ( $provider ) {
				'claude'  => '/^claude-[a-z0-9._-]+$/',
				'gemini'  => '/^gemini-[a-z0-9._-]+$/',
				'chatgpt' => '/^gpt-[a-z0-9._-]+$/',
				default   => '/(?!)/',
			};
			return 1 === preg_match( $pattern, $model );
		}

		private function setting( string $name ): string {
			if ( defined( $name ) ) {
				return trim( (string) constant( $name ) );
			}
			$value = getenv( $name );
			return false === $value ? '' : trim( (string) $value );
		}

		private function safe_content_type( string $value ): string {
			$type = strtolower( trim( explode( ';', $value )[0] ?? '' ) );
			if ( in_array( $type, array( 'text/event-stream', 'application/x-ndjson', 'application/ndjson', 'application/json-seq', 'application/json' ), true ) ) {
				return $type . ( 'text/event-stream' === $type || 'application/json' === $type ? '; charset=utf-8' : '' );
			}
			return 'application/json; charset=utf-8';
		}

		private function stream_error( string $message ): void {
			$error = wp_json_encode( array( 'error' => array( 'message' => $message ) ) );
			if ( str_starts_with( $this->content_type, 'text/event-stream' ) ) {
				echo 'data: ' . $error . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON protocol frame.
			} else {
				echo $error . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON protocol frame.
			}
			flush();
		}

		private function json_error( int $status, string $code, string $message ): void {
			if ( headers_sent() ) {
				return;
			}
			status_header( $status );
			header( 'Content-Type: application/json; charset=utf-8' );
			header( 'Cache-Control: no-store' );
			header( 'X-Content-Type-Options: nosniff' );
			echo wp_json_encode(
				array(
					'error' => array(
						'code'    => sanitize_key( $code ),
						'message' => $message,
					),
				)
			); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON response.
		}
	}
}
