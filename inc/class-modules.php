<?php
/**
 * The module registry: what OS is made of, which parts are on, and how a part
 * that breaks gets taken out of the way instead of taking the site down.
 *
 * Each module is a directory under `modules/` with a `module.json` describing
 * it and a `module.php` that boots it. That directory used to be a separate
 * plugin, and the boundary survives the merge: a module still owns its data,
 * its ability namespace, and its REST namespace. What it no longer needs is its
 * own activation, its own copy of the shared runtime, or a contract test
 * proving it can live alone.
 *
 * Why a toggle rather than nine plugins:
 *
 * The reason to keep them separate was that someone might want only Calendar.
 * A toggle answers that better than a plugin boundary does. "Which modules are
 * on" is one screen; "which of nine plugins did I install, and in what order"
 * is a support conversation. Anyone replicating this setup installs one thing
 * and turns off what they do not want.
 *
 * Failure isolation is the property the split really bought, so it is rebuilt
 * here rather than lost. Two layers:
 *
 *   1. `Throwable` is caught around each module's boot. PHP surfaces most
 *      runtime failures as `Error`, so a module that calls a missing function
 *      or trips a type error is disabled for the request while the rest of the
 *      site carries on.
 *   2. A hard fatal, out of memory or a parse error in a required file, kills
 *      the request before any catch runs. So a marker option is written before
 *      a module boots and cleared after. Finding a stale marker on the next
 *      request means that module took the site down, and it is disabled until
 *      a human turns it back on. Same circuit breaker the code loader uses on
 *      PHP snippets, for the same reason: a bad module should not need SSH.
 *
 * @package OS
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OS_Modules {

	/** Modules an administrator has switched off. */
	const DISABLED_OPTION = 'os_disabled_modules';

	/** Modules the circuit breaker switched off, module => reason. */
	const TRIPPED_OPTION = 'os_tripped_modules';

	/** The module currently mid-boot, cleared once it returns. */
	const BOOTING_OPTION = 'os_booting_module';

	/** @var array<string,array<string,mixed>>|null */
	private static ?array $manifests = null;

	/**
	 * Every module on disk, keyed by name, in boot order.
	 *
	 * Order is alphabetical rather than declared: modules interoperate through
	 * WordPress hooks, never by loading each other, so boot order carries no
	 * meaning. If it ever does, that is a dependency and it belongs in a hook.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function all(): array {
		if ( null !== self::$manifests ) {
			return self::$manifests;
		}

		$found = array();
		foreach ( (array) glob( OS_DIR . 'modules/*/module.json' ) as $path ) {
			$manifest = json_decode( (string) file_get_contents( $path ), true );
			if ( ! is_array( $manifest ) || empty( $manifest['module'] ) ) {
				continue;
			}
			$manifest['dir']       = dirname( $path );
			$manifest['bootstrap'] = dirname( $path ) . '/module.php';
			$found[ (string) $manifest['module'] ] = $manifest;
		}
		ksort( $found );

		self::$manifests = $found;
		return $found;
	}

	/** @return string[] Modules switched off by an administrator. */
	public static function disabled(): array {
		return array_values( array_filter( array_map( 'strval', (array) get_option( self::DISABLED_OPTION, array() ) ) ) );
	}

	/** @return array<string,string> Modules the breaker tripped, module => reason. */
	public static function tripped(): array {
		$tripped = get_option( self::TRIPPED_OPTION, array() );
		return is_array( $tripped ) ? $tripped : array();
	}

	/** @return array<string,array<string,mixed>> Modules that should boot. */
	public static function enabled(): array {
		$off = array_merge( self::disabled(), array_keys( self::tripped() ) );
		return array_diff_key( self::all(), array_flip( $off ) );
	}

	/** Switch a module off, or on. Returns the resulting disabled list. */
	public static function set_enabled( string $module, bool $enabled ): array {
		$disabled = self::disabled();
		if ( $enabled ) {
			$disabled = array_values( array_diff( $disabled, array( $module ) ) );
			self::clear_trip( $module );
		} elseif ( ! in_array( $module, $disabled, true ) ) {
			$disabled[] = $module;
		}
		update_option( self::DISABLED_OPTION, $disabled );
		return $disabled;
	}

	/** Clear a breaker trip so the module boots again on the next request. */
	public static function clear_trip( string $module ): void {
		$tripped = self::tripped();
		unset( $tripped[ $module ] );
		update_option( self::TRIPPED_OPTION, $tripped );
	}

	/**
	 * Boot every enabled module.
	 *
	 * Called once, early, from the plugin bootstrap. A module that throws is
	 * reported and skipped; a module that hard-fatals is caught on the next
	 * request by the stale marker it left behind.
	 */
	public static function boot(): void {
		self::trip_stale_marker();

		foreach ( self::enabled() as $name => $manifest ) {
			if ( ! is_file( (string) $manifest['bootstrap'] ) ) {
				continue;
			}

			update_option( self::BOOTING_OPTION, $name, false );

			try {
				require_once $manifest['bootstrap'];
			} catch ( Throwable $e ) {
				self::trip( $name, sprintf( '%s in %s:%d', $e->getMessage(), basename( $e->getFile() ), $e->getLine() ) );
			}

			delete_option( self::BOOTING_OPTION );
		}

		add_action( 'admin_notices', array( __CLASS__, 'tripped_notice' ) );
	}

	/**
	 * A marker left behind means the previous request died inside that module.
	 * Trip it, so the next request boots without it and the site comes back.
	 */
	private static function trip_stale_marker(): void {
		$stale = get_option( self::BOOTING_OPTION, '' );
		if ( ! is_string( $stale ) || '' === $stale ) {
			return;
		}
		delete_option( self::BOOTING_OPTION );
		self::trip( $stale, 'the request did not survive this module booting' );
	}

	/** Record a module as tripped. */
	private static function trip( string $module, string $reason ): void {
		$tripped            = self::tripped();
		$tripped[ $module ] = $reason;
		update_option( self::TRIPPED_OPTION, $tripped );
	}

	/** Tell an administrator that something was switched off for them. */
	public static function tripped_notice(): void {
		$tripped = self::tripped();
		if ( empty( $tripped ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		foreach ( $tripped as $module => $reason ) {
			printf(
				'<div class="notice notice-warning"><p>%s</p></div>',
				esc_html(
					sprintf(
						/* translators: 1: module name, 2: why it was disabled. */
						__( 'OS disabled the %1$s module because it failed to load: %2$s', 'os' ),
						(string) $module,
						(string) $reason
					)
				)
			);
		}
	}

	/**
	 * Every data identifier the suite owns, module => keys.
	 *
	 * The manifests stopped being an independence contract when the plugins
	 * merged. They still answer the question that actually matters on someone
	 * else's site: what does this own, and therefore what may an uninstall
	 * remove. See docs/contracts/DATA-INVENTORY.md.
	 *
	 * @return array<string,string[]>
	 */
	public static function owned_data(): array {
		$owned = array();
		foreach ( self::all() as $name => $manifest ) {
			$owned[ $name ] = array_map( 'strval', (array) ( $manifest['owned_data'] ?? array() ) );
		}
		return $owned;
	}
}
