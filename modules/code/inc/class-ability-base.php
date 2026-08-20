<?php
/**
 * Local Abilities API registration foundation.
 *
 * @package OS_Code
 */

defined( 'ABSPATH' ) || exit;

abstract class OS_Code_Ability_Base {

	const NS       = 'code';
	const CATEGORY = 'os-code';

	public static function register(): void {
		add_action( 'wp_abilities_api_categories_init', array( static::class, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( static::class, 'register_all' ) );
	}

	public static function register_category(): void {
		if ( function_exists( 'wp_register_ability_category' ) && ! wp_has_ability_category( self::CATEGORY ) ) {
			wp_register_ability_category(
				self::CATEGORY,
				array(
					'label'       => 'OS Code',
					'description' => 'Guarded code snippets and operations for WordPress.',
				)
			);
		}
	}

	protected static function reg( string $id, array $args ): void {
		$args['category'] = self::CATEGORY;
		try {
			wp_register_ability( $id, $args );
		} catch ( Throwable $error ) {
			do_action( 'ci_code_ability_error', $id, $error );
		}
	}

	public static function can_read(): bool {
		return current_user_can( 'manage_options' );
	}

	abstract public static function register_all(): void;
}
