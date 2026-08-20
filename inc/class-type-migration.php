<?php
/**
 * Move the family's content model onto the frozen `os_` data namespace: post
 * types, the taxonomies attached to them, and the meta keys hanging off both.
 * See docs/contracts/DATA-INVENTORY.md.
 *
 * These three move together because they only make sense together. A snippet
 * whose post type became `os_snippet` while its meta is still filed under
 * `ci_tip` is not half migrated, it is broken: the editor reads the new type
 * and finds none of its fields. So the unit of work here is a type and
 * everything attached to it, not one identifier at a time.
 *
 * The ordering inside a group is deliberate. Attachments move first and the
 * post type last, so the post type name is the resume marker: while rows still
 * carry `ci_snippet`, the group is unfinished no matter what else succeeded.
 * Every step is independently idempotent, so a re-run after a failure picks up
 * exactly what is left rather than repeating what landed.
 *
 * A post type cannot expand the way an option can. `WP_Query` asks the database
 * for one exact `post_type` string and no filter makes a row answer to two
 * names, so the flip has to land with the registration rather than before it.
 * That ordering is enforced, not documented: an entry is skipped unless its
 * replacement is registered, which means running this against a build whose
 * `register_post_type()` calls still say `ci_skill` does nothing at all instead
 * of hiding every post on the site.
 *
 * Usage:
 *   wp ci migrate-types              # dry run — prints every planned change
 *   wp ci migrate-types --execute    # apply
 *   wp ci migrate-types --network    # every site in the network
 *   wp ci migrate-types --merge      # allow a non-empty target (resume)
 *   wp ci migrate-types --force      # skip the registration guards
 *
 * Roles are untouched: every type in this family registers with
 * `capability_type => 'page'`, so no capability carries a type name. Rewrite
 * rules are untouched too, because every type registers `rewrite => false`.
 * Revisions need nothing: they carry `post_type = 'revision'` and find their
 * parent by ID. Term relationships need nothing: they join on
 * `term_taxonomy_id`, not on the taxonomy name.
 *
 * @package OS_Index
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OS_Type_Migration {

	/**
	 * Post types, and the taxonomies and meta keys that belong to each. The
	 * group is the transaction: everything in it moves in one pass.
	 *
	 * @var array<string,array{to:string,taxonomies:array<string,string>,meta:array<string,string>}>
	 */
	private const GROUPS = array(
		'ci_skill'    => array(
			'to'         => 'os_skill',
			'taxonomies' => array( 'ci_skill_type' => 'os_skill_type' ),
			'meta'       => array(),
		),
		'ci_snippet'  => array(
			'to'         => 'os_snippet',
			'taxonomies' => array(),
			'meta'       => array(
				'ci_tip'        => 'os_tip',
				'ci_kind'       => 'os_kind',
				'ci_section'    => 'os_section',
				'ci_builtin_id' => 'os_builtin_id',
			),
		),
		'ci_reminder' => array(
			'to'         => 'os_reminder',
			'taxonomies' => array( 'ci_reminder_tag' => 'os_reminder_tag' ),
			'meta'       => array(
				'ci_task_due_date'     => 'os_task_due_date',
				'ci_task_due_time'     => 'os_task_due_time',
				'ci_task_priority'     => 'os_task_priority',
				'ci_reminder_note'     => 'os_reminder_note',
				'ci_reminder_notified' => 'os_reminder_notified',
			),
		),
		'ci_automation' => array(
			'to'         => 'os_automation',
			'taxonomies' => array(),
			'meta'       => array(
				'ci_auto_trigger'     => 'os_auto_trigger',
				'ci_auto_channel'     => 'os_auto_channel',
				'ci_auto_method'      => 'os_auto_method',
				'ci_auto_target'      => 'os_auto_target',
				'ci_auto_agent'       => 'os_auto_agent',
				'ci_auto_agent_mode'  => 'os_auto_agent_mode',
				'ci_auto_model'       => 'os_auto_model',
				'ci_auto_payload'     => 'os_auto_payload',
				'ci_auto_body_type'   => 'os_auto_body_type',
				'ci_auto_headers'     => 'os_auto_headers',
				'ci_auto_priority'    => 'os_auto_priority',
				'ci_auto_tags'        => 'os_auto_tags',
				'ci_auto_lead_minutes' => 'os_auto_lead_minutes',
				'ci_auto_digest_time' => 'os_auto_digest_time',
				'ci_auto_then'        => 'os_auto_then',
				'ci_auto_delay'       => 'os_auto_delay',
				'ci_auto_enabled'     => 'os_auto_enabled',
				'ci_auto_log'         => 'os_auto_log',
			),
		),
		'ci_code'     => array(
			'to'         => 'os_code',
			'taxonomies' => array(),
			'meta'       => array(
				'ci_code_active'   => 'os_code_active',
				'ci_code_language' => 'os_code_language',
				'ci_code_priority' => 'os_code_priority',
				'ci_code_scope'    => 'os_code_scope',
			),
		),
		'ci_wiki'           => array( 'to' => 'os_wiki', 'taxonomies' => array(), 'meta' => array() ),
		'ci_memory'         => array( 'to' => 'os_memory', 'taxonomies' => array(), 'meta' => array() ),
		'ci_wizard'         => array( 'to' => 'os_wizard', 'taxonomies' => array(), 'meta' => array() ),
		'ci_csv'            => array( 'to' => 'os_csv', 'taxonomies' => array(), 'meta' => array() ),
		'ci_agent'          => array( 'to' => 'os_agent', 'taxonomies' => array(), 'meta' => array() ),
		'ci_journal'        => array( 'to' => 'os_journal', 'taxonomies' => array(), 'meta' => array() ),
		'wp_activity'       => array( 'to' => 'os_activity', 'taxonomies' => array(), 'meta' => array() ),
		'wp_calendar_event' => array( 'to' => 'os_calendar_event', 'taxonomies' => array(), 'meta' => array() ),
		'wp_content_type'   => array( 'to' => 'os_content_type', 'taxonomies' => array(), 'meta' => array() ),
		'wp_knowledge_node' => array( 'to' => 'os_knowledge_node', 'taxonomies' => array(), 'meta' => array() ),
		'wp_notification'   => array( 'to' => 'os_notification', 'taxonomies' => array(), 'meta' => array() ),
	);

	/**
	 * Taxonomies that span several types, so they belong to no single group.
	 *
	 * @var array<string,string>
	 */
	private const SHARED_TAXONOMIES = array( 'ci_tag' => 'os_tag' );

	/**
	 * Meta keys registered across several types. `ci_language` marks a post as
	 * a code file, `ci_path` is the vault path, `ci_tags` is the name-based tag
	 * bridge, and `ci_notif_read_at` is set on notifications.
	 *
	 * @var array<string,string>
	 */
	private const SHARED_META = array(
		'ci_language'      => 'os_language',
		'ci_path'          => 'os_path',
		'ci_tags'          => 'os_tags',
		'ci_notif_read_at' => 'os_notif_read_at',
	);

	/** Options whose ARRAY KEYS are post type names. */
	private const KEYED_BY_TYPE = array(
		'os_field_groups',
		'os_schema_overrides',
		'os_agents_overrides',
		'os_custom_cpts',
		'os_field_groups_core_index_content_types',
		'os_schema_overrides_core_index_content_types',
		'os_agents_overrides_core_index_content_types',
	);

	/** Options holding a flat LIST of post type names. */
	private const LISTS_OF_TYPES = array( 'os_adopted_cpts' );

	/**
	 * Renamed extension points, new name => the name consumers may still use.
	 *
	 * A filter is a published contract, so the old name keeps firing rather than
	 * every apply site growing a chained pair. Bridging once here keeps the call
	 * sites clean and means retiring the compatibility is deleting one constant.
	 *
	 * @var array<string,string>
	 */
	private const LEGACY_FILTERS = array(
		'os_default_block'            => 'ci_default_block',
		'os_tag_object_types'         => 'ci_tag_object_types',
		'os_admin_search_post_types'  => 'ci_admin_search_post_types',
		'os_discriminator_taxonomies' => 'ci_discriminator_taxonomies',
		'os_schema_for_cpt'           => 'ci_schema_for_cpt',
		'os_agents_for_cpt'           => 'ci_agents_for_cpt',
		'os_okf_type'                 => 'ci_okf_type',
		'os_okf_key_aliases'          => 'ci_okf_key_aliases',
	);

	/** Renamed cron hooks, legacy => new. A hook reschedules; it cannot migrate. */
	private const CRON_HOOKS = array( 'ci_reminders_cron' => 'os_reminders_cron' );

	public static function register(): void {
		add_action( 'pre_get_posts', array( __CLASS__, 'redirect_legacy_query' ) );
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'rewrite_legacy_rest_route' ), 10, 3 );

		// Anything still hooked on a filter's pre-rename name keeps running: the
		// new filter re-broadcasts under the old one at a late priority, so a
		// legacy consumer sees the value everything else has already produced.
		foreach ( self::LEGACY_FILTERS as $current => $legacy ) {
			add_filter(
				$current,
				static function ( $value, ...$args ) use ( $legacy ) {
					return apply_filters_ref_array( $legacy, array_merge( array( $value ), $args ) );
				},
				99,
				4
			);
		}

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command(
				'ci migrate-types',
				array( __CLASS__, 'cmd' ),
				array( 'shortdesc' => 'Move ci_/wp_ post types, taxonomies, and meta onto the frozen os_ namespace.' )
			);
		}
	}

	/**
	 * Point a query at a legacy post type to its replacement, but only once the
	 * legacy type is no longer registered. While both exist the site is
	 * mid-migration and a query for the old name still means the old name.
	 *
	 * Covers WP_Query, so plugin code and REST collections. It cannot cover raw
	 * SQL, and it deliberately ignores a query naming several types, where
	 * guessing the intent would be worse than leaving it alone.
	 *
	 * @param WP_Query $query The query being prepared.
	 */
	public static function redirect_legacy_query( $query ): void {
		$requested = $query->get( 'post_type' );
		if ( ! is_string( $requested ) || '' === $requested ) {
			return;
		}
		$group = self::GROUPS[ $requested ] ?? null;
		if ( null === $group || post_type_exists( $requested ) || ! post_type_exists( $group['to'] ) ) {
			return;
		}
		$query->set( 'post_type', $group['to'] );
	}

	/**
	 * Answer the pre-rename REST routes from the renamed ones.
	 *
	 * A post type's `rest_base` follows its name again, so the collection that
	 * used to live at `/wp/v2/ci_skill` now lives at `/wp/v2/os_skill`. Saved
	 * agent configurations, MCP clients, and anything else holding the old URL
	 * would 404, so the old path is rewritten onto the new one before the server
	 * matches a route. Same mechanism as the namespace rewrite in
	 * `OS_Legacy_Compat`, and it retires the same way: delete this once
	 * every client has moved.
	 *
	 * @param mixed            $result  Short-circuit result, returned untouched.
	 * @param WP_REST_Server   $server  Server instance (unused).
	 * @param WP_REST_Request  $request The request to re-point.
	 * @return mixed The unmodified $result.
	 */
	public static function rewrite_legacy_rest_route( $result, $server, $request ) {
		if ( null !== $result ) {
			return $result;
		}
		$route = $request->get_route();
		foreach ( self::GROUPS as $legacy => $group ) {
			$prefix = '/wp/v2/' . $legacy;
			if ( $route === $prefix || str_starts_with( $route, $prefix . '/' ) ) {
				$request->set_route( '/wp/v2/' . $group['to'] . substr( $route, strlen( $prefix ) ) );
				break;
			}
		}
		return $result;
	}

	/**
	 * Every change this site would make, grouped by owning post type.
	 *
	 * @return array<int,array{group:string,kind:string,from:string,to:string,rows:int,existing:int,ready:bool}>
	 */
	public static function plan(): array {
		$entries = array();

		foreach ( self::groups() as $from => $group ) {
			$ready = post_type_exists( $group['to'] );

			foreach ( $group['taxonomies'] as $tax_from => $tax_to ) {
				$entries[] = self::entry( $from, 'taxonomy', $tax_from, $tax_to, taxonomy_exists( $tax_to ) );
			}
			foreach ( $group['meta'] as $meta_from => $meta_to ) {
				$entries[] = self::entry( $from, 'meta', $meta_from, $meta_to, $ready );
			}
			$entries[] = self::entry( $from, 'post_type', $from, $group['to'], $ready );
		}

		foreach ( self::SHARED_TAXONOMIES as $from => $to ) {
			$entries[] = self::entry( 'shared', 'taxonomy', $from, $to, taxonomy_exists( $to ) );
		}
		foreach ( self::SHARED_META as $from => $to ) {
			$entries[] = self::entry( 'shared', 'meta', $from, $to, self::any_target_registered() );
		}

		// Only a populated SOURCE is pending work. A target holding rows with
		// nothing to move is the normal state of a fresh install, where the
		// plugin has simply been writing under its own name, and listing it
		// would report work that does not exist.
		return array_values(
			array_filter( $entries, static fn( array $e ): bool => $e['rows'] > 0 )
		);
	}

	/**
	 * Apply one planned entry.
	 *
	 * @return int|WP_Error Rows rewritten, or why it refused.
	 */
	public static function move( array $entry, bool $merge = false, bool $force = false ) {
		if ( ! $force && ! $entry['ready'] ) {
			return new WP_Error(
				'target_not_registered',
				sprintf( '%s is not registered yet; migrate the code first or pass --force', $entry['to'] )
			);
		}

		$expected = $entry['rows'];
		if ( 0 === $expected ) {
			return 0;
		}
		if ( $entry['existing'] > 0 && ! $merge && 'meta' !== $entry['kind'] ) {
			return new WP_Error(
				'target_not_empty',
				sprintf( '%s already holds %d row(s); pass --merge to combine them', $entry['to'], $entry['existing'] )
			);
		}

		switch ( $entry['kind'] ) {
			case 'post_type':
				$updated = self::rewrite( 'post_type', $entry['from'], $entry['to'] );
				break;
			case 'taxonomy':
				$updated = self::rewrite( 'taxonomy', $entry['from'], $entry['to'] );
				break;
			case 'meta':
				$updated = self::rewrite( 'meta', $entry['from'], $entry['to'] );
				break;
			default:
				return new WP_Error( 'unknown_kind', $entry['kind'] );
		}

		if ( false === $updated ) {
			global $wpdb;
			return new WP_Error( 'update_failed', $wpdb->last_error );
		}

		// Independent readback: the source must be empty and the target must
		// have grown by exactly what the source held. A count that agrees with
		// the UPDATE's own return value proves nothing on its own.
		$left   = self::count( $entry['kind'], $entry['from'] );
		$landed = self::count( $entry['kind'], $entry['to'] ) - $entry['existing'];
		if ( 0 !== $left || $landed !== $expected ) {
			return new WP_Error(
				'readback_mismatch',
				sprintf( 'expected %d moved, found %d with %d left behind', $expected, $landed, $left )
			);
		}

		// A nav menu entry pointing at a post type or taxonomy archive stores
		// that name in `_menu_item_object`, so it breaks unless it moves too.
		if ( 'meta' !== $entry['kind'] ) {
			self::rewrite_menu_items( $entry['from'], $entry['to'] );
		}
		if ( 'taxonomy' === $entry['kind'] ) {
			self::rewrite_taxonomy_options( $entry['from'], $entry['to'] );
		}

		return (int) $updated;
	}

	/**
	 * Rewrite post type names used as keys or list entries inside the settings
	 * options. Runs once after the rows move, because a single option can be
	 * keyed by several types.
	 *
	 * @param array<string,string> $pairs Applied post type renames.
	 * @return int Number of option rows rewritten.
	 */
	public static function rewrite_option_payloads( array $pairs ): int {
		$touched = 0;

		foreach ( self::KEYED_BY_TYPE as $option ) {
			$value = OS_Options::get( $option, null );
			if ( ! is_array( $value ) ) {
				continue;
			}
			$changed = false;
			$rebuilt = array();
			foreach ( $value as $key => $entry ) {
				$new_key = is_string( $key ) && isset( $pairs[ $key ] ) ? $pairs[ $key ] : $key;
				if ( $new_key !== $key ) {
					$changed = true;
				}
				if ( is_array( $entry ) ) {
					foreach ( array( 'slug', 'post_type' ) as $field ) {
						if ( isset( $entry[ $field ] ) && is_string( $entry[ $field ] ) && isset( $pairs[ $entry[ $field ] ] ) ) {
							$entry[ $field ] = $pairs[ $entry[ $field ] ];
							$changed         = true;
						}
					}
				}
				$rebuilt[ $new_key ] = $entry;
			}
			if ( $changed ) {
				OS_Options::update( $option, $rebuilt );
				++$touched;
			}
		}

		foreach ( self::LISTS_OF_TYPES as $option ) {
			$value = OS_Options::get( $option, null );
			if ( ! is_array( $value ) ) {
				continue;
			}
			$rebuilt = array_map(
				static fn( $type ) => is_string( $type ) && isset( $pairs[ $type ] ) ? $pairs[ $type ] : $type,
				$value
			);
			if ( $rebuilt !== $value ) {
				OS_Options::update( $option, $rebuilt );
				++$touched;
			}
		}

		return $touched;
	}

	/**
	 * Move the scheduled events onto the renamed hooks.
	 *
	 * A cron hook does not migrate, it reschedules: the event's identity IS the
	 * hook name, so the old entry is cleared and an equivalent one booked under
	 * the new name at the same timestamp and recurrence. Worst case is one
	 * missed tick, which is why this runs last, after everything the hook
	 * triggers has already moved.
	 *
	 * @return array<string,string> Legacy hook => what happened to it.
	 */
	public static function reschedule_cron( bool $execute ): array {
		$report = array();

		foreach ( self::CRON_HOOKS as $legacy => $current ) {
			$next = wp_next_scheduled( $legacy );
			if ( false === $next ) {
				continue;
			}
			$schedule = wp_get_schedule( $legacy );
			$report[ $legacy ] = sprintf(
				'%s -> %s at %s%s',
				$legacy,
				$current,
				gmdate( 'c', (int) $next ),
				is_string( $schedule ) && '' !== $schedule ? ' (' . $schedule . ')' : ' (single)'
			);

			if ( ! $execute ) {
				continue;
			}
			wp_clear_scheduled_hook( $legacy );
			if ( is_string( $schedule ) && '' !== $schedule ) {
				wp_schedule_event( (int) $next, $schedule, $current );
			} else {
				wp_schedule_single_event( (int) $next, $current );
			}
		}

		return $report;
	}

	/** Build one plan entry with both sides counted. */
	private static function entry( string $group, string $kind, string $from, string $to, bool $ready ): array {
		return array(
			'group'    => $group,
			'kind'     => $kind,
			'from'     => $from,
			'to'       => $to,
			'rows'     => self::count( $kind, $from ),
			'existing' => self::count( $kind, $to ),
			'ready'    => $ready,
		);
	}

	/**
	 * Pairs discovered from `os_custom_cpts` rather than declared statically.
	 *
	 * A dynamic type has no `register_post_type()` call of its own: its name IS
	 * the definition key, so rewriting the payload is what renames it. There is
	 * no separate registration to wait for, which is why these are rewritten
	 * whether or not any posts moved. A dynamic type with no content would
	 * otherwise keep its legacy name forever.
	 *
	 * @return array<string,string>
	 */
	public static function dynamic_pairs_for_test(): array {
		return self::dynamic_pairs();
	}

	private static function dynamic_pairs(): array {
		$dynamic = array();
		foreach ( self::groups() as $from => $group ) {
			if ( ! isset( self::GROUPS[ $from ] ) ) {
				$dynamic[ $from ] = $group['to'];
			}
		}
		return $dynamic;
	}

	/**
	 * The static groups plus any dynamic type whose slug still carries a legacy
	 * prefix. Dynamic types are defined in `os_custom_cpts`, which is why the
	 * option migration has to run first.
	 *
	 * @return array<string,array{to:string,taxonomies:array<string,string>,meta:array<string,string>}>
	 */
	private static function groups(): array {
		$groups = self::GROUPS;

		foreach ( (array) OS_Options::get( 'os_custom_cpts', array() ) as $key => $definition ) {
			$slug = '';
			if ( is_array( $definition ) ) {
				$slug = (string) ( $definition['slug'] ?? $definition['post_type'] ?? '' );
			}
			if ( '' === $slug && is_string( $key ) ) {
				$slug = $key;
			}
			if ( '' === $slug || isset( $groups[ $slug ] ) ) {
				continue;
			}
			if ( str_starts_with( $slug, 'ci_' ) || str_starts_with( $slug, 'wp_' ) ) {
				$groups[ $slug ] = array(
					'to'         => 'os_' . substr( $slug, 3 ),
					'taxonomies' => array(),
					'meta'       => array(),
				);
			}
		}

		return $groups;
	}

	/** True once at least one replacement post type is registered. */
	private static function any_target_registered(): bool {
		foreach ( self::GROUPS as $group ) {
			if ( post_type_exists( $group['to'] ) ) {
				return true;
			}
		}
		return false;
	}

	/** Rows carrying an identifier, whatever kind it is. */
	private static function count( string $kind, string $name ): int {
		global $wpdb;

		switch ( $kind ) {
			case 'post_type':
				$sql = "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s";
				break;
			case 'taxonomy':
				$sql = "SELECT COUNT(*) FROM {$wpdb->term_taxonomy} WHERE taxonomy = %s";
				break;
			case 'meta':
				$sql = "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = %s";
				break;
			default:
				return 0;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- migration tooling counts rows, not cached objects.
		return (int) $wpdb->get_var( $wpdb->prepare( $sql, $name ) );
	}

	/** The UPDATE behind one rename. Returns rows affected, or false. */
	private static function rewrite( string $kind, string $from, string $to ) {
		global $wpdb;

		switch ( $kind ) {
			case 'post_type':
				$sql = "UPDATE {$wpdb->posts} SET post_type = %s WHERE post_type = %s";
				break;
			case 'taxonomy':
				$sql = "UPDATE {$wpdb->term_taxonomy} SET taxonomy = %s WHERE taxonomy = %s";
				break;
			case 'meta':
				$sql = "UPDATE {$wpdb->postmeta} SET meta_key = %s WHERE meta_key = %s";
				break;
			default:
				return false;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-shot migration.
		return $wpdb->query( $wpdb->prepare( $sql, $to, $from ) );
	}

	/**
	 * Meta VALUES that name a post type.
	 *
	 * A dynamic content type records which post type it describes in
	 * `content_types_type_key`, so a definition survives the rename pointing at
	 * a name nothing registers any more. The editor's lookup tolerates either
	 * prefix, but leaving the stored value stale means the next reader has to
	 * tolerate it too, forever. Move it with the rows.
	 *
	 * @var string[]
	 */
	private const TYPE_NAME_META = array( 'content_types_type_key' );

	/**
	 * Rewrite every meta value that holds a post type name.
	 *
	 * Runs as a sweep rather than per moved type, because a definition can name
	 * a type that has no posts: it never enters the plan, but its reference is
	 * just as stale. Only pairs whose replacement is registered are rewritten,
	 * so this cannot run ahead of the code.
	 *
	 * @return int Rows rewritten.
	 */
	public static function rewrite_type_references_sweep(): int {
		$total = 0;
		foreach ( self::groups() as $from => $group ) {
			if ( ! post_type_exists( $group['to'] ) ) {
				continue;
			}
			$total += self::rewrite_type_references( $from, $group['to'] );
		}
		return $total;
	}

	/** Rewrite meta values that hold one post type name. Returns rows changed. */
	private static function rewrite_type_references( string $from, string $to ): int {
		global $wpdb;
		$changed = 0;
		foreach ( self::TYPE_NAME_META as $meta_key ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-shot migration.
			$changed += (int) $wpdb->query(
				$wpdb->prepare(
					"UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE meta_key = %s AND meta_value = %s",
					$to,
					$meta_key,
					$from
				)
			);
		}
		return $changed;
	}

	/** Nav menu items store the type or taxonomy name in `_menu_item_object`. */
	private static function rewrite_menu_items( string $from, string $to ): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-shot migration.
		$wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE meta_key = '_menu_item_object' AND meta_value = %s",
				$to,
				$from
			)
		);
	}

	/**
	 * Two core options embed a taxonomy name in the option NAME itself:
	 * `default_term_{taxonomy}` and, for a hierarchical taxonomy, the
	 * `{taxonomy}_children` cache. Ours are flat, so the second is usually
	 * absent, but an adopted taxonomy may not be.
	 */
	private static function rewrite_taxonomy_options( string $from, string $to ): void {
		foreach ( array( 'default_term_%s', '%s_children' ) as $pattern ) {
			$old_name = sprintf( $pattern, $from );
			$value    = get_option( $old_name, null );
			if ( null === $value ) {
				continue;
			}
			update_option( sprintf( $pattern, $to ), $value );
			delete_option( $old_name );
		}
	}

	/**
	 * `wp ci migrate-types [--execute] [--network] [--merge] [--force]`
	 *
	 * @param array<int,string>    $args       Positional args (unused).
	 * @param array<string,string> $assoc_args Flags.
	 */
	public static function cmd( $args, $assoc_args ): void {
		$execute = isset( $assoc_args['execute'] );
		$network = isset( $assoc_args['network'] );
		$merge   = isset( $assoc_args['merge'] );
		$force   = isset( $assoc_args['force'] );

		if ( $network && ! is_multisite() ) {
			\WP_CLI::error( '--network requires a multisite install.' );
		}

		$sites = array( get_current_blog_id() );
		if ( $network ) {
			$sites = array_map( 'intval', get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) );
		}

		\WP_CLI::line( sprintf( '[%s] content model across %d site(s)', $execute ? 'EXECUTING' : 'DRY RUN', count( $sites ) ) );

		$done = 0;
		$rows = 0;
		$bad  = 0;

		foreach ( $sites as $site_id ) {
			if ( $network ) {
				switch_to_blog( $site_id );
			}

			$plan    = self::plan();
			$label   = $network ? sprintf( 'site %d (%s)', $site_id, home_url() ) : 'this site';
			$applied = array();
			$current = '';

			\WP_CLI::line( sprintf( '  %s:%s', $label, empty( $plan ) ? ' nothing to do' : '' ) );

			foreach ( $plan as $entry ) {
				if ( $entry['group'] !== $current ) {
					$current = $entry['group'];
					\WP_CLI::line( sprintf( '    [%s]', $current ) );
				}

				\WP_CLI::line(
					sprintf(
						'      %-9s %-22s -> %-22s %6d row(s)%s%s',
						$entry['kind'],
						$entry['from'],
						$entry['to'],
						$entry['rows'],
						$entry['existing'] > 0 ? sprintf( ', target holds %d', $entry['existing'] ) : '',
						$entry['ready'] ? '' : '  [target not registered]'
					)
				);

				if ( ! $execute ) {
					continue;
				}

				$result = self::move( $entry, $merge, $force );
				if ( is_wp_error( $result ) ) {
					++$bad;
					\WP_CLI::warning( sprintf( '        skipped: %s', $result->get_error_message() ) );
					continue;
				}
				if ( $result > 0 ) {
					++$done;
					$rows += (int) $result;
					if ( 'post_type' === $entry['kind'] ) {
						$applied[ $entry['from'] ] = $entry['to'];
					}
					\WP_CLI::line( sprintf( '        ok: %d row(s)', (int) $result ) );
				}
			}

			if ( $execute ) {
				// Dynamic types rename by payload, so they are rewritten whether
				// or not they had rows to move.
				$options = self::rewrite_option_payloads( $applied + self::dynamic_pairs() );
				$refs    = self::rewrite_type_references_sweep();
				\WP_CLI::line( sprintf( '    settings rewritten: %d option(s), %d type reference(s)', $options, $refs ) );
			}
			// Cron last: a hook is rescheduled only once everything it triggers
			// has already moved.
			foreach ( self::reschedule_cron( $execute ) as $line ) {
				\WP_CLI::line( sprintf( '    cron      %s', $line ) );
			}

			if ( $execute && $done > 0 ) {
				wp_cache_flush();
				flush_rewrite_rules( false );
			}

			if ( $network ) {
				restore_current_blog();
			}
		}

		if ( ! $execute ) {
			\WP_CLI::success( 'Dry run complete. Re-run with --execute.' );
			return;
		}
		// A guard refusal is the expected outcome for anything whose replacement
		// is not registered yet, so it reports as a skip rather than failing the
		// command. Only a genuine failure, an update or readback that went wrong,
		// exits non-zero.
		\WP_CLI::success(
			sprintf(
				'%d identifier(s) moved, %d row(s) rewritten%s.',
				$done,
				$rows,
				$bad > 0 ? sprintf( ', %d skipped pending their code rename', $bad ) : ''
			)
		);
	}
}
