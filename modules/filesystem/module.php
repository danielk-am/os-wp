<?php
/**
 * Module: filesystem
 *
 * Was the standalone plugin `os-filesystem`. Merged into the OS plugin; the
 * module boundary survives as a directory and a toggle rather than a
 * separate activation. See docs/contracts/MODULES.md.
 *
 * @package OS
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CI_FILESYSTEM_DIR', plugin_dir_path( __FILE__ ) );
define( 'CI_FILESYSTEM_URL', plugin_dir_url( __FILE__ ) );

/**
 * Asset URL with an mtime cache-buster, so a redeploy busts the CDN + browser
 * cache (CI core versions its own module URLs the same way; without this the
 * importmap specifier resolves to a stale module).
 */
function ci_filesystem_asset_url( string $rel ): string {
	$path = CI_FILESYSTEM_DIR . $rel;
	$ver  = file_exists( $path ) ? (string) filemtime( $path ) : '0';
	return CI_FILESYSTEM_URL . $rel . '?v=' . $ver;
}

add_action(
	'plugins_loaded',
	static function () {
		require_once CI_FILESYSTEM_DIR . 'inc/class-filesystem-options.php';
		require_once CI_FILESYSTEM_DIR . 'inc/class-filesystem.php';
		require_once CI_FILESYSTEM_DIR . 'inc/class-ability-base.php';
		require_once CI_FILESYSTEM_DIR . 'inc/class-filesystem-abilities.php';
		WP_Filesystem::register();
		WP_Filesystem_Abilities::register();
		OS_Standalone_Admin::boot(
			array(
				'slug'       => 'os-filesystem',
				'name'       => 'OS Filesystem',
				'mode'       => 'filesystem',
				'rest_ns'    => WP_Filesystem::REST_NS,
				'capability' => 'manage_options',
				'parent_slug' => 'tools.php',
				'menu_priority' => 62,
				'compat_field_options' => array( 'ci_field_groups_filesystem_for_wordpress' ),
				'types'      => array(
					'file' => array(
						'singular'    => 'File',
						'plural'      => 'Files',
						'icon'        => 'dashicons-open-folder',
						'description' => 'Browse and edit files inside explicitly jailed roots.',
						'meta'        => array(),
					),
				),
				'description' => 'Browse and edit jailed WordPress files.',
				'ai_chat_instructions' => 'Help administrators inspect and edit files only within the configured jailed roots. Preserve exact paths, treat destructive operations cautiously, and never suggest bypassing root or manage_options checks.',
			),
			__FILE__
		);
	},
	20
);
