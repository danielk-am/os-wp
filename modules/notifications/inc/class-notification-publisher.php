<?php
/**
 * Product-owned notification publication action.
 *
 * @package OS_Notifications
 */

defined( 'ABSPATH' ) || exit;

final class OS_Notifications_Publisher {

	const LEGACY_CALENDAR_DUE_HOOK = 'reminders_for_wordpress_due';

	public static function register(): void {
		add_action( 'notifications_for_wordpress_publish', array( __CLASS__, 'publish' ), 10, 5 );
		if ( did_action( 'plugins_loaded' ) ) {
			self::register_calendar_hooks();
			return;
		}
		add_action( 'plugins_loaded', array( __CLASS__, 'register_calendar_hooks' ), 20 );
	}

	public static function register_calendar_hooks(): void {
		add_action( 'core_index_calendar_reminder_due', array( __CLASS__, 'publish_reminder' ), 10, 2 );
		if ( ! class_exists( 'OS_Calendar_Reminders' ) ) {
			add_action( self::LEGACY_CALENDAR_DUE_HOOK, array( __CLASS__, 'publish_reminder' ), 10, 2 );
		}
	}

	public static function publish( string $title, string $message = '', string $channel = 'inbox', string $source = '', array $payload = array(), string $post_name = '' ): int {
		$id = wp_insert_post(
			array(
				'post_type'    => 'os_notification',
				'post_status'  => 'private',
				'post_title'   => sanitize_text_field( $title ),
				'post_name'    => sanitize_title( $post_name ),
				'post_content' => wp_kses_post( $message ),
				'meta_input'   => array(
					'notifications_channel' => sanitize_key( $channel ),
					'notifications_read'    => false,
					'notifications_source'  => sanitize_key( $source ),
					'notifications_payload' => $payload,
				),
			)
		);

		return (int) $id;
	}

	/**
	 * Publish one idempotent notification for a Calendar delivery.
	 *
	 * Calendar 1.2 emits both its canonical and previous hook during rolling
	 * upgrades. A deterministic post slug prevents those hooks, retries, and
	 * a recovered fatal callback from creating duplicate notifications.
	 */
	public static function publish_reminder( WP_Post $reminder, string $delivery_key = '' ): int {
		if ( 'os_reminder' !== $reminder->post_type ) {
			return 0;
		}

		if ( '' === $delivery_key ) {
			$delivery_key = $reminder->ID . ':' . (string) get_post_meta( $reminder->ID, 'reminders_due', true );
		}
		$digest    = substr( hash( 'sha256', $delivery_key ), 0, 20 );
		$post_name = 'core-index-calendar-reminder-' . $reminder->ID . '-' . $digest;
		$existing  = get_page_by_path( $post_name, OBJECT, 'os_notification' );
		if ( $existing instanceof WP_Post ) {
			return $existing->ID;
		}

		$lock_key = '_core_index_notifications_delivery_lock_' . $digest;
		$lock     = array(
			'token'   => wp_generate_uuid4(),
			'created' => time(),
		);
		if ( ! self::acquire_delivery_lock( $lock_key, $lock ) ) {
			$existing = get_page_by_path( $post_name, OBJECT, 'os_notification' );
			if ( $existing instanceof WP_Post ) {
				return $existing->ID;
			}

			throw new RuntimeException( 'Calendar reminder delivery is already in progress.' );
		}

		try {
			$existing = get_page_by_path( $post_name, OBJECT, 'os_notification' );
			if ( $existing instanceof WP_Post ) {
				return $existing->ID;
			}

			$notification_id = self::publish(
				$reminder->post_title,
				$reminder->post_content,
				'inbox',
				'reminders',
				array(
					'reminder_id'  => $reminder->ID,
					'delivery_key' => $delivery_key,
				),
				$post_name
			);
			if ( $notification_id <= 0 ) {
				throw new RuntimeException( 'WordPress could not create the reminder notification.' );
			}
			return $notification_id;
		} finally {
			self::release_delivery_lock( $lock_key, $lock );
		}
	}

	/**
	 * Acquire one database-unique, non-autoloaded delivery lease.
	 *
	 * WordPress options have a unique index on option_name. INSERT IGNORE gives
	 * exactly one request ownership without relying on add_option(), whose
	 * upsert behaviour is not a compare-and-set operation. A stale owner is
	 * removed with a compare-and-delete so its late finally block cannot release
	 * a successor's lease.
	 */
	private static function acquire_delivery_lock( string $lock_key, array $lock ): bool {
		global $wpdb;

		$serialized = maybe_serialize( $lock );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- INSERT IGNORE against option_name's unique index is the atomic lock primitive; caches are invalidated below.
		$inserted = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)",
				$lock_key,
				$serialized,
				'no'
			)
		);
		self::clear_delivery_lock_cache( $lock_key );
		if ( 1 === $inserted ) {
			return true;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Lock ownership must be read from the database, not a potentially stale persistent cache.
		$current_value = $wpdb->get_var(
			$wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $lock_key )
		);
		$current = null === $current_value ? null : maybe_unserialize( $current_value );
		if (
			! is_array( $current )
			|| ! isset( $current['created'] )
			|| (int) $current['created'] >= time() - ( 10 * MINUTE_IN_SECONDS )
			|| ! self::release_delivery_lock( $lock_key, $current )
		) {
			return false;
		}

		return self::acquire_delivery_lock( $lock_key, $lock );
	}

	/**
	 * Release only the lease value owned by this request.
	 */
	private static function release_delivery_lock( string $lock_key, array $lock ): bool {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Ownership-safe compare-and-delete is the lock primitive; the option cache is cleared below.
		$deleted = $wpdb->delete(
			$wpdb->options,
			array(
				'option_name'  => $lock_key,
				'option_value' => maybe_serialize( $lock ),
			),
			array( '%s', '%s' )
		);
		if ( $deleted ) {
			self::clear_delivery_lock_cache( $lock_key );
		}

		return 1 === $deleted;
	}

	private static function clear_delivery_lock_cache( string $lock_key ): void {
		wp_cache_delete( $lock_key, 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}
}
