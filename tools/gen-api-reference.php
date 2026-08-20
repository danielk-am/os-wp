<?php
/**
 * Generate a module's API reference from its type declaration.
 *
 * The reference is generated, never authored, so it cannot describe a route
 * that is not registered from the same declaration. That is the whole point:
 * the API layer gets a machine-readable contract that is true by construction.
 *
 * Usage: php tools/gen-api-reference.php <types.json> [output.json]
 *
 * @package OS_Content_Types
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

define( 'ABSPATH', __DIR__ . '/' );

if ( ! function_exists( 'sanitize_key' ) ) {
	/**
	 * Minimal sanitize_key stand-in.
	 *
	 * @param string $key Raw key.
	 * @return string
	 */
	function sanitize_key( $key ) {
		return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) );
	}
}

if ( ! function_exists( 'wp_json_encode' ) ) {
	/**
	 * Minimal wp_json_encode stand-in.
	 *
	 * @param mixed $data Data.
	 * @return string
	 */
	function wp_json_encode( $data ) {
		return json_encode( $data ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
	}
}

require_once __DIR__ . '/../modules/content-types/inc/class-type-declaration.php';
require_once __DIR__ . '/../modules/content-types/inc/class-type-compiler.php';

$source = $argv[1] ?? '';
$target = $argv[2] ?? __DIR__ . '/../modules/content-types/api/rest-api.json';

if ( '' === $source ) {
	fwrite( STDERR, "Usage: php tools/gen-api-reference.php <types.json> [output.json]\n" );
	exit( 1 );
}

$declaration = OS_Type_Declaration::load( $source );

foreach ( $declaration['errors'] as $error ) {
	fwrite( STDERR, '  error  ' . $error . "\n" );
}

if ( array() === $declaration['types'] ) {
	fwrite( STDERR, "No usable types in {$source}. Nothing written.\n" );
	exit( 1 );
}

// Carry forward any hand-registered route the previous reference listed, so
// regenerating never quietly shrinks what the module documents.
$undeclared = array();
if ( is_readable( $target ) ) {
	$previous = json_decode( (string) file_get_contents( $target ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	foreach ( (array) ( $previous['routes'] ?? array() ) as $route ) {
		if ( is_string( $route ) ) {
			$undeclared[] = $route;
		}
	}
	foreach ( (array) ( $previous['undeclared']['routes'] ?? array() ) as $route ) {
		if ( is_string( $route ) && ! in_array( $route, $undeclared, true ) ) {
			$undeclared[] = $route;
		}
	}
}

$reference = OS_Type_Compiler::reference( $declaration, 'content-types/v1', $undeclared );
$encoded   = json_encode( $reference, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode

if ( false === file_put_contents( $target, $encoded . "\n" ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	fwrite( STDERR, "Could not write {$target}\n" );
	exit( 1 );
}

printf(
	"Wrote %s: %d type(s), %d route(s)%s\n",
	$target,
	count( $declaration['types'] ),
	count( $reference['routes'] ),
	array() === $declaration['errors'] ? '' : sprintf( ', %d error(s) above', count( $declaration['errors'] ) )
);

exit( array() === $declaration['errors'] ? 0 : 1 );
