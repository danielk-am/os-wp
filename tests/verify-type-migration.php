<?php
/**
 * Self-contained regression checks for the ci_/wp_ -> os_ content model
 * migration: post types, their taxonomies, and their meta keys.
 *
 * The paths that matter on a real site are the ones exercised here: the
 * registration guard that stops a flip happening before the code moves, the
 * group ordering that leaves the post type as the resume marker, the
 * independent readback, the menu-item and settings fixups, and the query
 * redirect that keeps legacy callers working afterwards.
 *
 * Usage: php tests/verify-type-migration.php
 *
 * @package OS_Index
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

define( 'ABSPATH', __DIR__ . '/' );

$GLOBALS['ci_test_options']          = array();
$GLOBALS['ci_test_registered_types'] = array();
$GLOBALS['ci_test_registered_taxes'] = array();
$GLOBALS['ci_test_cron']             = array();

class WP_Error {
	private string $code;
	private string $message;

	public function __construct( string $code = '', string $message = '' ) {
		$this->code    = $code;
		$this->message = $message;
	}

	public function get_error_code(): string {
		return $this->code;
	}

	public function get_error_message(): string {
		return $this->message;
	}
}

/** Just enough WP_REST_Request for the route rewrite. */
class CI_Test_Request {
	private string $route;

	public function __construct( string $route ) {
		$this->route = $route;
	}

	public function get_route(): string {
		return $this->route;
	}

	public function set_route( string $route ): void {
		$this->route = $route;
	}
}

/** Just enough WP_Query for the pre_get_posts redirect. */
class CI_Test_Query {
	private array $vars;

	public function __construct( array $vars = array() ) {
		$this->vars = $vars;
	}

	public function get( string $key ) {
		return $this->vars[ $key ] ?? '';
	}

	public function set( string $key, $value ): void {
		$this->vars[ $key ] = $value;
	}
}

/**
 * Minimal $wpdb over arrays: posts are [ID => post_type], postmeta is a list of
 * [meta_key, meta_value], term_taxonomy is a list of taxonomy names. Only the
 * statements this migration issues are understood, and an UPDATE can be told to
 * leave a row behind so the readback failure is real rather than assumed.
 */
class CI_Test_WPDB {

	public string $posts         = 'wp_posts';
	public string $postmeta      = 'wp_postmeta';
	public string $term_taxonomy = 'wp_term_taxonomy';
	public string $last_error    = '';

	/** @var array<int,string> */
	public array $rows = array();

	/** @var array<int,array{0:string,1:string}> */
	public array $meta = array();

	/** @var array<int,string> */
	public array $terms = array();

	/** Identifier whose UPDATE leaves exactly one row behind. */
	public ?string $partial_update_for = null;

	public function prepare( string $query, ...$args ): string {
		foreach ( $args as $arg ) {
			$query = preg_replace( '/%[sd]/', "'" . addslashes( (string) $arg ) . "'", $query, 1 );
		}
		return $query;
	}

	public function get_var( string $query ) {
		if ( preg_match( "/COUNT\(\*\) FROM wp_posts WHERE post_type = '([^']+)'/", $query, $m ) ) {
			return count( array_filter( $this->rows, static fn( $t ) => $t === $m[1] ) );
		}
		if ( preg_match( "/COUNT\(\*\) FROM wp_term_taxonomy WHERE taxonomy = '([^']+)'/", $query, $m ) ) {
			return count( array_filter( $this->terms, static fn( $t ) => $t === $m[1] ) );
		}
		if ( preg_match( "/COUNT\(\*\) FROM wp_postmeta WHERE meta_key = '([^']+)'/", $query, $m ) ) {
			return count( array_filter( $this->meta, static fn( $r ) => $r[0] === $m[1] ) );
		}
		return 0;
	}

	public function query( string $query ) {
		// Checked before the meta_key rewrite so the two never collide.
		if ( preg_match( "/UPDATE wp_postmeta SET meta_value = '([^']+)' WHERE meta_key = '_menu_item_object' AND meta_value = '([^']+)'/", $query, $m ) ) {
			$changed = 0;
			foreach ( $this->meta as $i => $row ) {
				if ( '_menu_item_object' === $row[0] && $m[2] === $row[1] ) {
					$this->meta[ $i ][1] = $m[1];
					++$changed;
				}
			}
			return $changed;
		}

		if ( preg_match( "/UPDATE wp_posts SET post_type = '([^']+)' WHERE post_type = '([^']+)'/", $query, $m ) ) {
			return $this->flip( $this->rows, $m[2], $m[1], static fn( &$store, $k, $v ) => $store[ $k ] = $v );
		}

		if ( preg_match( "/UPDATE wp_term_taxonomy SET taxonomy = '([^']+)' WHERE taxonomy = '([^']+)'/", $query, $m ) ) {
			return $this->flip( $this->terms, $m[2], $m[1], static fn( &$store, $k, $v ) => $store[ $k ] = $v );
		}

		if ( preg_match( "/UPDATE wp_postmeta SET meta_value = '([^']+)' WHERE meta_key = '([^']+)' AND meta_value = '([^']+)'/", $query, $m ) ) {
			$changed = 0;
			foreach ( $this->meta as $i => $row ) {
				if ( $row[0] === $m[2] && $row[1] === $m[3] ) {
					$this->meta[ $i ][1] = $m[1];
					++$changed;
				}
			}
			return $changed;
		}

		if ( preg_match( "/UPDATE wp_postmeta SET meta_key = '([^']+)' WHERE meta_key = '([^']+)'/", $query, $m ) ) {
			list( , $to, $from ) = $m;
			$changed             = 0;
			$skip                = $this->partial_update_for === $from;
			foreach ( $this->meta as $i => $row ) {
				if ( $row[0] !== $from ) {
					continue;
				}
				if ( $skip ) {
					$skip = false;
					continue;
				}
				$this->meta[ $i ][0] = $to;
				++$changed;
			}
			return $changed;
		}

		return false;
	}

	/** Shared flip for the two flat stores. */
	private function flip( array &$store, string $from, string $to, callable $set ): int {
		$changed = 0;
		$skip    = $this->partial_update_for === $from;
		foreach ( $store as $key => $value ) {
			if ( $value !== $from ) {
				continue;
			}
			if ( $skip ) {
				$skip = false;
				continue;
			}
			$set( $store, $key, $to );
			++$changed;
		}
		return $changed;
	}
}

$wpdb = new CI_Test_WPDB();

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	return true;
}

function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	return true;
}

function get_option( string $key, $default_value = false ) {
	return array_key_exists( $key, $GLOBALS['ci_test_options'] ) ? $GLOBALS['ci_test_options'][ $key ] : $default_value;
}

function update_option( string $key, $value, $autoload = null ): bool {
	$GLOBALS['ci_test_options'][ $key ] = $value;
	return true;
}

function delete_option( string $key ): bool {
	if ( ! array_key_exists( $key, $GLOBALS['ci_test_options'] ) ) {
		return false;
	}
	unset( $GLOBALS['ci_test_options'][ $key ] );
	return true;
}

function post_type_exists( string $type ): bool {
	return in_array( $type, $GLOBALS['ci_test_registered_types'], true );
}

function taxonomy_exists( string $taxonomy ): bool {
	return in_array( $taxonomy, $GLOBALS['ci_test_registered_taxes'], true );
}

function is_wp_error( $value ): bool {
	return $value instanceof WP_Error;
}

function wp_cache_delete( $key, $group = '' ) {}
function wp_cache_flush() {}
function flush_rewrite_rules( $hard = true ) {}

function apply_filters_ref_array( $hook, $args ) { return $args[0] ?? null; }
function wp_next_scheduled( $hook ) { return $GLOBALS['ci_test_cron'][ $hook ]['next'] ?? false; }
function wp_get_schedule( $hook ) { return $GLOBALS['ci_test_cron'][ $hook ]['schedule'] ?? false; }
function wp_clear_scheduled_hook( $hook ) { unset( $GLOBALS['ci_test_cron'][ $hook ] ); }
function wp_schedule_event( $ts, $rec, $hook ) { $GLOBALS['ci_test_cron'][ $hook ] = array( 'next' => $ts, 'schedule' => $rec ); return true; }
function wp_schedule_single_event( $ts, $hook ) { $GLOBALS['ci_test_cron'][ $hook ] = array( 'next' => $ts, 'schedule' => false ); return true; }

require_once __DIR__ . '/../inc/class-options.php';
require_once __DIR__ . '/../inc/class-type-migration.php';

$passed = 0;
$failed = 0;

/** Record one assertion. */
function os_check( string $label, bool $ok, string $detail = '' ): void {
	global $passed, $failed;
	if ( $ok ) {
		++$passed;
		echo "  ok   {$label}\n";
		return;
	}
	++$failed;
	echo '  FAIL ' . $label . ( '' !== $detail ? " — {$detail}" : '' ) . "\n";
}

/** Reset the world between cases. */
function os_seed(): void {
	global $wpdb;
	$wpdb->rows = array(
		1 => 'ci_snippet',
		2 => 'ci_snippet',
		3 => 'ci_skill',
		4 => 'post',
	);
	$wpdb->meta = array(
		array( 'ci_tip', 'a tip' ),
		array( 'ci_kind', 'yaml' ),
		array( 'ci_section', 'Custom' ),
		array( '_menu_item_object', 'ci_skill' ),
		array( '_menu_item_type', 'ci_skill' ),
	);
	$wpdb->terms                         = array( 'ci_skill_type', 'ci_skill_type', 'ci_tag', 'category' );
	$wpdb->partial_update_for            = null;
	$GLOBALS['ci_test_registered_types'] = array( 'os_skill', 'os_snippet', 'post' );
	$GLOBALS['ci_test_registered_taxes'] = array( 'os_skill_type', 'os_tag', 'category' );
	$GLOBALS['ci_test_options']          = array();
}

/** Pull one plan entry by kind and source name. */
function os_entry( array $plan, string $kind, string $from ): ?array {
	foreach ( $plan as $entry ) {
		if ( $entry['kind'] === $kind && $entry['from'] === $from ) {
			return $entry;
		}
	}
	return null;
}

echo "plan() covers all three kinds and groups them\n";
os_seed();
$plan = OS_Type_Migration::plan();
os_check( 'counts post type rows', 2 === ( os_entry( $plan, 'post_type', 'ci_snippet' )['rows'] ?? 0 ) );
os_check( 'counts taxonomy rows', 2 === ( os_entry( $plan, 'taxonomy', 'ci_skill_type' )['rows'] ?? 0 ) );
os_check( 'counts meta rows', 1 === ( os_entry( $plan, 'meta', 'ci_tip' )['rows'] ?? 0 ) );
os_check( 'attaches the taxonomy to its type', 'ci_skill' === ( os_entry( $plan, 'taxonomy', 'ci_skill_type' )['group'] ?? '' ) );
os_check( 'attaches snippet meta to its type', 'ci_snippet' === ( os_entry( $plan, 'meta', 'ci_tip' )['group'] ?? '' ) );
os_check( 'files a cross-type taxonomy as shared', 'shared' === ( os_entry( $plan, 'taxonomy', 'ci_tag' )['group'] ?? '' ) );
os_check( 'omits identifiers with no rows', null === os_entry( $plan, 'post_type', 'ci_memory' ) );

$kinds = array();
foreach ( $plan as $entry ) {
	if ( 'ci_snippet' === $entry['group'] ) {
		$kinds[] = $entry['kind'];
	}
}
os_check( 'the post type moves last in its group', 'post_type' === end( $kinds ), implode( ',', $kinds ) );

echo "move() refuses before the registration has moved\n";
os_seed();
$GLOBALS['ci_test_registered_types'] = array( 'post' );
$GLOBALS['ci_test_registered_taxes'] = array( 'category' );
$plan                                = OS_Type_Migration::plan();
$result                              = OS_Type_Migration::move( os_entry( $plan, 'post_type', 'ci_snippet' ) );
os_check( 'post type is refused', is_wp_error( $result ) && 'target_not_registered' === $result->get_error_code() );
$result = OS_Type_Migration::move( os_entry( $plan, 'taxonomy', 'ci_skill_type' ) );
os_check( 'taxonomy is refused', is_wp_error( $result ) && 'target_not_registered' === $result->get_error_code() );
os_check( 'nothing was touched', 2 === count( array_filter( $wpdb->rows, static fn( $t ) => 'ci_snippet' === $t ) ) );

echo "move() flips a whole group\n";
os_seed();
$plan = OS_Type_Migration::plan();
foreach ( $plan as $entry ) {
	if ( 'ci_snippet' === $entry['group'] || 'ci_skill' === $entry['group'] ) {
		OS_Type_Migration::move( $entry );
	}
}
os_check( 'post types moved', 0 === count( array_filter( $wpdb->rows, static fn( $t ) => 'ci_snippet' === $t ) ) );
os_check( 'unrelated posts untouched', 'post' === $wpdb->rows[4] );
os_check( 'taxonomy moved', 2 === count( array_filter( $wpdb->terms, static fn( $t ) => 'os_skill_type' === $t ) ) );
os_check( 'core taxonomy untouched', in_array( 'category', $wpdb->terms, true ) );
os_check( 'meta key moved', 'os_tip' === $wpdb->meta[0][0] );
os_check( 'menu item object rewritten', 'os_skill' === $wpdb->meta[3][1] );
os_check( 'a different meta key is left alone', 'ci_skill' === $wpdb->meta[4][1] );

echo "move() carries meta values that name the post type\n";
os_seed();
$wpdb->meta[] = array( 'content_types_type_key', 'ci_snippet' );
$wpdb->meta[] = array( 'content_types_type_key', 'something_else' );
OS_Type_Migration::rewrite_type_references_sweep();
$keys = array_values( array_filter( $wpdb->meta, static fn( $r ) => 'content_types_type_key' === $r[0] ) );
os_check( 'a definition pointing at the type follows it', 'os_snippet' === ( $keys[0][1] ?? '' ), $keys[0][1] ?? 'missing' );
os_check( 'an unrelated value is left alone', 'something_else' === ( $keys[1][1] ?? '' ) );

// A type with no posts never enters the plan, but its references are just as stale.
os_seed();
$wpdb->rows   = array( 4 => 'post' );
$wpdb->meta[] = array( 'content_types_type_key', 'ci_skill' );
OS_Type_Migration::rewrite_type_references_sweep();
$keys = array_values( array_filter( $wpdb->meta, static fn( $r ) => 'content_types_type_key' === $r[0] ) );
os_check( 'a reference to an empty type still moves', 'os_skill' === ( $keys[0][1] ?? '' ), $keys[0][1] ?? 'missing' );

// And it refuses to run ahead of the code.
os_seed();
$GLOBALS['ci_test_registered_types'] = array( 'post' );
$wpdb->meta[] = array( 'content_types_type_key', 'ci_snippet' );
OS_Type_Migration::rewrite_type_references_sweep();
$keys = array_values( array_filter( $wpdb->meta, static fn( $r ) => 'content_types_type_key' === $r[0] ) );
os_check( 'unregistered replacement leaves the reference alone', 'ci_snippet' === ( $keys[0][1] ?? '' ), $keys[0][1] ?? 'missing' );

echo "move() tolerates a populated meta target but not a populated type\n";
os_seed();
$wpdb->meta[] = array( 'os_tip', 'already moved' );
$plan         = OS_Type_Migration::plan();
$result       = OS_Type_Migration::move( os_entry( $plan, 'meta', 'ci_tip' ) );
os_check( 'meta merges without a flag', 1 === $result, var_export( $result, true ) );

os_seed();
$wpdb->rows[9] = 'os_snippet';
$plan          = OS_Type_Migration::plan();
$result        = OS_Type_Migration::move( os_entry( $plan, 'post_type', 'ci_snippet' ) );
os_check( 'post type refuses a populated target', is_wp_error( $result ) && 'target_not_empty' === $result->get_error_code() );
$result = OS_Type_Migration::move( os_entry( $plan, 'post_type', 'ci_snippet' ), true );
os_check( 'and merges when told to', 2 === $result, var_export( $result, true ) );

echo "move() catches a partial update in the readback\n";
os_seed();
$wpdb->partial_update_for = 'ci_snippet';
$plan                     = OS_Type_Migration::plan();
$result                   = OS_Type_Migration::move( os_entry( $plan, 'post_type', 'ci_snippet' ) );
os_check( 'returns an error', is_wp_error( $result ) );
os_check( 'names the reason', 'readback_mismatch' === $result->get_error_code(), is_wp_error( $result ) ? $result->get_error_message() : '' );

echo "taxonomy rename carries its core options\n";
os_seed();
$GLOBALS['ci_test_options']['default_term_ci_skill_type'] = 42;
$GLOBALS['ci_test_options']['ci_skill_type_children']     = array( 1 => array( 2 ) );
$plan                                                     = OS_Type_Migration::plan();
OS_Type_Migration::move( os_entry( $plan, 'taxonomy', 'ci_skill_type' ) );
os_check( 'default term option renamed', 42 === get_option( 'default_term_os_skill_type' ) );
os_check( 'children cache renamed', array( 1 => array( 2 ) ) === get_option( 'os_skill_type_children' ) );
os_check( 'legacy option names removed', false === get_option( 'default_term_ci_skill_type' ) && false === get_option( 'ci_skill_type_children' ) );

echo "shared meta waits for the code rename\n";
os_seed();
$wpdb->meta[]                        = array( 'ci_path', 'skills/thing' );
$GLOBALS['ci_test_registered_types'] = array( 'post' );
$plan                                = OS_Type_Migration::plan();
$result                              = OS_Type_Migration::move( os_entry( $plan, 'meta', 'ci_path' ) );
os_check( 'refused while no target type exists', is_wp_error( $result ) );

$GLOBALS['ci_test_registered_types'] = array( 'os_skill', 'post' );
$plan                                = OS_Type_Migration::plan();
$result                              = OS_Type_Migration::move( os_entry( $plan, 'meta', 'ci_path' ) );
os_check( 'proceeds once one has landed', 1 === $result, var_export( $result, true ) );

echo "rewrite_option_payloads() moves keys, slugs, and list entries\n";
os_seed();
$GLOBALS['ci_test_options'] = array(
	'os_field_groups' => array(
		'ci_skill' => array( 'version' => 3 ),
		'post'     => array( 'version' => 1 ),
	),
	'os_custom_cpts'  => array(
		'ci_issue' => array( 'slug' => 'ci_issue', 'label' => 'Issue' ),
	),
	'os_adopted_cpts' => array( 'ci_skill', 'habitat' ),
);
$touched = OS_Type_Migration::rewrite_option_payloads(
	array( 'ci_skill' => 'os_skill', 'ci_issue' => 'os_issue' )
);
$fields  = get_option( 'os_field_groups' );
$types   = get_option( 'os_custom_cpts' );
$adopted = get_option( 'os_adopted_cpts' );
os_check( 'rewrote three options', 3 === $touched, (string) $touched );
os_check( 'keyed option key moved', isset( $fields['os_skill'] ) && ! isset( $fields['ci_skill'] ) );
os_check( 'unrelated key survived', isset( $fields['post'] ) );
os_check( 'definition key moved', isset( $types['os_issue'] ) );
os_check( 'definition slug field moved', 'os_issue' === ( $types['os_issue']['slug'] ?? '' ) );
os_check( 'list entry moved', in_array( 'os_skill', $adopted, true ) && ! in_array( 'ci_skill', $adopted, true ) );
os_check( 'unrelated list entry survived', in_array( 'habitat', $adopted, true ) );

echo "a dynamic type with no posts still gets its definition renamed\n";
os_seed();
$wpdb->rows = array( 4 => 'post' );
$GLOBALS['ci_test_options']['os_custom_cpts'] = array( 'ci_issue' => array( 'slug' => 'ci_issue', 'label' => 'Issue' ) );
$GLOBALS['ci_test_options']['os_adopted_cpts'] = array( 'ci_issue' );
OS_Type_Migration::rewrite_option_payloads( OS_Type_Migration::dynamic_pairs_for_test() );
$types = get_option( 'os_custom_cpts' );
os_check( 'definition key renamed with no rows to move', isset( $types['os_issue'] ), implode( ',', array_keys( (array) $types ) ) );
os_check( 'definition slug renamed too', 'os_issue' === ( $types['os_issue']['slug'] ?? '' ) );
os_check( 'the adopted list follows', in_array( 'os_issue', (array) get_option( 'os_adopted_cpts' ), true ) );

echo "dynamic types from os_custom_cpts are planned\n";
os_seed();
$GLOBALS['ci_test_options']['os_custom_cpts'] = array( 'ci_project' => array( 'slug' => 'ci_project' ) );
$wpdb->rows[7]                                = 'ci_project';
$GLOBALS['ci_test_registered_types'][]        = 'os_project';
$plan                                         = OS_Type_Migration::plan();
os_check( 'dynamic type is planned', null !== os_entry( $plan, 'post_type', 'ci_project' ) );
os_check( 'dynamic target is derived', 'os_project' === ( os_entry( $plan, 'post_type', 'ci_project' )['to'] ?? '' ) );

echo "redirect_legacy_query() only fires once the old name is gone\n";
os_seed();
$GLOBALS['ci_test_registered_types'] = array( 'ci_skill', 'os_skill' );
$query                               = new CI_Test_Query( array( 'post_type' => 'ci_skill' ) );
OS_Type_Migration::redirect_legacy_query( $query );
os_check( 'leaves the query alone while both are registered', 'ci_skill' === $query->get( 'post_type' ) );

$GLOBALS['ci_test_registered_types'] = array( 'os_skill' );
$query                               = new CI_Test_Query( array( 'post_type' => 'ci_skill' ) );
OS_Type_Migration::redirect_legacy_query( $query );
os_check( 'redirects once the legacy type is unregistered', 'os_skill' === $query->get( 'post_type' ) );

$query = new CI_Test_Query( array( 'post_type' => array( 'ci_skill', 'post' ) ) );
OS_Type_Migration::redirect_legacy_query( $query );
os_check( 'leaves a multi-type query alone', array( 'ci_skill', 'post' ) === $query->get( 'post_type' ) );


echo "reschedule_cron() moves the event, not the data\n";
$GLOBALS['ci_test_cron'] = array( 'ci_reminders_cron' => array( 'next' => 1800000000, 'schedule' => 'hourly' ) );
$report = OS_Type_Migration::reschedule_cron( false );
os_check( 'dry run reports the move', isset( $report['ci_reminders_cron'] ) );
os_check( 'dry run changes nothing', isset( $GLOBALS['ci_test_cron']['ci_reminders_cron'] ) );
OS_Type_Migration::reschedule_cron( true );
os_check( 'legacy hook cleared', ! isset( $GLOBALS['ci_test_cron']['ci_reminders_cron'] ) );
os_check( 'new hook booked at the same time', 1800000000 === ( $GLOBALS['ci_test_cron']['os_reminders_cron']['next'] ?? 0 ) );
os_check( 'recurrence preserved', 'hourly' === ( $GLOBALS['ci_test_cron']['os_reminders_cron']['schedule'] ?? '' ) );
$GLOBALS['ci_test_cron'] = array();
os_check( 'nothing scheduled is a no-op', array() === OS_Type_Migration::reschedule_cron( true ) );

echo "rewrite_legacy_rest_route() re-points the pre-rename collection\n";
$request = new CI_Test_Request( '/wp/v2/ci_skill' );
OS_Type_Migration::rewrite_legacy_rest_route( null, null, $request );
os_check( 'collection route re-pointed', '/wp/v2/os_skill' === $request->get_route() );

$request = new CI_Test_Request( '/wp/v2/ci_skill/42' );
OS_Type_Migration::rewrite_legacy_rest_route( null, null, $request );
os_check( 'item route keeps its suffix', '/wp/v2/os_skill/42' === $request->get_route() );

$request = new CI_Test_Request( '/wp/v2/posts' );
OS_Type_Migration::rewrite_legacy_rest_route( null, null, $request );
os_check( 'an unrelated route is untouched', '/wp/v2/posts' === $request->get_route() );

$request = new CI_Test_Request( '/wp/v2/ci_skill' );
OS_Type_Migration::rewrite_legacy_rest_route( 'short-circuited', null, $request );
os_check( 'a short-circuited request is left alone', '/wp/v2/ci_skill' === $request->get_route() );
echo "\n{$passed} passed, {$failed} failed\n";
exit( $failed > 0 ? 1 : 0 );
