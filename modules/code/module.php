<?php
/**
 * Module: code
 *
 * Was the standalone plugin `os-code`. Merged into the OS plugin; the
 * module boundary survives as a directory and a toggle rather than a
 * separate activation. See docs/contracts/MODULES.md.
 *
 * @package OS
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CI_CODE_DIR', plugin_dir_path( __FILE__ ) );
define( 'CI_CODE_URL', plugin_dir_url( __FILE__ ) );

/**
 * Asset URL with an mtime cache-buster, so a redeploy busts the CDN + browser
 * cache (CI core versions its own module URLs the same way; without this the
 * importmap specifier resolves to a stale module).
 */
function ci_code_asset_url( string $rel ): string {
	$path = CI_CODE_DIR . $rel;
	$ver  = file_exists( $path ) ? (string) filemtime( $path ) : '0';
	return CI_CODE_URL . $rel . '?v=' . $ver;
}

add_action(
	'plugins_loaded',
	static function () {
		require_once CI_CODE_DIR . 'inc/class-code-options.php';
		require_once CI_CODE_DIR . 'inc/class-code.php';
		require_once CI_CODE_DIR . 'inc/class-ability-base.php';
		require_once CI_CODE_DIR . 'inc/class-code-abilities.php';
		if ( ! class_exists( 'WP_Code', false ) ) {
			class_alias( CI_Code::class, 'WP_Code' );
		}
		if ( ! class_exists( 'WP_Code_Ability_Base', false ) ) {
			class_alias( CI_Code_Ability_Base::class, 'WP_Code_Ability_Base' );
		}
		if ( ! class_exists( 'WP_Code_Abilities', false ) ) {
			class_alias( CI_Code_Abilities::class, 'WP_Code_Abilities' );
		}
		CI_Code::register();
		CI_Code_Abilities::register();
		OS_Standalone_Admin::boot(
			array(
				'slug'        => 'os-code',
				'name'        => 'OS Code',
				'mode'        => 'code',
				'rest_ns'     => CI_Code::NS,
				'parent_slug' => 'tools.php',
				'menu_priority' => 61,
				'capability'   => 'manage_options',
				'compat_field_options' => array( 'ci_field_groups_code_for_wordpress' ),
				'admin_items' => true,
				'types'       => array(
					'code' => array(
						'post_type'  => CI_Code::CPT,
						'singular'   => 'Snippet',
						'plural'     => 'Code',
						'icon'       => 'dashicons-editor-code',
						'description'=> 'Author guarded PHP, JavaScript, CSS, and HTML snippets.',
						'meta'       => array(
							CI_Code::META_LANG     => 'string',
							CI_Code::META_SCOPE    => 'string',
							CI_Code::META_ACTIVE   => 'boolean',
							CI_Code::META_PRIORITY => 'integer',
						),
					),
				),
				'description' => 'Author guarded code that belongs to WordPress.',
				'ai_chat_instructions' => 'Help administrators understand and edit these WordPress snippets. Preserve inactive-by-default behavior, the PHP activation gate, and the circuit breaker, and never claim code ran unless the app confirms it.',
			),
			__FILE__
		);
	},
	20
);

register_activation_hook(
	__FILE__,
	static function (): void {
		require_once CI_CODE_DIR . 'inc/class-code-options.php';
		require_once CI_CODE_DIR . 'inc/class-code.php';
		CI_Code::activate();
	}
);

register_deactivation_hook(
	__FILE__,
	static function (): void {
		require_once CI_CODE_DIR . 'inc/class-code-options.php';
		require_once CI_CODE_DIR . 'inc/class-code.php';
		CI_Code::deactivate();
	}
);
