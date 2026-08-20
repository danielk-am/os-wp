<?php
/**
 * Filesystem — a jailed file browser surface for the React admin app.
 *
 * The disk-backed sibling of the Media Library: where Media is a virtual
 * filesystem over WP attachments, this manages real files on disk. The
 * React `filesystem` app (assets/os-app-filesystem.js) renders a lazy
 * directory tree + preview pane against the REST routes here.
 *
 * Security model — this is the sharp edge, so it's worth stating plainly:
 *
 *   1. EVERY route requires `manage_options`. There is no token bypass
 *      (unlike the slim markdown routes) and no MCP write exposure.
 *   2. Access is JAILED to admin-configured roots (the `ci_fs_roots`
 *      option). A request names a root by id + a relative path; the path
 *      is canonicalised with realpath() and rejected unless it resolves
 *      INSIDE that root. This is the check wp-file-manager's elFinder
 *      connector got wrong (CVE-2020-25213) — symlinks that escape the
 *      root fail the prefix test because realpath() follows them.
 *   3. Phase 1 (this file as first shipped) is READ-ONLY: roots, list,
 *      read, download. Mutating routes (write/mkdir/rename/move/copy/
 *      delete/upload/chmod/archive) + the command console (exec) are
 *      added in Phase 2, gated the same way, with exec OFF by default.
 *
 * Routes (all `manage_options`, under filesystem/v1):
 *
 *   GET /fs/roots                       → configured roots (+ exists/writable)
 *   POST /fs/roots   { roots: [...] }   → replace the roots list
 *   GET /fs/list?root=&path=            → one directory's entries
 *   GET /fs/read?root=&path=            → file content (text) or binary flag
 *   GET /fs/download?root=&path=        → raw file stream (Content-Disposition)
 *
 * @package Core_Index
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WP_Filesystem {

	const REST_NS      = 'filesystem/v1';
	const OPTION_ROOTS = 'os_fs_roots';
	const OPTION_EXEC  = 'os_fs_exec';
	const OPTION_CONSOLE = 'os_fs_console';

	/** The four admin-editable terminal-console colours; the rest of the
	 * palette (bar/dim/faint) is derived from these client-side. */
	const CONSOLE_DEFAULTS = array(
		'bg'     => '#1e1e1e',
		'body'   => '#d4d4d4',
		'prompt' => '#4ec9b0',
		'error'  => '#f48771',
	);

	/** Hard ceiling on the command-console timeout (seconds), regardless of config. */
	const EXEC_MAX_TIMEOUT = 120;

	/** Max entries returned for a single directory listing (rest is truncated). */
	const MAX_ENTRIES = 2000;

	/** Max bytes returned inline by /fs/read; larger files must be downloaded. */
	const MAX_READ_BYTES = 2097152; // 2 MiB.

	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function register_admin_page(): void {
		add_management_page(
			'Filesystem',
			'Filesystem',
			'manage_options',
			'os-filesystem',
			array( __CLASS__, 'render_admin_page' )
		);
	}

	public static function render_admin_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1>Filesystem</h1>
			<p>Manage the jailed roots available to WordPress and MCP clients.</p>
			<table class="widefat striped">
				<thead><tr><th>Root</th><th>Path</th><th>Status</th></tr></thead>
				<tbody>
				<?php foreach ( self::get_roots() as $root ) : ?>
					<?php $exists = is_dir( (string) $root['path'] ); ?>
					<tr>
						<td><?php echo esc_html( (string) $root['label'] ); ?></td>
						<td><code><?php echo esc_html( (string) $root['path'] ); ?></code></td>
						<td><?php echo $exists ? 'Available' : 'Unavailable'; ?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<p class="description">Root changes are available through the authenticated <code>filesystem/v1/fs/roots</code> REST endpoint.</p>
		</div>
		<?php
	}

	/* ===================================================================
	 * Roots
	 * =================================================================== */

	/**
	 * The admin-configured roots, normalised. Each: { id, label, path }.
	 * Seeds a single `wp-content` root on first access so the app is
	 * usable out of the box without a config step.
	 *
	 * @return array<int,array{id:string,label:string,path:string}>
	 */
	public static function get_roots(): array {
		$raw = CI_Filesystem_Options::get( self::OPTION_ROOTS, null );
		if ( null === $raw || ! is_array( $raw ) ) {
			$seed = self::seed_roots();
			CI_Filesystem_Options::update( self::OPTION_ROOTS, $seed );
			$raw = $seed;
		}
		$out  = array();
		$seen = array();
		foreach ( (array) $raw as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$id   = sanitize_key( (string) ( $row['id'] ?? '' ) );
			$path = (string) ( $row['path'] ?? '' );
			if ( '' === $id || '' === $path || isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$out[]       = array(
				'id'    => $id,
				'label' => (string) ( $row['label'] ?? $id ),
				'path'  => $path,
			);
		}
		return $out;
	}

	/**
	 * The first-run seed for `ci_fs_roots`. Each site gets its own CI-vault
	 * jurisdiction slice(s) as ready-made roots when CI core's vault mode is on
	 * — so "each site pulls from its own os-vault" needs no manual config —
	 * followed by a general-purpose `wp-content` root. Reuses core's
	 * jurisdiction jail (`vault_roots()` only returns the slices this site may
	 * serve), so the seed can never expose a jurisdiction the site isn't scoped
	 * to. Seeded once; admins edit freely afterwards via Manage roots.
	 *
	 * @return array<int,array{id:string,label:string,path:string}>
	 */
	private static function seed_roots(): array {
		$seed = array();
		$optional_roots = apply_filters( 'filesystem_for_wordpress_seed_roots', array() );
		if ( is_array( $optional_roots ) ) {
			foreach ( $optional_roots as $name => $path ) {
				$name = (string) $name;
				$seed[] = array(
					'id'    => 'vault-' . sanitize_key( $name ),
					'label' => 'Vault: ' . $name,
					'path'  => (string) $path,
				);
			}
		}
		$seed[] = array(
			'id'    => 'wp-content',
			'label' => 'wp-content',
			'path'  => defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : ABSPATH . 'wp-content',
		);
		return $seed;
	}

	/** Find a root config row by id, or null. */
	private static function root_by_id( string $id ): ?array {
		foreach ( self::get_roots() as $root ) {
			if ( $root['id'] === $id ) {
				return $root;
			}
		}
		return null;
	}

	/**
	 * Resolve (root id, relative path) to an absolute path that is proven
	 * to live inside the root. Returns a WP_Error on any failure — unknown
	 * root, traversal attempt, symlink escape, or (when $must_exist) a
	 * missing target.
	 *
	 * @param bool $must_exist When true, the target itself must exist;
	 *                         when false (Phase 2 creates), only the
	 *                         deepest existing ancestor is jail-checked.
	 * @return string|WP_Error Absolute canonical path.
	 */
	public static function resolve( string $root_id, string $rel, bool $must_exist = true ) {
		$root = self::root_by_id( $root_id );
		if ( ! $root ) {
			return new WP_Error( 'fs_unknown_root', 'Unknown filesystem root.', array( 'status' => 404 ) );
		}
		// Null bytes are always an attack — bail before touching the FS.
		if ( false !== strpos( $rel, "\0" ) || false !== strpos( $root['path'], "\0" ) ) {
			return new WP_Error( 'fs_bad_path', 'Illegal path.', array( 'status' => 400 ) );
		}
		$base = realpath( $root['path'] );
		if ( false === $base || ! is_dir( $base ) ) {
			return new WP_Error( 'fs_root_missing', 'Configured root does not exist on disk.', array( 'status' => 500 ) );
		}
		$base = rtrim( $base, DIRECTORY_SEPARATOR );
		$rel  = ltrim( str_replace( '\\', '/', $rel ), '/' );

		// Reject traversal as a path component rather than relying on
		// realpath() to collapse it. Besides making the jail decision explicit,
		// this keeps a non-existent destination from retaining ".." segments.
		$segments = array();
		foreach ( explode( '/', $rel ) as $segment ) {
			if ( '' === $segment || '.' === $segment ) {
				continue;
			}
			if ( '..' === $segment ) {
				return new WP_Error( 'fs_bad_path', 'Path traversal is not allowed.', array( 'status' => 400 ) );
			}
			$segments[] = $segment;
		}
		$rel    = implode( DIRECTORY_SEPARATOR, $segments );
		$target = '' === $rel ? $base : $base . DIRECTORY_SEPARATOR . $rel;

		$real = realpath( $target );
		if ( false === $real ) {
			if ( $must_exist ) {
				return new WP_Error( 'fs_not_found', 'No such file or directory.', array( 'status' => 404 ) );
			}

			/*
			 * Target doesn't exist yet (create flow). Find the deepest
			 * filesystem entry, including a dangling symlink, then rebuild
			 * the missing suffix from its canonical location. Returning the
			 * original spelling here would let "root/link/new" follow a
			 * dangling or later-resolved link outside the jail.
			 */
			$probe  = $target;
			$suffix = array();
			while ( ! file_exists( $probe ) && ! is_link( $probe ) ) {
				if ( $probe === $base ) {
					break;
				}
				array_unshift( $suffix, basename( $probe ) );
				$parent = dirname( $probe );
				if ( $parent === $probe ) {
					break;
				}
				$probe = $parent;
			}
			$real_ancestor = realpath( $probe );
			if ( false === $real_ancestor || ! self::within( $base, $real_ancestor ) ) {
				return new WP_Error( 'fs_escape', 'Path escapes the configured root.', array( 'status' => 403 ) );
			}
			if ( ! is_dir( $real_ancestor ) ) {
				return new WP_Error( 'fs_not_dir', 'Destination parent is not a directory.', array( 'status' => 400 ) );
			}
			return empty( $suffix )
				? $real_ancestor
				: $real_ancestor . DIRECTORY_SEPARATOR . implode( DIRECTORY_SEPARATOR, $suffix );
		}
		if ( ! self::within( $base, $real ) ) {
			return new WP_Error( 'fs_escape', 'Path escapes the configured root.', array( 'status' => 403 ) );
		}
		return $real;
	}

	/** True when $path is $base itself or a descendant of it. */
	private static function within( string $base, string $path ): bool {
		$base = rtrim( $base, DIRECTORY_SEPARATOR );
		$path = rtrim( $path, DIRECTORY_SEPARATOR );
		return $path === $base || str_starts_with( $path, $base . DIRECTORY_SEPARATOR );
	}

	/* ===================================================================
	 * REST
	 * =================================================================== */

	public static function can_manage(): bool {
		return current_user_can( 'manage_options' );
	}

	public static function register_routes(): void {
		$auth = array( __CLASS__, 'can_manage' );

		register_rest_route( self::REST_NS, '/fs/roots', array(
			array(
				'methods'             => 'GET',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_roots' ),
			),
			array(
				'methods'             => 'POST',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_set_roots' ),
				'args'                => array(
					'roots' => array( 'required' => true, 'type' => 'array' ),
				),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/list', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_list' ),
			'args'                => array(
				'root' => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
				'path' => array( 'default' => '', 'sanitize_callback' => array( __CLASS__, 'sanitize_rel' ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/search', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_search' ),
			'args'                => array(
				'root'    => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
				'path'    => array( 'default' => '', 'sanitize_callback' => array( __CLASS__, 'sanitize_rel' ) ),
				'q'       => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
				'content' => array( 'default' => false ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/read', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_read' ),
			'args'                => array(
				'root' => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
				'path' => array( 'required' => true, 'sanitize_callback' => array( __CLASS__, 'sanitize_rel' ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/download', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_download' ),
			'args'                => array(
				'root' => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
				'path' => array( 'required' => true, 'sanitize_callback' => array( __CLASS__, 'sanitize_rel' ) ),
			),
		) );

		// ---- Phase 2: mutating ops (all manage_options + REST nonce) -------
		$root_arg = array( 'required' => true, 'sanitize_callback' => 'sanitize_key' );
		$rel_arg  = array( 'sanitize_callback' => array( __CLASS__, 'sanitize_rel' ) );

		register_rest_route( self::REST_NS, '/fs/write', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_write' ),
			'args'                => array(
				'root'    => $root_arg,
				'path'    => array_merge( $rel_arg, array( 'required' => true ) ),
				'content' => array( 'required' => true, 'type' => 'string' ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/create', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_create' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => array_merge( $rel_arg, array( 'required' => true ) ),
				'type' => array( 'default' => 'file', 'enum' => array( 'file', 'dir' ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/move', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_move' ),
			'args'                => array(
				'root' => $root_arg,
				'from' => array_merge( $rel_arg, array( 'required' => true ) ),
				'to'   => array_merge( $rel_arg, array( 'required' => true ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/copy', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_copy' ),
			'args'                => array(
				'root' => $root_arg,
				'from' => array_merge( $rel_arg, array( 'required' => true ) ),
				'to'   => array_merge( $rel_arg, array( 'required' => true ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/delete', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_delete' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => array_merge( $rel_arg, array( 'required' => true ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/chmod', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_chmod' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => array_merge( $rel_arg, array( 'required' => true ) ),
				'mode' => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/upload', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_upload' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => $rel_arg, // destination directory.
			),
		) );

		register_rest_route( self::REST_NS, '/fs/archive', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_archive' ),
			'args'                => array(
				'root'  => $root_arg,
				'paths' => array( 'required' => true, 'type' => 'array' ),
				'dest'  => array_merge( $rel_arg, array( 'required' => true ) ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/extract', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_extract' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => array_merge( $rel_arg, array( 'required' => true ) ),
				'dest' => $rel_arg, // optional target dir; default = sibling.
			),
		) );

		// ---- Phase 2: command console (OFF by default; opt-in in Settings) -
		register_rest_route( self::REST_NS, '/fs/exec', array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'rest_exec' ),
			'args'                => array(
				'root' => $root_arg,
				'path' => $rel_arg, // working directory.
				'cmd'  => array( 'required' => true, 'type' => 'string' ),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/exec-config', array(
			array(
				'methods'             => 'GET',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_get_exec_config' ),
			),
			array(
				'methods'             => 'POST',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_set_exec_config' ),
				'args'                => array(
					'enabled' => array( 'required' => true, 'type' => 'boolean' ),
					'timeout' => array( 'type' => 'integer', 'default' => 30 ),
				),
			),
		) );

		register_rest_route( self::REST_NS, '/fs/console', array(
			array(
				'methods'             => 'GET',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_get_console' ),
			),
			array(
				'methods'             => 'POST',
				'permission_callback' => $auth,
				'callback'            => array( __CLASS__, 'rest_set_console' ),
				'args'                => array(
					'colors' => array( 'required' => true, 'type' => 'object' ),
				),
			),
		) );
	}

	/**
	 * Sanitise a relative path argument. We DON'T sanitize_text_field here
	 * because legitimate filenames contain characters that would mangle;
	 * the real safety net is resolve()'s realpath jail. We only strip null
	 * bytes + leading slashes and normalise separators.
	 */
	public static function sanitize_rel( $value ): string {
		$value = (string) $value;
		$value = str_replace( "\0", '', $value );
		$value = str_replace( '\\', '/', $value );
		return ltrim( $value, '/' );
	}

	/** The admin-configured console colours, each validated, defaults filled in. */
	public static function get_console(): array {
		$saved = CI_Filesystem_Options::get( self::OPTION_CONSOLE, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		$out = array();
		foreach ( self::CONSOLE_DEFAULTS as $k => $def ) {
			$v         = isset( $saved[ $k ] ) ? (string) $saved[ $k ] : '';
			$out[ $k ] = self::is_hex( $v ) ? strtolower( $v ) : $def;
		}
		return $out;
	}

	/** A #rrggbb hex colour. */
	private static function is_hex( $v ): bool {
		return is_string( $v ) && (bool) preg_match( '/^#[0-9a-fA-F]{6}$/', $v );
	}

	public static function rest_get_console(): WP_REST_Response {
		return new WP_REST_Response( array( 'console' => self::get_console() ) );
	}

	public static function rest_set_console( WP_REST_Request $req ): WP_REST_Response {
		$in  = (array) $req->get_param( 'colors' );
		$cur = self::get_console();
		$out = array();
		foreach ( self::CONSOLE_DEFAULTS as $k => $def ) {
			$v         = isset( $in[ $k ] ) ? (string) $in[ $k ] : $cur[ $k ];
			$out[ $k ] = self::is_hex( $v ) ? strtolower( $v ) : $cur[ $k ];
		}
		CI_Filesystem_Options::update( self::OPTION_CONSOLE, $out );
		return new WP_REST_Response( array( 'console' => $out ) );
	}

	public static function rest_roots(): WP_REST_Response {
		$out = array();
		foreach ( self::get_roots() as $root ) {
			$real = realpath( $root['path'] );
			$out[] = array(
				'id'       => $root['id'],
				'label'    => $root['label'],
				'path'     => $root['path'],
				'exists'   => ( false !== $real && is_dir( $real ) ),
				'writable' => ( false !== $real && wp_is_writable( $real ) ),
			);
		}
		$exec = self::get_exec_config();
		return new WP_REST_Response( array(
			'roots'        => $out,
			'exec_enabled' => $exec['enabled'],
			'console'      => self::get_console(),
		) );
	}

	public static function rest_set_roots( WP_REST_Request $req ): WP_REST_Response {
		$raw   = (array) $req->get_param( 'roots' );
		$clean = array();
		$seen  = array();
		foreach ( $raw as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$label = sanitize_text_field( (string) ( $row['label'] ?? '' ) );
			$path  = trim( (string) ( $row['path'] ?? '' ) );
			if ( '' === $path ) {
				continue;
			}
			// Derive a stable id from the label (or the path basename).
			$id = sanitize_key( (string) ( $row['id'] ?? '' ) );
			if ( '' === $id ) {
				$id = sanitize_key( $label !== '' ? $label : basename( $path ) );
			}
			if ( '' === $id || isset( $seen[ $id ] ) ) {
				$id = $id . '-' . substr( md5( $path ), 0, 6 );
			}
			$seen[ $id ] = true;
			$clean[]     = array(
				'id'    => $id,
				'label' => '' !== $label ? $label : $id,
				'path'  => $path,
			);
		}
		CI_Filesystem_Options::update( self::OPTION_ROOTS, $clean );
		return self::rest_roots();
	}

	public static function rest_list( WP_REST_Request $req ) {
		$out = self::list_dir( (string) $req->get_param( 'root' ), (string) $req->get_param( 'path' ) );
		return is_wp_error( $out ) ? $out : new WP_REST_Response( $out );
	}

	/**
	 * Recursive search under the current directory, for the browser's search
	 * box. Reuses the same bounded walker as the ci/fs-search ability, then
	 * enriches each hit with the FULL entry metadata (size/mtime/perms/…) so the
	 * results render through the identical row/tile as a normal listing — only
	 * with a `path` (relative to the search root) so the UI can show where each
	 * hit lives. Name-only by default; pass `content=1` to also scan file bodies
	 * (slower), which adds a `snippet` to each content hit.
	 */
	public static function rest_search( WP_REST_Request $req ) {
		$root    = (string) $req->get_param( 'root' );
		$rel     = (string) $req->get_param( 'path' );
		$content = filter_var( $req->get_param( 'content' ), FILTER_VALIDATE_BOOLEAN );
		$out     = self::search( $root, $rel, (string) $req->get_param( 'q' ), $content, 200, 30000 );
		if ( is_wp_error( $out ) ) {
			return $out;
		}
		$base = self::resolve( $root, $rel );
		if ( ! is_wp_error( $base ) ) {
			$base = rtrim( $base, DIRECTORY_SEPARATOR );
			foreach ( $out['results'] as &$hit ) {
				$abs  = $base . DIRECTORY_SEPARATOR . str_replace( '/', DIRECTORY_SEPARATOR, $hit['path'] );
				// Carry the match type through; keep the body snippet for content hits.
				$extra = array( 'path' => $hit['path'], 'match' => $hit['match'] );
				if ( isset( $hit['snippet'] ) ) {
					$extra['snippet'] = $hit['snippet'];
				}
				$hit = array_merge( self::entry_meta( $abs, $hit['name'] ), $extra );
			}
			unset( $hit );
		}
		return new WP_REST_Response( $out );
	}

	/**
	 * List one jailed directory. Shared by the REST route + the ci/fs-list
	 * ability so the path-jail + sort + truncation rules live in one place.
	 *
	 * @return array{root:string,path:string,entries:array,truncated:bool}|WP_Error
	 */
	public static function list_dir( string $root, string $rel ) {
		$dir = self::resolve( $root, $rel );
		if ( is_wp_error( $dir ) ) {
			return $dir;
		}
		if ( ! is_dir( $dir ) ) {
			return new WP_Error( 'fs_not_dir', 'Not a directory.', array( 'status' => 400 ) );
		}
		$entries   = array();
		$truncated = false;
		$count     = 0;
		$dh        = @opendir( $dir );
		if ( false === $dh ) {
			return new WP_Error( 'fs_unreadable', 'Directory is not readable.', array( 'status' => 403 ) );
		}
		while ( false !== ( $name = readdir( $dh ) ) ) {
			if ( '.' === $name || '..' === $name ) {
				continue;
			}
			if ( ++$count > self::MAX_ENTRIES ) {
				$truncated = true;
				break;
			}
			$entries[] = self::entry_meta( $dir . DIRECTORY_SEPARATOR . $name, $name );
		}
		closedir( $dh );

		// Directories first, then files; alpha within each (case-insensitive).
		usort( $entries, static function ( $a, $b ) {
			if ( $a['type'] !== $b['type'] ) {
				return 'dir' === $a['type'] ? -1 : 1;
			}
			return strcasecmp( $a['name'], $b['name'] );
		} );

		return array(
			'root'      => $root,
			'path'      => $rel,
			'entries'   => $entries,
			'truncated' => $truncated,
		);
	}

	/** Build the metadata row for one directory entry. */
	private static function entry_meta( string $abs, string $name ): array {
		$is_link = is_link( $abs );
		$is_dir  = is_dir( $abs );
		$ext     = $is_dir ? '' : strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$meta    = array(
			'name'       => $name,
			'type'       => $is_dir ? 'dir' : 'file',
			'is_link'    => $is_link,
			'ext'        => $ext,
			'size'       => $is_dir ? 0 : (int) @filesize( $abs ),
			'mtime'      => (int) @filemtime( $abs ),
			'perms'      => self::perms_string( $abs ),
			'readable'   => is_readable( $abs ),
			'writable'   => wp_is_writable( $abs ),
		);
		if ( ! $is_dir ) {
			$ft           = wp_check_filetype( $name );
			$meta['mime'] = $ft['type'] ? (string) $ft['type'] : '';
		}
		return $meta;
	}

	/** rwxr-xr-x style permission string (best effort; '' if unknown). */
	private static function perms_string( string $abs ): string {
		$p = @fileperms( $abs );
		if ( false === $p ) {
			return '';
		}
		$info  = ( $p & 0x4000 ) ? 'd' : ( ( ( $p & 0xA000 ) === 0xA000 ) ? 'l' : '-' );
		$info .= ( $p & 0x0100 ) ? 'r' : '-';
		$info .= ( $p & 0x0080 ) ? 'w' : '-';
		$info .= ( $p & 0x0040 ) ? 'x' : '-';
		$info .= ( $p & 0x0020 ) ? 'r' : '-';
		$info .= ( $p & 0x0010 ) ? 'w' : '-';
		$info .= ( $p & 0x0008 ) ? 'x' : '-';
		$info .= ( $p & 0x0004 ) ? 'r' : '-';
		$info .= ( $p & 0x0002 ) ? 'w' : '-';
		$info .= ( $p & 0x0001 ) ? 'x' : '-';
		return $info;
	}

	public static function rest_read( WP_REST_Request $req ) {
		$out = self::read_file( (string) $req->get_param( 'root' ), (string) $req->get_param( 'path' ) );
		return is_wp_error( $out ) ? $out : new WP_REST_Response( $out );
	}

	/**
	 * Read one jailed file as text. Shared by the REST route + the
	 * ci/fs-read ability. Large files return `too_large`; non-text files
	 * return `binary` (caller downloads instead). Never returns raw bytes
	 * for binaries.
	 *
	 * @return array{name:string,size:int,mime:string,ext:string,binary?:bool,content?:string,too_large?:bool}|WP_Error
	 */
	public static function read_file( string $root, string $rel ) {
		$file = self::resolve( $root, $rel );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		if ( ! is_file( $file ) ) {
			return new WP_Error( 'fs_not_file', 'Not a file.', array( 'status' => 400 ) );
		}
		$size = (int) filesize( $file );
		$name = basename( $file );
		$ft   = wp_check_filetype( $name );
		$resp = array(
			'name' => $name,
			'size' => $size,
			'mime' => $ft['type'] ? (string) $ft['type'] : '',
			'ext'  => strtolower( pathinfo( $name, PATHINFO_EXTENSION ) ),
		);
		if ( $size > self::MAX_READ_BYTES ) {
			$resp['too_large'] = true;
			$resp['content']   = '';
			return $resp;
		}
		$raw = file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- reading a jailed local file, not a remote URL.
		if ( false === $raw ) {
			return new WP_Error( 'fs_read_failed', 'Could not read file.', array( 'status' => 500 ) );
		}
		$resp['binary']  = self::looks_binary( $raw );
		$resp['content'] = $resp['binary'] ? '' : $raw;
		return $resp;
	}

	/** Heuristic: a NUL byte in the first 8KB means "treat as binary". */
	private static function looks_binary( string $raw ): bool {
		$sample = substr( $raw, 0, 8192 );
		return false !== strpos( $sample, "\0" );
	}

	/**
	 * Bounded recursive search under a jailed directory. Matches the query
	 * against file/dir NAMES always, and against text-file CONTENT when
	 * $content is true. Walks at most $max_files files (a backstop so a
	 * search over a huge tree can't run unbounded) and returns at most
	 * $max_results hits. Used by the ci/fs-search ability.
	 *
	 * @return array{results:array,scanned:int,capped:bool}|WP_Error
	 */
	public static function search( string $root, string $rel, string $query, bool $content = false, int $max_results = 100, int $max_files = 20000 ) {
		$start = self::resolve( $root, $rel );
		if ( is_wp_error( $start ) ) {
			return $start;
		}
		if ( ! is_dir( $start ) ) {
			return new WP_Error( 'fs_not_dir', 'Search root is not a directory.', array( 'status' => 400 ) );
		}
		$query = (string) $query;
		if ( '' === $query ) {
			return new WP_Error( 'fs_empty_query', 'query is required.', array( 'status' => 400 ) );
		}
		$needle  = function_exists( 'mb_strtolower' ) ? mb_strtolower( $query ) : strtolower( $query );
		$base    = rtrim( $start, DIRECTORY_SEPARATOR );
		$results = array();
		$scanned = 0;
		$capped  = false;

		$it = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS ),
			RecursiveIteratorIterator::SELF_FIRST
		);
		foreach ( $it as $info ) {
			if ( $scanned >= $max_files || count( $results ) >= $max_results ) {
				$capped = true;
				break;
			}
			$scanned++;
			$abs  = $info->getPathname();
			// Re-assert the jail: FOLLOW_SYMLINKS could surface a path that
			// resolves outside the root. realpath + prefix check kills it.
			$real = realpath( $abs );
			if ( false === $real || ! self::within( $base, $real ) ) {
				continue;
			}
			$name     = $info->getFilename();
			$rel_path = ltrim( str_replace( $base, '', $abs ), DIRECTORY_SEPARATOR );
			$rel_path = str_replace( '\\', '/', $rel_path );
			$hay      = function_exists( 'mb_strtolower' ) ? mb_strtolower( $name ) : strtolower( $name );
			if ( false !== strpos( $hay, $needle ) ) {
				$results[] = array(
					'path'  => $rel_path,
					'name'  => $name,
					'type'  => $info->isDir() ? 'dir' : 'file',
					'match' => 'name',
				);
				continue;
			}
			if ( $content && $info->isFile() && $info->getSize() <= self::MAX_READ_BYTES ) {
				$raw = file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- jailed local file.
				if ( false === $raw || self::looks_binary( $raw ) ) {
					continue;
				}
				// Locate + slice in the SAME string domain as $raw. A byte offset
				// taken from mb_strtolower($raw) can drift when lowercasing changes
				// a character's byte length (e.g. 'İ' → 'i̇'), landing the window
				// past the real match; mb_stripos/mb_substr are case-insensitive and
				// character-indexed against $raw itself, so they stay aligned.
				$pos = function_exists( 'mb_stripos' ) ? mb_stripos( $raw, $query ) : stripos( $raw, $query );
				if ( false !== $pos ) {
					$snippet = trim(
						function_exists( 'mb_substr' )
							? mb_substr( $raw, max( 0, $pos - 40 ), 120 )
							: substr( $raw, max( 0, $pos - 40 ), 120 )
					);
					$results[] = array(
						'path'    => $rel_path,
						'name'    => $name,
						'type'    => 'file',
						'match'   => 'content',
						'snippet' => $snippet,
					);
				}
			}
		}
		return array( 'results' => $results, 'scanned' => $scanned, 'capped' => $capped );
	}

	/* ===================================================================
	 * Phase 2 — mutating ops (all manage_options; jailed via resolve())
	 * =================================================================== */

	/** Shared success envelope for a path-targeted op. */
	private static function ok( string $root, string $rel, array $extra = array() ): WP_REST_Response {
		return new WP_REST_Response( array_merge( array( 'ok' => true, 'root' => $root, 'path' => $rel ), $extra ) );
	}

	public static function rest_write( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$rel  = (string) $req->get_param( 'path' );
		$abs  = self::resolve( $root, $rel, false );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( is_dir( $abs ) ) {
			return new WP_Error( 'fs_is_dir', 'Target is a directory.', array( 'status' => 400 ) );
		}
		if ( ! is_dir( dirname( $abs ) ) ) {
			return new WP_Error( 'fs_no_parent', 'Parent directory does not exist.', array( 'status' => 400 ) );
		}
		$bytes = file_put_contents( $abs, (string) $req->get_param( 'content' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- jailed local file.
		if ( false === $bytes ) {
			return new WP_Error( 'fs_write_failed', 'Write failed (check permissions).', array( 'status' => 500 ) );
		}
		return self::ok( $root, $rel, array( 'bytes' => $bytes ) );
	}

	public static function rest_create( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$rel  = (string) $req->get_param( 'path' );
		$type = (string) $req->get_param( 'type' );
		$abs  = self::resolve( $root, $rel, false );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( file_exists( $abs ) ) {
			return new WP_Error( 'fs_exists', 'A file or directory with that name already exists.', array( 'status' => 409 ) );
		}
		if ( 'dir' === $type ) {
			if ( ! wp_mkdir_p( $abs ) ) {
				return new WP_Error( 'fs_mkdir_failed', 'Could not create directory.', array( 'status' => 500 ) );
			}
		} else {
			if ( ! is_dir( dirname( $abs ) ) ) {
				return new WP_Error( 'fs_no_parent', 'Parent directory does not exist.', array( 'status' => 400 ) );
			}
			if ( false === file_put_contents( $abs, '' ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- jailed local file.
				return new WP_Error( 'fs_create_failed', 'Could not create file.', array( 'status' => 500 ) );
			}
		}
		return self::ok( $root, $rel, array( 'type' => $type ) );
	}

	public static function rest_move( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$from = self::resolve( $root, (string) $req->get_param( 'from' ), true );
		if ( is_wp_error( $from ) ) {
			return $from;
		}
		$to = self::resolve( $root, (string) $req->get_param( 'to' ), false );
		if ( is_wp_error( $to ) ) {
			return $to;
		}
		if ( file_exists( $to ) || is_link( $to ) ) {
			return new WP_Error( 'fs_exists', 'Destination already exists.', array( 'status' => 409 ) );
		}
		if ( ! @rename( $from, $to ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename -- moving a jailed disk file; WP_Filesystem::move needs FS-credential init this admin tool intentionally avoids.
			return new WP_Error( 'fs_move_failed', 'Move/rename failed (check permissions).', array( 'status' => 500 ) );
		}
		return self::ok( $root, (string) $req->get_param( 'to' ) );
	}

	public static function rest_copy( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$from = self::resolve( $root, (string) $req->get_param( 'from' ), true );
		if ( is_wp_error( $from ) ) {
			return $from;
		}
		$to = self::resolve( $root, (string) $req->get_param( 'to' ), false );
		if ( is_wp_error( $to ) ) {
			return $to;
		}
		if ( file_exists( $to ) || is_link( $to ) ) {
			return new WP_Error( 'fs_exists', 'Destination already exists.', array( 'status' => 409 ) );
		}
		$root_config = self::root_by_id( $root );
		$root_base   = $root_config ? realpath( $root_config['path'] ) : false;
		if ( false === $root_base ) {
			return new WP_Error( 'fs_root_missing', 'Configured root does not exist on disk.', array( 'status' => 500 ) );
		}
		if ( is_dir( $from ) && self::within( $from, $to ) ) {
			return new WP_Error( 'fs_recursive_copy', 'A directory cannot be copied inside itself.', array( 'status' => 400 ) );
		}
		if ( ! self::copy_recursive( $from, $to, $root_base ) ) {
			if ( file_exists( $to ) || is_link( $to ) ) {
				self::delete_recursive( $to );
			}
			return new WP_Error( 'fs_copy_failed', 'Copy failed (check permissions).', array( 'status' => 500 ) );
		}
		return self::ok( $root, (string) $req->get_param( 'to' ) );
	}

	public static function rest_delete( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$rel  = (string) $req->get_param( 'path' );
		if ( '' === trim( $rel ) ) {
			return new WP_Error( 'fs_refuse_root', 'Refusing to delete the root itself.', array( 'status' => 400 ) );
		}
		$abs = self::resolve( $root, $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( ! self::delete_recursive( $abs ) ) {
			return new WP_Error( 'fs_delete_failed', 'Delete failed (check permissions).', array( 'status' => 500 ) );
		}
		return self::ok( $root, $rel );
	}

	public static function rest_chmod( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$rel  = (string) $req->get_param( 'path' );
		$abs  = self::resolve( $root, $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		$mode_str = (string) $req->get_param( 'mode' );
		if ( ! preg_match( '/^[0-7]{3,4}$/', $mode_str ) ) {
			return new WP_Error( 'fs_bad_mode', 'Mode must be octal, e.g. 644 or 0755.', array( 'status' => 400 ) );
		}
		$mode = intval( $mode_str, 8 );
		if ( ! @chmod( $abs, $mode ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_chmod -- chmod on a jailed disk path; this IS the file-manager's chmod action.
			return new WP_Error( 'fs_chmod_failed', 'chmod failed (check ownership).', array( 'status' => 500 ) );
		}
		return self::ok( $root, $rel, array( 'mode' => $mode_str ) );
	}

	public static function rest_upload( WP_REST_Request $req ) {
		$root = (string) $req->get_param( 'root' );
		$rel  = (string) $req->get_param( 'path' );
		$dir  = self::resolve( $root, $rel, true );
		if ( is_wp_error( $dir ) ) {
			return $dir;
		}
		if ( ! is_dir( $dir ) ) {
			return new WP_Error( 'fs_not_dir', 'Upload target is not a directory.', array( 'status' => 400 ) );
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- REST nonce already verified by core.
		if ( empty( $_FILES['file'] ) ) {
			return new WP_Error( 'fs_no_file', 'No file uploaded (field name must be `file`).', array( 'status' => 400 ) );
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing
		$file    = array_map( 'sanitize_text_field', wp_unslash( $_FILES['file'] ) );
		$tmp     = $file['tmp_name'];
		$name    = sanitize_file_name( (string) $file['name'] );
		if ( '' === $name || ! is_uploaded_file( $tmp ) ) {
			return new WP_Error( 'fs_bad_upload', 'Invalid upload.', array( 'status' => 400 ) );
		}
		$dest_rel = self::sanitize_rel( $rel . '/' . $name );
		$dest     = self::resolve( $root, $dest_rel, false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		if ( ! @move_uploaded_file( $tmp, $dest ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized,Generic.PHP.ForbiddenFunctions.Found -- saving an upload to a jailed dir outside uploads/; wp_handle_upload only targets the uploads dir.
			return new WP_Error( 'fs_upload_failed', 'Could not save the uploaded file.', array( 'status' => 500 ) );
		}
		return self::ok( $root, $dest_rel, array( 'name' => $name ) );
	}

	public static function rest_archive( WP_REST_Request $req ) {
		if ( ! class_exists( '\ZipArchive' ) ) {
			return new WP_Error( 'fs_no_zip', 'PHP ZipArchive extension is required.', array( 'status' => 500 ) );
		}
		$root  = (string) $req->get_param( 'root' );
		$paths = (array) $req->get_param( 'paths' );
		$dest  = self::resolve( $root, (string) $req->get_param( 'dest' ), false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		if ( file_exists( $dest ) || is_link( $dest ) ) {
			return new WP_Error( 'fs_exists', 'Destination archive already exists.', array( 'status' => 409 ) );
		}
		$root_config = self::root_by_id( $root );
		$root_base   = $root_config ? realpath( $root_config['path'] ) : false;
		if ( false === $root_base ) {
			return new WP_Error( 'fs_root_missing', 'Configured root does not exist on disk.', array( 'status' => 500 ) );
		}

		// Resolve sources before creating the destination. Otherwise a request
		// can name the not-yet-created archive as both source and destination,
		// after which opening the ZIP makes that invalid source appear valid.
		$sources = array();
		foreach ( $paths as $path ) {
			$abs = self::resolve( $root, self::sanitize_rel( (string) $path ), true );
			if ( ! is_wp_error( $abs ) ) {
				$sources[] = $abs;
			}
		}
		if ( empty( $sources ) ) {
			return new WP_Error( 'fs_no_archive_sources', 'No valid archive sources were provided.', array( 'status' => 400 ) );
		}

		$zip = new \ZipArchive();
		if ( true !== $zip->open( $dest, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) {
			return new WP_Error( 'fs_zip_open', 'Could not create archive.', array( 'status' => 500 ) );
		}
		$added            = 0;
		$skipped_symlinks = 0;
		$real_dest        = realpath( $dest );
		$archive_ok       = true;
		try {
			foreach ( $sources as $abs ) {
				$base = basename( $abs );
				if ( is_dir( $abs ) ) {
					if ( ! $zip->addEmptyDir( $base ) ) {
						$archive_ok = false;
						break;
					}
					$it = new RecursiveIteratorIterator(
						new RecursiveDirectoryIterator( $abs, FilesystemIterator::SKIP_DOTS ),
						RecursiveIteratorIterator::SELF_FIRST
					);
					foreach ( $it as $f ) {
						if ( $f->isLink() ) {
							++$skipped_symlinks;
							continue;
						}
						$real = realpath( $f->getPathname() );
						if (
							false === $real
							|| ! self::within( $root_base, $real )
							|| $f->getPathname() === $dest
							|| ( false !== $real_dest && $real === $real_dest )
						) {
							continue;
						}
						$local = $base . '/' . ltrim( substr( $f->getPathname(), strlen( $abs ) ), DIRECTORY_SEPARATOR );
						$local = str_replace( '\\', '/', $local );
						if ( $f->isDir() ) {
							$archive_ok = $zip->addEmptyDir( $local );
						} else {
							$archive_ok = $zip->addFile( $real, $local );
						}
						if ( ! $archive_ok ) {
							break 2;
						}
						$added++;
					}
				} else {
					$archive_ok = $zip->addFile( $abs, $base );
					if ( ! $archive_ok ) {
						break;
					}
					$added++;
				}
			}
		} catch ( \UnexpectedValueException ) {
			$archive_ok = false;
		}
		$archive_ok = $zip->close() && $archive_ok;
		$real_dest  = realpath( $dest );
		$archive_ok = $archive_ok && false !== $real_dest && self::within( $root_base, $real_dest );
		if ( ! $archive_ok ) {
			wp_delete_file( $dest );
			return new WP_Error( 'fs_archive_failed', 'Could not finish the archive.', array( 'status' => 500 ) );
		}
		return self::ok(
			$root,
			(string) $req->get_param( 'dest' ),
			array(
				'entries'          => $added,
				'skipped_symlinks' => $skipped_symlinks,
			)
		);
	}

	public static function rest_extract( WP_REST_Request $req ) {
		if ( ! class_exists( '\ZipArchive' ) ) {
			return new WP_Error( 'fs_no_zip', 'PHP ZipArchive extension is required.', array( 'status' => 500 ) );
		}
		$root = (string) $req->get_param( 'root' );
		$abs  = self::resolve( $root, (string) $req->get_param( 'path' ), true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		$dest_rel = (string) $req->get_param( 'dest' );
		if ( '' === trim( $dest_rel ) ) {
			// Default: a sibling folder named after the archive (sans extension).
			$dest_rel = self::sanitize_rel( dirname( (string) $req->get_param( 'path' ) ) . '/' . preg_replace( '/\.[^.]+$/', '', basename( $abs ) ) );
		}
		$dest = self::resolve( $root, $dest_rel, false );
		if ( is_wp_error( $dest ) ) {
			return $dest;
		}
		wp_mkdir_p( $dest );
		$real_dest = realpath( $dest );
		if ( false === $real_dest || ! self::within( realpath( self::root_by_id( $root )['path'] ), $real_dest ) ) {
			return new WP_Error( 'fs_escape', 'Extract destination escapes the root.', array( 'status' => 403 ) );
		}
		$zip = new \ZipArchive();
		if ( true !== $zip->open( $abs ) ) {
			return new WP_Error( 'fs_zip_open', 'Could not open archive.', array( 'status' => 400 ) );
		}
		// Zip-slip defence: reject any entry whose name contains traversal.
		for ( $i = 0; $i < $zip->numFiles; $i++ ) {
			$entry = (string) $zip->getNameIndex( $i );
			if ( str_contains( $entry, '..' ) || str_starts_with( $entry, '/' ) ) {
				$zip->close();
				return new WP_Error( 'fs_zip_slip', 'Archive contains an unsafe path; extraction aborted.', array( 'status' => 400 ) );
			}
		}
		$ok = $zip->extractTo( $real_dest );
		$zip->close();
		if ( ! $ok ) {
			return new WP_Error( 'fs_extract_failed', 'Extraction failed.', array( 'status' => 500 ) );
		}
		return self::ok( $root, $dest_rel );
	}

	/* ---- Recursion helpers -------------------------------------------- */

	private static function copy_recursive( string $src, string $dst, string $root_base ): bool {
		if ( is_link( $src ) || is_link( $dst ) || file_exists( $dst ) ) {
			return false;
		}
		$real_src = realpath( $src );
		if ( false === $real_src || ! self::within( $root_base, $real_src ) ) {
			return false;
		}
		if ( is_dir( $real_src ) ) {
			if ( ! wp_mkdir_p( $dst ) ) {
				return false;
			}
			$real_dst = realpath( $dst );
			if ( false === $real_dst || ! self::within( $root_base, $real_dst ) ) {
				return false;
			}
			$dh = opendir( $real_src );
			if ( false === $dh ) {
				return false;
			}
			$ok = true;
			while ( false !== ( $f = readdir( $dh ) ) ) {
				if ( '.' === $f || '..' === $f ) {
					continue;
				}
				$ok = self::copy_recursive( $real_src . DIRECTORY_SEPARATOR . $f, $dst . DIRECTORY_SEPARATOR . $f, $root_base ) && $ok;
			}
			closedir( $dh );
			return $ok;
		}
		$real_parent = realpath( dirname( $dst ) );
		return is_file( $real_src )
			&& false !== $real_parent
			&& self::within( $root_base, $real_parent )
			&& copy( $real_src, $dst );
	}

	/**
	 * Find (and optionally delete) stale compiled .md twins under a root.
	 *
	 * A .md is a stale twin only when a .llm source sits beside it: the
	 * same-basename source (foo.md <- foo.llm) or a skill entry point
	 * (SKILL.md <- a <name>.llm in the same dir). .llm is authored AND served
	 * now, so these .md are build leftovers. This NEVER deletes a .llm and
	 * NEVER a .md without a .llm sibling, which bounds the blast radius that
	 * kept general writes off MCP. Dry-run unless $apply. Jailed via resolve().
	 *
	 * @return array|WP_Error
	 */
	public static function clean_md_twins( string $root, string $rel = '', bool $apply = false, bool $include_hidden = false, int $max_results = 5000, int $max_files = 50000 ) {
		$start = self::resolve( $root, $rel );
		if ( is_wp_error( $start ) ) {
			return $start;
		}
		if ( ! is_dir( $start ) ) {
			return new WP_Error( 'fs_not_dir', 'Clean root is not a directory.', array( 'status' => 400 ) );
		}
		$base    = rtrim( $start, DIRECTORY_SEPARATOR );
		$twins   = array();
		$scanned = 0;
		$capped  = false;
		$failed  = 0;

		// SKIP_DOTS only; symlinks are NOT followed here (a mutating walk must
		// not chase a link out of the tree even before the jail re-check).
		$it = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::SELF_FIRST
		);
		foreach ( $it as $info ) {
			if ( $scanned >= $max_files || count( $twins ) >= $max_results ) {
				$capped = true;
				break;
			}
			$scanned++;
			if ( ! $info->isFile() ) {
				continue;
			}
			$abs = $info->getPathname();
			if ( 'md' !== strtolower( (string) pathinfo( $abs, PATHINFO_EXTENSION ) ) ) {
				continue;
			}
			$rel_path = str_replace( '\\', '/', ltrim( str_replace( $base, '', $abs ), DIRECTORY_SEPARATOR ) );
			// Skip hidden components (.trash, .git, .pre-unification-old) unless asked.
			if ( ! $include_hidden ) {
				$hidden = false;
				foreach ( explode( '/', $rel_path ) as $part ) {
					if ( '' !== $part && '.' === $part[0] ) {
						$hidden = true;
						break;
					}
				}
				if ( $hidden ) {
					continue;
				}
			}
			// Re-assert the jail: a symlink or race could surface a path outside.
			$real = realpath( $abs );
			if ( false === $real || ! self::within( $base, $real ) ) {
				continue;
			}
			// Twin test: a .llm source must sit beside this .md.
			$is_twin = false;
			if ( is_file( substr( $abs, 0, -3 ) . '.llm' ) ) {
				$is_twin = true;                         // foo.md  <- foo.llm
			} elseif ( 'SKILL.md' === basename( $abs ) ) {
				$llms = glob( dirname( $abs ) . DIRECTORY_SEPARATOR . '*.llm' );
				$is_twin = ! empty( $llms );             // SKILL.md <- <name>.llm
			}
			if ( ! $is_twin ) {
				continue;
			}
			$deleted = false;
			if ( $apply ) {
				wp_delete_file( $abs );
				$deleted = ! file_exists( $abs );
				if ( ! $deleted ) {
					$failed++;
				}
			}
			$twins[] = array(
				'path'    => $rel_path,
				'deleted' => $deleted,
			);
		}

		return array(
			'root'        => $root,
			'path'        => $rel,
			'applied'     => $apply,
			'twins_found' => count( $twins ),
			'deleted'     => $apply ? ( count( $twins ) - $failed ) : 0,
			'failed'      => $failed,
			'scanned'     => $scanned,
			'capped'      => $capped,
			'items'       => $twins,
		);
	}

	private static function delete_recursive( string $path ): bool {
		if ( is_link( $path ) || is_file( $path ) ) {
			wp_delete_file( $path );
			return ! file_exists( $path ) && ! is_link( $path );
		}
		if ( is_dir( $path ) ) {
			$dh = opendir( $path );
			if ( false === $dh ) {
				return false;
			}
			$ok = true;
			while ( false !== ( $f = readdir( $dh ) ) ) {
				if ( '.' === $f || '..' === $f ) {
					continue;
				}
				$ok = self::delete_recursive( $path . DIRECTORY_SEPARATOR . $f ) && $ok;
			}
			closedir( $dh );
			return @rmdir( $path ) && $ok; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- removing a jailed disk directory during recursive delete.
		}
		return false;
	}

	/* ===================================================================
	 * Phase 2 — command console (exec)
	 * =================================================================== */

	/** @return array{enabled:bool,timeout:int} */
	public static function get_exec_config(): array {
		$raw = CI_Filesystem_Options::get( self::OPTION_EXEC, array() );
		$raw = is_array( $raw ) ? $raw : array();
		$timeout = (int) ( $raw['timeout'] ?? 30 );
		return array(
			'enabled' => ! empty( $raw['enabled'] ),
			'timeout' => max( 1, min( self::EXEC_MAX_TIMEOUT, $timeout ) ),
		);
	}

	public static function rest_get_exec_config(): WP_REST_Response {
		return new WP_REST_Response( self::get_exec_config() );
	}

	public static function rest_set_exec_config( WP_REST_Request $req ): WP_REST_Response {
		$cfg = array(
			'enabled' => (bool) $req->get_param( 'enabled' ),
			'timeout' => max( 1, min( self::EXEC_MAX_TIMEOUT, (int) $req->get_param( 'timeout' ) ) ),
		);
		CI_Filesystem_Options::update( self::OPTION_EXEC, $cfg );
		return new WP_REST_Response( $cfg );
	}

	/**
	 * Run a shell command in a jailed working directory. This is the sharp
	 * edge of the whole feature, so it is locked down hard:
	 *   - manage_options + REST nonce (enforced by the route).
	 *   - DISABLED unless an admin explicitly opts in via Settings.
	 *   - cwd is jailed to a configured root via resolve().
	 *   - hard timeout; the process is killed if it overruns.
	 * It is intentionally NOT exposed as an MCP ability.
	 */
	public static function rest_exec( WP_REST_Request $req ) {
		$cfg = self::get_exec_config();
		if ( ! $cfg['enabled'] ) {
			return new WP_Error( 'fs_exec_disabled', 'The command console is disabled. Enable it in the Files roots manager.', array( 'status' => 403 ) );
		}
		if ( ! function_exists( 'proc_open' ) ) {
			return new WP_Error( 'fs_no_proc', 'proc_open is disabled on this host.', array( 'status' => 500 ) );
		}
		$root = (string) $req->get_param( 'root' );
		$cwd  = self::resolve( $root, (string) $req->get_param( 'path' ), true );
		if ( is_wp_error( $cwd ) ) {
			return $cwd;
		}
		if ( ! is_dir( $cwd ) ) {
			$cwd = dirname( $cwd );
		}
		$cmd = trim( (string) $req->get_param( 'cmd' ) );
		if ( '' === $cmd ) {
			return new WP_Error( 'fs_empty_cmd', 'cmd is required.', array( 'status' => 400 ) );
		}

		$descriptors = array(
			0 => array( 'pipe', 'r' ),
			1 => array( 'pipe', 'w' ),
			2 => array( 'pipe', 'w' ),
		);
		$proc = proc_open( $cmd, $descriptors, $pipes, $cwd, null ); // phpcs:ignore Generic.PHP.ForbiddenFunctions.Found -- the command console's entire purpose; gated by manage_options + opt-in + jailed cwd + timeout, never MCP-exposed.
		if ( ! is_resource( $proc ) ) {
			return new WP_Error( 'fs_exec_failed', 'Could not start the process.', array( 'status' => 500 ) );
		}
		fclose( $pipes[0] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- closing a proc_open process pipe, not a file; no WP_Filesystem equivalent.
		stream_set_blocking( $pipes[1], false );
		stream_set_blocking( $pipes[2], false );

		$stdout   = '';
		$stderr   = '';
		$deadline = time() + $cfg['timeout'];
		$timedout = false;
		$exit     = 0;
		do {
			$stdout .= stream_get_contents( $pipes[1] );
			$stderr .= stream_get_contents( $pipes[2] );
			$status  = proc_get_status( $proc );
			if ( ! $status['running'] ) {
				// Capture the exit code here — once proc_get_status() has
				// reaped it, proc_close() returns -1 (a PHP gotcha).
				$exit = (int) $status['exitcode'];
				break;
			}
			if ( time() >= $deadline ) {
				$timedout = true;
				proc_terminate( $proc, 9 );
				break;
			}
			usleep( 50000 );
		} while ( true );

		// Final drain.
		$stdout .= stream_get_contents( $pipes[1] );
		$stderr .= stream_get_contents( $pipes[2] );
		fclose( $pipes[1] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- closing a proc_open process pipe, not a file.
		fclose( $pipes[2] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- closing a proc_open process pipe, not a file.
		proc_close( $proc );

		// Cap returned output so a runaway command can't blow up the response.
		$cap = 200000;
		return new WP_REST_Response( array(
			'ok'       => ! $timedout,
			'cmd'      => $cmd,
			'cwd'      => (string) $req->get_param( 'path' ),
			'stdout'   => substr( $stdout, 0, $cap ),
			'stderr'   => substr( $stderr, 0, $cap ),
			'exit'     => $timedout ? 124 : $exit,
			'timedout' => $timedout,
		) );
	}

	/**
	 * Stream a file as a download. Not a JSON response — sets headers and
	 * echoes bytes, then exits (standard pattern for REST file delivery).
	 */
	public static function rest_download( WP_REST_Request $req ) {
		$file = self::resolve( (string) $req->get_param( 'root' ), (string) $req->get_param( 'path' ) );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		if ( ! is_file( $file ) || ! is_readable( $file ) ) {
			return new WP_Error( 'fs_not_file', 'Not a readable file.', array( 'status' => 400 ) );
		}
		$name = basename( $file );
		$ft   = wp_check_filetype( $name );
		nocache_headers();
		header( 'Content-Type: ' . ( $ft['type'] ? $ft['type'] : 'application/octet-stream' ) );
		header( 'Content-Disposition: attachment; filename="' . str_replace( '"', '', $name ) . '"' );
		header( 'Content-Length: ' . (int) filesize( $file ) );
		readfile( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streaming a jailed local file.
		exit;
	}
}
