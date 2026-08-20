<?php
/**
 * Module: wiki
 *
 * Was the standalone plugin `os-wiki`. Merged into the OS plugin; the
 * module boundary survives as a directory and a toggle rather than a
 * separate activation. See docs/contracts/MODULES.md.
 *
 * @package OS
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/inc/class-memory-capture.php';
require_once __DIR__ . '/inc/class-llm-provider.php';

final class OS_AI_Library {

	const VERSION   = '1.2.2';
	const NAMESPACE = 'llm-wiki';
	const REST_NS   = 'llm-wiki/v1';
	const CATEGORY  = 'os-wiki';
	const TYPES     = array (
  'skill' => 
  array (
    'post_type' => 'os_skill',
    'singular' => 'Skill',
    'plural' => 'Skills',
    'icon' => 'dashicons-lightbulb',
    'meta' => 
    array (
      'path' => 'string',
      'format' => 'string',
    ),
  ),
  'wiki' => 
  array (
    'post_type' => 'os_wiki',
    'singular' => 'Wiki page',
    'plural' => 'Wiki',
    'icon' => 'dashicons-book-alt',
    'meta' => 
    array (
      'path' => 'string',
      'format' => 'string',
    ),
  ),
  'memory' => 
  array (
    'post_type' => 'os_memory',
    'singular' => 'Memory',
    'plural' => 'Memory',
    'icon' => 'dashicons-database',
    'meta' => 
    array (
      'path' => 'string',
      'importance' => 'integer',
    ),
  ),
  'snippet' =>
  array (
    'post_type' => 'os_snippet',
    'singular' => 'Snippet',
    'plural' => 'Snippets',
    'icon' => 'dashicons-shortcode',
    'meta' =>
    array (
      'path' => 'string',
      'kind' => 'string',
    ),
  ),
);

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_types' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_ability_category' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
		foreach ( self::TYPES as $type ) {
			add_filter( 'rest_pre_insert_' . $type['post_type'], array( __CLASS__, 'block_rest_mutation' ), 10, 2 );
		}
	}

	public static function is_read_only(): bool {
		$read_only = defined( 'CORE_INDEX_AI_LIBRARY_READ_ONLY' ) && CORE_INDEX_AI_LIBRARY_READ_ONLY;
		return (bool) apply_filters( 'core_index_ai_library_read_only', $read_only );
	}

	public static function block_rest_mutation( $prepared_post, WP_REST_Request $request ) {
		if ( self::is_read_only() ) {
			return new WP_Error(
				'core_index_read_only',
				'Core Index is a read-only legacy view. Save Memory, Skills, and Wiki through Core Vault.',
				array( 'status' => 403 )
			);
		}

		return $prepared_post;
	}

	public static function menu_icon(): string {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
			. '<path fill="#a7aaad" transform="translate(32 0)" d="M338.8-9.9c11.9 8.6 16.3 24.2 10.9 37.8L271.3 224 416 224c13.5 0 25.5 8.4 30.1 21.1s.7 26.9-9.6 35.5l-288 240c-11.3 9.4-27.4 9.9-39.3 1.3s-16.3-24.2-10.9-37.8L176.7 288 32 288c-13.5 0-25.5-8.4-30.1-21.1s-.7-26.9 9.6-35.5l288-240c11.3-9.4 27.4-9.9 39.3-1.3z"/>'
			. '</svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	public static function register_types(): void {
		foreach ( self::TYPES as $type ) {
			register_post_type(
				$type['post_type'],
				array(
									'labels' => array(
						'name'          => $type['plural'],
						'singular_name' => $type['singular'],
						'add_new_item'  => 'Add new ' . strtolower( $type['singular'] ),
						'edit_item'     => 'Edit ' . strtolower( $type['singular'] ),
					),
					'public'       => false,
					'show_ui'      => false,
					'show_in_rest' => true,
					'menu_icon'    => $type['icon'],
					'supports'     => array( 'title', 'editor', 'excerpt', 'revisions', 'custom-fields' ),
					'map_meta_cap' => true,
				)
			);
			foreach ( $type['meta'] as $key => $value_type ) {
				register_post_meta(
					$type['post_type'],
					self::meta_key( $key ),
					array(
						'type'              => $value_type,
						'single'            => true,
						'show_in_rest'      => true,
						'sanitize_callback' => array( __CLASS__, 'sanitize_meta' ),
						'auth_callback'     => static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id ),
					)
				);
			}
		}
	}

	public static function sanitize_meta( $value ) {
		if ( is_array( $value ) ) {
			return map_deep( $value, 'sanitize_text_field' );
		}
		return is_bool( $value ) || is_int( $value ) ? $value : sanitize_text_field( (string) $value );
	}

	private static function meta_key( string $key ): string {
		return str_replace( '-', '_', self::NAMESPACE ) . '_' . $key;
	}

	public static function register_ability_category(): void {
		wp_register_ability_category(
			self::CATEGORY,
			array(
				'label'       => 'OS Wiki',
				'description' => 'Abilities owned by OS Wiki.',
			)
		);
	}

	public static function register_abilities(): void {
		foreach ( self::TYPES as $key => $type ) {
			self::register_type_abilities( $key, $type );
		}
	}

	private static function register_type_abilities( string $key, array $type ): void {
		$list = static fn() => current_user_can( 'read' );
		$base = self::NAMESPACE . '/' . $key;

		self::ability(
			$base . '-list',
			'List ' . strtolower( $type['plural'] ),
			array(
				'type'       => 'object',
				'properties' => array(
					'search' => array( 'type' => 'string' ),
					'limit'  => array( 'type' => 'integer', 'default' => 100, 'minimum' => 1, 'maximum' => 500 ),
				),
			),
			$list,
			static fn( $input ) => self::list_items( $type, $input )
		);
		self::ability(
			$base . '-read',
			'Read ' . strtolower( $type['singular']),
			array(
				'type'       => 'object',
				'required'   => array( 'id' ),
				'properties' => array( 'id' => array( 'type' => 'integer' ) ),
			),
			static fn( $input ) => self::can_read_item( $type, (int) ( $input['id'] ?? 0 ) ),
			static fn( $input ) => self::read_item( $type, (int) ( $input['id'] ?? 0 ) )
		);
		if ( self::is_read_only() ) {
			return;
		}
		self::ability(
			$base . '-create',
			'Create ' . strtolower( $type['singular']),
			self::write_schema( false ),
			static fn( $input ) => self::can_create_item( $type, (array) $input ),
			static fn( $input ) => self::create_item( $type, $input )
		);
		self::ability(
			$base . '-update',
			'Update ' . strtolower( $type['singular']),
			self::write_schema( true ),
			static fn( $input ) => self::can_update_item( $type, (int) ( $input['id'] ?? 0 ), (array) $input ),
			static fn( $input ) => self::update_item( $type, $input )
		);
		self::ability(
			$base . '-delete',
			'Trash ' . strtolower( $type['singular']),
			array(
				'type'       => 'object',
				'required'   => array( 'id' ),
				'properties' => array( 'id' => array( 'type' => 'integer' ) ),
			),
			static fn( $input ) => self::can_delete_item( $type, (int) ( $input['id'] ?? 0 ) ),
			static fn( $input ) => self::delete_item( $type, (int) ( $input['id'] ?? 0 ) )
		);
	}

	private static function ability( string $id, string $label, array $input, callable $permission, callable $execute ): void {
		wp_register_ability(
			$id,
			array(
				'label'               => $label,
				'description'         => $label . ' in OS Wiki.',
				'category'            => self::CATEGORY,
				'input_schema'        => $input,
				'output_schema'       => array( 'type' => 'object' ),
				'permission_callback' => $permission,
				'execute_callback'    => $execute,
				'meta'                => array( 'mcp' => array( 'public' => true ) ),
			)
		);
	}

	private static function write_schema( bool $with_id ): array {
		$properties = array(
			'title'   => array( 'type' => 'string' ),
			'content' => array( 'type' => 'string' ),
			'status'  => array( 'type' => 'string', 'enum' => array( 'draft', 'publish', 'private' ), 'default' => 'draft' ),
			'meta'    => array( 'type' => 'object' ),
		);
		if ( $with_id ) {
			$properties['id'] = array( 'type' => 'integer' );
		}
		return array(
			'type'       => 'object',
			'required'   => $with_id ? array( 'id' ) : array( 'title' ),
			'properties' => $properties,
		);
	}

	private static function list_items( array $type, array $input ): array {
		$posts = get_posts(
			array(
				'post_type'      => $type['post_type'],
				'post_status'    => array( 'publish', 'private', 'draft' ),
				'posts_per_page' => max( 1, min( 500, (int) ( $input['limit'] ?? 100 ) ) ),
				's'              => sanitize_text_field( (string) ( $input['search'] ?? '' ) ),
				'orderby'        => 'modified',
				'order'          => 'DESC',
			)
		);
		$posts = array_filter( $posts, static fn( $post ) => current_user_can( 'read_post', $post->ID ) );
		return array( 'items' => array_map( static fn( $post ) => self::serialize( $type, $post ), $posts ) );
	}

	private static function read_item( array $type, int $id ): array {
		$post = get_post( $id );
		return $post instanceof WP_Post && $type['post_type'] === $post->post_type && current_user_can( 'read_post', $id )
			? self::serialize( $type, $post )
			: array( 'error' => 'not_found' );
	}

	private static function can_read_item( array $type, int $id ): bool {
		$post = get_post( $id );
		return $post instanceof WP_Post && $type['post_type'] === $post->post_type && current_user_can( 'read_post', $id );
	}

	private static function can_edit_item( array $type, int $id ): bool {
		$post = get_post( $id );
		return $post instanceof WP_Post && $type['post_type'] === $post->post_type && current_user_can( 'edit_post', $id );
	}

	private static function can_create_item( array $type, array $input ): bool {
		if ( self::is_read_only() ) {
			return false;
		}
		$post_type = get_post_type_object( $type['post_type'] );
		return $post_type instanceof WP_Post_Type
			&& current_user_can( $post_type->cap->create_posts )
			&& self::can_set_status( $type, $input['status'] ?? 'draft' );
	}

	private static function can_update_item( array $type, int $id, array $input ): bool {
		return ! self::is_read_only()
			&& self::can_edit_item( $type, $id )
			&& ( ! array_key_exists( 'status', $input ) || self::can_set_status( $type, $input['status'] ) );
	}

	private static function can_set_status( array $type, $status ): bool {
		$status = self::status( $status );
		if ( 'draft' === $status ) {
			return true;
		}

		$post_type = get_post_type_object( $type['post_type'] );
		return $post_type instanceof WP_Post_Type && current_user_can( $post_type->cap->publish_posts );
	}

	private static function can_delete_item( array $type, int $id ): bool {
		if ( self::is_read_only() ) {
			return false;
		}
		$post = get_post( $id );
		return $post instanceof WP_Post && $type['post_type'] === $post->post_type && current_user_can( 'delete_post', $id );
	}

	private static function create_item( array $type, array $input ): array {
		if ( ! self::can_create_item( $type, $input ) ) {
			return array( 'error' => 'forbidden' );
		}

		$id = wp_insert_post(
			array(
				'post_type'    => $type['post_type'],
				'post_title'   => sanitize_text_field( (string) ( $input['title'] ?? '' ) ),
				'post_content' => wp_kses_post( (string) ( $input['content'] ?? '' ) ),
				'post_status'  => self::status( $input['status'] ?? 'draft' ),
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return array( 'error' => $id->get_error_message() );
		}
		self::update_meta( $type, (int) $id, (array) ( $input['meta'] ?? array() ) );
		return self::read_item( $type, (int) $id );
	}

	private static function update_item( array $type, array $input ): array {
		$id   = (int) ( $input['id'] ?? 0 );
		if ( ! self::can_update_item( $type, $id, $input ) ) {
			return array( 'error' => 'forbidden' );
		}
		$update = array( 'ID' => $id );
		foreach ( array( 'title' => 'post_title', 'content' => 'post_content', 'status' => 'post_status' ) as $source => $target ) {
			if ( array_key_exists( $source, $input ) ) {
				$update[ $target ] = 'status' === $source ? self::status( $input[ $source ] ) : ( 'title' === $source ? sanitize_text_field( (string) $input[ $source ] ) : wp_kses_post( (string) $input[ $source ] ) );
			}
		}
		$result = wp_update_post( $update, true );
		if ( is_wp_error( $result ) ) {
			return array( 'error' => $result->get_error_message() );
		}
		self::update_meta( $type, $id, (array) ( $input['meta'] ?? array() ) );
		return self::read_item( $type, $id );
	}

	private static function delete_item( array $type, int $id ): array {
		if ( ! self::can_delete_item( $type, $id ) ) {
			return array( 'error' => 'forbidden' );
		}
		return array( 'ok' => (bool) wp_trash_post( $id ), 'id' => $id );
	}

	private static function update_meta( array $type, int $id, array $values ): void {
		foreach ( $type['meta'] as $key => $value_type ) {
			if ( array_key_exists( $key, $values ) ) {
				update_post_meta( $id, self::meta_key( $key ), self::sanitize_meta( $values[ $key ] ) );
			}
		}
	}

	private static function serialize( array $type, WP_Post $post ): array {
		$meta = array();
		foreach ( $type['meta'] as $key => $value_type ) {
			$meta[ $key ] = get_post_meta( $post->ID, self::meta_key( $key ), true );
		}
		return array(
			'id'       => (int) $post->ID,
			'title'    => (string) $post->post_title,
			'content'  => (string) $post->post_content,
			'status'   => (string) $post->post_status,
			'modified' => (string) $post->post_modified_gmt,
			'meta'     => $meta,
			'edit_url' => get_edit_post_link( $post->ID, 'raw' ),
		);
	}

	private static function status( $status ): string {
		return in_array( $status, array( 'draft', 'publish', 'private' ), true ) ? $status : 'draft';
	}

	public static function register_routes(): void {
		$item_routes = array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static fn() => current_user_can( 'read' ),
				'callback'            => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type ? self::list_items( $type, $request->get_params() ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
				},
			),
		);
		$single_routes = array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type && self::can_read_item( $type, (int) $request['id'] );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type ? self::read_item( $type, (int) $request['id'] ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
				},
			),
		);

		if ( ! self::is_read_only() ) {
			$item_routes[] = array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static function ( WP_REST_Request $request ) {
					$type  = self::type( (string) $request['type'] );
					$input = $request->get_json_params() ?: $request->get_params();
					return $type && self::can_create_item( $type, $input );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type ? self::create_item( $type, $request->get_json_params() ?: $request->get_params() ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
				},
			);
			$single_routes[] = array(
				'methods'             => 'PUT,PATCH',
				'permission_callback' => static function ( WP_REST_Request $request ) {
					$type        = self::type( (string) $request['type'] );
					$input       = $request->get_json_params() ?: $request->get_params();
					$input['id'] = (int) $request['id'];
					return $type && self::can_update_item( $type, (int) $request['id'], $input );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$type        = self::type( (string) $request['type'] );
					$input       = $request->get_json_params() ?: $request->get_params();
					$input['id'] = (int) $request['id'];
					return $type ? self::update_item( $type, $input ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
				},
			);
			$single_routes[] = array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type && self::can_delete_item( $type, (int) $request['id'] );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$type = self::type( (string) $request['type'] );
					return $type ? self::delete_item( $type, (int) $request['id'] ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
				},
			);
		}

		register_rest_route(
			self::REST_NS,
			'/items',
			$item_routes
		);
		register_rest_route(
			self::REST_NS,
			'/items/(?P<id>\d+)',
			$single_routes
		);
	}

	private static function type( string $key ): ?array {
		return self::TYPES[ sanitize_key( $key ) ] ?? null;
	}
}


OS_AI_Library::register();
OS_AI_Library_Memory_Capture::register();
OS_AI_Library_LLM_Provider::register();
OS_Standalone_Admin::boot(
	array(
		'slug' => 'os-wiki', 'name' => 'OS Wiki',
		'mode' => 'wiki', 'rest_ns' => OS_AI_Library::REST_NS,
		'compat_field_options' => array( 'ci_field_groups_llm_wiki_for_wordpress' ),
		'menu_title' => 'AI library', 'menu_icon' => OS_AI_Library::menu_icon(),
		'position' => '40.0',
		'menu_priority' => 41,
		'separator_before' => array( 'position' => '39.0', 'slug' => 'separator-os-content-library' ),
		'grouped_menu_types' => array( 'skill', 'wiki', 'memory' ),
		'types' => OS_AI_Library::TYPES,
		'description' => 'Author durable skills, wiki pages, memory, and snippets for people and agents.',
		'ai_chat_instructions' => 'Help administrators curate this AI library. Ground answers in visible skills, wiki pages, and memory, distinguish durable source material from suggestions, and keep private content within WordPress permissions.',
	),
	OS_PLUGIN_FILE
);
