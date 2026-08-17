<?php
/**
 * Plugin Name:       OS
 * Description:       Skills, wiki, memory, work items, calendar, code, and the rest of the OS, as WordPress modules an agent can read and write.
 * Version:           3.3.0
 * Requires at least: 6.9
 * Requires PHP:      8.1
 * Author:            Daniel Kam
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       os
 * Update URI:        https://github.com/danielk-am/os-wp
 *
 * @package OS
 */

/**
 * One plugin, nine modules.
 *
 * This was nine standalone plugins plus a hub, split out of a monolith in July
 * 2026 so each could be independently useful. That goal changed: this is one
 * person's operating system, installed whole by anyone who wants it, so the
 * independence contract was costing 10.9 MB of duplicated runtime, a sync
 * script, and a validator to police a property nobody was using.
 *
 * The module boundaries survive the merge. They were the valuable part. What
 * went away is the plugin border around each one, replaced by a directory, a
 * manifest, and a toggle. See docs/contracts/MODULES.md for the shape and
 * docs/contracts/DATA-INVENTORY.md for the data each module owns.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OS_PLUGIN_FILE', __FILE__ );
define( 'OS_DIR', plugin_dir_path( __FILE__ ) );
define( 'OS_URL', plugin_dir_url( __FILE__ ) );
define( 'OS_VERSION', '3.3.0' );

// Option access and the namespace migrations load before anything else and
// outside the module system: they are how a site that ran the pre-rename code
// gets its data onto `os_`, and a module being switched off must not take its
// migration path with it.
require_once OS_DIR . 'inc/class-updates.php';
OS_Updates::register();

require_once OS_DIR . 'inc/class-options.php';
require_once OS_DIR . 'inc/class-option-migration.php';
Core_Index_Option_Migration::register();
require_once OS_DIR . 'inc/class-type-migration.php';
Core_Index_Type_Migration::register();

// The shared runtime every module's admin app is built on. One copy now; there
// were ten, kept in step by a sync script that no longer needs to exist.
require_once OS_DIR . 'inc/class-icon-svg-sanitizer.php';
require_once OS_DIR . 'inc/runtime/class-standalone-admin.php';
require_once OS_DIR . 'inc/runtime/class-ai-chat-relay.php';

require_once OS_DIR . 'inc/class-modules.php';
require_once OS_DIR . 'inc/class-modules-screen.php';
OS_Modules_Screen::register();

// Modules register post types and abilities, both of which must be in place
// before `init` and before the Abilities API registry is first touched, so they
// boot at file scope rather than on `plugins_loaded`.
OS_Modules::boot();

/**
 * Remove only what this plugin owns.
 *
 * Reads the module manifests rather than a hardcoded list, so a module that
 * declares its data gets cleaned up without anyone remembering to edit this.
 */
function os_uninstall(): void {
	foreach ( OS_Modules::owned_data() as $keys ) {
		foreach ( $keys as $key ) {
			delete_option( $key );
		}
	}
	delete_option( OS_Modules::DISABLED_OPTION );
	delete_option( OS_Modules::TRIPPED_OPTION );
	delete_option( OS_Modules::BOOTING_OPTION );
}
register_uninstall_hook( __FILE__, 'os_uninstall' );
