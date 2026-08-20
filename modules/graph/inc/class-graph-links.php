<?php
/**
 * Product-owned graph-link mutation action.
 *
 * @package OS_Graph
 */

defined( 'ABSPATH' ) || exit;

final class OS_Graph_Links {

	public static function register(): void {
		add_action( 'knowledge_graph_for_wordpress_link', array( __CLASS__, 'link' ), 10, 3 );
	}

	public static function link( int $from, int $to, string $relationship = 'related' ): bool {
		$source = get_post( $from );
		$target = get_post( $to );
		if (
			! $source instanceof WP_Post
			|| ! $target instanceof WP_Post
			|| 'os_knowledge_node' !== $source->post_type
			|| 'os_knowledge_node' !== $target->post_type
		) {
			return false;
		}
		$relations   = get_post_meta( $from, 'knowledge_graph_relations', true );
		$relations   = is_array( $relations ) ? $relations : array();
		$relations[] = array(
			'target'       => $to,
			'relationship' => sanitize_key( $relationship ),
		);
		$relations = array_values( array_unique( $relations, SORT_REGULAR ) );

		return (bool) update_post_meta( $from, 'knowledge_graph_relations', $relations );
	}
}
