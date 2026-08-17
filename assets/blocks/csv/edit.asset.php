<?php
/**
 * Asset metadata for the CSV Preview block's editor script. Matches the
 * Wiki Data block's `filemtime(edit.js)` versioning so deploys bust
 * the browser cache instead of shipping stale JS.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
return ( static function () {
	$ci_edit_js = __DIR__ . '/edit.js';
	return array(
		'dependencies' => array(
			'wp-blocks',
			'wp-element',
			'wp-block-editor',
			'wp-components',
			'wp-server-side-render',
			'wp-api-fetch',
		),
		'version'      => file_exists( $ci_edit_js ) ? (string) filemtime( $ci_edit_js ) : '0.2.0',
	);
} )();
