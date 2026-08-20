<?php
/**
 * Self-contained regression checks for the core-index -> os block rewrite.
 *
 * The paths that matter are the ones that decide whether a real post survives:
 * every delimiter form Gutenberg writes gets moved, prose that merely mentions
 * the old name does not, a block we never owned is left alone, and running the
 * rewrite twice changes nothing the second time.
 *
 * Usage: php tests/verify-block-migration.php
 *
 * @package OS
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

define( 'ABSPATH', __DIR__ . '/' );

require_once __DIR__ . '/../inc/class-block-migration.php';

$passed = 0;
$failed = 0;

/**
 * Record one check.
 *
 * @param string $label  What is being checked.
 * @param bool   $ok     Result.
 * @param string $detail Optional failure detail.
 */
function os_check( string $label, bool $ok, string $detail = '' ): void {
	global $passed, $failed;
	if ( $ok ) {
		++$passed;
		echo "  ok   {$label}\n";
		return;
	}
	++$failed;
	echo '  FAIL ' . $label . ( '' !== $detail ? " : {$detail}" : '' ) . "\n";
}

/**
 * Rewrite and return both the result and the replacement count.
 *
 * @param string $in Content.
 * @return array{0:string,1:int}
 */
function os_rewrite( string $in ): array {
	$n   = 0;
	$out = OS_Block_Migration::rewrite( $in, $n );
	return array( $out, $n );
}

echo "\nEvery delimiter form Gutenberg writes\n";

list( $out, $n ) = os_rewrite( '<!-- wp:core-index/task {"id":4} --><p>Hi</p><!-- /wp:core-index/task -->' );
os_check( 'a paired block moves both delimiters', 2 === $n && ! str_contains( $out, 'core-index/' ), $out );
os_check( 'block attributes survive the rewrite', str_contains( $out, '{"id":4}' ), $out );

list( $out, $n ) = os_rewrite( '<!-- wp:core-index/csv /-->' );
os_check( 'a self-closing block moves', 1 === $n && '<!-- wp:os/csv /-->' === $out, $out );

list( $out, $n ) = os_rewrite( '<!-- wp:core-index/site-editor-embed -->x<!-- /wp:core-index/site-editor-embed -->' );
os_check( 'a hyphenated name moves', 2 === $n && ! str_contains( $out, 'core-index/' ), $out );

$all = '';
foreach ( OS_Block_Migration::BLOCKS as $b ) {
	$all .= "<!-- wp:core-index/{$b} --><!-- /wp:core-index/{$b} -->";
}
list( $out, $n ) = os_rewrite( $all );
os_check( 'all five blocks move', 10 === $n, (string) $n );
os_check( 'no core-index delimiter survives', ! OS_Block_Migration::has_legacy( $out ) );

echo "\nWhat must not be touched\n";

list( $out, $n ) = os_rewrite( '<p>We used to call this core-index/task in the old docs.</p>' );
os_check( 'prose naming the old block is left alone', 0 === $n && str_contains( $out, 'core-index/task' ), $out );

list( $out, $n ) = os_rewrite( '<a href="https://github.a8c.com/1dr0/core-index/blob/main/docs/API.md">API</a>' );
os_check( 'an external URL is left alone', 0 === $n && str_contains( $out, 'core-index/blob' ), $out );

list( $out, $n ) = os_rewrite( '<!-- wp:core-index/something-else --><!-- /wp:core-index/something-else -->' );
os_check( 'a block we never owned is left alone', 0 === $n, $out );

list( $out, $n ) = os_rewrite( '<!-- wp:core-index/tasklist --><!-- /wp:core-index/tasklist -->' );
os_check( 'a longer name that merely starts with ours is left alone', 0 === $n, $out );

list( $out, $n ) = os_rewrite( '<!-- wp:core/paragraph --><p>x</p><!-- /wp:core/paragraph -->' );
os_check( 'a core block is left alone', 0 === $n );

echo "\nIdempotence\n";

list( $once, $n1 ) = os_rewrite( '<!-- wp:core-index/task --><!-- /wp:core-index/task -->' );
list( $twice, $n2 ) = os_rewrite( $once );
os_check( 'a second pass changes nothing', 0 === $n2 && $twice === $once );
os_check( 'the first pass did the work', 2 === $n1 );

list( $out, $n ) = os_rewrite( 'no blocks here at all' );
os_check( 'content with no blocks is returned untouched', 0 === $n && 'no blocks here at all' === $out );

echo "\nDetection\n";

os_check( 'has_legacy sees an unmigrated post', OS_Block_Migration::has_legacy( '<!-- wp:core-index/wiki /-->' ) );
os_check( 'has_legacy ignores prose', ! OS_Block_Migration::has_legacy( 'mentions core-index/wiki in text' ) );
os_check( 'has_legacy ignores a migrated post', ! OS_Block_Migration::has_legacy( '<!-- wp:os/wiki /-->' ) );

echo "\nRegistration agrees with the rewrite\n";

$declared = array();
foreach ( glob( __DIR__ . '/../assets/blocks/*/block.json' ) as $file ) {
	$json = json_decode( (string) file_get_contents( $file ), true );
	if ( isset( $json['name'] ) ) {
		$declared[] = (string) $json['name'];
	}
}
sort( $declared );
$expected = array_map( static fn( $b ) => 'os/' . $b, OS_Block_Migration::BLOCKS );
sort( $expected );
os_check( 'every block.json is registered under os/', $declared === $expected, implode( ', ', $declared ) );
os_check( 'no block.json still says core-index/', array() === array_filter( $declared, static fn( $n ) => str_contains( $n, 'core-index/' ) ) );

echo "\n{$passed} passed, {$failed} failed\n";
exit( $failed > 0 ? 1 : 0 );
