<?php
/**
 * Local Abilities API registration foundation.
 *
 * @package OS_Filesystem
 */

defined( 'ABSPATH' ) || exit;

abstract class WP_Filesystem_Ability_Base {

	const NS       = 'filesystem';
	const CATEGORY = 'os-filesystem';

	public static function register(): void {
		add_action( 'wp_abilities_api_categories_init', array( static::class, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( static::class, 'register_all' ) );
	}

	public static function register_category(): void {
		if ( function_exists( 'wp_register_ability_category' ) && ! wp_has_ability_category( self::CATEGORY ) ) {
			wp_register_ability_category(
				self::CATEGORY,
				array(
					'label'       => 'OS Filesystem',
					'description' => 'Jailed filesystem operations for WordPress.',
				)
			);
		}
	}

	protected static function reg( string $id, array $args ): void {
		$args['category'] = self::CATEGORY;
		try {
			wp_register_ability( $id, $args );
		} catch ( Throwable $error ) {
			do_action( 'filesystem_for_wordpress_ability_error', $id, $error );
		}
	}

	abstract public static function register_all(): void;
}
