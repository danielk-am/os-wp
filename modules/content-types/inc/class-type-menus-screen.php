<?php
/**
 * Content type → Menus & icons: where every type's place in the sidebar is
 * decided. Menu label, icon, and position, for built-in and user-defined types
 * alike; same shape as Secure Custom Fields, one screen, no code.
 *
 * The screen itself is a WPDS app page (assets/os-app-type-menus.js), the same
 * grammar as every other surface of the plugin; this class supplies the admin
 * page mount and the REST endpoints behind it. Cosmetic configuration has no
 * recovery role, so unlike the OS Modules screen it has no reason to avoid the
 * app runtime. Writes one option, `os_type_menus`, which the shared runtime
 * reads when building menus.
 *
 * @package OS_Content_Types
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OS_Type_Menus_Screen {

	const OPTION = 'os_type_menus';

	/**
	 * Prefixed with the content-types app's own page slug on purpose: the
	 * shared runtime treats any page starting with a type's slug as its own,
	 * so this page gets the app shell, assets, and importmap for free, and
	 * `initial_route()` maps the `-menus` suffix to the /type-menus route.
	 */
	const SLUG = 'os-content-types-content-type-menus';

	const REST_NS = 'content-types/v1';

	public static function register(): void {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ), 60 );
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function add_page(): void {
		add_submenu_page(
			'os-content-types-content-type',
			__( 'Menus & icons', 'os' ),
			__( 'Menus & icons', 'os' ),
			'manage_options',
			self::SLUG,
			static function (): void {
				echo '<div class="wrap" style="margin:0;padding:0;max-width:none"><div id="os-app-root"></div></div>';
			}
		);
	}

	public static function routes(): void {
		$can = static fn(): bool => current_user_can( 'manage_options' );

		register_rest_route(
			self::REST_NS,
			'/type-menus',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => $can,
					'callback'            => array( __CLASS__, 'rest_get' ),
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => $can,
					'callback'            => array( __CLASS__, 'rest_save' ),
				),
			)
		);
	}

	/** The page payload: every OS type's current override, plus both icon sets. */
	public static function rest_get(): WP_REST_Response {
		$saved = (array) get_option( self::OPTION, array() );
		$types = array();

		foreach ( get_post_types( array(), 'objects' ) as $name => $object ) {
			if ( ! str_starts_with( $name, 'os_' ) ) {
				continue;
			}
			$override = (array) ( $saved[ $name ] ?? array() );
			$types[]  = array(
				'type'     => $name,
				'plural'   => (string) $object->labels->name,
				'label'    => (string) ( $override['label'] ?? '' ),
				'icon'     => (string) ( $override['icon'] ?? '' ),
				'position' => (string) ( $override['position'] ?? '' ),
			);
		}
		usort( $types, static fn( array $a, array $b ): int => strcmp( $a['type'], $b['type'] ) );

		$fa = self::fa_icons();

		return rest_ensure_response(
			array(
				'types'     => $types,
				'icon_sets' => array(
					'fa'        => $fa,
					'dashicons' => self::dashicons(),
				),
				'icon_uris' => array_combine( $fa, array_map( array( 'OS_Standalone_Admin', 'fa_icon_data_uri' ), $fa ) ),
			)
		);
	}

	/**
	 * Save the whole table in one POST. Empty fields mean "use the module's
	 * default", so clearing a field is how an override is undone; only
	 * non-empty values are stored and the option never accumulates blanks.
	 */
	public static function rest_save( WP_REST_Request $request ): WP_REST_Response {
		$menus = (array) $request->get_param( 'menus' );
		$known = array_filter( array_keys( get_post_types() ), static fn( string $t ): bool => str_starts_with( $t, 'os_' ) );

		$saved = array();
		foreach ( $known as $type ) {
			$row   = (array) ( $menus[ $type ] ?? array() );
			$entry = array_filter(
				array(
					'label'    => sanitize_text_field( (string) ( $row['label'] ?? '' ) ),
					'icon'     => self::sanitize_icon( (string) ( $row['icon'] ?? '' ) ),
					'position' => self::sanitize_position( (string) ( $row['position'] ?? '' ) ),
				),
				static fn( string $value ): bool => '' !== $value
			);
			if ( $entry ) {
				$saved[ $type ] = $entry;
			}
		}

		update_option( self::OPTION, $saved );

		return rest_ensure_response( array( 'saved' => count( $saved ) ) );
	}

	/**
	 * The Font Awesome names the plugin ships, from the generated path table.
	 *
	 * @return string[]
	 */
	private static function fa_icons(): array {
		$file  = OS_DIR . 'inc/runtime/fa-icon-paths.php';
		$paths = is_readable( $file ) ? (array) require $file : array();
		$names = array_keys( $paths );
		sort( $names );
		return $names;
	}

	/**
	 * Every dashicon this WordPress ships, parsed from core's own stylesheet
	 * so the list always matches the running version.
	 *
	 * @return string[]
	 */
	private static function dashicons(): array {
		static $names = null;
		if ( null !== $names ) {
			return $names;
		}
		$css = '';
		foreach ( array( 'dashicons.min.css', 'dashicons.css' ) as $file ) {
			$path = ABSPATH . WPINC . '/css/' . $file;
			if ( is_readable( $path ) ) {
				$css = (string) file_get_contents( $path );
				break;
			}
		}
		preg_match_all( '/\.dashicons-([a-z0-9-]+):before/', $css, $matches );
		$names = array_values( array_unique( $matches[1] ?? array() ) );
		sort( $names );
		return $names;
	}

	/** Icons are a bundled Font Awesome name or a dashicon; anything else is dropped. */
	private static function sanitize_icon( string $icon ): string {
		$icon = trim( $icon );
		if ( preg_match( '/^dashicons-[a-z0-9-]+$/', $icon ) ) {
			return $icon;
		}
		if ( str_starts_with( $icon, 'fa-' ) && in_array( substr( $icon, 3 ), self::fa_icons(), true ) ) {
			return $icon;
		}
		return '';
	}

	/** Positions are numeric, dotted decimals included, e.g. `3.1`. */
	private static function sanitize_position( string $position ): string {
		$position = trim( $position );
		return preg_match( '/^[0-9]+(\.[0-9]+)?$/', $position ) ? $position : '';
	}
}
