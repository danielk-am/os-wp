<?php
/**
 * Auto-updates from GitHub releases, through the manifest this repo publishes.
 *
 * The `Update URI` header names github.com, so WordPress offers this plugin's
 * update check to the `update_plugins_github.com` filter and expects whoever
 * answers to say what the newest version is and where the ZIP lives. This class
 * answers from `manifest.json` on the repo's main branch, which each release
 * updates alongside the tag.
 *
 * Why a manifest instead of the GitHub releases API: the manifest is one
 * cacheable file the site owner controls, it needs no API token or rate-limit
 * handling, and rolling an update back is editing one line rather than
 * deleting a release.
 *
 * Loaded outside the module system on purpose: updates must keep working when
 * every module is switched off, and especially when one is tripped, because an
 * update is how a broken module gets fixed.
 *
 * @package OS
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OS_Updates {

	const REPO     = 'https://github.com/danielk-am/os-wp';
	const MANIFEST = 'https://raw.githubusercontent.com/danielk-am/os-wp/main/manifest.json';
	const CACHE    = 'os_update_manifest';

	public static function register(): void {
		add_filter( 'update_plugins_github.com', array( __CLASS__, 'check' ), 10, 3 );
	}

	/**
	 * Answer WordPress's update check for this plugin.
	 *
	 * Returns the existing $update untouched for any other github.com-hosted
	 * plugin, and false-equivalent (unchanged) when the manifest is missing,
	 * malformed, or not newer, so a broken manifest can never push a downgrade.
	 *
	 * @param array|false $update      Update data another callback provided.
	 * @param array       $plugin_data The plugin's header data.
	 * @param string      $plugin_file Plugin basename, e.g. `os/os.php`.
	 * @return array|false
	 */
	public static function check( $update, $plugin_data, $plugin_file ) {
		if ( self::REPO !== (string) ( $plugin_data['UpdateURI'] ?? '' ) ) {
			return $update;
		}

		$manifest = self::manifest();
		if ( empty( $manifest['version'] ) || empty( $manifest['package'] ) ) {
			return $update;
		}
		if ( ! version_compare( (string) $manifest['version'], (string) $plugin_data['Version'], '>' ) ) {
			return $update;
		}

		return array(
			'id'           => 'github.com/danielk-am/os-wp',
			'slug'         => 'os',
			'plugin'       => $plugin_file,
			'version'      => (string) $manifest['version'],
			'url'          => self::REPO,
			'package'      => (string) $manifest['package'],
			'requires'     => (string) ( $manifest['requires'] ?? '6.9' ),
			'requires_php' => (string) ( $manifest['requires_php'] ?? '8.1' ),
			'tested'       => (string) ( $manifest['tested'] ?? '' ),
		);
	}

	/**
	 * The published manifest, cached for six hours. Update checks run often and
	 * the raw endpoint is happy to be hit rarely; `wp plugin update` after a
	 * fresh release still works because WP-CLI forces the check.
	 *
	 * @return array<string,mixed>
	 */
	private static function manifest(): array {
		$cached = get_site_transient( self::CACHE );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = wp_remote_get( self::MANIFEST, array( 'timeout' => 10 ) );
		$manifest = array();
		if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
			$decoded  = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			$manifest = is_array( $decoded ) ? $decoded : array();
		}

		// A failed fetch caches the empty result too, briefly, so an outage
		// does not turn every admin page load into a slow remote request.
		set_site_transient( self::CACHE, $manifest, $manifest ? 6 * HOUR_IN_SECONDS : 15 * MINUTE_IN_SECONDS );

		return $manifest;
	}
}
