<?php
/**
 * Self-contained regression checks for the ci_ -> os_ option migration.
 *
 * Runs Core_Index_Option_Migration against an in-memory $wpdb, so the paths
 * that matter on a real site are the ones exercised here: the plan states, the
 * byte-exact copy, the refusal to overwrite an existing target, and the revert
 * when the readback disagrees with what was written.
 *
 * Usage: php tests/verify-option-migration.php
 *
 * @package OS_Index
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );

/**
 * Minimal $wpdb over an array. Only the four calls the migration makes are
 * implemented, plus a switch that corrupts one readback so the verify-and-
 * revert path can be proven rather than assumed.
 */
class CI_Test_WPDB {

	public $options    = 'wp_options';
	public $last_error = '';

	/** @var array<string,array{option_value:string,autoload:string}> */
	public $rows = array();

	/** @var string|null Option name whose next read returns corrupted data. */
	public $corrupt_readback_for = null;

	public function prepare( $query, ...$args ) {
		foreach ( $args as $arg ) {
			$query = preg_replace( '/%s/', "'" . addslashes( (string) $arg ) . "'", $query, 1 );
		}
		return $query;
	}

	public function esc_like( $text ) {
		return addcslashes( (string) $text, '_%\\' );
	}

	public function get_row( $query, $output = null ) {
		if ( ! preg_match( "/option_name = '([^']+)'/", (string) $query, $m ) ) {
			return null;
		}
		$name = stripslashes( $m[1] );
		if ( ! isset( $this->rows[ $name ] ) ) {
			return null;
		}
		$row = $this->rows[ $name ];
		if ( $this->corrupt_readback_for === $name ) {
			$row['option_value'] = 'TRUNCATED';
		}
		return $row;
	}

	public function get_col( $query ) {
		if ( ! preg_match( "/LIKE '([^']*)%'/", (string) $query, $m ) ) {
			return array();
		}
		$prefix = str_replace( array( '\\_', '\\%', '\\\\' ), array( '_', '%', '\\' ), stripslashes( $m[1] ) );
		return array_values(
			array_filter( array_keys( $this->rows ), static fn( $name ) => str_starts_with( (string) $name, $prefix ) )
		);
	}

	public function insert( $table, $data, $formats = null ) {
		if ( isset( $this->rows[ $data['option_name'] ] ) ) {
			return false;
		}
		$this->rows[ $data['option_name'] ] = array(
			'option_value' => $data['option_value'],
			'autoload'     => $data['autoload'],
		);
		return 1;
	}

	public function delete( $table, $where, $formats = null ) {
		unset( $this->rows[ $where['option_name'] ] );
		return 1;
	}
}

$wpdb = new CI_Test_WPDB();

$GLOBALS['ci_test_filters'] = array();

function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['ci_test_filters'][ $hook ][] = $callback;
}

function get_option( $name, $default_value = false ) {
	global $wpdb;
	return isset( $wpdb->rows[ $name ] ) ? $wpdb->rows[ $name ]['option_value'] : $default_value;
}

function wp_cache_delete( $key, $group = '' ) {}

require_once __DIR__ . '/../inc/class-option-migration.php';

$passed = 0;
$failed = 0;

/** Record one assertion. */
function ci_check( string $label, bool $ok, string $detail = '' ): void {
	global $passed, $failed;
	if ( $ok ) {
		++$passed;
		echo "  ok   {$label}\n";
		return;
	}
	++$failed;
	echo '  FAIL ' . $label . ( '' !== $detail ? " — {$detail}" : '' ) . "\n";
}

echo "plan() reports each state\n";
$wpdb->rows = array(
	'ci_custom_cpts'                           => array( 'option_value' => 'a:1:{i:0;s:8:"ci_issue";}', 'autoload' => 'yes' ),
	'ci_taxonomies'                            => array( 'option_value' => 'a:0:{}', 'autoload' => 'no' ),
	'os_instance_id'                           => array( 'option_value' => 'abc', 'autoload' => 'yes' ),
	'ci_fs_roots'                              => array( 'option_value' => '/srv', 'autoload' => 'no' ),
	'os_fs_roots'                              => array( 'option_value' => '/other', 'autoload' => 'no' ),
	'ci_field_groups_core_index_content_types' => array( 'option_value' => 'x', 'autoload' => 'no' ),
	'ci_totally_unknown_thing'                 => array( 'option_value' => 'y', 'autoload' => 'no' ),
);

$plan   = Core_Index_Option_Migration::plan();
$states = array_column( $plan, 'state', 'from' );
ci_check( 'a legacy row with no target is pending', ( $states['ci_custom_cpts'] ?? '' ) === 'pending' );
ci_check( 'a moved row reports done', ( $states['ci_instance_id'] ?? '' ) === 'done' );
ci_check( 'both rows present reports conflict', ( $states['ci_fs_roots'] ?? '' ) === 'conflict' );
ci_check( 'prefix family members are discovered', isset( $states['ci_field_groups_core_index_content_types'] ) );
ci_check( 'ci_custom_cpts is planned first', $plan[0]['from'] === 'ci_custom_cpts', $plan[0]['from'] );

echo "unmapped() surfaces gaps rather than skipping them\n";
$orphans = Core_Index_Option_Migration::unmapped();
ci_check( 'an unknown ci_ option is flagged', in_array( 'ci_totally_unknown_thing', $orphans, true ) );
ci_check( 'a mapped option is not flagged', ! in_array( 'ci_custom_cpts', $orphans, true ) );
ci_check( 'a family member is not flagged', ! in_array( 'ci_field_groups_core_index_content_types', $orphans, true ) );

echo "move() copies exactly, then deletes\n";
$before = $wpdb->rows['ci_custom_cpts'];
$result = Core_Index_Option_Migration::move( 'ci_custom_cpts', 'os_custom_cpts' );
ci_check( 'reports success', $result['ok'], $result['message'] );
ci_check( 'target holds the same bytes', ( $wpdb->rows['os_custom_cpts']['option_value'] ?? '' ) === $before['option_value'] );
ci_check( 'autoload flag survives', ( $wpdb->rows['os_custom_cpts']['autoload'] ?? '' ) === 'yes' );
ci_check( 'source row is gone', ! isset( $wpdb->rows['ci_custom_cpts'] ) );

echo "move() is idempotent\n";
$result = Core_Index_Option_Migration::move( 'ci_custom_cpts', 'os_custom_cpts' );
ci_check( 'a second run is a no-op', $result['ok'] && 'already moved' === $result['message'], $result['message'] );

echo "move() never overwrites an existing target\n";
$result = Core_Index_Option_Migration::move( 'ci_fs_roots', 'os_fs_roots' );
ci_check( 'refuses the move', ! $result['ok'], $result['message'] );
ci_check( 'source is untouched', ( $wpdb->rows['ci_fs_roots']['option_value'] ?? '' ) === '/srv' );
ci_check( 'target is untouched', ( $wpdb->rows['os_fs_roots']['option_value'] ?? '' ) === '/other' );

echo "move() reverts when the readback disagrees\n";
$wpdb->corrupt_readback_for = 'os_taxonomies';
$result                     = Core_Index_Option_Migration::move( 'ci_taxonomies', 'os_taxonomies' );
ci_check( 'reports failure', ! $result['ok'], $result['message'] );
ci_check( 'the partial copy is removed', ! isset( $wpdb->rows['os_taxonomies'] ) );
ci_check( 'the source survives', isset( $wpdb->rows['ci_taxonomies'] ) );
$wpdb->corrupt_readback_for = null;

echo "\n{$passed} passed, {$failed} failed\n";
exit( $failed > 0 ? 1 : 0 );
