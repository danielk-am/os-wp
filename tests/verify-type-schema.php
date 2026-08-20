<?php
/**
 * Self-contained regression checks for the type declaration and its compiler.
 *
 * The paths that matter are the ones that keep one declaration honest across
 * three surfaces: validation that reports rather than skips, a field schema
 * that reaches register_post_meta intact, REST args and ability input staying
 * identical, an output schema that describes something, and normalisation that
 * is stable enough to hash.
 *
 * Usage: php tests/verify-type-schema.php
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
 * The reference declaration used across cases.
 *
 * @return array
 */
function os_fixture(): array {
	return array(
		'version' => 1,
		'types'   => array(
			array(
				'key'      => 'recipe',
				'singular' => 'Recipe',
				'plural'   => 'Recipes',
				'supports' => array( 'title', 'editor', 'revisions' ),
				'fields'   => array(
					array(
						'key'      => 'servings',
						'type'     => 'integer',
						'minimum'  => 1,
						'required' => true,
						'index'    => true,
					),
					array(
						'key'   => 'course',
						'type'  => 'string',
						'enum'  => array( 'starter', 'main', 'dessert' ),
						'index' => true,
					),
					array(
						'key'    => 'published_on',
						'type'   => 'string',
						'format' => 'date',
					),
					array(
						'key'   => 'tags',
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
					array(
						'key'         => 'base_recipe',
						'type'        => 'relation',
						'to'          => 'recipe',
						'cardinality' => 'many',
					),
				),
				'display'  => array(
					'columns' => array( 'title', 'course' ),
					'form'    => array(
						array(
							'section' => 'Timing',
							'fields'  => array( 'servings' ),
						),
					),
				),
			),
		),
	);
}

echo "\nType declaration\n";

$declaration = OS_Type_Declaration::normalise( os_fixture() );
$recipe      = $declaration['types']['recipe'] ?? array();

os_check( 'a valid declaration produces no errors', array() === $declaration['errors'], implode( '; ', $declaration['errors'] ) );
os_check( 'every declared field survives', 5 === count( $recipe['fields'] ?? array() ) );
os_check( 'title is always supported', in_array( 'title', $recipe['supports'] ?? array(), true ) );

$twice = OS_Type_Declaration::normalise( os_fixture() );
os_check( 'normalisation is idempotent', $declaration === $twice );

echo "\nValidation reports, never skips silently\n";

$bad = os_fixture();
$bad['types'][0]['fields'][] = array(
	'key'  => 'layout_row',
	'type' => 'row',
);
$result = OS_Type_Declaration::normalise( $bad );
os_check(
	'a layout type inside fields is an error',
	1 === count( $result['errors'] ) && str_contains( $result['errors'][0], 'Layout belongs in display' ),
	implode( '; ', $result['errors'] )
);
os_check( 'the offending field is not registered', ! isset( $result['types']['recipe']['fields']['layout_row'] ) );

$bad = os_fixture();
$bad['types'][0]['fields'][] = array(
	'key'  => 'mystery',
	'type' => 'wysiwyg',
);
$result = OS_Type_Declaration::normalise( $bad );
os_check( 'an unknown field type is an error', 1 === count( $result['errors'] ) && str_contains( $result['errors'][0], 'unknown type' ) );

$bad = os_fixture();
$bad['types'][0]['key'] = 'a_very_long_type_key_indeed';
$result = OS_Type_Declaration::normalise( $bad );
os_check( 'a key over 20 characters is rejected and reported', array() === $result['types'] && 1 === count( $result['errors'] ) );

$bad             = os_fixture();
$bad['types'][1] = $bad['types'][0];
$result          = OS_Type_Declaration::normalise( $bad );
os_check( 'a duplicate type key is reported', 1 === count( $result['errors'] ) && str_contains( $result['errors'][0], 'more than once' ) );

$bad = os_fixture();
$bad['types'][0]['display']['columns'][] = 'not_a_field';
$result = OS_Type_Declaration::normalise( $bad );
os_check( 'display cannot reference an undeclared field', 1 === count( $result['errors'] ) && str_contains( $result['errors'][0], 'not a declared field' ) );

$bad = os_fixture();
$bad['types'][0]['fields'][4]['to'] = '';
$result = OS_Type_Declaration::normalise( $bad );
os_check( 'a relation with no target is an error', 1 === count( $result['errors'] ) && str_contains( $result['errors'][0], 'no target type' ) );

echo "\nPresentation cannot change data\n";

$without = os_fixture();
unset( $without['types'][0]['display'] );
$stripped = OS_Type_Declaration::normalise( $without );

os_check( 'removing display leaves every field intact', ( $stripped['types']['recipe']['fields'] ?? null ) === $recipe['fields'] );
os_check(
	'removing display does not change the schema hash',
	OS_Type_Declaration::hash( $stripped['types']['recipe'] ) === OS_Type_Declaration::hash( $recipe )
);

$retyped = os_fixture();
$retyped['types'][0]['fields'][0]['type'] = 'number';
$retyped = OS_Type_Declaration::normalise( $retyped );
os_check(
	'retyping a field does change the schema hash',
	OS_Type_Declaration::hash( $retyped['types']['recipe'] ) !== OS_Type_Declaration::hash( $recipe )
);

echo "\nField schema\n";

$servings = OS_Type_Compiler::field_schema( $recipe['fields']['servings'] );
os_check( 'a constraint reaches the schema', 'integer' === $servings['type'] && 1 === $servings['minimum'] );

$course = OS_Type_Compiler::field_schema( $recipe['fields']['course'] );
os_check( 'an enum reaches the schema', array( 'starter', 'main', 'dessert' ) === ( $course['enum'] ?? array() ) );

$published = OS_Type_Compiler::field_schema( $recipe['fields']['published_on'] );
os_check( 'a format reaches the schema', 'date' === ( $published['format'] ?? '' ) );

$tags = OS_Type_Compiler::field_schema( $recipe['fields']['tags'] );
os_check( 'an array field always carries items', 'string' === ( $tags['items']['type'] ?? '' ) );

$relation = OS_Type_Compiler::field_schema( $recipe['fields']['base_recipe'] );
os_check( 'a many relation is an array of integers', 'array' === $relation['type'] && 'integer' === $relation['items']['type'] );

echo "\nMeta registration\n";

$meta = OS_Type_Compiler::meta_args( $recipe['fields']['course'] );
os_check( 'the schema travels under show_in_rest', isset( $meta['show_in_rest']['schema']['enum'] ) );
os_check( 'show_in_rest is not a bare boolean', is_array( $meta['show_in_rest'] ) );
os_check( 'single is set so values read back as scalars', true === $meta['single'] );

$relation_meta = OS_Type_Compiler::meta_args( $recipe['fields']['base_recipe'] );
os_check( 'a many relation stores as an array', 'array' === $relation_meta['type'] );

echo "\nOne declaration, three surfaces\n";

foreach ( OS_Type_Compiler::OPERATIONS as $operation ) {
	$args  = OS_Type_Compiler::rest_args( $recipe, $operation );
	$input = OS_Type_Compiler::ability_input_schema( $recipe, $operation );

	$args_keys  = array_keys( $args );
	$input_keys = array_keys( $input['properties'] );
	sort( $args_keys );
	sort( $input_keys );
	os_check( sprintf( '%s: REST args and ability input accept the same keys', $operation ), $args_keys === $input_keys );

	$mismatched = array();
	foreach ( $args as $key => $schema ) {
		$expected = $schema;
		unset( $expected['required'] );
		if ( $expected !== $input['properties'][ $key ] ) {
			$mismatched[] = $key;
		}
	}
	os_check( sprintf( '%s: both surfaces enforce identical constraints', $operation ), array() === $mismatched, implode( ', ', $mismatched ) );

	$output = OS_Type_Compiler::ability_output_schema( $recipe, $operation );
	os_check( sprintf( '%s: the output schema describes properties', $operation ), array() !== ( $output['properties'] ?? array() ) );
}

echo "\nOperation shapes\n";

$create = OS_Type_Compiler::rest_args( $recipe, 'create' );
$update = OS_Type_Compiler::rest_args( $recipe, 'update' );
os_check( 'a required field is required on create', ! empty( $create['servings']['required'] ) );
os_check( 'the same field is optional on update', empty( $update['servings']['required'] ) );
os_check( 'update requires an id', ! empty( $update['id']['required'] ) );

$list = OS_Type_Compiler::rest_args( $recipe, 'list' );
os_check( 'an indexed field is offered as a filter', isset( $list['course'] ) );
os_check( 'an unindexed field is not offered as a filter', ! isset( $list['published_on'] ) );
os_check( 'list is paginated with a ceiling', 100 === ( $list['per_page']['maximum'] ?? 0 ) );

$input = OS_Type_Compiler::ability_input_schema( $recipe, 'create' );
os_check( 'ability input lists its required keys', in_array( 'servings', $input['required'] ?? array(), true ) );

echo "\nGenerated reference\n";

$reference = OS_Type_Compiler::reference( $declaration, 'content-types/v1' );
os_check( 'every operation is documented', 5 === count( $reference['routes'] ) );
os_check( 'the reference is marked generated', true === $reference['generated'] );

$paths = array();
foreach ( $reference['routes'] as $route ) {
	$paths[ $route['operation'] ] = $route['path'] . ' ' . $route['method'];
	os_check( sprintf( 'route %s carries a response schema', $route['operation'] ), array() !== ( $route['response']['properties'] ?? array() ) );
}
os_check( 'create posts to the collection', '/recipe POST' === $paths['create'] );
os_check( 'delete addresses one record', '/recipe/{id} DELETE' === $paths['delete'] );

$carried = OS_Type_Compiler::reference( $declaration, 'content-types/v1', array( '/settings', '/notifications' ) );
os_check( 'hand-registered routes are carried, not dropped', array( '/settings', '/notifications' ) === $carried['undeclared']['routes'] );
os_check( 'an empty carry list still reports the section', array() === $reference['undeclared']['routes'] );

echo "\nBad input\n";

$broken = OS_Type_Declaration::parse( '{not json' );
os_check( 'invalid JSON reports rather than fatals', array() === $broken['types'] && 1 === count( $broken['errors'] ) );

$missing = OS_Type_Declaration::load( __DIR__ . '/does-not-exist.json' );
os_check( 'a missing declaration reports its path', str_contains( $missing['errors'][0] ?? '', 'does-not-exist.json' ) );

echo "\n{$passed} passed, {$failed} failed\n";
exit( $failed > 0 ? 1 : 0 );
