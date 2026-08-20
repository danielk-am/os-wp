<?php
/**
 * Small, product-owned memory capture action.
 *
 * @package OS_Wiki
 */

defined( 'ABSPATH' ) || exit;

final class OS_AI_Library_Memory_Capture {

	public static function register(): void {
		add_action( 'llm_wiki_for_wordpress_remember', array( __CLASS__, 'remember' ), 10, 3 );
	}

	public static function remember( string $title, string $content, int $importance = 0 ): int {
		if ( OS_AI_Library::is_read_only() ) {
			return 0;
		}

		$id = wp_insert_post(
			array(
				'post_type'    => 'os_memory',
				'post_status'  => 'private',
				'post_title'   => sanitize_text_field( $title ),
				'post_content' => wp_kses_post( $content ),
			)
		);
		if ( $id ) {
			update_post_meta( $id, 'llm_wiki_importance', max( 0, min( 100, $importance ) ) );
		}

		return (int) $id;
	}
}
