<?php
/**
 * Native WordPress activity recorder.
 *
 * @package OS_Activity
 */

defined( 'ABSPATH' ) || exit;

final class Core_Index_Activity_Recorder {

	public static function register(): void {
		add_action( 'transition_post_status', array( __CLASS__, 'post_transition' ), 10, 3 );
		add_action( 'activated_plugin', static fn( $plugin ) => self::record( 'plugin.activated', 'Plugin activated', array( 'plugin' => $plugin ) ) );
		add_action( 'deactivated_plugin', static fn( $plugin ) => self::record( 'plugin.deactivated', 'Plugin deactivated', array( 'plugin' => $plugin ) ) );
		add_action( 'activity_log_for_wordpress_record', array( __CLASS__, 'record' ), 10, 3 );
	}

	public static function post_transition( string $new, string $old, WP_Post $post ): void {
		if ( $new === $old || in_array( $post->post_type, array( 'revision', 'os_activity' ), true ) ) {
			return;
		}
		self::record(
			'post.transition',
			sprintf( '%s changed from %s to %s', $post->post_title ?: '(untitled)', $old, $new ),
			array( 'post_type' => $post->post_type, 'post_id' => $post->ID )
		);
	}

	public static function record( string $event, string $summary, array $context = array() ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => 'os_activity',
				'post_status' => 'private',
				'post_title'  => sanitize_text_field( $summary ),
				'meta_input'  => array(
					'activity_event'       => sanitize_key( $event ),
					'activity_actor'       => get_current_user_id(),
					'activity_object_type' => sanitize_key( (string) ( $context['post_type'] ?? '' ) ),
					'activity_object_id'   => (int) ( $context['post_id'] ?? 0 ),
					'activity_context'     => $context,
				),
			)
		);

		return (int) $id;
	}
}
