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

define( 'OS_CODE_DIR', plugin_dir_path( __FILE__ ) );
define( 'OS_CODE_URL', plugin_dir_url( __FILE__ ) );

/**
 * Asset URL with an mtime cache-buster, so a redeploy busts the CDN + browser
 * cache (CI core versions its own module URLs the same way; without this the
 * importmap specifier resolves to a stale module).
 */
function os_code_asset_url( string $rel ): string {
	$path = OS_CODE_DIR . $rel;
	$ver  = file_exists( $path ) ? (string) filemtime( $path ) : '0';
	return OS_CODE_URL . $rel . '?v=' . $ver;
}

add_action(
	'plugins_loaded',
	static function () {
		require_once OS_CODE_DIR . 'inc/class-code-options.php';
		require_once OS_CODE_DIR . 'inc/class-code.php';
		require_once OS_CODE_DIR . 'inc/class-ability-base.php';
		require_once OS_CODE_DIR . 'inc/class-code-abilities.php';
		OS_Code::register();
		OS_Code_Abilities::register();
		OS_Standalone_Admin::boot(
			array(
				'slug'        => 'os-code',
				'name'        => 'OS Code',
				'mode'        => 'code',
				'rest_ns'     => OS_Code::NS,
				'parent_slug' => 'tools.php',
				'menu_priority' => 61,
				'capability'   => 'manage_options',
				'compat_field_options' => array( 'ci_field_groups_code_for_wordpress' ),
				'admin_items' => true,
				'types'       => array(
					'code' => array(
						'post_type'  => OS_Code::CPT,
						'singular'   => 'Snippet',
						'plural'     => 'Code',
						'icon'       => 'dashicons-editor-code',
						'description'=> 'Author guarded PHP, JavaScript, CSS, and HTML snippets.',
						'meta'       => array(
							OS_Code::META_LANG     => 'string',
							OS_Code::META_SCOPE    => 'string',
							OS_Code::META_ACTIVE   => 'boolean',
							OS_Code::META_PRIORITY => 'integer',
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
		require_once OS_CODE_DIR . 'inc/class-code-options.php';
		require_once OS_CODE_DIR . 'inc/class-code.php';
		OS_Code::activate();
	}
);

register_deactivation_hook(
	__FILE__,
	static function (): void {
		require_once OS_CODE_DIR . 'inc/class-code-options.php';
		require_once OS_CODE_DIR . 'inc/class-code.php';
		OS_Code::deactivate();
	}
);
