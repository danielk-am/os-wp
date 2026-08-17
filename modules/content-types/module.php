<?php
/**
 * Module: content-types
 *
 * Was the standalone plugin `os-content-types`. Merged into the OS plugin; the
 * module boundary survives as a directory and a toggle rather than a
 * separate activation. See docs/contracts/MODULES.md.
 *
 * @package OS
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/inc/class-icon-svg-sanitizer.php';
require_once __DIR__ . '/inc/class-type-menus-screen.php';
OS_Type_Menus_Screen::register();
require_once __DIR__ . '/inc/class-dynamic-types.php';

final class Core_Index_Content_Types {

	const VERSION   = '1.1.7';
	const NAMESPACE = 'content-types';
	const REST_NS   = 'content-types/v1';
	const CATEGORY  = 'os-content-types';
	const TYPES     = array (
  'content-type' => 
  array (
    'post_type' => 'os_content_type',
    'singular' => 'Content type',
    'plural' => 'Content types',
    'icon' => 'dashicons-index-card',
    'manage_capability' => 'manage_options',
    'meta' => 
    array (
      'type_key' => 'string',
      'singular' => 'string',
      'plural' => 'string',
      'schema' => 'object',
    ),
  ),
  'csv' =>
  array (
    'post_type' => 'os_csv',
    'singular' => 'CSV table',
    'plural' => 'CSV tables',
    'icon' => 'dashicons-editor-table',
    'meta' => array (),
    'editor' => 'csv',
    'content_editor' => 'csv',
  ),
);

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_types' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_ability_category' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
	}

	public static function menu_icon(): string {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
			. '<path fill="#a7aaad" d="M224.3-2.5c19.8-11.4 44.2-11.4 64 0L464.2 99c19.8 11.4 32 32.6 32 55.4l0 203c0 22.9-12.2 44-32 55.4L288.3 514.5c-19.8 11.4-44.2 11.4-64 0L48.5 413c-19.8-11.4-32-32.6-32-55.4l0-203c0-22.9 12.2-44 32-55.4L224.3-2.5zm207.8 360l0-166.1-143.8 83 0 166.1 143.8-83z"/>'
			. '</svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	public static function register_types(): void {
		foreach ( self::TYPES as $type ) {
			$args = array(
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
			);
			$manage_capability = (string) ( $type['manage_capability'] ?? '' );
			if ( '' !== $manage_capability ) {
				// Structural definitions are site configuration, not ordinary
				// editorial content. Mapping every primitive capability keeps
				// WordPress's native REST controller behind the same boundary
				// as the dedicated, validated settings routes.
				$args['capabilities'] = array_fill_keys(
					array(
						'edit_post',
						'read_post',
						'delete_post',
						'edit_posts',
						'edit_others_posts',
						'delete_posts',
						'publish_posts',
						'read_private_posts',
						'delete_private_posts',
						'delete_published_posts',
						'delete_others_posts',
						'edit_private_posts',
						'edit_published_posts',
						'create_posts',
					),
					$manage_capability
				);
				$args['map_meta_cap'] = false;
			}
			register_post_type(
				$type['post_type'],
				$args
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
						'auth_callback'     => static fn( $allowed, $meta_key, $post_id ) => self::can_access_type( $type )
							&& current_user_can( 'edit_post', (int) $post_id ),
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
				'label'       => 'OS Content Types',
				'description' => 'Abilities owned by OS Content Types.',
			)
		);
	}

	public static function register_abilities(): void {
		foreach ( self::TYPES as $key => $type ) {
			self::register_type_abilities( $key, $type );
		}
	}

	private static function register_type_abilities( string $key, array $type ): void {
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
			static fn() => self::can_list_items( $type ),
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
				'description'         => $label . ' in OS Content Types.',
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
		if ( ! self::can_list_items( $type ) ) {
			return array( 'error' => 'forbidden' );
		}

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
		return self::can_access_type( $type )
			&& $post instanceof WP_Post
			&& $type['post_type'] === $post->post_type
			&& current_user_can( 'read_post', $id );
	}

	private static function can_edit_item( array $type, int $id ): bool {
		$post = get_post( $id );
		return self::can_access_type( $type )
			&& $post instanceof WP_Post
			&& $type['post_type'] === $post->post_type
			&& current_user_can( 'edit_post', $id );
	}

	private static function can_create_item( array $type, array $input ): bool {
		$post_type = get_post_type_object( $type['post_type'] );
		return self::can_access_type( $type )
			&& $post_type instanceof WP_Post_Type
			&& current_user_can( $post_type->cap->create_posts )
			&& self::can_set_status( $type, $input['status'] ?? 'draft' );
	}

	private static function can_update_item( array $type, int $id, array $input ): bool {
		return self::can_edit_item( $type, $id )
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
		$post = get_post( $id );
		return self::can_access_type( $type )
			&& $post instanceof WP_Post
			&& $type['post_type'] === $post->post_type
			&& current_user_can( 'delete_post', $id );
	}

	private static function can_list_items( array $type ): bool {
		return self::can_access_type( $type ) && current_user_can( 'read' );
	}

	private static function can_access_type( array $type ): bool {
		$capability = (string) ( $type['manage_capability'] ?? '' );
		return '' === $capability || current_user_can( $capability );
	}

	private static function create_item( array $type, array $input ): array {
		if ( ! self::can_create_item( $type, $input ) ) {
			return array( 'error' => 'forbidden' );
		}

		$id = wp_insert_post(
			array(
				'post_type'    => $type['post_type'],
				'post_title'   => sanitize_text_field( (string) ( $input['title'] ?? '' ) ),
				'post_content' => self::sanitize_content( $type, (string) ( $input['content'] ?? '' ) ),
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
				$update[ $target ] = 'status' === $source ? self::status( $input[ $source ] ) : ( 'title' === $source ? sanitize_text_field( (string) $input[ $source ] ) : self::sanitize_content( $type, (string) $input[ $source ] ) );
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
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || $type['post_type'] !== $post->post_type || ! current_user_can( 'delete_post', $id ) ) {
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

	private static function sanitize_content( array $type, string $content ): string {
		return 'os_csv' === ( $type['post_type'] ?? '' ) ? $content : wp_kses_post( $content );
	}

	public static function register_routes(): void {
		register_rest_route(
			self::REST_NS,
			'/items',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => static function ( WP_REST_Request $request ) {
						$type = self::type( (string) $request['type'] );
						return $type ? self::can_list_items( $type ) : current_user_can( 'read' );
					},
					'callback'            => static function ( WP_REST_Request $request ) {
						$type = self::type( (string) $request['type'] );
						return $type ? self::list_items( $type, $request->get_params() ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
				array(
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
				),
			)
		);
		register_rest_route(
			self::REST_NS,
			'/items/(?P<id>\d+)',
			array(
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
				array(
					'methods'             => 'PUT,PATCH',
					'permission_callback' => static function ( WP_REST_Request $request ) {
						$type        = self::type( (string) $request['type'] );
						$input       = $request->get_json_params() ?: $request->get_params();
						$input['id'] = (int) $request['id'];
						return $type && self::can_update_item( $type, (int) $request['id'], $input );
					},
					'callback'            => static function ( WP_REST_Request $request ) {
						$type  = self::type( (string) $request['type'] );
						$input = $request->get_json_params() ?: $request->get_params();
						$input['id'] = (int) $request['id'];
						return $type ? self::update_item( $type, $input ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => static function ( WP_REST_Request $request ) {
						$type = self::type( (string) $request['type'] );
						return $type && self::can_delete_item( $type, (int) $request['id'] );
					},
					'callback'            => static function ( WP_REST_Request $request ) {
						$type = self::type( (string) $request['type'] );
						return $type ? self::delete_item( $type, (int) $request['id'] ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
			)
		);
	}

	private static function type( string $key ): ?array {
		return self::TYPES[ sanitize_key( $key ) ] ?? null;
	}
}

( static function (): void {
	if ( ! class_exists( 'Content_Types_For_WordPress' ) ) {
		class_alias( Core_Index_Content_Types::class, 'Content_Types_For_WordPress' );
	}
	if ( ! class_exists( 'Content_Types_For_WordPress_Dynamic_Types' ) ) {
		class_alias( Core_Index_Content_Types_Dynamic_Types::class, 'Content_Types_For_WordPress_Dynamic_Types' );
	}
} )();

Core_Index_Content_Types::register();
Core_Index_Content_Types_Dynamic_Types::register();
OS_Standalone_Admin::boot(
	array(
		'slug' => 'os-content-types', 'name' => 'OS Content Types',
		'mode' => 'content-types', 'rest_ns' => Core_Index_Content_Types::REST_NS,
		'compat_field_options' => array( 'ci_field_groups_content_types_for_wordpress' ),
		'menu_title' => 'Content type', 'position' => '41.0',
		'separator_before' => array( 'position' => '39.0', 'slug' => 'separator-ci-content-library' ),
		'types' => array_replace_recursive(
			Core_Index_Content_Types::TYPES,
			array( 'content-type' => array( 'icon' => Core_Index_Content_Types::menu_icon() ) )
		),
		'menu_types' => array( 'content-type' ),
		'editor_providers' => array( 'llm', 'csv', 'source' ),
		'description' => 'Design WordPress content models and their fields.',
		'ai_chat_instructions' => 'Help administrators design WordPress content types and fields. Ground answers in the visible model, preserve registered keys and stored content, and identify schema changes before suggesting them.',
	),
	OS_PLUGIN_FILE
);
