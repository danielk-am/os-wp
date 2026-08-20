<?php
/**
 * Boot declared types and serve them over both interfaces.
 *
 * One domain core, two clients. Every REST route and every ability in here
 * calls the same `list_items`, `read_item`, `create_item`, `update_item`, and
 * `delete_item`, with argument schemas generated from the same declaration, so
 * the API and the agent surface cannot drift apart or gain a capability the
 * other lacks.
 *
 * Declared types register at `init:25`, ahead of the stored-definition path at
 * `init:30`, so the file wins. That path already skips a key when
 * `post_type_exists()`, so no extra coordination is needed.
 *
 * See docs/contracts/TYPE-SCHEMA.md.
 *
 * @package OS_Content_Types
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-type-declaration.php';
require_once __DIR__ . '/class-type-compiler.php';

final class OS_Type_Runtime {

	const REST_NS  = 'content-types/v1';
	const CATEGORY = 'os-content-types';

	/** @var array|null Cached normalised declaration. */
	private static ?array $declaration = null;

	/**
	 * Hook the runtime up.
	 */
	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_types' ), 25 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
		add_action( 'admin_notices', array( __CLASS__, 'render_errors' ) );
	}

	/**
	 * Where the declaration lives.
	 *
	 * Filterable so a site can keep it in a versioned directory rather than
	 * beside uploads.
	 *
	 * @return string
	 */
	public static function path(): string {
		$default = defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/types.json' : '';
		return (string) apply_filters( 'os_types_declaration_path', $default );
	}

	/**
	 * The normalised declaration, read once per request.
	 *
	 * @return array{version:int,types:array,errors:array}
	 */
	public static function declaration(): array {
		if ( null === self::$declaration ) {
			$path              = self::path();
			self::$declaration = '' !== $path && is_readable( $path )
				? OS_Type_Declaration::load( $path )
				: array(
					'version' => 1,
					'types'   => array(),
					'errors'  => array(),
				);
		}
		return self::$declaration;
	}

	/**
	 * Every declared type, keyed by post type.
	 *
	 * @return array<string,array>
	 */
	public static function types(): array {
		return self::declaration()['types'];
	}

	/**
	 * One declared type, or null.
	 *
	 * @param string $key Type key.
	 * @return array|null
	 */
	public static function type( string $key ): ?array {
		return self::types()[ sanitize_key( $key ) ] ?? null;
	}

	/**
	 * Register every declared type and its typed meta.
	 */
	public static function register_types(): void {
		foreach ( self::types() as $key => $type ) {
			if ( post_type_exists( $key ) ) {
				// Never clobber an existing type. Invariant 1: report, do not
				// silently skip.
				self::$declaration['errors'][] = sprintf( 'Type "%s" is already registered elsewhere and was skipped.', $key );
				unset( self::$declaration['types'][ $key ] );
				continue;
			}
			$registered = register_post_type( $key, OS_Type_Compiler::post_type_args( $type ) );
			if ( is_wp_error( $registered ) ) {
				self::$declaration['errors'][] = sprintf( 'Type "%s" failed to register: %s', $key, $registered->get_error_message() );
				unset( self::$declaration['types'][ $key ] );
				continue;
			}
			foreach ( $type['fields'] as $field ) {
				$args                      = OS_Type_Compiler::meta_args( $field );
				$args['sanitize_callback'] = static fn( $value ) => self::sanitize( $field, $value );
				$args['auth_callback']     = static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id );
				register_post_meta( $key, $field['key'], $args );
			}
		}
	}

	/**
	 * Register one REST route per operation, with generated args.
	 */
	public static function register_routes(): void {
		foreach ( self::types() as $key => $type ) {
			register_rest_route(
				self::REST_NS,
				OS_Type_Compiler::path( $key, 'list' ),
				array(
					array(
						'methods'             => 'GET',
						'args'                => OS_Type_Compiler::rest_args( $type, 'list' ),
						'permission_callback' => static fn() => self::can( $key, 'list' ),
						'callback'            => static fn( $request ) => self::list_items( $key, $request->get_params() ),
					),
					array(
						'methods'             => 'POST',
						'args'                => OS_Type_Compiler::rest_args( $type, 'create' ),
						'permission_callback' => static fn() => self::can( $key, 'create' ),
						'callback'            => static fn( $request ) => self::create_item( $key, self::input( $request ) ),
					),
				)
			);
			register_rest_route(
				self::REST_NS,
				'/' . $key . '/(?P<id>\d+)',
				array(
					array(
						'methods'             => 'GET',
						'args'                => OS_Type_Compiler::rest_args( $type, 'read' ),
						'permission_callback' => static fn( $request ) => self::can( $key, 'read', (int) $request['id'] ),
						'callback'            => static fn( $request ) => self::read_item( $key, (int) $request['id'] ),
					),
					array(
						'methods'             => 'PUT',
						'args'                => OS_Type_Compiler::rest_args( $type, 'update' ),
						'permission_callback' => static fn( $request ) => self::can( $key, 'update', (int) $request['id'] ),
						'callback'            => static fn( $request ) => self::update_item( $key, (int) $request['id'], self::input( $request ) ),
					),
					array(
						'methods'             => 'DELETE',
						'args'                => OS_Type_Compiler::rest_args( $type, 'delete' ),
						'permission_callback' => static fn( $request ) => self::can( $key, 'delete', (int) $request['id'] ),
						'callback'            => static fn( $request ) => self::delete_item( $key, (int) $request['id'] ),
					),
				)
			);
		}
	}

	/**
	 * Register one ability per operation, against the same core.
	 */
	public static function register_abilities(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}
		foreach ( self::types() as $key => $type ) {
			foreach ( OS_Type_Compiler::OPERATIONS as $operation ) {
				wp_register_ability(
					sprintf( 'content-types/%s-%s', $key, $operation ),
					array(
						'label'               => sprintf( '%s %s', ucfirst( $operation ), $type['plural'] ),
						'description'         => sprintf( '%s %s records.', ucfirst( $operation ), strtolower( $type['singular'] ) ),
						'category'            => self::CATEGORY,
						'input_schema'        => OS_Type_Compiler::ability_input_schema( $type, $operation ),
						'output_schema'       => OS_Type_Compiler::ability_output_schema( $type, $operation ),
						'permission_callback' => static fn( $input = array() ) => self::can( $key, $operation, (int) ( $input['id'] ?? 0 ) ),
						'execute_callback'    => static fn( $input = array() ) => self::execute( $key, $operation, (array) $input ),
						'meta'                => array( 'mcp' => array( 'public' => true ) ),
					)
				);
			}
		}
	}

	/**
	 * Route an ability call into the same core the REST layer uses.
	 *
	 * @param string $key       Type key.
	 * @param string $operation Operation.
	 * @param array  $input     Ability input.
	 * @return array|WP_Error
	 */
	private static function execute( string $key, string $operation, array $input ) {
		switch ( $operation ) {
			case 'read':
				return self::read_item( $key, (int) ( $input['id'] ?? 0 ) );
			case 'create':
				return self::create_item( $key, $input );
			case 'update':
				return self::update_item( $key, (int) ( $input['id'] ?? 0 ), $input );
			case 'delete':
				return self::delete_item( $key, (int) ( $input['id'] ?? 0 ) );
			default:
				return self::list_items( $key, $input );
		}
	}

	/**
	 * Capability check for one operation.
	 *
	 * Record-level rules are declared but not enforced yet, so capabilities are
	 * the whole boundary today. A declaration's `rules` block is carried through
	 * untouched so it stays valid once rules land.
	 *
	 * @param string $key       Type key.
	 * @param string $operation Operation.
	 * @param int    $id        Record id, where the operation has one.
	 * @return bool
	 */
	private static function can( string $key, string $operation, int $id = 0 ): bool {
		$object = get_post_type_object( $key );
		if ( ! $object ) {
			return false;
		}
		$caps = $object->cap;
		switch ( $operation ) {
			case 'create':
				return current_user_can( $caps->create_posts );
			case 'update':
				return $id > 0 && current_user_can( $caps->edit_post, $id );
			case 'delete':
				return $id > 0 && current_user_can( $caps->delete_post, $id );
			case 'read':
				return $id > 0 && current_user_can( $caps->read_post, $id );
			default:
				return current_user_can( $caps->edit_posts );
		}
	}

	/**
	 * List records.
	 *
	 * Filters run through meta_query until the `os_field_index` projection
	 * table lands. Only indexed fields are offered as filters, so the slow path
	 * stays bounded to what the index will later cover.
	 *
	 * @param string $key   Type key.
	 * @param array  $input Query input.
	 * @return array
	 */
	public static function list_items( string $key, array $input ): array {
		$type = self::type( $key );
		if ( ! $type ) {
			return array(
				'items' => array(),
				'total' => 0,
			);
		}
		$per_page = min( 100, max( 1, (int) ( $input['per_page'] ?? 20 ) ) );
		$args     = array(
			'post_type'      => $key,
			'post_status'    => array( 'publish', 'draft', 'private' ),
			'posts_per_page' => $per_page,
			'paged'          => max( 1, (int) ( $input['page'] ?? 1 ) ),
			's'              => (string) ( $input['search'] ?? '' ),
		);
		$meta = array();
		foreach ( $type['fields'] as $field ) {
			if ( empty( $field['index'] ) || ! isset( $input[ $field['key'] ] ) ) {
				continue;
			}
			$meta[] = array(
				'key'   => $field['key'],
				'value' => $input[ $field['key'] ],
			);
		}
		if ( array() !== $meta ) {
			$args['meta_query'] = $meta; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
		}
		$query = new WP_Query( $args );
		return array(
			'items' => array_map( static fn( $post ) => self::record( $type, $post ), $query->posts ),
			'total' => (int) $query->found_posts,
		);
	}

	/**
	 * Read one record.
	 *
	 * @param string $key Type key.
	 * @param int    $id  Record id.
	 * @return array|WP_Error
	 */
	public static function read_item( string $key, int $id ) {
		$type = self::type( $key );
		$post = $id > 0 ? get_post( $id ) : null;
		if ( ! $type || ! $post || $post->post_type !== $key ) {
			return new WP_Error( 'os_not_found', 'Record not found.', array( 'status' => 404 ) );
		}
		return self::record( $type, $post );
	}

	/**
	 * Create one record.
	 *
	 * @param string $key   Type key.
	 * @param array  $input Field values.
	 * @return array|WP_Error
	 */
	public static function create_item( string $key, array $input ) {
		$type = self::type( $key );
		if ( ! $type ) {
			return new WP_Error( 'os_unknown_type', 'Unknown type.', array( 'status' => 400 ) );
		}
		$id = wp_insert_post(
			array(
				'post_type'    => $key,
				'post_status'  => 'publish',
				'post_title'   => sanitize_text_field( (string) ( $input['title'] ?? '' ) ),
				'post_content' => (string) ( $input['content'] ?? '' ),
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}
		self::save_fields( $type, (int) $id, $input );
		return self::read_item( $key, (int) $id );
	}

	/**
	 * Update one record.
	 *
	 * An update is a patch. A field absent from the input is left alone.
	 *
	 * @param string $key   Type key.
	 * @param int    $id    Record id.
	 * @param array  $input Field values.
	 * @return array|WP_Error
	 */
	public static function update_item( string $key, int $id, array $input ) {
		$existing = self::read_item( $key, $id );
		if ( is_wp_error( $existing ) ) {
			return $existing;
		}
		$type   = self::type( $key );
		$update = array( 'ID' => $id );
		if ( isset( $input['title'] ) ) {
			$update['post_title'] = sanitize_text_field( (string) $input['title'] );
		}
		if ( isset( $input['content'] ) ) {
			$update['post_content'] = (string) $input['content'];
		}
		if ( count( $update ) > 1 ) {
			$saved = wp_update_post( $update, true );
			if ( is_wp_error( $saved ) ) {
				return $saved;
			}
		}
		self::save_fields( $type, $id, $input );
		return self::read_item( $key, $id );
	}

	/**
	 * Delete one record.
	 *
	 * Trash, never force. Deleting data is the one thing this layer will not do
	 * on its own authority.
	 *
	 * @param string $key Type key.
	 * @param int    $id  Record id.
	 * @return array|WP_Error
	 */
	public static function delete_item( string $key, int $id ) {
		$existing = self::read_item( $key, $id );
		if ( is_wp_error( $existing ) ) {
			return $existing;
		}
		$trashed = wp_trash_post( $id );
		return array(
			'id'      => $id,
			'deleted' => (bool) $trashed,
		);
	}

	/**
	 * Write declared fields, ignoring anything undeclared.
	 *
	 * @param array $type  Normalised type.
	 * @param int   $id    Record id.
	 * @param array $input Input values.
	 */
	private static function save_fields( array $type, int $id, array $input ): void {
		foreach ( $type['fields'] as $field ) {
			if ( ! array_key_exists( $field['key'], $input ) ) {
				continue;
			}
			update_post_meta( $id, $field['key'], self::sanitize( $field, $input[ $field['key'] ] ) );
		}
	}

	/**
	 * Build the record shape the output schema promises.
	 *
	 * @param array   $type Normalised type.
	 * @param WP_Post $post Post.
	 * @return array
	 */
	private static function record( array $type, $post ): array {
		$record = array(
			'id'     => (int) $post->ID,
			'status' => (string) $post->post_status,
		);
		if ( in_array( 'title', $type['supports'], true ) ) {
			$record['title'] = (string) $post->post_title;
		}
		if ( in_array( 'editor', $type['supports'], true ) ) {
			$record['content'] = (string) $post->post_content;
		}
		foreach ( $type['fields'] as $field ) {
			$record[ $field['key'] ] = self::sanitize( $field, get_post_meta( (int) $post->ID, $field['key'], true ) );
		}
		return $record;
	}

	/**
	 * Cast and clean one value against its declared type.
	 *
	 * Core already validated the value against the schema at the REST boundary.
	 * This is the second line, for ability calls and direct writes.
	 *
	 * @param array $field Normalised field.
	 * @param mixed $value Raw value.
	 * @return mixed
	 */
	private static function sanitize( array $field, $value ) {
		$primitive = OS_Type_Compiler::meta_primitive( $field );
		if ( 'array' === $primitive ) {
			$items = is_array( $value ) ? $value : array();
			$of    = 'relation' === $field['type'] ? 'integer' : (string) ( $field['items']['type'] ?? 'string' );
			return array_values(
				array_map(
					static fn( $item ) => 'integer' === $of ? (int) $item : sanitize_text_field( (string) $item ),
					$items
				)
			);
		}
		switch ( $primitive ) {
			case 'integer':
				return (int) $value;
			case 'number':
				return (float) $value;
			case 'boolean':
				return (bool) $value;
			case 'object':
				return is_array( $value ) ? map_deep( $value, 'sanitize_text_field' ) : array();
			default:
				return sanitize_text_field( (string) $value );
		}
	}

	/**
	 * Merge a REST request's body and query into one input array.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	private static function input( $request ): array {
		$body = $request->get_json_params();
		return is_array( $body ) && array() !== $body ? $body : (array) $request->get_params();
	}

	/**
	 * Surface declaration errors where someone will see them.
	 */
	public static function render_errors(): void {
		$errors = self::declaration()['errors'];
		if ( array() === $errors || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		echo '<div class="notice notice-error"><p><strong>Type declaration</strong></p><ul style="list-style:disc;margin-left:20px">';
		foreach ( $errors as $error ) {
			echo '<li>' . esc_html( (string) $error ) . '</li>';
		}
		echo '</ul></div>';
	}
}
