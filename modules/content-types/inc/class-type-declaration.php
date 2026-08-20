<?php
/**
 * Load, validate, and normalise a `types.json` declaration.
 *
 * The declaration is the source of truth. Everything the compiler emits is a
 * projection of what this class returns. See docs/contracts/TYPE-SCHEMA.md.
 *
 * Validation never throws and never skips silently. A type that fails is left
 * out of `types` and recorded in `errors`, so the caller can report it.
 *
 * @package OS_Content_Types
 */

defined( 'ABSPATH' ) || exit;

final class OS_Type_Declaration {

	/** Field `type` values a declaration may use. */
	const FIELD_TYPES = array( 'string', 'integer', 'number', 'boolean', 'array', 'object', 'relation' );

	/**
	 * Words that describe layout, not data.
	 *
	 * These are the entries `register_dynamic_meta()` skips by name today. In a
	 * declaration they are a hard error: presentation belongs in `display`.
	 */
	const LAYOUT_WORDS = array( 'section', 'row', 'group', 'stack', 'tab', 'heading', 'notice', 'content' );

	/** WordPress caps post type keys at 20 characters. */
	const MAX_KEY_LENGTH = 20;

	/**
	 * Read a declaration file.
	 *
	 * @param string $path Absolute path to types.json.
	 * @return array{version:int,types:array,errors:array}
	 */
	public static function load( string $path ): array {
		if ( ! is_readable( $path ) ) {
			return self::empty( array( sprintf( 'Declaration not readable: %s', $path ) ) );
		}
		$raw = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false === $raw ) {
			return self::empty( array( sprintf( 'Declaration could not be read: %s', $path ) ) );
		}
		return self::parse( $raw );
	}

	/**
	 * Parse and validate declaration JSON.
	 *
	 * @param string $raw JSON source.
	 * @return array{version:int,types:array,errors:array}
	 */
	public static function parse( string $raw ): array {
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return self::empty( array( 'Declaration is not valid JSON.' ) );
		}
		return self::normalise( $decoded );
	}

	/**
	 * Normalise a decoded declaration into the shape the compiler consumes.
	 *
	 * @param array $decoded Decoded declaration.
	 * @return array{version:int,types:array,errors:array}
	 */
	public static function normalise( array $decoded ): array {
		$errors = array();
		$types  = array();
		$seen   = array();

		foreach ( (array) ( $decoded['types'] ?? array() ) as $index => $type ) {
			if ( ! is_array( $type ) ) {
				$errors[] = sprintf( 'Type at position %s is not an object.', (string) $index );
				continue;
			}
			$key = self::key( (string) ( $type['key'] ?? '' ) );
			if ( '' === $key ) {
				$errors[] = sprintf( 'Type at position %s has no usable key.', (string) $index );
				continue;
			}
			if ( strlen( $key ) > self::MAX_KEY_LENGTH ) {
				$errors[] = sprintf( 'Type "%s" exceeds the %d character key limit.', $key, self::MAX_KEY_LENGTH );
				continue;
			}
			if ( isset( $seen[ $key ] ) ) {
				$errors[] = sprintf( 'Type "%s" is declared more than once.', $key );
				continue;
			}
			$seen[ $key ] = true;

			$fields = self::fields( $key, (array) ( $type['fields'] ?? array() ), $errors );
			$types[ $key ] = array(
				'key'          => $key,
				'singular'     => self::text( $type['singular'] ?? $key ),
				'plural'       => self::text( $type['plural'] ?? ( $type['singular'] ?? $key ) ),
				'icon'         => self::text( $type['icon'] ?? '' ),
				'hierarchical' => ! empty( $type['hierarchical'] ),
				'supports'     => self::supports( $type['supports'] ?? null ),
				'fields'       => $fields,
				'rules'        => self::rules( (array) ( $type['rules'] ?? array() ) ),
				'display'      => self::display( $key, (array) ( $type['display'] ?? array() ), $fields, $errors ),
			);
		}

		return array(
			'version' => (int) ( $decoded['version'] ?? 1 ),
			'types'   => $types,
			'errors'  => $errors,
		);
	}

	/**
	 * Validate and normalise one type's data fields.
	 *
	 * @param string $type_key Owning type key.
	 * @param array  $raw      Raw field list.
	 * @param array  $errors   Error accumulator, by reference.
	 * @return array<string,array>
	 */
	private static function fields( string $type_key, array $raw, array &$errors ): array {
		$fields = array();
		foreach ( $raw as $index => $field ) {
			if ( ! is_array( $field ) ) {
				$errors[] = sprintf( '%s: field at position %s is not an object.', $type_key, (string) $index );
				continue;
			}
			$key = self::key( (string) ( $field['key'] ?? '' ) );
			if ( '' === $key ) {
				$errors[] = sprintf( '%s: field at position %s has no usable key.', $type_key, (string) $index );
				continue;
			}
			if ( isset( $fields[ $key ] ) ) {
				$errors[] = sprintf( '%s: field "%s" is declared more than once.', $type_key, $key );
				continue;
			}
			$field_type = self::text( $field['type'] ?? '' );
			if ( in_array( $field_type, self::LAYOUT_WORDS, true ) ) {
				$errors[] = sprintf( '%s: field "%s" uses layout type "%s". Layout belongs in display.', $type_key, $key, $field_type );
				continue;
			}
			if ( ! in_array( $field_type, self::FIELD_TYPES, true ) ) {
				$errors[] = sprintf( '%s: field "%s" has unknown type "%s".', $type_key, $key, $field_type );
				continue;
			}
			if ( 'relation' === $field_type ) {
				$target = self::key( (string) ( $field['to'] ?? '' ) );
				if ( '' === $target ) {
					$errors[] = sprintf( '%s: relation field "%s" has no target type.', $type_key, $key );
					continue;
				}
			}
			$fields[ $key ] = self::field( $key, $field_type, $field );
		}
		return $fields;
	}

	/**
	 * Normalise one validated field.
	 *
	 * @param string $key        Field key.
	 * @param string $field_type Validated field type.
	 * @param array  $raw        Raw field.
	 * @return array
	 */
	private static function field( string $key, string $field_type, array $raw ): array {
		$field = array(
			'key'      => $key,
			'type'     => $field_type,
			'label'    => self::text( $raw['label'] ?? ucwords( str_replace( '_', ' ', $key ) ) ),
			'required' => ! empty( $raw['required'] ),
			'index'    => ! empty( $raw['index'] ),
		);
		foreach ( array( 'format', 'pattern', 'description' ) as $keyword ) {
			if ( isset( $raw[ $keyword ] ) && '' !== self::text( $raw[ $keyword ] ) ) {
				$field[ $keyword ] = self::text( $raw[ $keyword ] );
			}
		}
		foreach ( array( 'minimum', 'maximum', 'minLength', 'maxLength' ) as $keyword ) {
			if ( isset( $raw[ $keyword ] ) && is_numeric( $raw[ $keyword ] ) ) {
				$field[ $keyword ] = 0 + $raw[ $keyword ];
			}
		}
		if ( isset( $raw['enum'] ) && is_array( $raw['enum'] ) && array() !== $raw['enum'] ) {
			$field['enum'] = array_values( $raw['enum'] );
		}
		if ( isset( $raw['default'] ) ) {
			$field['default'] = $raw['default'];
		}
		if ( 'array' === $field_type ) {
			$items          = is_array( $raw['items'] ?? null ) ? $raw['items'] : array( 'type' => 'string' );
			$item_type      = self::text( $items['type'] ?? 'string' );
			$field['items'] = array( 'type' => in_array( $item_type, self::FIELD_TYPES, true ) ? $item_type : 'string' );
		}
		if ( 'relation' === $field_type ) {
			$field['to']          = self::key( (string) ( $raw['to'] ?? '' ) );
			$field['cardinality'] = 'many' === self::text( $raw['cardinality'] ?? 'one' ) ? 'many' : 'one';
		}
		return $field;
	}

	/**
	 * Normalise the display block, checking every reference resolves.
	 *
	 * Display never defines a field. It only names one that already exists, so
	 * an unknown reference is an error rather than an implicit declaration.
	 *
	 * @param string $type_key Owning type key.
	 * @param array  $raw      Raw display block.
	 * @param array  $fields   Normalised fields.
	 * @param array  $errors   Error accumulator, by reference.
	 * @return array{columns:array,form:array}
	 */
	private static function display( string $type_key, array $raw, array $fields, array &$errors ): array {
		$columns = array();
		foreach ( (array) ( $raw['columns'] ?? array() ) as $column ) {
			$column = self::key( (string) $column );
			if ( 'title' === $column || isset( $fields[ $column ] ) ) {
				$columns[] = $column;
				continue;
			}
			if ( '' !== $column ) {
				$errors[] = sprintf( '%s: display column "%s" is not a declared field.', $type_key, $column );
			}
		}
		$form = array();
		foreach ( (array) ( $raw['form'] ?? array() ) as $section ) {
			if ( ! is_array( $section ) ) {
				continue;
			}
			$keys = array();
			foreach ( (array) ( $section['fields'] ?? array() ) as $field_key ) {
				$field_key = self::key( (string) $field_key );
				if ( isset( $fields[ $field_key ] ) ) {
					$keys[] = $field_key;
					continue;
				}
				if ( '' !== $field_key ) {
					$errors[] = sprintf( '%s: form references "%s", which is not a declared field.', $type_key, $field_key );
				}
			}
			$form[] = array(
				'section' => self::text( $section['section'] ?? '' ),
				'fields'  => $keys,
			);
		}
		return array(
			'columns' => $columns,
			'form'    => $form,
		);
	}

	/**
	 * Keep the rules block verbatim.
	 *
	 * Rules are parsed but not applied. Until the record-rule decision lands,
	 * capabilities remain the only enforcement, and carrying the block through
	 * unchanged means a declaration written today stays valid afterwards.
	 *
	 * @param array $raw Raw rules block.
	 * @return array<string,string>
	 */
	private static function rules( array $raw ): array {
		$rules = array();
		foreach ( array( 'list', 'view', 'create', 'update', 'delete' ) as $action ) {
			if ( isset( $raw[ $action ] ) && '' !== self::text( $raw[ $action ] ) ) {
				$rules[ $action ] = self::text( $raw[ $action ] );
			}
		}
		return $rules;
	}

	/**
	 * Normalise the supports list, always keeping title.
	 *
	 * @param mixed $raw Raw supports value.
	 * @return array<int,string>
	 */
	private static function supports( $raw ): array {
		$allowed  = array( 'title', 'editor', 'excerpt', 'author', 'revisions', 'custom-fields', 'autosave', 'thumbnail', 'page-attributes' );
		$supports = array( 'title' );
		foreach ( (array) ( is_array( $raw ) ? $raw : array() ) as $support ) {
			$support = self::text( $support );
			if ( in_array( $support, $allowed, true ) && ! in_array( $support, $supports, true ) ) {
				$supports[] = $support;
			}
		}
		return $supports;
	}

	/**
	 * Stable hash of a normalised type, for migration diffing.
	 *
	 * Display is excluded on purpose. Presentation cannot change data, so a
	 * display edit must not read as a schema change.
	 *
	 * @param array $type Normalised type.
	 * @return string
	 */
	public static function hash( array $type ): string {
		$subject = $type;
		unset( $subject['display'] );
		return hash( 'sha256', (string) wp_json_encode( $subject ) );
	}

	/**
	 * Empty result carrying errors.
	 *
	 * @param array $errors Errors.
	 * @return array{version:int,types:array,errors:array}
	 */
	private static function empty( array $errors ): array {
		return array(
			'version' => 1,
			'types'   => array(),
			'errors'  => $errors,
		);
	}

	/**
	 * Sanitise an identifier.
	 *
	 * @param string $value Raw value.
	 * @return string
	 */
	private static function key( string $value ): string {
		return function_exists( 'sanitize_key' ) ? sanitize_key( $value ) : strtolower( preg_replace( '/[^a-z0-9_\-]/i', '', $value ) );
	}

	/**
	 * Cast a scalar to a trimmed string.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	private static function text( $value ): string {
		return is_scalar( $value ) ? trim( (string) $value ) : '';
	}
}
