<?php
/**
 * Calendar-specific WordPress surfaces.
 *
 * @package OS_Calendar
 */

defined( 'ABSPATH' ) || exit;

final class OS_Calendar_Features {

	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( __CLASS__, 'serve_ics' ), 10, 4 );
	}

	public static function register_routes(): void {
		foreach ( array( '/calendar\.ics', '/reminders\.ics' ) as $route ) {
			register_rest_route(
				'calendar/v1',
				$route,
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => static fn() => current_user_can( 'read' ),
					'callback'            => array( __CLASS__, 'export_ics' ),
				)
			);
		}
	}

	public static function export_ics(): WP_REST_Response {
		$events = get_posts(
			array(
				'post_type'      => 'os_calendar_event',
				'post_status'    => array( 'publish', 'private' ),
				'posts_per_page' => 500,
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'no_found_rows'  => true,
			)
		);
		usort(
			$events,
			static function ( WP_Post $left, WP_Post $right ): int {
				$left_start  = (string) get_post_meta( $left->ID, 'calendar_start', true );
				$right_start = (string) get_post_meta( $right->ID, 'calendar_start', true );
				return strcmp( $left_start, $right_start );
			}
		);
		$lines  = array( 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OS Calendar//EN' );
		foreach ( $events as $event ) {
			if ( ! current_user_can( 'read_post', $event->ID ) ) {
				continue;
			}
			$start = self::date( (string) get_post_meta( $event->ID, 'calendar_start', true ) );
			$end   = self::date( (string) get_post_meta( $event->ID, 'calendar_end', true ) );
			if ( '' === $start ) {
				continue;
			}
			$lines[] = 'BEGIN:VEVENT';
			$lines[] = 'UID:wp-calendar-' . $event->ID . '@' . wp_parse_url( home_url(), PHP_URL_HOST );
			$lines[] = 'DTSTAMP:' . gmdate( 'Ymd\THis\Z' );
			$lines[] = 'DTSTART:' . $start;
			if ( '' !== $end ) {
				$lines[] = 'DTEND:' . $end;
			}
			$lines[] = 'SUMMARY:' . self::escape( $event->post_title );
			$location = (string) get_post_meta( $event->ID, 'calendar_location', true );
			if ( '' !== $location ) {
				$lines[] = 'LOCATION:' . self::escape( $location );
			}
			$lines[] = 'END:VEVENT';
		}
		$lines[]  = 'END:VCALENDAR';
		$response = new WP_REST_Response( implode( "\r\n", $lines ) . "\r\n" );
		$response->header( 'Content-Type', 'text/calendar; charset=UTF-8' );

		return $response;
	}

	public static function serve_ics( bool $served, WP_HTTP_Response $result, WP_REST_Request $request, WP_REST_Server $server ): bool {
		if ( ! in_array( $request->get_route(), array( '/calendar/v1/calendar.ics', '/calendar/v1/reminders.ics' ), true ) ) {
			return $served;
			}
			header( 'Content-Type: text/calendar; charset=UTF-8' );
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- RFC 5545 payload is escaped when each property is assembled.
			echo (string) $result->get_data();

		return true;
	}

	private static function date( string $value ): string {
		$timestamp = strtotime( $value );
		return $timestamp ? gmdate( 'Ymd\THis\Z', $timestamp ) : '';
	}

	private static function escape( string $value ): string {
		return str_replace( array( '\\', ',', ';', "\n" ), array( '\\\\', '\\,', '\\;', '\\n' ), $value );
	}
}
