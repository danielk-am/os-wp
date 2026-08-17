<?php
/**
 * Asset metadata for the Wiki Data block's editor script. WordPress
 * reads this file when register_block_type processes block.json's
 * `editorScript` entry — `dependencies` controls enqueue order,
 * `version` becomes the `?ver=` cache-buster on the script URL.
 *
 * `filemtime(edit.js)` as the version means deploys automatically
 * invalidate the browser cache. A static string like '0.1.0' kept
 * shipping the old edit.js to users even after the file changed
 * (browsers cache scripts aggressively when ?ver= is stable).
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
