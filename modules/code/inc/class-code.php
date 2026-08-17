<?php
/**
 * Context Code Snippets — author PHP / JS / CSS / HTML as real files on disk,
 * with a fatal-error circuit breaker for PHP.
 *
 * Each snippet is a `os_code` post (the source of truth + free version history
 * via revisions). Saving materialises it to a real file under
 * wp-content/ci-snippets/<lang>/<slug>.<ext> — so it's browsable, diffable, and
 * restorable in the Filesystem app, and a corrupt PHP snippet is recoverable by
 * the loader rather than fatal-and-stuck.
 *
 * Execution model by language:
 *   - php  → run by the mu-plugin loader (inc/loader/ci-code-loader.php),
 *            wrapped in a shutdown tripwire that flags + auto-skips any snippet
 *            that fatals (the circuit breaker). Activation is the only risky
 *            operation, so MCP activation of PHP is gated behind a setting.
 *   - css  → enqueued on the matching scope (front / admin / both)
 *   - js   → enqueued on the matching scope
 *   - html → printed at wp_footer (front scope) and/or via the [os_code]
 *            shortcode.
 *
 * Options kept in sync for the dependency-free loader:
 *   ci_code_index  : [ { id, slug, language, scope, active, priority } ]
 *   ci_code_errors : { id => { t, msg, file, line } }   (circuit breaker)
 *
 * @package Core_Index
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class CI_Code {

	const NS           = 'code/v1';
	const CPT          = 'os_code';
	const INDEX_OPTION = 'os_code_index';
	const ERROR_OPTION = 'os_code_errors';
	const META_LANG    = 'os_code_language';
	const META_SCOPE   = 'os_code_scope';
	const META_ACTIVE  = 'os_code_active';
	const META_PRIORITY = 'os_code_priority';
	// Off by default: an agent can DRAFT runnable PHP, but a human must flip
	// this on (Settings) before MCP can activate PHP. JS/CSS/HTML are not gated.
	const OPTION_MCP_ACTIVATE_PHP = 'os_code_mcp_activate_php';
	const LOADING_OPTION = 'os_code_loading';
	const LOADER_VERSION = 4;

	const LANGS  = array( 'php', 'js', 'css', 'html' );
	const EXT    = array( 'php' => 'php', 'js' => 'js', 'css' => 'css', 'html' => 'html' );

	private static int $sync_hold = 0;
	private static bool $syncing = false;
	private static array $pending_sync = array();
	private static array $deleting = array();

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_cpt' ) );
		add_action( 'init', array( __CLASS__, 'ensure_loader_installed' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		// Post data is persisted before registered REST meta. Queue both layers,
		// then perform one materialisation/index rebuild after REST has applied
		// every field. Direct metadata writes stay synchronous.
		add_action( 'save_post_' . self::CPT, array( __CLASS__, 'on_save' ), 10, 3 );
		add_action( 'added_post_meta', array( __CLASS__, 'on_meta_mutation' ), 10, 4 );
		add_action( 'updated_post_meta', array( __CLASS__, 'on_meta_mutation' ), 10, 4 );
		add_action( 'deleted_post_meta', array( __CLASS__, 'on_meta_mutation' ), 10, 4 );
		add_action( 'rest_after_insert_' . self::CPT, array( __CLASS__, 'on_rest_after_insert' ), 10, 3 );
		add_filter( 'rest_request_after_callbacks', array( __CLASS__, 'after_rest_callbacks' ), PHP_INT_MAX, 3 );
		add_action( 'shutdown', array( __CLASS__, 'flush_shutdown_sync' ), 1 );
		add_action( 'before_delete_post', array( __CLASS__, 'on_delete' ) );
		add_action( 'trashed_post', array( __CLASS__, 'on_delete' ) );
		add_action( 'deleted_post_' . self::CPT, array( __CLASS__, 'on_deleted' ), 10, 2 );
		// Asset injection for the safe languages (PHP is the loader's job).
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_front' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin' ) );
		add_action( 'wp_footer', array( __CLASS__, 'print_html_front' ) );
		add_shortcode( 'os_code', array( __CLASS__, 'shortcode' ) );
	}

	/**
	 * Restore the derived loader and index when the plugin is activated.
	 */
	public static function activate(): void {
		self::ensure_loader_installed();
		self::rebuild_index();
	}

	/**
	 * Stop every executable snippet while preserving posts and materialised files.
	 */
	public static function deactivate(): void {
		CI_Code_Options::update( self::INDEX_OPTION, array(), false );
		CI_Code_Options::delete( self::LOADING_OPTION );

		$source = CI_CODE_DIR . 'inc/loader/ci-code-loader.php';
		$loader = self::loader_path();
		if ( ! is_file( $source ) || ! is_file( $loader ) ) {
			return;
		}

		$source_hash = hash_file( 'sha256', $source );
		$loader_hash = hash_file( 'sha256', $loader );
		if ( is_string( $source_hash ) && is_string( $loader_hash ) && hash_equals( $source_hash, $loader_hash ) ) {
			wp_delete_file( $loader );
		}
	}

	// === CPT + meta =======================================================

	public static function register_cpt(): void {
		register_post_type( self::CPT, array(
			'label'        => 'Code Snippets',
			'public'       => false,
			'show_ui'      => false,
			'show_in_menu' => false,
			'menu_icon'    => 'dashicons-editor-code',
			'show_in_rest' => true,
			'rest_base'    => self::CPT,
			'supports'     => array( 'title', 'editor', 'revisions', 'custom-fields' ),
			'capability_type' => 'post',
			'map_meta_cap' => false,
			'capabilities' => array(
				'create_posts'           => 'manage_options',
				'delete_others_posts'    => 'manage_options',
				'delete_post'            => 'manage_options',
				'delete_posts'           => 'manage_options',
				'delete_private_posts'   => 'manage_options',
				'delete_published_posts' => 'manage_options',
				'edit_others_posts'      => 'manage_options',
				'edit_post'              => 'manage_options',
				'edit_posts'             => 'manage_options',
				'edit_private_posts'     => 'manage_options',
				'edit_published_posts'   => 'manage_options',
				'publish_posts'          => 'manage_options',
				'read_post'              => 'manage_options',
				'read_private_posts'     => 'manage_options',
			),
		) );

		$auth = static fn() => current_user_can( 'manage_options' );
		register_post_meta( self::CPT, self::META_LANG, array(
			'type' => 'string', 'single' => true, 'show_in_rest' => true, 'default' => 'php',
			'sanitize_callback' => static fn( $v ) => in_array( $v, self::LANGS, true ) ? $v : 'php',
			'auth_callback' => $auth,
		) );
		register_post_meta( self::CPT, self::META_SCOPE, array(
			'type' => 'string', 'single' => true, 'show_in_rest' => true, 'default' => 'everywhere',
			'sanitize_callback' => static fn( $v ) => in_array( $v, array( 'everywhere', 'admin', 'frontend' ), true ) ? $v : 'everywhere',
			'auth_callback' => $auth,
		) );
		register_post_meta( self::CPT, self::META_ACTIVE, array(
			'type' => 'boolean', 'single' => true, 'show_in_rest' => true, 'default' => false,
			'auth_callback' => $auth,
		) );
		register_post_meta( self::CPT, self::META_PRIORITY, array(
			'type' => 'integer', 'single' => true, 'show_in_rest' => true, 'default' => 10,
			'auth_callback' => $auth,
		) );
	}

	// === Save / delete → materialise + reindex ============================

	public static function on_save( $post_id, $post, $update ): void {
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		if ( get_post_type( $post_id ) !== self::CPT ) {
			return;
		}
		self::queue_sync( (int) $post_id );
	}

	/**
	 * Keep derived files/indexes aligned with direct registered-meta writes.
	 *
	 * WordPress REST saves post data first and meta second. REST writes are
	 * therefore coalesced until rest_after_insert; non-REST writes synchronize
	 * before update_post_meta() returns.
	 */
	public static function on_meta_mutation( $meta_id, $object_id, $meta_key, $meta_value ): void {
		unset( $meta_id, $meta_value );
		if ( ! in_array( $meta_key, self::sync_meta_keys(), true ) ) {
			return;
		}
		$post_id = (int) $object_id;
		if ( isset( self::$deleting[ $post_id ] ) || self::CPT !== get_post_type( $post_id ) ) {
			return;
		}
		self::queue_sync( $post_id );
	}

	/** Synchronize once after the core REST controller has applied post meta. */
	public static function on_rest_after_insert( $post, $request, $creating ): void {
		unset( $request, $creating );
		if ( $post instanceof WP_Post && self::CPT === $post->post_type ) {
			self::sync_post( (int) $post->ID );
		}
	}

	/**
	 * Flush writes performed by custom REST callbacks that do not emit the
	 * post-type-specific rest_after_insert action.
	 *
	 * @param mixed $response REST response.
	 * @return mixed
	 */
	public static function after_rest_callbacks( $response, $handler, $request ) {
		unset( $handler, $request );
		self::flush_pending_sync( true );
		return $response;
	}

	/** Last-resort flush for a REST controller that did not reach its after hook. */
	public static function flush_shutdown_sync(): void {
		self::flush_pending_sync( true );
	}

	/** Defer a related group of post/meta changes into one derived-state write. */
	public static function begin_sync_batch(): void {
		++self::$sync_hold;
	}

	/** Finish a related group of changes and synchronize its affected snippets. */
	public static function end_sync_batch(): void {
		if ( self::$sync_hold > 0 ) {
			--self::$sync_hold;
		}
		if ( 0 === self::$sync_hold ) {
			self::flush_pending_sync( true );
		}
	}

	/** Force one snippet's materialised file and shared index into sync. */
	public static function sync_post( int $post_id ): void {
		self::$pending_sync[ $post_id ] = true;
		self::flush_pending_sync( true );
	}

	/**
	 * Flush all queued snippet changes, rebuilding the shared index only once.
	 *
	 * @param bool $force Ignore REST-request deferral.
	 */
	public static function flush_pending_sync( bool $force = false ): void {
		if (
			self::$syncing
			|| self::$sync_hold > 0
			|| ( ! $force && defined( 'REST_REQUEST' ) && REST_REQUEST )
		) {
			return;
		}

		while ( self::$pending_sync ) {
			$pending            = array_keys( self::$pending_sync );
			self::$pending_sync = array();
			self::$syncing      = true;
			$rebuild            = false;

			foreach ( $pending as $post_id ) {
				$post_id = (int) $post_id;
				if ( isset( self::$deleting[ $post_id ] ) || self::CPT !== get_post_type( $post_id ) ) {
					continue;
				}
				if ( 'trash' === get_post_status( $post_id ) ) {
					self::remove_files( $post_id );
				} else {
					self::materialise( $post_id );
				}
				self::clear_error( $post_id );
				$rebuild = true;
			}

			if ( $rebuild ) {
				self::rebuild_index();
			}
			self::$syncing = false;
		}
	}

	private static function queue_sync( int $post_id ): void {
		if ( $post_id <= 0 || isset( self::$deleting[ $post_id ] ) ) {
			return;
		}
		self::$pending_sync[ $post_id ] = true;
		self::flush_pending_sync();
	}

	private static function sync_meta_keys(): array {
		return array(
			self::META_LANG,
			self::META_SCOPE,
			self::META_ACTIVE,
			self::META_PRIORITY,
		);
	}

	public static function on_delete( $post_id ): void {
		if ( get_post_type( $post_id ) !== self::CPT ) {
			return;
		}
		if ( 'before_delete_post' === current_filter() ) {
			self::$deleting[ (int) $post_id ] = true;
		}
		unset( self::$pending_sync[ (int) $post_id ] );
		self::remove_files( (int) $post_id );
		self::clear_error( (int) $post_id );
		if ( 'before_delete_post' === current_filter() ) {
			// The row still exists here. Rebuild after WordPress deletes it.
			return;
		}
		self::rebuild_index();
	}

	/** Rebuild only after a force-deleted snippet no longer exists in the DB. */
	public static function on_deleted( $post_id, $post ): void {
		if ( ! $post instanceof WP_Post || self::CPT !== $post->post_type ) {
			return;
		}
		unset( self::$deleting[ (int) $post_id ], self::$pending_sync[ (int) $post_id ] );
		self::rebuild_index();
	}

	/** Write the snippet body to its real file (always — active or not). */
	public static function materialise( int $post_id ): void {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}
		$lang = self::lang_of( $post_id );
		$slug = $post->post_name ? $post->post_name : ( 'code-' . $post_id );
		$dir  = self::dir() . '/' . $lang;
		if ( ! wp_mkdir_p( $dir ) ) {
			return;
		}
		// Remove stale files for this id in OTHER languages (language changed).
		self::remove_files( $post_id, $lang );
		$body = (string) $post->post_content;
		$path = $dir . '/' . $slug . '.' . self::EXT[ $lang ];
		if ( 'php' === $lang ) {
			// Store with a controlled opening tag + guard; strip a leading
			// <?php the author may have typed so we never double it.
			$body = preg_replace( '/^\s*<\?php\s*/', '', $body );
			$header = "<?php\n/* Context code snippet #{$post_id} — managed file, edits are overwritten on save. */\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n";
			file_put_contents( $path, $header . $body . "\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		} else {
			file_put_contents( $path, $body ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}
	}

	private static function remove_files( int $post_id, string $keep_lang = '' ): void {
		$post = get_post( $post_id );
		$slug = ( $post && $post->post_name ) ? $post->post_name : ( 'code-' . $post_id );
		foreach ( self::LANGS as $lang ) {
			if ( $lang === $keep_lang ) {
				continue;
			}
			$path = self::dir() . '/' . $lang . '/' . $slug . '.' . self::EXT[ $lang ];
			if ( is_file( $path ) ) {
				wp_delete_file( $path );
			}
		}
	}

	/** Rebuild the lightweight index the loader + enqueuers read. */
	public static function rebuild_index(): void {
		$posts = get_posts( array(
			'post_type'      => self::CPT,
			'posts_per_page' => 500,
			'post_status'    => array( 'publish', 'draft', 'private' ),
			'fields'         => 'ids',
		) );
		$index = array();
		foreach ( $posts as $id ) {
			$p = get_post( $id );
			$index[] = array(
				'id'       => (int) $id,
				'slug'     => $p->post_name ? $p->post_name : ( 'code-' . $id ),
				'language' => self::lang_of( $id ),
				'scope'    => (string) ( get_post_meta( $id, self::META_SCOPE, true ) ?: 'everywhere' ),
				'active'   => (bool) get_post_meta( $id, self::META_ACTIVE, true ),
				'priority' => (int) ( get_post_meta( $id, self::META_PRIORITY, true ) ?: 10 ),
			);
		}
		CI_Code_Options::update( self::INDEX_OPTION, $index, false );
	}

	// === Circuit-breaker error helpers ====================================

	public static function get_errors(): array {
		$e = CI_Code_Options::get( self::ERROR_OPTION, array() );
		return is_array( $e ) ? $e : array();
	}

	public static function clear_error( int $post_id ): void {
		$e = self::get_errors();
		if ( isset( $e[ $post_id ] ) ) {
			unset( $e[ $post_id ] );
			CI_Code_Options::update( self::ERROR_OPTION, $e, false );
		}
	}

	// === Activation (the gated, risky op) =================================

	/**
	 * Set a snippet's active flag. Returns WP_Error when MCP tries to activate
	 * PHP while the gate is closed. $via='mcp' applies the gate; $via='ui'
	 * (a logged-in admin clicking Activate) does not.
	 */
	public static function set_active( int $post_id, bool $active, string $via = 'ui' ) {
		$post = get_post( $post_id );
		if ( ! $post || $post->post_type !== self::CPT ) {
			return new WP_Error( 'not_found', 'Snippet not found.', array( 'status' => 404 ) );
		}
		if ( $active && 'mcp' === $via && 'php' === self::lang_of( $post_id ) && ! self::mcp_php_activation_allowed() ) {
			return new WP_Error(
				'php_activation_gated',
				'Activating PHP via MCP is disabled. A human must enable it in Settings, or activate this snippet from the editor.',
				array( 'status' => 403 )
			);
		}
		self::begin_sync_batch();
		try {
			update_post_meta( $post_id, self::META_ACTIVE, $active ? true : false );
			if ( $active ) {
				self::clear_error( $post_id ); // re-arm the circuit breaker on activate
			}
			// update_post_meta() emits no mutation hook when the value is
			// unchanged. Queue explicitly so activation also repairs drift.
			self::queue_sync( $post_id );
		} finally {
			self::end_sync_batch();
		}
		return true;
	}

	public static function mcp_php_activation_allowed(): bool {
		return (bool) CI_Code_Options::get( self::OPTION_MCP_ACTIVATE_PHP, false );
	}

	// === Asset injection (css / js / html) ================================

	public static function enqueue_front(): void {
		self::enqueue_assets( false );
	}
	public static function enqueue_admin(): void {
		self::enqueue_assets( true );
	}

	private static function enqueue_assets( bool $is_admin ): void {
		foreach ( self::active_index() as $s ) {
			if ( ! self::scope_matches( $s['scope'], $is_admin ) ) {
				continue;
			}
			$url = self::url() . '/' . $s['language'] . '/' . $s['slug'] . '.' . ( self::EXT[ $s['language'] ] ?? $s['language'] );
			$ver = (string) ( file_exists( self::dir() . '/' . $s['language'] . '/' . $s['slug'] . '.' . self::EXT[ $s['language'] ] ) ? filemtime( self::dir() . '/' . $s['language'] . '/' . $s['slug'] . '.' . self::EXT[ $s['language'] ] ) : self::LOADER_VERSION );
			if ( 'css' === $s['language'] ) {
				wp_enqueue_style( 'ci-code-' . $s['id'], $url, array(), $ver );
			} elseif ( 'js' === $s['language'] ) {
				wp_enqueue_script( 'ci-code-' . $s['id'], $url, array(), $ver, true );
			}
		}
	}

	public static function print_html_front(): void {
		if ( is_admin() ) {
			return;
		}
		foreach ( self::active_index() as $s ) {
			if ( 'html' !== $s['language'] || ! self::scope_matches( $s['scope'], false ) ) {
				continue;
			}
			$path = self::dir() . '/html/' . $s['slug'] . '.html';
			if ( is_file( $path ) ) {
				echo "\n<!-- os_code #" . absint( $s['id'] ) . " -->\n";
				// HTML snippets are author-trusted markup, printed verbatim.
				echo file_get_contents( $path ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents
			}
		}
	}

	public static function shortcode( $atts ): string {
		$atts = shortcode_atts( array( 'id' => 0, 'slug' => '' ), $atts, 'os_code' );
		$post = $atts['id'] ? get_post( (int) $atts['id'] ) : ( $atts['slug'] ? get_page_by_path( (string) $atts['slug'], OBJECT, self::CPT ) : null );
		if ( ! $post || $post->post_type !== self::CPT || 'html' !== self::lang_of( $post->ID ) ) {
			return '';
		}
		$path = self::dir() . '/html/' . ( $post->post_name ?: ( 'code-' . $post->ID ) ) . '.html';
		return is_file( $path ) ? (string) file_get_contents( $path ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents
	}

	// === REST =============================================================

	public static function register_routes(): void {
		$can = static fn() => current_user_can( 'manage_options' );
		register_rest_route( self::NS, '/code/status', array(
			'methods'             => 'GET',
			'permission_callback' => $can,
			'callback'            => static function () {
				return rest_ensure_response( array(
					'errors'           => self::get_errors(),
					'loader_installed' => is_file( WPMU_PLUGIN_DIR . '/ci-code-loader.php' ),
					'mcp_activate_php' => self::mcp_php_activation_allowed(),
				) );
			},
		) );
		register_rest_route( self::NS, '/code/(?P<id>\d+)/activate', array(
			'methods'             => 'POST',
			'permission_callback' => $can,
			'callback'            => static function ( $req ) {
				$res = self::set_active( (int) $req['id'], (bool) $req->get_param( 'active' ), 'ui' );
				return is_wp_error( $res ) ? $res : rest_ensure_response( array( 'ok' => true, 'active' => (bool) $req->get_param( 'active' ) ) );
			},
			'args'                => array( 'active' => array( 'type' => 'boolean', 'required' => true ) ),
		) );
		register_rest_route( self::NS, '/code/(?P<id>\d+)/clear-error', array(
			'methods'             => 'POST',
			'permission_callback' => $can,
			'callback'            => static function ( $req ) {
				self::clear_error( (int) $req['id'] );
				return rest_ensure_response( array( 'ok' => true ) );
			},
		) );
	}

	// === Loader installation ==============================================

	/** Copy the mu-plugin loader into place when missing or out of date. */
	public static function ensure_loader_installed(): void {
		if ( ! defined( 'WPMU_PLUGIN_DIR' ) ) {
			return;
		}
		$src  = CI_CODE_DIR . 'inc/loader/ci-code-loader.php';
		$dest = self::loader_path();
		if ( ! is_file( $src ) ) {
			return;
		}
		$need = ! is_file( $dest );
		if ( ! $need ) {
			$cur = (string) file_get_contents( $dest ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents
			$owned_loader = (
				str_contains( $cur, 'Plugin Name: OS Code Loader' )
				&& str_contains( $cur, 'Auto-managed by OS Code' )
			) || (
				str_contains( $cur, 'Plugin Name: Context Code Loader' )
				&& str_contains( $cur, 'Auto-managed by Core Index' )
			);
			if (
				! $owned_loader
				|| ! preg_match( '/CI Code Loader Version:\s*(\d+)/', $cur, $m )
			) {
				return;
			}
			$source_hash = hash_file( 'sha256', $src );
			$loader_hash = hash_file( 'sha256', $dest );
			$need = (int) $m[1] !== self::LOADER_VERSION
				|| ! is_string( $source_hash )
				|| ! is_string( $loader_hash )
				|| ! hash_equals( $source_hash, $loader_hash );
		}
		if ( $need && wp_mkdir_p( WPMU_PLUGIN_DIR ) ) {
			file_put_contents( $dest, (string) file_get_contents( $src ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents, WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents
		}
	}

	private static function loader_path(): string {
		return WPMU_PLUGIN_DIR . '/ci-code-loader.php';
	}

	// === Helpers ==========================================================

	public static function dir(): string {
		return ( defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : ABSPATH . 'wp-content' ) . '/ci-snippets';
	}
	public static function url(): string {
		return content_url( 'ci-snippets' );
	}
	private static function lang_of( int $post_id ): string {
		$l = (string) get_post_meta( $post_id, self::META_LANG, true );
		return in_array( $l, self::LANGS, true ) ? $l : 'php';
	}
	private static function active_index(): array {
		$idx = CI_Code_Options::get( self::INDEX_OPTION, array() );
		if ( ! is_array( $idx ) ) {
			return array();
		}
		$errs = self::get_errors();
		return array_values( array_filter( $idx, static fn( $s ) => is_array( $s ) && ! empty( $s['active'] ) && empty( $errs[ $s['id'] ] ) ) );
	}
	private static function scope_matches( string $scope, bool $is_admin ): bool {
		if ( 'everywhere' === $scope ) {
			return true;
		}
		return ( 'admin' === $scope ) ? $is_admin : ! $is_admin;
	}
}
