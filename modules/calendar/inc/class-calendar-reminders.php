<?php
/**
 * Per-reminder scheduler owned by OS Calendar.
 *
 * @package OS_Calendar
 */

defined( 'ABSPATH' ) || exit;

final class Core_Index_Calendar_Reminders {

	const CRON_HOOK               = 'core_index_calendar_dispatch_reminder';
	const SYNC_HOOK               = 'core_index_calendar_sync_reminder';
	const RECONCILE_HOOK          = 'core_index_calendar_reconcile_reminders';
	const LEGACY_DUE_HOOK         = 'reminders_for_wordpress_due';
	const INDEX_OPTION            = 'core_index_calendar_reminder_schedule';
	const PENDING_OPTION          = 'core_index_calendar_reminder_schedule_pending';
	const STATE_OPTION_PREFIX     = 'core_index_calendar_reminder_state_';
	const LOCK_OPTION_PREFIX      = 'core_index_calendar_reminder_lock_';
	const VERSION_OPTION          = 'core_index_calendar_reminder_scheduler_version';
	const RECONCILE_CURSOR_OPTION = 'core_index_calendar_reminder_reconcile_cursor';
	const VERSION                 = '3';
	const BATCH_SIZE              = 100;
	const MAX_DELIVERY_RETRIES    = 5;
	const LOCK_TTL                = 600;
	const LOCK_WAIT_ATTEMPTS      = 40;
	const LOCK_WAIT_MICROSECONDS  = 25000;

	/**
	 * Prevents dispatch-marker writes from recursively changing the schedule.
	 *
	 * @var bool
	 */
	private static bool $updating_dispatch_marker = false;

	/**
	 * Request-owned, re-entrant reminder locks.
	 *
	 * @var array<int,array{depth:int,option:string,payload:array{token:string,created:int}}>
	 */
	private static array $owned_locks = array();

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'maybe_upgrade' ), 50 );
		add_action( self::CRON_HOOK, array( __CLASS__, 'dispatch_due' ), 10, 1 );
		add_action( self::SYNC_HOOK, array( __CLASS__, 'sync_queued' ), 10, 1 );
		add_action( self::RECONCILE_HOOK, array( __CLASS__, 'reconcile' ) );
		add_action( 'save_post_ci_reminder', array( __CLASS__, 'saved' ), 20, 3 );
		add_action( 'transition_post_status', array( __CLASS__, 'status_changed' ), 20, 3 );
		add_action( 'added_post_meta', array( __CLASS__, 'meta_changed' ), 20, 4 );
		add_action( 'updated_post_meta', array( __CLASS__, 'meta_changed' ), 20, 4 );
		add_action( 'deleted_post_meta', array( __CLASS__, 'meta_changed' ), 20, 4 );
		add_action( 'trashed_post', array( __CLASS__, 'removed' ), 10, 1 );
		add_action( 'before_delete_post', array( __CLASS__, 'removed' ), 10, 1 );
	}

	public static function activate(): void {
		self::clear_legacy_schedule();
		$migrated = self::migrate_legacy_state();
		self::rebuild_state();
		self::ensure_reconciliation();

		if ( $migrated ) {
			delete_option( self::INDEX_OPTION );
			delete_option( self::PENDING_OPTION );
			update_option( self::VERSION_OPTION, self::VERSION, false );
		}
	}

	public static function deactivate(): void {
		$cursor = 0;
		do {
			$reminder_ids = self::reminder_ids_after( $cursor, true );
			foreach ( $reminder_ids as $reminder_id ) {
				$cursor = $reminder_id;
				wp_clear_scheduled_hook( self::CRON_HOOK, array( $reminder_id ) );
				wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
				delete_option( self::state_option( $reminder_id ) );
				delete_option( self::lock_option( $reminder_id ) );
			}
		} while ( self::BATCH_SIZE === count( $reminder_ids ) );

		wp_clear_scheduled_hook( self::CRON_HOOK, array( 0 ) );
		wp_clear_scheduled_hook( self::RECONCILE_HOOK );
		self::clear_legacy_schedule();
		delete_option( self::INDEX_OPTION );
		delete_option( self::PENDING_OPTION );
		delete_option( self::VERSION_OPTION );
		delete_option( self::RECONCILE_CURSOR_OPTION );
	}

	public static function maybe_upgrade(): void {
		if ( self::VERSION !== get_option( self::VERSION_OPTION ) ) {
			self::activate();
			return;
		}
		self::ensure_reconciliation();
	}

	/**
	 * Copy version-two shared state to isolated reminder options.
	 *
	 * The old options remain intact unless every record was copied. This keeps
	 * an interrupted upgrade recoverable on the next request.
	 */
	private static function migrate_legacy_state(): bool {
		$legacy = array();
		foreach ( self::records_option( self::INDEX_OPTION ) as $reminder_id => $record ) {
			$legacy[ $reminder_id ] = array(
				'location' => 'confirmed',
				'record'   => $record,
			);
		}
		foreach ( self::records_option( self::PENDING_OPTION ) as $reminder_id => $record ) {
			$legacy[ $reminder_id ] = array(
				'location' => 'pending',
				'record'   => $record,
			);
		}

		$migrated = true;
		foreach ( $legacy as $reminder_id => $state ) {
			if ( null !== self::stored_state( get_option( self::state_option( $reminder_id ), null ) ) ) {
				continue;
			}

			$written = false;
			$locked  = self::run_locked(
				$reminder_id,
				static function () use ( $reminder_id, $state, &$written ): void {
					$current = self::stored_state( get_option( self::state_option( $reminder_id ), null ) );
					$written = null !== $current
						|| self::state_set( $reminder_id, $state['location'], $state['record'] );
				}
			);
			if ( ! $locked || ! $written ) {
				$migrated = false;
			}
		}

		return $migrated;
	}

	/**
	 * Rebuild missing events in bounded database reads without resetting
	 * delivery attempts carried over from version two.
	 */
	private static function rebuild_state(): void {
		delete_option( self::RECONCILE_CURSOR_OPTION );
		$cursor = 0;
		do {
			$reminder_ids = self::reminder_ids_after( $cursor );
			foreach ( $reminder_ids as $reminder_id ) {
				$cursor = $reminder_id;
				self::request_sync( $reminder_id, false );
			}
		} while ( self::BATCH_SIZE === count( $reminder_ids ) );
	}

	/**
	 * Keep one inexpensive hourly repair event available.
	 */
	private static function ensure_reconciliation(): void {
		if ( wp_next_scheduled( self::RECONCILE_HOOK ) ) {
			return;
		}

		wp_schedule_event(
			time() + ( 5 * MINUTE_IN_SECONDS ),
			'hourly',
			self::RECONCILE_HOOK,
			array(),
			true
		);
	}

	public static function saved( int $post_id, WP_Post $post, bool $update ): void {
		unset( $update );
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		self::request_sync( $post->ID, true );
	}

	public static function status_changed( string $new_status, string $old_status, WP_Post $post ): void {
		unset( $new_status, $old_status );
		if ( 'os_reminder' === $post->post_type ) {
			self::request_sync( $post->ID, true );
		}
	}

	/**
	 * Keep the schedule current when reminder metadata changes.
	 *
	 * @param int|int[] $meta_id Meta row ID or IDs.
	 * @param int       $object_id Reminder post ID.
	 * @param string    $meta_key Changed metadata key.
	 * @param mixed     $meta_value Changed metadata value.
	 */
	public static function meta_changed( $meta_id, int $object_id, string $meta_key, $meta_value ): void {
		unset( $meta_id, $meta_value );
		if (
			self::$updating_dispatch_marker
			|| 'os_reminder' !== get_post_type( $object_id )
			|| ! in_array( $meta_key, array( 'reminders_due', 'reminders_completed', 'reminders_dispatched_at' ), true )
		) {
			return;
		}

		if ( 'reminders_due' === $meta_key && get_post_meta( $object_id, 'reminders_dispatched_at', true ) ) {
			self::$updating_dispatch_marker = true;
			delete_post_meta( $object_id, 'reminders_dispatched_at' );
			self::$updating_dispatch_marker = false;
		}
		self::request_sync( $object_id, true );
	}

	public static function removed( int $post_id ): void {
		if ( 'os_reminder' !== get_post_type( $post_id ) ) {
			return;
		}

		$locked = self::run_locked(
			$post_id,
			static function () use ( $post_id ): void {
				self::unschedule_locked( $post_id );
			}
		);
		if ( ! $locked ) {
			self::queue_sync( $post_id );
		}
	}

	/**
	 * Dispatch one scheduled reminder, or a bounded due batch when called
	 * without an ID for backward-compatible manual execution.
	 */
	public static function dispatch_due( int $reminder_id = 0 ): void {
		if ( $reminder_id > 0 ) {
			self::dispatch_one( $reminder_id );
			return;
		}

		$cursor     = 0;
		$dispatched = 0;
		$now        = time();
		do {
			$reminder_ids = self::reminder_ids_after( $cursor );
			foreach ( $reminder_ids as $candidate_id ) {
				$cursor = $candidate_id;
				$due    = self::due_timestamp( (string) get_post_meta( $candidate_id, 'reminders_due', true ) );
				if ( null === $due || $due > $now ) {
					continue;
				}
				self::dispatch_one( $candidate_id );
				++$dispatched;
				if ( $dispatched >= self::BATCH_SIZE ) {
					break 2;
				}
			}
		} while ( self::BATCH_SIZE === count( $reminder_ids ) );
	}

	/**
	 * Repair missing state and events from an authoritative post cursor.
	 *
	 * A reminder absent from all scheduler options is still rediscovered here,
	 * so a failed or interrupted option write cannot make delivery disappear.
	 */
	public static function reconcile(): void {
		$cursor       = (int) get_option( self::RECONCILE_CURSOR_OPTION, 0 );
		$reminder_ids = self::reminder_ids_after( $cursor );

		if ( empty( $reminder_ids ) && $cursor > 0 ) {
			$cursor       = 0;
			$reminder_ids = self::reminder_ids_after( 0 );
		}

		foreach ( $reminder_ids as $reminder_id ) {
			$cursor = $reminder_id;
			self::request_sync( $reminder_id, false );
		}

		if ( count( $reminder_ids ) < self::BATCH_SIZE ) {
			$cursor = 0;
		}
		update_option( self::RECONCILE_CURSOR_OPTION, $cursor, false );
	}

	public static function sync_queued( int $reminder_id ): void {
		self::request_sync( $reminder_id, false );
	}

	private static function dispatch_one( int $reminder_id ): void {
		$locked = self::run_locked(
			$reminder_id,
			static function () use ( $reminder_id ): void {
				self::dispatch_one_locked( $reminder_id );
			}
		);
		if ( ! $locked ) {
			self::queue_dispatch( $reminder_id );
		}
	}

	/**
	 * Dispatch while holding the reminder's option lock.
	 */
	private static function dispatch_one_locked( int $reminder_id ): void {
		$reminder = get_post( $reminder_id );
		if ( ! self::is_dispatchable( $reminder ) ) {
			self::unschedule_locked( $reminder_id );
			return;
		}

		$due_timestamp = self::due_timestamp( (string) get_post_meta( $reminder_id, 'reminders_due', true ) );
		if ( null === $due_timestamp ) {
			self::unschedule_locked( $reminder_id );
			return;
		}
		if ( $due_timestamp > time() ) {
			self::sync_locked( $reminder_id, false );
			return;
		}

		$record = self::state( $reminder_id, $due_timestamp );
		if ( 'pending' === $record['location'] && $record['exhausted'] ) {
			self::mark_exhausted( $reminder_id, $record );
			return;
		}

		$delivery_key = $reminder_id . ':' . $due_timestamp;
		wp_clear_scheduled_hook( self::CRON_HOOK, array( $reminder_id ) );

		if ( $record['attempts'] < self::MAX_DELIVERY_RETRIES ) {
			$retry_record             = $record;
			$retry_record['attempts'] = $record['attempts'] + 1;
			self::schedule_confirmed(
				$reminder_id,
				time() + self::retry_delay( $retry_record['attempts'] ),
				$retry_record
			);
		} else {
			self::mark_exhausted( $reminder_id, $record );
		}

		try {
			do_action( 'core_index_calendar_reminder_due', $reminder, $delivery_key );
			if ( has_action( self::LEGACY_DUE_HOOK ) ) {
				do_action_deprecated(
					self::LEGACY_DUE_HOOK,
					array( $reminder, $delivery_key ),
					'1.2.0',
					'core_index_calendar_reminder_due'
				);
			}
		} catch ( Throwable $error ) {
			do_action(
				'core_index_calendar_reminder_delivery_failed',
				$reminder,
				$delivery_key,
				$error,
				$record['attempts'] + 1
			);
			return;
		}

		self::$updating_dispatch_marker = true;
		$marked = update_post_meta( $reminder_id, 'reminders_dispatched_at', gmdate( DATE_ATOM ) );
		self::$updating_dispatch_marker = false;
		if ( false === $marked ) {
			return;
		}
		self::unschedule_locked( $reminder_id );
	}

	/**
	 * Run a state transition under the reminder lock or queue a repair.
	 */
	private static function request_sync( int $reminder_id, bool $reset_attempts ): void {
		$locked = self::run_locked(
			$reminder_id,
			static function () use ( $reminder_id, $reset_attempts ): void {
				self::sync_locked( $reminder_id, $reset_attempts );
			}
		);
		if ( ! $locked ) {
			self::queue_sync( $reminder_id );
		}
	}

	/**
	 * Synchronize one reminder while holding its option lock.
	 */
	private static function sync_locked( int $reminder_id, bool $reset_attempts ): void {
		$reminder = get_post( $reminder_id );
		if ( ! self::is_dispatchable( $reminder ) ) {
			self::unschedule_locked( $reminder_id );
			return;
		}

		$due_timestamp = self::due_timestamp( (string) get_post_meta( $reminder_id, 'reminders_due', true ) );
		if ( null === $due_timestamp ) {
			self::unschedule_locked( $reminder_id );
			return;
		}

		$record = $reset_attempts
			? self::record( $due_timestamp )
			: self::state( $reminder_id, $due_timestamp );

		$now          = time();
		$scheduled    = wp_next_scheduled( self::CRON_HOOK, array( $reminder_id ) );
		$scheduled_at = (int) $record['scheduled_at'];
		$matches      = $scheduled
			&& (
				( $scheduled_at > 0 && (int) $scheduled === $scheduled_at )
				|| (
					0 === $scheduled_at
					&& (
						( $due_timestamp > $now && (int) $scheduled === $due_timestamp )
						|| ( $due_timestamp <= $now && (int) $scheduled <= $now + MINUTE_IN_SECONDS )
					)
				)
			);

		if ( $matches ) {
			$record['scheduled_at'] = (int) $scheduled;
			self::state_set( $reminder_id, 'confirmed', $record );
			wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
			return;
		}

		if ( $scheduled ) {
			wp_clear_scheduled_hook( self::CRON_HOOK, array( $reminder_id ) );
		}

		if ( ! $reset_attempts && 'pending' === $record['location'] ) {
			if ( $record['exhausted'] ) {
				wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
				return;
			}
			if ( $record['retry_after'] > $now ) {
				self::queue_sync( $reminder_id, $record['retry_after'] );
				return;
			}
		}

		self::schedule_confirmed(
			$reminder_id,
			max( $due_timestamp, $now + 1 ),
			$record
		);
	}

	/**
	 * Schedule and store only a confirmed event.
	 */
	private static function schedule_confirmed( int $reminder_id, int $run_at, array $record ): bool {
		$result = wp_schedule_single_event(
			$run_at,
			self::CRON_HOOK,
			array( $reminder_id ),
			true
		);

		if ( true === $result ) {
			$record['schedule_failures'] = 0;
			$record['retry_after']       = 0;
			$record['scheduled_at']      = $run_at;
			self::state_set( $reminder_id, 'confirmed', $record );
			wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
			return true;
		}

		$existing = wp_next_scheduled( self::CRON_HOOK, array( $reminder_id ) );
		if ( $existing ) {
			$record['schedule_failures'] = 0;
			$record['retry_after']       = 0;
			$record['scheduled_at']      = (int) $existing;
			self::state_set( $reminder_id, 'confirmed', $record );
			wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
			return true;
		}

		$record['schedule_failures'] = min( self::MAX_DELIVERY_RETRIES, $record['schedule_failures'] + 1 );
		$record['retry_after']       = time() + self::retry_delay( $record['schedule_failures'] );
		$record['scheduled_at']      = 0;
		self::state_set( $reminder_id, 'pending', $record );
		self::queue_sync( $reminder_id, $record['retry_after'] );
		return false;
	}

	private static function mark_exhausted( int $reminder_id, array $record ): void {
		wp_clear_scheduled_hook( self::CRON_HOOK, array( $reminder_id ) );
		wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
		$record['exhausted']    = true;
		$record['retry_after']  = 0;
		$record['scheduled_at'] = 0;
		self::state_set( $reminder_id, 'pending', $record );
	}

	private static function is_dispatchable( $reminder ): bool {
		return $reminder instanceof WP_Post
			&& 'os_reminder' === $reminder->post_type
			&& in_array( $reminder->post_status, array( 'publish', 'private' ), true )
			&& ! get_post_meta( $reminder->ID, 'reminders_completed', true )
			&& ! get_post_meta( $reminder->ID, 'reminders_dispatched_at', true );
	}

	private static function due_timestamp( string $due ): ?int {
		if ( '' === trim( $due ) ) {
			return null;
		}
		try {
			$date = new DateTimeImmutable( $due, wp_timezone() );
		} catch ( Exception $exception ) {
			unset( $exception );
			return null;
		}
		return $date->getTimestamp();
	}

	private static function retry_delay( int $attempt ): int {
		$delays = array(
			MINUTE_IN_SECONDS,
			5 * MINUTE_IN_SECONDS,
			15 * MINUTE_IN_SECONDS,
			HOUR_IN_SECONDS,
			6 * HOUR_IN_SECONDS,
		);
		$index = max( 0, min( count( $delays ) - 1, $attempt - 1 ) );
		return $delays[ $index ];
	}

	private static function unschedule_locked( int $reminder_id ): void {
		wp_clear_scheduled_hook( self::CRON_HOOK, array( $reminder_id ) );
		wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
		delete_option( self::state_option( $reminder_id ) );
	}

	/**
	 * Return a known state or a clean state when the due date changed.
	 *
	 * This method runs only while the reminder lock is held.
	 *
	 * @return array{due:int,attempts:int,schedule_failures:int,retry_after:int,scheduled_at:int,exhausted:bool,location:string}
	 */
	private static function state( int $reminder_id, int $due_timestamp ): array {
		$stored = self::stored_state( get_option( self::state_option( $reminder_id ), null ) );
		if ( null !== $stored && $due_timestamp === $stored['due'] ) {
			return $stored;
		}

		$legacy = self::legacy_state( $reminder_id );
		if ( null !== $legacy && $due_timestamp === $legacy['due'] ) {
			self::state_set( $reminder_id, $legacy['location'], $legacy );
			return $legacy;
		}

		$record             = self::record( $due_timestamp );
		$record['location'] = 'confirmed';
		return $record;
	}

	/**
	 * Normalize one scheduler state record.
	 */
	private static function normalize_record( $stored ): ?array {
		if ( is_numeric( $stored ) && (int) $stored > 0 ) {
			return self::record( (int) $stored );
		}
		if ( ! is_array( $stored ) || empty( $stored['due'] ) ) {
			return null;
		}
		return array(
			'due'               => (int) $stored['due'],
			'attempts'          => max( 0, (int) ( $stored['attempts'] ?? 0 ) ),
			'schedule_failures' => max( 0, (int) ( $stored['schedule_failures'] ?? 0 ) ),
			'retry_after'       => max( 0, (int) ( $stored['retry_after'] ?? 0 ) ),
			'scheduled_at'      => max( 0, (int) ( $stored['scheduled_at'] ?? 0 ) ),
			'exhausted'         => ! empty( $stored['exhausted'] ),
		);
	}

	/**
	 * Normalize an isolated state option.
	 *
	 * @return array{due:int,attempts:int,schedule_failures:int,retry_after:int,scheduled_at:int,exhausted:bool,location:string}|null
	 */
	private static function stored_state( $stored ): ?array {
		$record = self::normalize_record( $stored );
		if ( null === $record ) {
			return null;
		}
		$record['location'] = is_array( $stored ) && 'pending' === ( $stored['location'] ?? '' )
			? 'pending'
			: 'confirmed';
		return $record;
	}

	private static function record( int $due_timestamp ): array {
		return array(
			'due'               => $due_timestamp,
			'attempts'          => 0,
			'schedule_failures' => 0,
			'retry_after'       => 0,
			'scheduled_at'      => 0,
			'exhausted'         => false,
		);
	}

	/**
	 * Read a reminder from the version-two shared options.
	 */
	private static function legacy_state( int $reminder_id ): ?array {
		$pending = self::records_option( self::PENDING_OPTION );
		if ( isset( $pending[ $reminder_id ] ) ) {
			$pending[ $reminder_id ]['location'] = 'pending';
			return $pending[ $reminder_id ];
		}

		$index = self::records_option( self::INDEX_OPTION );
		if ( isset( $index[ $reminder_id ] ) ) {
			$index[ $reminder_id ]['location'] = 'confirmed';
			return $index[ $reminder_id ];
		}
		return null;
	}

	private static function records_option( string $option ): array {
		$stored = get_option( $option, array() );
		if ( ! is_array( $stored ) ) {
			return array();
		}

		$records = array();
		foreach ( $stored as $reminder_id => $record ) {
			$normalized = self::normalize_record( $record );
			if ( (int) $reminder_id > 0 && null !== $normalized ) {
				$records[ (int) $reminder_id ] = $normalized;
			}
		}
		return $records;
	}

	/**
	 * Store one reminder without reading or rewriting any other reminder.
	 */
	private static function state_set( int $reminder_id, string $location, array $record ): bool {
		$normalized = self::normalize_record( $record );
		if ( null === $normalized ) {
			return false;
		}
		$normalized['location'] = 'pending' === $location ? 'pending' : 'confirmed';
		$option                 = self::state_option( $reminder_id );
		$updated                = update_option( $option, $normalized, false );

		return $updated || $normalized === get_option( $option );
	}

	private static function state_option( int $reminder_id ): string {
		return self::STATE_OPTION_PREFIX . $reminder_id;
	}

	private static function lock_option( int $reminder_id ): string {
		return self::LOCK_OPTION_PREFIX . $reminder_id;
	}

	/**
	 * Queue a best-effort per-reminder repair. The hourly cursor remains the
	 * fallback if WordPress itself loses this concurrent cron-array write.
	 */
	private static function queue_sync( int $reminder_id, ?int $run_at = null ): void {
		$run_at    = max( time() + 1, $run_at ?? time() + MINUTE_IN_SECONDS );
		$scheduled = wp_next_scheduled( self::SYNC_HOOK, array( $reminder_id ) );
		if ( $scheduled && (int) $scheduled <= $run_at ) {
			return;
		}
		if ( $scheduled ) {
			wp_clear_scheduled_hook( self::SYNC_HOOK, array( $reminder_id ) );
		}
		wp_schedule_single_event( $run_at, self::SYNC_HOOK, array( $reminder_id ), true );
	}

	private static function queue_dispatch( int $reminder_id ): void {
		if ( wp_next_scheduled( self::CRON_HOOK, array( $reminder_id ) ) ) {
			return;
		}
		wp_schedule_single_event(
			time() + MINUTE_IN_SECONDS,
			self::CRON_HOOK,
			array( $reminder_id ),
			true
		);
	}

	/**
	 * Return the next authoritative reminder IDs in primary-key order.
	 *
	 * @return int[]
	 */
	private static function reminder_ids_after( int $cursor, bool $all_statuses = false ): array {
		global $wpdb;

		$statuses = $all_statuses
			? array_keys( get_post_stati() )
			: array( 'publish', 'private' );
		$placeholders = implode( ', ', array_fill( 0, count( $statuses ), '%s' ) );
		$values       = array_merge(
			array( 'os_reminder' ),
			$statuses,
			array( $cursor, self::BATCH_SIZE )
		);
		$sql          = $wpdb->prepare(
			"SELECT ID
			FROM {$wpdb->posts}
			WHERE post_type = %s
				AND post_status IN ( {$placeholders} )
				AND ID > %d
			ORDER BY ID ASC
			LIMIT %d",
			$values
		);

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Prepared, bounded repair query needs authoritative current rows.
		return array_map( 'intval', (array) $wpdb->get_col( $sql ) );
	}

	/**
	 * Execute an atomic state transition with bounded lock waiting.
	 */
	private static function run_locked( int $reminder_id, callable $callback ): bool {
		if ( ! self::acquire_lock( $reminder_id ) ) {
			return false;
		}

		try {
			$callback();
		} finally {
			self::release_lock( $reminder_id );
		}
		return true;
	}

	private static function acquire_lock( int $reminder_id ): bool {
		if ( isset( self::$owned_locks[ $reminder_id ] ) ) {
			++self::$owned_locks[ $reminder_id ]['depth'];
			return true;
		}

		$option  = self::lock_option( $reminder_id );
		$payload = array(
			'token'   => wp_generate_uuid4(),
			'created' => time(),
		);

		for ( $attempt = 0; $attempt < self::LOCK_WAIT_ATTEMPTS; ++$attempt ) {
			if ( self::insert_lock( $option, $payload ) ) {
				self::$owned_locks[ $reminder_id ] = array(
					'depth'   => 1,
					'option'  => $option,
					'payload' => $payload,
				);
				return true;
			}

			$current = get_option( $option, null );
			if ( self::lock_is_stale( $current ) ) {
				self::delete_option_if_value( $option, $current );
				continue;
			}

			if ( $attempt + 1 < self::LOCK_WAIT_ATTEMPTS ) {
				usleep( self::LOCK_WAIT_MICROSECONDS );
			}
		}
		return false;
	}

	/**
	 * Insert a lock without an update path.
	 *
	 * WordPress 7.0's option insert may upsert on duplicate. INSERT IGNORE
	 * preserves the unique option-name row as an actual mutex; the SQLite
	 * integration translates it to the equivalent OR IGNORE statement.
	 */
	private static function insert_lock( string $option, array $payload ): bool {
		global $wpdb;

		$sql = $wpdb->prepare(
			"INSERT IGNORE INTO {$wpdb->options} ( option_name, option_value, autoload )
			VALUES ( %s, %s, %s )",
			$option,
			maybe_serialize( $payload ),
			'no'
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Insert-only unique-row acquisition is the lock safety boundary.
		$inserted = $wpdb->query( $sql );
		self::clear_option_cache( $option );
		if ( 1 === $inserted ) {
			return true;
		}
		return false;
	}

	private static function release_lock( int $reminder_id ): void {
		if ( ! isset( self::$owned_locks[ $reminder_id ] ) ) {
			return;
		}
		if ( self::$owned_locks[ $reminder_id ]['depth'] > 1 ) {
			--self::$owned_locks[ $reminder_id ]['depth'];
			return;
		}

		$lock = self::$owned_locks[ $reminder_id ];
		unset( self::$owned_locks[ $reminder_id ] );
		self::delete_option_if_value( $lock['option'], $lock['payload'] );
	}

	private static function lock_is_stale( $lock ): bool {
		return ! is_array( $lock )
			|| empty( $lock['token'] )
			|| empty( $lock['created'] )
			|| (int) $lock['created'] <= time() - self::LOCK_TTL;
	}

	/**
	 * Compare-and-delete prevents an expired owner from deleting a replacement
	 * lock acquired by another request.
	 */
	private static function delete_option_if_value( string $option, $expected ): bool {
		global $wpdb;

		$sql = $wpdb->prepare(
			"DELETE FROM {$wpdb->options}
			WHERE option_name = %s
				AND option_value = %s",
			$option,
			maybe_serialize( $expected )
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Atomic compare-and-delete is the lock safety boundary.
		$deleted = $wpdb->query( $sql );
		if ( 1 === $deleted ) {
			self::clear_option_cache( $option );
			return true;
		}
		return false;
	}

	private static function clear_option_cache( string $option ): void {
		wp_cache_delete( $option, 'options' );

		$notoptions = wp_cache_get( 'notoptions', 'options' );
		if ( is_array( $notoptions ) && isset( $notoptions[ $option ] ) ) {
			unset( $notoptions[ $option ] );
			wp_cache_set( 'notoptions', $notoptions, 'options' );
		}

		$alloptions = wp_cache_get( 'alloptions', 'options' );
		if ( is_array( $alloptions ) && isset( $alloptions[ $option ] ) ) {
			unset( $alloptions[ $option ] );
			wp_cache_set( 'alloptions', $alloptions, 'options' );
		}
	}

	private static function clear_legacy_schedule(): void {
		wp_clear_scheduled_hook( 'reminders_for_wordpress_tick' );
	}
}

( static function (): void {
	$active_plugins = (array) get_option( 'active_plugins', array() );
	if (
		! in_array( 'reminders-for-wordpress/reminders-for-wordpress.php', $active_plugins, true )
		&& ! class_exists( 'Reminders_For_WordPress_Features' )
	) {
		class_alias( Core_Index_Calendar_Reminders::class, 'Reminders_For_WordPress_Features' );
	}
} )();
