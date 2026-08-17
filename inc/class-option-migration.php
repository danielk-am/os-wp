<?php
/**
 * Move the family's option rows from the `ci_` prefix onto the frozen `os_`
 * data namespace. See docs/contracts/DATA-INVENTORY.md for the full worklist
 * and why the namespace is frozen: a plugin's name is free to change, its data
 * is not, and `ci_` is a plugin name that leaked into the database.
 *
 * Options go first because they are the cheapest rename (one row, no joins) and
 * because two of them define what the later post_type migration has to
 * enumerate: `ci_custom_cpts` holds every user-defined content type and
 * `ci_taxonomies` holds every user-defined taxonomy. Rename the registered
 * types without those and the dynamic ones are stranded.
 *
 * This is the middle step of expand / migrate / contract:
 *
 *   1. expand   — code reads the new key, falling back to the old one
 *   2. migrate  — this class moves the rows  (wp ci migrate-options --execute)
 *   3. contract — the fallback and this class are deleted
 *
 * The read shim below is the safety net for step 2, not a substitute for step
 * 1: once a row has moved, any code still calling get_option( 'ci_*' ) keeps
 * working because `pre_option_*` resolves it to the new row. Writes are NOT
 * redirected. A legacy write would recreate the old row, which the next dry run
 * reports as pending again, so the drift is visible rather than silent.
 *
 * Usage:
 *   wp ci migrate-options                # dry run — prints what would change
 *   wp ci migrate-options --execute      # apply
 *   wp ci migrate-options --network      # every site in the network
 *   wp ci migrate-options --rollback     # reverse (os_ → ci_)
 *
 * The copy is a raw row copy, not get_option()/update_option(): the stored
 * string and its autoload flag are preserved byte for byte, so a serialized
 * value never makes a lossy round trip through PHP. Idempotent — a second run
 * finds nothing, because the source row is gone.
 *
 * @package OS_Index
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Core_Index_Option_Migration {

	/**
	 * Exact renames, in migration order. The first two are ordered
	 * deliberately: they define the dynamic content types and taxonomies that
	 * the post_type migration enumerates, so they move before anything reads
	 * them for that purpose.
	 *
	 * @var array<string,string>
	 */
	private const MAP = array(
		'ci_custom_cpts'        => 'os_custom_cpts',
		'ci_taxonomies'         => 'os_taxonomies',
		'ci_field_groups'       => 'os_field_groups',
		'ci_schema_overrides'   => 'os_schema_overrides',
		'ci_agents_overrides'   => 'os_agents_overrides',
		'ci_adopted_cpts'       => 'os_adopted_cpts',
		'ci_anthropic_api_key'  => 'os_anthropic_api_key',
		'ci_instance_id'        => 'os_instance_id',
		'ci_activity_log'       => 'os_activity_log',
		'ci_activity_events'    => 'os_activity_events',
		'ci_mcp_disabled_tools' => 'os_mcp_disabled_tools',
		'ci_disabled_apps'      => 'os_disabled_apps',
		'ci_file_skills_root'   => 'os_file_skills_root',
		'ci_kernel_proposals'   => 'os_kernel_proposals',
		'ci_code_index'         => 'os_code_index',
		'ci_code_errors'        => 'os_code_errors',
		'ci_code_loading'       => 'os_code_loading',
		'ci_code_mcp_activate_php' => 'os_code_mcp_activate_php',
		'ci_fs_roots'           => 'os_fs_roots',
		'ci_fs_exec'            => 'os_fs_exec',
		'ci_fs_console'         => 'os_fs_console',
	);

	/**
	 * Prefix families. These options are minted per plugin slug at runtime
	 * (`ci_field_groups_core_index_content_types`), so no static list can be
	 * complete. Anything matching a family prefix is migrated by swapping the
	 * `ci_` for `os_` and keeping the rest of the name verbatim.
	 *
	 * The suffixes are themselves a symptom of this whole exercise: the key was
	 * derived from a plugin slug, so one setting exists twice under two slugs.
	 * Collapsing those duplicates is a separate decision, deliberately not made
	 * here — this class moves rows, it never merges them.
	 *
	 * @var string[]
	 */
	private const FAMILIES = array(
		'ci_field_groups_',
		'ci_schema_overrides_',
		'ci_taxonomies_',
		'ci_agents_overrides_',
	);

	/** Sentinel for "this option row does not exist", distinct from a stored false. */
	private const ABSENT = '__core_index_absent__';

	public static function register(): void {
		self::register_read_shim();

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command(
				'ci migrate-options',
				array( __CLASS__, 'cmd' ),
				array( 'shortdesc' => 'Move ci_* option rows onto the frozen os_ data namespace.' )
			);
		}
	}

	/**
	 * Resolve a legacy read to the migrated row. Only the exact map is shimmed:
	 * the prefix families are minted by code that already knows the current
	 * name, and shimming an open-ended prefix would mean a filter per option
	 * lookup for rows that may not exist.
	 *
	 * Returns $pre untouched when the new row is absent, so this is inert
	 * before the migration runs and during a rollback.
	 */
	private static function register_read_shim(): void {
		foreach ( self::MAP as $old => $new ) {
			add_filter(
				"pre_option_{$old}",
				static function ( $pre ) use ( $new ) {
					if ( false !== $pre ) {
						return $pre; // another filter already answered.
					}
					$value = get_option( $new, self::ABSENT );
					return self::ABSENT === $value ? $pre : $value;
				}
			);
		}
	}

	/**
	 * The legacy name a canonical option came from, or null when the canonical
	 * name is not one this class knows. `Core_Index_Options` reads the pairing
	 * from here so the map is declared exactly once.
	 */
	public static function legacy_name( string $canonical ): ?string {
		$reverse = array_flip( self::MAP );
		return $reverse[ $canonical ] ?? null;
	}

	/**
	 * Every rename this site would perform, with its current state.
	 *
	 * @param bool $rollback Read the plan in reverse (os_ → ci_).
	 * @return array<int,array{from:string,to:string,state:string,autoload:string,bytes:int}>
	 */
	public static function plan( bool $rollback = false ): array {
		$pairs = self::MAP;
		foreach ( self::discover_families() as $name ) {
			$pairs[ $name ] = 'os_' . substr( $name, 3 );
		}
		if ( $rollback ) {
			$pairs = array_flip( $pairs );
		}

		$rows = array();
		foreach ( $pairs as $from => $to ) {
			$source = self::read_row( $from );
			$target = self::read_row( $to );

			if ( null === $source && null === $target ) {
				continue; // neither side exists; nothing to say about it.
			}
			if ( null === $source ) {
				$state = 'done';
			} elseif ( null !== $target ) {
				$state = 'conflict';
			} else {
				$state = 'pending';
			}

			$rows[] = array(
				'from'     => $from,
				'to'       => $to,
				'state'    => $state,
				'autoload' => null !== $source ? (string) $source['autoload'] : '',
				'bytes'    => null !== $source ? strlen( (string) $source['option_value'] ) : 0,
			);
		}
		return $rows;
	}

	/**
	 * Legacy option rows this class does not know how to move. Reported by the
	 * dry run so an unmapped key is a visible gap rather than a silent skip.
	 *
	 * @return string[]
	 */
	public static function unmapped(): array {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- migration tooling, no cache to warm.
		$names = (array) $wpdb->get_col(
			$wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'ci_' ) . '%' )
		);

		$known = array_keys( self::MAP );
		return array_values(
			array_filter(
				$names,
				static function ( $name ) use ( $known ): bool {
					if ( in_array( $name, $known, true ) ) {
						return false;
					}
					foreach ( self::FAMILIES as $prefix ) {
						if ( str_starts_with( (string) $name, $prefix ) ) {
							return false;
						}
					}
					return true;
				}
			)
		);
	}

	/**
	 * Move one row. Copy first, delete second, then read the target back and
	 * compare it to what was copied: a tool that reports success from the
	 * absence of an error is reporting that it ran, not that it worked.
	 *
	 * @return array{ok:bool,message:string}
	 */
	public static function move( string $from, string $to ): array {
		global $wpdb;

		$source = self::read_row( $from );
		if ( null === $source ) {
			return array( 'ok' => true, 'message' => 'already moved' );
		}
		if ( null !== self::read_row( $to ) ) {
			return array( 'ok' => false, 'message' => "target {$to} already exists, refusing to overwrite" );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- raw copy preserves the stored string and autoload flag verbatim.
		$inserted = $wpdb->insert(
			$wpdb->options,
			array(
				'option_name'  => $to,
				'option_value' => $source['option_value'],
				'autoload'     => $source['autoload'],
			),
			array( '%s', '%s', '%s' )
		);
		if ( false === $inserted ) {
			return array( 'ok' => false, 'message' => "insert failed: {$wpdb->last_error}" );
		}

		// Read back from the database, not from what we just wrote, before the
		// source row is destroyed. A truncating column or a storage-engine
		// surprise shows up here while the original still exists.
		$written = self::read_row( $to );
		if ( null === $written || $written['option_value'] !== $source['option_value'] ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- undo the partial copy.
			$wpdb->delete( $wpdb->options, array( 'option_name' => $to ), array( '%s' ) );
			return array( 'ok' => false, 'message' => 'readback mismatch, copy reverted' );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- the source row is now redundant.
		$wpdb->delete( $wpdb->options, array( 'option_name' => $from ), array( '%s' ) );

		self::forget( $from );
		self::forget( $to );

		return array( 'ok' => true, 'message' => sprintf( 'moved %d bytes (autoload %s)', strlen( (string) $source['option_value'] ), $source['autoload'] ) );
	}

	/**
	 * Raw option row, or null when absent. Deliberately not get_option(): that
	 * unserializes, applies filters (including our own shim), and cannot tell a
	 * stored `false` from a missing row.
	 *
	 * @return array{option_value:string,autoload:string}|null
	 */
	private static function read_row( string $name ): ?array {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- migration tooling reads the row, not the cached value.
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT option_value, autoload FROM {$wpdb->options} WHERE option_name = %s", $name ),
			ARRAY_A
		);
		return is_array( $row ) ? $row : null;
	}

	/** Drop an option from the cache, including the autoloaded bundle. */
	private static function forget( string $name ): void {
		wp_cache_delete( $name, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}

	/** Option names on this site matching a prefix family. @return string[] */
	private static function discover_families(): array {
		global $wpdb;
		$found = array();
		foreach ( self::FAMILIES as $prefix ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- migration tooling.
			$names = (array) $wpdb->get_col(
				$wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( $prefix ) . '%' )
			);
			$found = array_merge( $found, array_map( 'strval', $names ) );
		}
		return array_values( array_unique( $found ) );
	}

	/**
	 * `wp ci migrate-options [--execute] [--network] [--rollback]`
	 *
	 * @param array<int,string>    $args       Positional args (unused).
	 * @param array<string,string> $assoc_args Flags.
	 */
	public static function cmd( $args, $assoc_args ): void {
		$execute  = isset( $assoc_args['execute'] );
		$rollback = isset( $assoc_args['rollback'] );
		$network  = isset( $assoc_args['network'] );

		if ( $network && ! is_multisite() ) {
			\WP_CLI::error( '--network requires a multisite install.' );
		}

		$sites = array( get_current_blog_id() );
		if ( $network ) {
			$sites = array_map( 'intval', get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) );
		}

		\WP_CLI::line(
			sprintf(
				'[%s] %s across %d site(s)',
				$execute ? 'EXECUTING' : 'DRY RUN',
				$rollback ? 'rolling back os_ -> ci_' : 'migrating ci_ -> os_',
				count( $sites )
			)
		);

		$totals = array( 'moved' => 0, 'pending' => 0, 'conflict' => 0, 'failed' => 0 );

		foreach ( $sites as $site_id ) {
			if ( $network ) {
				switch_to_blog( $site_id );
			}

			$plan = self::plan( $rollback );
			$name = $network ? sprintf( 'site %d (%s)', $site_id, home_url() ) : 'this site';

			if ( empty( $plan ) ) {
				\WP_CLI::line( sprintf( '  %s: nothing to do', $name ) );
			} else {
				\WP_CLI::line( sprintf( '  %s:', $name ) );
			}

			foreach ( $plan as $row ) {
				if ( 'done' === $row['state'] ) {
					continue;
				}
				if ( 'conflict' === $row['state'] ) {
					++$totals['conflict'];
					\WP_CLI::warning( sprintf( '    %s -> %s: both rows exist, resolve by hand', $row['from'], $row['to'] ) );
					continue;
				}

				++$totals['pending'];
				\WP_CLI::line( sprintf( '    %-46s -> %-46s %6d bytes  autoload=%s', $row['from'], $row['to'], $row['bytes'], $row['autoload'] ) );

				if ( ! $execute ) {
					continue;
				}

				$result = self::move( $row['from'], $row['to'] );
				if ( $result['ok'] ) {
					++$totals['moved'];
					\WP_CLI::line( sprintf( '      ok: %s', $result['message'] ) );
				} else {
					++$totals['failed'];
					\WP_CLI::warning( sprintf( '      %s', $result['message'] ) );
				}
			}

			// Only meaningful in the forward direction; during a rollback the
			// ci_ rows being recreated are the point, not an anomaly.
			if ( ! $rollback ) {
				foreach ( self::unmapped() as $orphan ) {
					\WP_CLI::warning( sprintf( '    unmapped legacy option: %s', $orphan ) );
				}
			}

			if ( $network ) {
				restore_current_blog();
			}
		}

		if ( ! $execute ) {
			\WP_CLI::success( sprintf( '%d row(s) would move, %d conflict(s). Re-run with --execute.', $totals['pending'], $totals['conflict'] ) );
			return;
		}
		if ( $totals['failed'] > 0 ) {
			\WP_CLI::error( sprintf( '%d moved, %d failed, %d conflict(s).', $totals['moved'], $totals['failed'], $totals['conflict'] ) );
		}
		\WP_CLI::success( sprintf( '%d row(s) moved, %d conflict(s).', $totals['moved'], $totals['conflict'] ) );
	}
}
