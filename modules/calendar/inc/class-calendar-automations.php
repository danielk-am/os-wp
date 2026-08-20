<?php
/**
 * Automation execution boundary retained by OS Calendar.
 *
 * @package OS_Calendar
 */

defined( 'ABSPATH' ) || exit;

final class OS_Calendar_Automations {

	const LEGACY_RUN_HOOK       = 'routines_for_wordpress_run';
	const LEGACY_STEP_HOOK      = 'routines_for_wordpress_step';
	const LEGACY_COMPLETED_HOOK = 'routines_for_wordpress_completed';

	/**
	 * Hook-triggered runs seen during this request.
	 *
	 * The source value lets the same hook run twice intentionally while
	 * suppressing the matching compatibility hook for the same payload.
	 *
	 * @var array<string,string>
	 */
	private static array $hook_runs = array();

	public static function register(): void {
		add_action( 'core_index_calendar_automation_run', array( __CLASS__, 'run_from_canonical_hook' ), 10, 2 );
		add_action( self::LEGACY_RUN_HOOK, array( __CLASS__, 'run_from_legacy_hook' ), 10, 2 );
	}

	public static function run_from_canonical_hook( int $automation_id, array $context = array() ): void {
		self::run_from_hook( 'canonical', $automation_id, $context );
	}

	public static function run_from_legacy_hook( int $automation_id, array $context = array() ): void {
		self::run_from_hook( 'legacy', $automation_id, $context );
	}

	public static function run( int $automation_id, array $context = array() ): array {
		$automation = get_post( $automation_id );
		if ( ! $automation instanceof WP_Post || 'os_automation' !== $automation->post_type ) {
			return array( 'ok' => false, 'error' => 'not_found' );
		}
		if ( ! get_post_meta( $automation_id, 'routines_enabled', true ) ) {
			return array( 'ok' => false, 'error' => 'disabled' );
		}
		$steps = get_post_meta( $automation_id, 'routines_steps', true );
		$steps = is_array( $steps ) ? $steps : array();
		$run_token = wp_generate_uuid4();
		foreach ( $steps as $index => $step ) {
			do_action( 'core_index_calendar_automation_step', $step, $context, $automation, $index, $run_token );
			if ( has_action( self::LEGACY_STEP_HOOK ) ) {
				do_action_deprecated(
					self::LEGACY_STEP_HOOK,
					array( $step, $context, $automation, $index, $run_token ),
					'1.2.0',
					'core_index_calendar_automation_step'
				);
			}
		}
		update_post_meta( $automation_id, 'routines_last_run_at', gmdate( DATE_ATOM ) );
		do_action( 'core_index_calendar_automation_completed', $automation, $context, count( $steps ), $run_token );
		if ( has_action( self::LEGACY_COMPLETED_HOOK ) ) {
			do_action_deprecated(
				self::LEGACY_COMPLETED_HOOK,
				array( $automation, $context, count( $steps ), $run_token ),
				'1.2.0',
				'core_index_calendar_automation_completed'
			);
		}

		return array( 'ok' => true, 'steps' => count( $steps ), 'run_token' => $run_token );
	}

	private static function run_from_hook( string $source, int $automation_id, array $context ): void {
		$encoded_context = wp_json_encode( $context );
		$fingerprint     = $automation_id . ':' . hash( 'sha256', false === $encoded_context ? '' : $encoded_context );
		$previous_source = self::$hook_runs[ $fingerprint ] ?? '';
		if ( '' !== $previous_source && $source !== $previous_source ) {
			return;
		}

		if ( count( self::$hook_runs ) >= 100 ) {
			array_shift( self::$hook_runs );
		}
		self::$hook_runs[ $fingerprint ] = $source;
		self::run( $automation_id, $context );
	}
}

( static function (): void {
	$active_plugins = (array) get_option( 'active_plugins', array() );
	if (
		! in_array( 'routines-for-wordpress/routines-for-wordpress.php', $active_plugins, true )
		&& ! class_exists( 'Routines_For_WordPress_Runner' )
	) {
		class_alias( OS_Calendar_Automations::class, 'Routines_For_WordPress_Runner' );
	}
} )();
