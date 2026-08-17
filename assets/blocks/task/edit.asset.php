<?php
/**
 * Asset metadata for the Task block's editor script.
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
			'wp-data',
			'wp-i18n',
		),
		'version'      => file_exists( $ci_edit_js ) ? (string) filemtime( $ci_edit_js ) : '0.1.0',
	);
} )();
