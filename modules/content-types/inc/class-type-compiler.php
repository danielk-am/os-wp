<?php
/**
 * Compile a normalised declaration into every surface a type owns.
 *
 * One declaration in, four projections out: the post type, its typed meta, the
 * REST argument schemas, and the ability input and output schemas. The REST
 * layer and the MCP layer are generated from the same field schema here, which
 * is the only way they can be prevented from drifting.
 *
 * See docs/contracts/TYPE-SCHEMA.md.
 *
 * @package OS_Content_Types
 */

defined( 'ABSPATH' ) || exit;

final class OS_Type_Compiler {

	/** Operations every declared type exposes. */
	const OPERATIONS = array( 'list', 'read', 'create', 'update', 'delete' );

	/**
	 * JSON Schema for one declared field.
	 *
	 * This is the single source every other projection derives from.
	 *
	 * @param array $field Normalised field.
	 * @return array
	 */
	public static function field_schema( array $field ): array {
		$type = (string) $field['type'];

		if ( 'relation' === $type ) {
			$schema = 'many' === ( $field['cardinality'] ?? 'one' )
				? array(
					'type'  => 'array',
					'items' => array( 'type' => 'integer' ),
				)
				: array( 'type' => 'integer' );
			$schema['description'] = sprintf( 'Reference to %s.', (string) $field['to'] );
			return $schema;
		}

		$schema = array( 'type' => $type );
		foreach ( array( 'format', 'pattern', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'items', 'default', 'description' ) as $keyword ) {
			if ( isset( $field[ $keyword ] ) ) {
				$schema[ $keyword ] = $field[ $keyword ];
			}
		}
		if ( 'array' === $type && ! isset( $schema['items'] ) ) {
			// Core rejects array meta in REST without an items schema, so this
			// is a correctness requirement rather than a nicety.
			$schema['items'] = array( 'type' => 'string' );
		}
		return $schema;
	}

	/**
	 * The primitive `type` register_post_meta stores under.
	 *
	 * @param array $field Normalised field.
	 * @return string
	 */
	public static function meta_primitive( array $field ): string {
		if ( 'relation' === $field['type'] ) {
			return 'many' === ( $field['cardinality'] ?? 'one' ) ? 'array' : 'integer';
		}
		return (string) $field['type'];
	}

	/**
	 * Arguments for register_post_type().
	 *
	 * @param array $type Normalised type.
	 * @return array
	 */
	public static function post_type_args( array $type ): array {
		$singular = (string) $type['singular'];
		$plural   = (string) $type['plural'];
		$supports = $type['supports'];
		if ( $type['hierarchical'] && ! in_array( 'page-attributes', $supports, true ) ) {
			$supports[] = 'page-attributes';
		}
		return array(
			'label'           => $plural,
			'labels'          => array(
				'name'          => $plural,
				'singular_name' => $singular,
				'menu_name'     => $plural,
				'add_new_item'  => 'Add new ' . strtolower( $singular ),
				'edit_item'     => 'Edit ' . strtolower( $singular ),
				'new_item'      => 'New ' . strtolower( $singular ),
				'view_item'     => 'View ' . strtolower( $singular ),
				'search_items'  => 'Search ' . strtolower( $plural ),
			),
			'public'          => false,
			'show_ui'         => true,
			'show_in_menu'    => false,
			'show_in_rest'    => true,
			'rest_base'       => (string) $type['key'],
			'rest_namespace'  => 'wp/v2',
			'hierarchical'    => (bool) $type['hierarchical'],
			'has_archive'     => false,
			'rewrite'         => false,
			'capability_type' => 'page',
			'supports'        => $supports,
		);
	}

	/**
	 * Arguments for register_post_meta(), carrying the full schema.
	 *
	 * The schema travels under show_in_rest, so core validates at the REST
	 * boundary and no custom controller is needed to enforce it.
	 *
	 * @param array $field Normalised field.
	 * @return array
	 */
	public static function meta_args( array $field ): array {
		$schema = self::field_schema( $field );
		$args   = array(
			'type'         => self::meta_primitive( $field ),
			'single'       => true,
			'label'        => (string) $field['label'],
			'show_in_rest' => array( 'schema' => $schema ),
		);
		if ( isset( $field['default'] ) ) {
			$args['default'] = $field['default'];
		}
		return $args;
	}

	/**
	 * REST `args` for one operation on a type.
	 *
	 * WordPress validates REST args against the same JSON Schema keywords, so
	 * this is a direct projection rather than a translation.
	 *
	 * @param array  $type      Normalised type.
	 * @param string $operation One of OPERATIONS.
	 * @return array
	 */
	public static function rest_args( array $type, string $operation ): array {
		$args = array();

		if ( in_array( $operation, array( 'read', 'update', 'delete' ), true ) ) {
			$args['id'] = array(
				'type'        => 'integer',
				'required'    => true,
				'minimum'     => 1,
				'description' => 'Record id.',
			);
		}

		if ( 'list' === $operation ) {
			$args['search']   = array(
				'type'        => 'string',
				'description' => 'Free text search.',
			);
			$args['page']     = array(
				'type'    => 'integer',
				'minimum' => 1,
				'default' => 1,
			);
			$args['per_page'] = array(
				'type'    => 'integer',
				'minimum' => 1,
				'maximum' => 100,
				'default' => 20,
			);
			// Only indexed fields are offered as filters. An unindexed filter
			// would scan postmeta, so it is not exposed at all.
			foreach ( $type['fields'] as $field ) {
				if ( ! empty( $field['index'] ) ) {
					$args[ $field['key'] ] = self::field_schema( $field );
				}
			}
			return $args;
		}

		if ( in_array( $operation, array( 'create', 'update' ), true ) ) {
			if ( in_array( 'title', $type['supports'], true ) ) {
				$args['title'] = array(
					'type'     => 'string',
					'required' => 'create' === $operation,
				);
			}
			if ( in_array( 'editor', $type['supports'], true ) ) {
				$args['content'] = array( 'type' => 'string' );
			}
			foreach ( $type['fields'] as $field ) {
				$schema = self::field_schema( $field );
				// A field required on create is optional on update, because an
				// update is a patch and must not force a full record.
				if ( ! empty( $field['required'] ) && 'create' === $operation ) {
					$schema['required'] = true;
				}
				$args[ $field['key'] ] = $schema;
			}
		}

		return $args;
	}

	/**
	 * Ability input schema for one operation.
	 *
	 * Derived from rest_args so the agent surface and the API surface accept
	 * exactly the same input.
	 *
	 * @param array  $type      Normalised type.
	 * @param string $operation One of OPERATIONS.
	 * @return array
	 */
	public static function ability_input_schema( array $type, string $operation ): array {
		$properties = array();
		$required   = array();
		foreach ( self::rest_args( $type, $operation ) as $key => $schema ) {
			if ( ! empty( $schema['required'] ) ) {
				$required[] = $key;
			}
			unset( $schema['required'] );
			$properties[ $key ] = $schema;
		}
		$input = array(
			'type'       => 'object',
			'properties' => $properties,
		);
		if ( array() !== $required ) {
			$input['required'] = $required;
		}
		return $input;
	}

	/**
	 * The record shape a type returns.
	 *
	 * @param array $type Normalised type.
	 * @return array
	 */
	public static function record_schema( array $type ): array {
		$properties = array(
			'id'     => array( 'type' => 'integer' ),
			'status' => array( 'type' => 'string' ),
		);
		if ( in_array( 'title', $type['supports'], true ) ) {
			$properties['title'] = array( 'type' => 'string' );
		}
		if ( in_array( 'editor', $type['supports'], true ) ) {
			$properties['content'] = array( 'type' => 'string' );
		}
		foreach ( $type['fields'] as $field ) {
			$properties[ $field['key'] ] = self::field_schema( $field );
		}
		return array(
			'type'       => 'object',
			'properties' => $properties,
		);
	}

	/**
	 * Ability output schema for one operation.
	 *
	 * Replaces the untyped `array( 'type' => 'object' )` stub, which described
	 * nothing an agent could plan against.
	 *
	 * @param array  $type      Normalised type.
	 * @param string $operation One of OPERATIONS.
	 * @return array
	 */
	public static function ability_output_schema( array $type, string $operation ): array {
		if ( 'list' === $operation ) {
			return array(
				'type'       => 'object',
				'properties' => array(
					'items' => array(
						'type'  => 'array',
						'items' => self::record_schema( $type ),
					),
					'total' => array( 'type' => 'integer' ),
				),
			);
		}
		if ( 'delete' === $operation ) {
			return array(
				'type'       => 'object',
				'properties' => array(
					'id'      => array( 'type' => 'integer' ),
					'deleted' => array( 'type' => 'boolean' ),
				),
			);
		}
		return self::record_schema( $type );
	}

	/**
	 * The generated API reference for a whole declaration.
	 *
	 * This replaces the hand-maintained route-name list. It is generated, so it
	 * cannot describe a route that is not registered from the same declaration.
	 *
	 * Routes the module still registers by hand are carried through under
	 * `undeclared`, so the reference stays complete and the remaining work stays
	 * visible instead of disappearing from the file.
	 *
	 * @param array  $declaration Normalised declaration.
	 * @param string $namespace   REST namespace.
	 * @param array  $undeclared  Route paths with no declaration behind them.
	 * @return array
	 */
	public static function reference( array $declaration, string $namespace, array $undeclared = array() ): array {
		$routes = array();
		foreach ( $declaration['types'] as $key => $type ) {
			foreach ( self::OPERATIONS as $operation ) {
				$routes[] = array(
					'path'      => self::path( $key, $operation ),
					'method'    => self::method( $operation ),
					'operation' => $operation,
					'type'      => $key,
					'ability'   => sprintf( 'content-types/%s-%s', $key, $operation ),
					'args'      => self::rest_args( $type, $operation ),
					'response'  => self::ability_output_schema( $type, $operation ),
				);
			}
		}
		return array(
			'namespace'  => $namespace,
			'generated'  => true,
			'source'     => 'types.json',
			'note'       => 'Generated by OS_Type_Compiler::reference(). Do not edit by hand.',
			'routes'     => $routes,
			'undeclared' => array(
				'note'   => 'Registered by hand in module.php, with no declaration and no argument schema. Each one is outstanding work.',
				'routes' => array_values( $undeclared ),
			),
		);
	}

	/**
	 * Route path for an operation.
	 *
	 * @param string $key       Type key.
	 * @param string $operation Operation.
	 * @return string
	 */
	public static function path( string $key, string $operation ): string {
		return in_array( $operation, array( 'list', 'create' ), true )
			? sprintf( '/%s', $key )
			: sprintf( '/%s/{id}', $key );
	}

	/**
	 * HTTP method for an operation.
	 *
	 * @param string $operation Operation.
	 * @return string
	 */
	public static function method( string $operation ): string {
		switch ( $operation ) {
			case 'create':
				return 'POST';
			case 'update':
				return 'PUT';
			case 'delete':
				return 'DELETE';
			default:
				return 'GET';
		}
	}
}
