<?php
/**
 * OS_Code_Abilities — code snippet abilities
 *
 * Per-app ability registrar for OS, extracted from
 * class-abilities.php (issue 797) onto the shared
 * OS_Code_Ability_Base.
 *
 * @package OS
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OS_Code_Abilities extends OS_Code_Ability_Base {

	public static function register_all(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		// === Code snippets (AI-authored code as real files) ============
		//
		// PHP snippets are mini-plugins; an agent can DRAFT runnable code here,
		// materialised to wp-content/os-snippets/<lang>/<slug> and guarded by
		// the mu-plugin circuit breaker. Guardrails: writes need manage_options
		// (executable code), new snippets default to INACTIVE, and activating
		// PHP over MCP is refused unless a human enabled it in Settings — the
		// circuit breaker still auto-disables a snippet that fatals.
		if ( class_exists( 'OS_Code' ) ) {
			$code_cap = static fn() => current_user_can( 'manage_options' );

			self::reg( self::NS . '/code-list', array(
				'label'             => 'List code snippets',
				'description'       => 'List os_code snippets (php/js/css/html) with language, scope, active state, and any circuit-breaker error.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array( 'type' => 'object', 'properties' => array( 'language' => array( 'type' => 'string', 'enum' => array( '', 'php', 'js', 'css', 'html' ), 'default' => '' ) ) ),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'execute_callback'  => array( __CLASS__, 'execute_code_list' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/code-read', array(
				'label'             => 'Read code snippet',
				'description'       => 'Fetch one os_code snippet by id or slug. Returns the code body, language, scope, active state, and last error.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array( 'type' => 'object', 'properties' => array( 'id' => array( 'type' => 'integer' ), 'slug' => array( 'type' => 'string' ) ) ),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'execute_callback'  => array( __CLASS__, 'execute_code_read' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/code-create', array(
				'label'             => 'Create code snippet',
				'description'       => 'Create a php/js/css/html snippet. For PHP, OMIT the opening <?php tag — write the body only. Defaults to INACTIVE: a human (or ci/code-activate) must turn it on. Activating PHP over MCP is blocked unless enabled in Settings. Returns id + slug.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'required'   => array( 'title', 'language', 'code' ),
					'properties' => array(
						'title'    => array( 'type' => 'string' ),
						'language' => array( 'type' => 'string', 'enum' => array( 'php', 'js', 'css', 'html' ) ),
						'code'     => array( 'type' => 'string', 'description' => 'Snippet body. PHP: no opening <?php tag.' ),
						'scope'    => array( 'type' => 'string', 'enum' => array( 'everywhere', 'admin', 'frontend' ), 'default' => 'everywhere' ),
						'priority' => array( 'type' => 'integer', 'default' => 10 ),
						'active'   => array( 'type' => 'boolean', 'default' => false ),
					),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $code_cap,
				'execute_callback'  => array( __CLASS__, 'execute_code_create' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/code-update', array(
				'label'             => 'Update code snippet',
				'description'       => 'Update an existing snippet by id or slug (title / code / scope / priority). Editing re-materialises the file and re-arms the circuit breaker. Does not change active state — use ci/code-activate.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'properties' => array(
						'id'       => array( 'type' => 'integer' ),
						'slug'     => array( 'type' => 'string' ),
						'title'    => array( 'type' => 'string' ),
						'code'     => array( 'type' => 'string' ),
						'scope'    => array( 'type' => 'string', 'enum' => array( 'everywhere', 'admin', 'frontend' ) ),
						'priority' => array( 'type' => 'integer' ),
					),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $code_cap,
				'execute_callback'  => array( __CLASS__, 'execute_code_update' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/code-activate', array(
				'label'             => 'Activate / deactivate code snippet',
				'description'       => 'Turn a snippet on or off. Activating PHP over MCP is refused unless a human enabled it in Settings (returns ok:false with a reason). Deactivating is always allowed.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'required'   => array( 'active' ),
					'properties' => array(
						'id'     => array( 'type' => 'integer' ),
						'slug'   => array( 'type' => 'string' ),
						'active' => array( 'type' => 'boolean' ),
					),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $code_cap,
				'execute_callback'  => array( __CLASS__, 'execute_code_activate' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/code-delete', array(
				'label'             => 'Delete code snippet',
				'description'       => 'Trash a code snippet (recoverable) and remove its materialised file.',
				'category' => OS_Code_Ability_Base::CATEGORY,
				'input_schema'      => array( 'type' => 'object', 'properties' => array( 'id' => array( 'type' => 'integer' ), 'slug' => array( 'type' => 'string' ) ) ),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $code_cap,
				'execute_callback'  => array( __CLASS__, 'execute_code_delete' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );
		}

	}

	private static function code_resolve( $input ): ?\WP_Post {
		$id = (int) ( $input['id'] ?? 0 );
		if ( $id > 0 ) {
			$p = get_post( $id );
			return ( $p && OS_Code::CPT === $p->post_type ) ? $p : null;
		}
		$slug = (string) ( $input['slug'] ?? '' );
		if ( '' === $slug ) {
			return null;
		}
		$p = get_page_by_path( $slug, OBJECT, OS_Code::CPT );
		return $p instanceof \WP_Post ? $p : null;
	}

	private static function code_summary( \WP_Post $p ): array {
		$errs = OS_Code::get_errors();
		return array(
			'id'       => (int) $p->ID,
			'slug'     => (string) $p->post_name,
			'title'    => (string) $p->post_title,
			'language' => (string) ( get_post_meta( $p->ID, OS_Code::META_LANG, true ) ?: 'php' ),
			'scope'    => (string) ( get_post_meta( $p->ID, OS_Code::META_SCOPE, true ) ?: 'everywhere' ),
			'active'   => (bool) get_post_meta( $p->ID, OS_Code::META_ACTIVE, true ),
			'priority' => (int) ( get_post_meta( $p->ID, OS_Code::META_PRIORITY, true ) ?: 10 ),
			'error'    => $errs[ $p->ID ] ?? null,
		);
	}

	public static function execute_code_list( $input ): array {
		$lang  = (string) ( $input['language'] ?? '' );
		$posts = get_posts( array(
			'post_type'      => OS_Code::CPT,
			'posts_per_page' => 200,
			'post_status'    => array( 'publish', 'draft', 'private' ),
			'orderby'        => 'title',
			'order'          => 'ASC',
		) );
		$items = array();
		foreach ( $posts as $p ) {
			$row = self::code_summary( $p );
			if ( '' === $lang || $row['language'] === $lang ) {
				$items[] = $row;
			}
		}
		return array( 'items' => $items );
	}

	public static function execute_code_read( $input ): array {
		$p = self::code_resolve( $input );
		if ( ! $p ) {
			return array( 'found' => false );
		}
		return array( 'found' => true ) + self::code_summary( $p ) + array( 'code' => (string) $p->post_content );
	}

	public static function execute_code_create( $input ): array {
		$title = trim( (string) ( $input['title'] ?? '' ) );
		$lang  = (string) ( $input['language'] ?? '' );
		if ( '' === $title || ! in_array( $lang, OS_Code::LANGS, true ) ) {
			return array( 'ok' => false, 'message' => 'title and a valid language are required' );
		}
		OS_Code::begin_sync_batch();
		try {
			$id = wp_insert_post( array(
				'post_type'    => OS_Code::CPT,
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_content' => (string) ( $input['code'] ?? '' ),
			), true );
			if ( is_wp_error( $id ) ) {
				return array( 'ok' => false, 'message' => $id->get_error_message() );
			}
			update_post_meta( $id, OS_Code::META_LANG, $lang );
			update_post_meta( $id, OS_Code::META_SCOPE, in_array( ( $input['scope'] ?? '' ), array( 'everywhere', 'admin', 'frontend' ), true ) ? $input['scope'] : 'everywhere' );
			update_post_meta( $id, OS_Code::META_PRIORITY, (int) ( $input['priority'] ?? 10 ) );
			OS_Code::sync_post( (int) $id );
			$out = array( 'ok' => true, 'id' => (int) $id, 'slug' => get_post( $id )->post_name, 'active' => false );
			if ( ! empty( $input['active'] ) ) {
				$r = OS_Code::set_active( (int) $id, true, 'mcp' );
				if ( is_wp_error( $r ) ) {
					$out['active']             = false;
					$out['activation_blocked'] = $r->get_error_message();
				} else {
					$out['active'] = true;
				}
			}
			return $out;
		} finally {
			OS_Code::end_sync_batch();
		}
	}

	public static function execute_code_update( $input ): array {
		$p = self::code_resolve( $input );
		if ( ! $p ) {
			return array( 'ok' => false, 'message' => 'snippet not found' );
		}
		OS_Code::begin_sync_batch();
		try {
			$args = array( 'ID' => $p->ID );
			if ( array_key_exists( 'title', $input ) ) {
				$args['post_title'] = (string) $input['title'];
			}
			if ( array_key_exists( 'code', $input ) ) {
				$args['post_content'] = (string) $input['code'];
			}
			$res = wp_update_post( $args, true );
			if ( is_wp_error( $res ) ) {
				return array( 'ok' => false, 'message' => $res->get_error_message() );
			}
			if ( array_key_exists( 'scope', $input ) && in_array( $input['scope'], array( 'everywhere', 'admin', 'frontend' ), true ) ) {
				update_post_meta( $p->ID, OS_Code::META_SCOPE, $input['scope'] );
			}
			if ( array_key_exists( 'priority', $input ) ) {
				update_post_meta( $p->ID, OS_Code::META_PRIORITY, (int) $input['priority'] );
			}
			OS_Code::sync_post( (int) $p->ID );
			return array( 'ok' => true, 'id' => (int) $p->ID, 'slug' => (string) $p->post_name );
		} finally {
			OS_Code::end_sync_batch();
		}
	}

	public static function execute_code_activate( $input ): array {
		$p = self::code_resolve( $input );
		if ( ! $p ) {
			return array( 'ok' => false, 'message' => 'snippet not found' );
		}
		$active = (bool) ( $input['active'] ?? false );
		$r = OS_Code::set_active( (int) $p->ID, $active, 'mcp' );
		if ( is_wp_error( $r ) ) {
			return array( 'ok' => false, 'message' => $r->get_error_message() );
		}
		return array( 'ok' => true, 'id' => (int) $p->ID, 'active' => $active );
	}

	public static function execute_code_delete( $input ): array {
		$p = self::code_resolve( $input );
		if ( ! $p ) {
			return array( 'ok' => false, 'message' => 'snippet not found' );
		}
		wp_trash_post( $p->ID );
		return array( 'ok' => true, 'id' => (int) $p->ID, 'status' => 'trash' );
	}

	// --- Tracker (Projects → Issues) ---------------------------------

}
