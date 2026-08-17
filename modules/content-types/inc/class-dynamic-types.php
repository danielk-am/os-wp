<?php
/**
 * Register stored content type definitions as native WordPress post types.
 *
 * @package OS_Content_Types
 */

defined( 'ABSPATH' ) || exit;

final class Core_Index_Content_Types_Dynamic_Types {

	/** @var array<string,int> Post type keys registered from stored definitions. */
	private static array $registered = array();

	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_stored_types' ), 30 );
	}

	public static function owns( string $post_type ): bool {
		return isset( self::$registered[ $post_type ] );
	}

	public static function register_stored_types(): void {
		$definitions = get_posts(
			array(
				'post_type'      => 'os_content_type',
				'post_status'    => array( 'publish', 'private' ),
				'posts_per_page' => 100,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		usort( $definitions, static fn( $left, $right ): int => $left->ID <=> $right->ID );
		$seen = array();
		foreach ( $definitions as $definition ) {
			$key = sanitize_key( (string) get_post_meta( $definition->ID, 'content_types_type_key', true ) );
			if ( '' === $key || isset( $seen[ $key ] ) || post_type_exists( $key ) || strlen( $key ) > 20 ) {
				continue;
			}
			$seen[ $key ] = true;
			$singular = (string) get_post_meta( $definition->ID, 'content_types_singular', true );
			$plural   = (string) get_post_meta( $definition->ID, 'content_types_plural', true );
			$singular = $singular ?: $definition->post_title;
			$plural   = $plural ?: $singular;
			$config   = get_post_meta( $definition->ID, 'content_types_config', true );
			$config   = is_array( $config ) ? $config : array();
			$hierarchical = ! empty( $config['hierarchical'] );
			$supports = array( 'title', 'editor', 'excerpt', 'author', 'revisions', 'custom-fields', 'autosave' );
			if ( $hierarchical ) {
				$supports[] = 'page-attributes';
			}
			$registered = register_post_type(
				$key,
				array(
					'label'  => $plural,
					'labels' => array(
						'name'          => $plural,
						'singular_name' => $singular,
						'menu_name'     => $plural,
						'add_new_item'  => 'Add new ' . strtolower( $singular ),
						'edit_item'     => 'Edit ' . strtolower( $singular ),
						'new_item'      => 'New ' . strtolower( $singular ),
						'view_item'     => 'View ' . strtolower( $singular ),
						'search_items'  => 'Search ' . strtolower( $plural ),
					),
					'public'          => false,
					'show_ui'         => true,
					'show_in_menu'    => false,
					'show_in_rest'    => true,
					'rest_base'       => $key,
					'rest_namespace'  => 'wp/v2',
					'hierarchical'    => $hierarchical,
					'has_archive'     => false,
					'rewrite'         => false,
					'capability_type' => 'page',
					'supports'        => $supports,
				)
			);
			if ( ! is_wp_error( $registered ) ) {
				self::$registered[ $key ] = (int) $definition->ID;
			} else {
				continue;
			}
			register_post_meta(
				$key,
				'os_language',
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => 'sanitize_text_field',
					'auth_callback'     => static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id ),
				)
			);
		}
	}
}
