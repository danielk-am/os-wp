<?php
/**
 * Published wizard delivery route.
 *
 * @package OS_Wizard
 */

defined( 'ABSPATH' ) || exit;

final class Core_Index_Wizard_Builder_Runner {

	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function register_routes(): void {
		register_rest_route(
			'wizard-builder/v1',
			'/run/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => '__return_true',
				'callback'            => array( __CLASS__, 'read' ),
			)
		);
	}

	public static function read( WP_REST_Request $request ) {
		$wizard = get_post( (int) $request['id'] );
		if ( ! $wizard instanceof WP_Post || 'os_wizard' !== $wizard->post_type || 'publish' !== $wizard->post_status ) {
			return new WP_Error( 'wizard_not_found', 'Published wizard not found.', array( 'status' => 404 ) );
		}
		$config = json_decode( $wizard->post_content, true );
		$config = is_array( $config ) ? $config : array();
		return rest_ensure_response(
			array(
				'id'                => $wizard->ID,
				'title'             => $wizard->post_title,
				'introduction'      => (string) ( $config['introduction'] ?? '' ),
				'steps'             => (array) ( $config['steps'] ?? get_post_meta( $wizard->ID, 'wizard_builder_steps', true ) ?: array() ),
				'completion_action' => (string) ( $config['completion_action'] ?? get_post_meta( $wizard->ID, 'wizard_builder_completion_action', true ) ),
			)
		);
	}
}
