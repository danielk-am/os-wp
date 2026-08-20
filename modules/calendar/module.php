<?php
/**
 * Module: calendar
 *
 * Was the standalone plugin `os-calendar`. Merged into the OS plugin; the
 * module boundary survives as a directory and a toggle rather than a
 * separate activation. See docs/contracts/MODULES.md.
 *
 * @package OS
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/inc/class-calendar-features.php';
require_once __DIR__ . '/inc/class-calendar-reminders.php';
require_once __DIR__ . '/inc/class-calendar-automations.php';

final class OS_Calendar {

	const VERSION   = '1.2.1';
	const NAMESPACE = 'calendar';
	const REST_NS   = 'calendar/v1';
	const CATEGORY  = 'os-calendar';
	const TYPES     = array (
  'event' => 
  array (
    'namespace' => 'calendar',
    'rest_namespace' => 'calendar/v1',
    'category' => 'os-calendar',
    'product_name' => 'OS Calendar',
    'post_type' => 'os_calendar_event',
    'singular' => 'Event',
    'plural' => 'Events',
    'icon' => 'dashicons-calendar-alt',
    'meta' => 
    array (
      'start' => 'string',
      'end' => 'string',
      'all_day' => 'boolean',
      'location' => 'string',
    ),
  ),
  'reminder' =>
  array (
    'namespace' => 'reminders',
    'rest_namespace' => 'reminders/v1',
    'category' => 'reminders-for-wordpress',
    'product_name' => 'OS Calendar',
    'post_type' => 'os_reminder',
    'singular' => 'Reminder',
    'plural' => 'Reminders',
    'icon' => 'dashicons-bell',
    'meta' =>
    array (
      'due' => 'string',
      'priority' => 'string',
      'completed' => 'boolean',
      'note' => 'string',
    ),
  ),
  'routine' =>
  array (
    'namespace' => 'routines',
    'rest_namespace' => 'routines/v1',
    'category' => 'routines-for-wordpress',
    'product_name' => 'OS Calendar',
    'post_type' => 'os_automation',
    'singular' => 'Automation',
    'plural' => 'Automations',
    'icon' => 'dashicons-controls-repeat',
    'meta' =>
    array (
      'schedule' => 'string',
      'enabled' => 'boolean',
      'steps' => 'object',
    ),
  ),
);

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_types' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_ability_category' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
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
					self::meta_key( $type, $key ),
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
		register_post_meta(
			'os_reminder',
			'os_reminder_note',
			array(
				'type' => 'string', 'single' => true, 'show_in_rest' => true,
				'sanitize_callback' => 'sanitize_textarea_field',
				'auth_callback' => static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id ),
			)
		);
		register_rest_field(
			'os_reminder',
			'os_tags',
			array(
				'get_callback' => static fn( array $post ) => (array) get_post_meta( (int) $post['id'], 'os_tags', true ),
				'update_callback' => static function ( $value, WP_Post $post ): bool {
					update_post_meta( $post->ID, 'os_tags', array_values( array_filter( array_map( 'sanitize_text_field', (array) $value ) ) ) );
					return true;
				},
				'schema' => array( 'type' => 'array', 'items' => array( 'type' => 'string' ), 'context' => array( 'view', 'edit' ) ),
			)
		);
		$automation_meta = array(
			'os_auto_trigger' => 'string', 'os_auto_channel' => 'string',
			'os_auto_method' => 'string', 'os_auto_target' => 'string',
			'os_auto_agent' => 'string', 'os_auto_agent_mode' => 'string',
			'os_auto_model' => 'string', 'os_auto_payload' => 'string',
			'os_auto_body_type' => 'string', 'os_auto_headers' => 'string',
			'ci_auto_priority' => 'string', 'os_auto_tags' => 'string',
			'os_auto_lead_minutes' => 'integer', 'os_auto_digest_time' => 'string',
			'os_auto_then' => 'string', 'os_auto_delay' => 'integer',
			'os_auto_enabled' => 'boolean',
		);
		foreach ( $automation_meta as $key => $value_type ) {
			register_post_meta(
				'os_automation',
				$key,
				array(
					'type' => $value_type, 'single' => true, 'show_in_rest' => true,
					'sanitize_callback' => array( __CLASS__, 'sanitize_meta' ),
					'auth_callback' => static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id ),
				)
			);
		}
	}

	public static function sanitize_meta( $value ) {
		if ( is_array( $value ) ) {
			return map_deep( $value, 'sanitize_text_field' );
		}
		return is_bool( $value ) || is_int( $value ) ? $value : sanitize_text_field( (string) $value );
	}

	private static function meta_key( array $type, string $key ): string {
		return str_replace( '-', '_', (string) $type['namespace'] ) . '_' . $key;
	}

	public static function register_ability_category(): void {
		foreach ( self::TYPES as $type ) {
			wp_register_ability_category(
				$type['category'],
				array(
					'label'       => $type['plural'],
					'description' => $type['plural'] . ' abilities owned by OS Calendar.',
				)
			);
		}
	}

	public static function register_abilities(): void {
		foreach ( self::TYPES as $key => $type ) {
			self::register_type_abilities( $key, $type );
		}
	}

	private static function register_type_abilities( string $key, array $type ): void {
		$list = static fn() => current_user_can( 'read' );
		$base = $type['namespace'] . '/' . $key;

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
			static fn( $input ) => self::list_items( $type, $input ),
			$type
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
			static fn( $input ) => self::read_item( $type, (int) ( $input['id'] ?? 0 ) ),
			$type
		);
		self::ability(
			$base . '-create',
			'Create ' . strtolower( $type['singular']),
			self::write_schema( false ),
			static fn( $input ) => self::can_create_item( $type, (array) $input ),
			static fn( $input ) => self::create_item( $type, $input ),
			$type
		);
		self::ability(
			$base . '-update',
			'Update ' . strtolower( $type['singular']),
			self::write_schema( true ),
			static fn( $input ) => self::can_update_item( $type, (int) ( $input['id'] ?? 0 ), (array) $input ),
			static fn( $input ) => self::update_item( $type, $input ),
			$type
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
			static fn( $input ) => self::delete_item( $type, (int) ( $input['id'] ?? 0 ) ),
			$type
		);
	}

	private static function ability( string $id, string $label, array $input, callable $permission, callable $execute, array $type ): void {
		wp_register_ability(
			$id,
			array(
				'label'               => $label,
				'description'         => $label . ' in ' . $type['product_name'] . '.',
				'category'            => $type['category'],
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
		$post_type = get_post_type_object( $type['post_type'] );
		return $post_type instanceof WP_Post_Type
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
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || $type['post_type'] !== $post->post_type || ! current_user_can( 'delete_post', $id ) ) {
			return array( 'error' => 'forbidden' );
		}
		return array( 'ok' => (bool) wp_trash_post( $id ), 'id' => $id );
	}

	private static function update_meta( array $type, int $id, array $values ): void {
		foreach ( $type['meta'] as $key => $value_type ) {
			if ( array_key_exists( $key, $values ) ) {
				update_post_meta( $id, self::meta_key( $type, $key ), self::sanitize_meta( $values[ $key ] ) );
			}
		}
	}

	private static function serialize( array $type, WP_Post $post ): array {
		$meta = array();
		foreach ( $type['meta'] as $key => $value_type ) {
			$meta[ $key ] = get_post_meta( $post->ID, self::meta_key( $type, $key ), true );
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
		self::register_routes_for_namespace( 'calendar/v1', 'event', true );
		self::register_routes_for_namespace( 'reminders/v1', 'reminder', false );
		self::register_routes_for_namespace( 'routines/v1', 'routine', false );
	}

	private static function register_routes_for_namespace( string $namespace, string $default_key, bool $allow_all ): void {
		register_rest_route(
			$namespace,
			'/items',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => static fn() => current_user_can( 'read' ),
					'callback'            => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type ? self::list_items( $type, $request->get_params() ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type  = self::route_type( $request, $default_key, $allow_all );
						$input = $request->get_json_params() ?: $request->get_params();
						return $type && self::can_create_item( $type, $input );
					},
					'callback'            => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type ? self::create_item( $type, $request->get_json_params() ?: $request->get_params() ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
			)
		);
		register_rest_route(
			$namespace,
			'/items/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type && self::can_read_item( $type, (int) $request['id'] );
					},
					'callback'            => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type ? self::read_item( $type, (int) $request['id'] ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
				array(
					'methods'             => 'PUT,PATCH',
					'permission_callback' => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type        = self::route_type( $request, $default_key, $allow_all );
						$input       = $request->get_json_params() ?: $request->get_params();
						$input['id'] = (int) $request['id'];
						return $type && self::can_update_item( $type, (int) $request['id'], $input );
					},
					'callback'            => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type  = self::route_type( $request, $default_key, $allow_all );
						$input = $request->get_json_params() ?: $request->get_params();
						$input['id'] = (int) $request['id'];
						return $type ? self::update_item( $type, $input ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type && self::can_delete_item( $type, (int) $request['id'] );
					},
					'callback'            => static function ( WP_REST_Request $request ) use ( $default_key, $allow_all ) {
						$type = self::route_type( $request, $default_key, $allow_all );
						return $type ? self::delete_item( $type, (int) $request['id'] ) : new WP_Error( 'invalid_type', 'Unknown product type.', array( 'status' => 400 ) );
					},
				),
			)
		);
	}

	private static function route_type( WP_REST_Request $request, string $default_key, bool $allow_all ): ?array {
		$requested = sanitize_key( (string) $request->get_param( 'type' ) );
		$key       = $requested ?: $default_key;
		if ( ! $allow_all && $key !== $default_key ) {
			return null;
		}
		return self::type( $key );
	}

	private static function type( string $key ): ?array {
		return self::TYPES[ sanitize_key( $key ) ] ?? null;
	}
}

( static function (): void {
	if ( ! class_exists( 'Calendar_For_WordPress' ) ) {
		class_alias( OS_Calendar::class, 'Calendar_For_WordPress' );
	}
	if ( ! class_exists( 'Calendar_For_WordPress_Features' ) ) {
		class_alias( OS_Calendar_Features::class, 'Calendar_For_WordPress_Features' );
	}
	if ( ! class_exists( 'Calendar_For_WordPress_Reminders' ) ) {
		class_alias( OS_Calendar_Reminders::class, 'Calendar_For_WordPress_Reminders' );
	}
	if ( ! class_exists( 'Calendar_For_WordPress_Automations' ) ) {
		class_alias( OS_Calendar_Automations::class, 'Calendar_For_WordPress_Automations' );
	}
} )();

OS_Calendar::register();
OS_Calendar_Features::register();
OS_Calendar_Reminders::register();
OS_Calendar_Automations::register();
OS_Standalone_Admin::boot(
	array(
		'slug' => 'os-calendar', 'name' => 'OS Calendar',
		'mode' => 'calendar', 'rest_ns' => OS_Calendar::REST_NS,
		'compat_rest_namespaces' => array( 'reminders/v1', 'routines/v1' ),
		'compat_field_options' => array(
			'ci_field_groups_calendar_for_wordpress',
			'ci_field_groups_reminders_for_wordpress',
			'ci_field_groups_routines_for_wordpress',
		),
		'menu_title' => 'Calendar', 'position' => '3.0', 'menu_priority' => 38,
		'types' => OS_Calendar::TYPES,
		'description' => 'Plan events, keep reminders visible, and automate scheduled work.',
		'ai_chat_instructions' => 'Help administrators work with this calendar. Ground answers in the visible events, reminders, and automations, preserve dates and time zones, and clearly distinguish suggestions from scheduled changes.',
	),
	OS_PLUGIN_FILE
);

register_activation_hook( __FILE__, array( OS_Calendar_Reminders::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( OS_Calendar_Reminders::class, 'deactivate' ) );
