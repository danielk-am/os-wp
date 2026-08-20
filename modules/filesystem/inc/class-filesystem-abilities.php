<?php
/**
 * WP_Filesystem_Abilities — filesystem (read-only) abilities
 *
 * Per-app ability registrar for OS, extracted from
 * class-abilities.php (issue 797) onto the shared
 * WP_Filesystem_Ability_Base.
 *
 * @package OS
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WP_Filesystem_Abilities extends WP_Filesystem_Ability_Base {

	public static function register_all(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		// === Filesystem (read-only over MCP, + one bounded cleanup) =====
		//
		// Disk introspection for agents: list a jailed root, read a text
		// file, search by name/content. Gated at `manage_options` (stricter
		// than can_read) because the filesystem is sensitive. General writes +
		// the command console are deliberately NOT abilities — they stay
		// REST-only, behind the admin UI. The ONE mutating exception is
		// fs-clean-md-twins: it deletes only stale .md files that have a .llm
		// sibling (never a .llm, never a .md without one) and is dry-run by
		// default, so its blast radius is a build artifact, not arbitrary
		// disk. Only registered when the Filesystem module is present.
		if ( class_exists( 'WP_Filesystem' ) ) {
			$fs_can = static fn() => current_user_can( 'manage_options' );

			self::reg( self::NS . '/fs-roots', array(
				'label'             => 'List filesystem roots',
				'description'       => 'List the admin-configured filesystem roots the Files browser is jailed to. Each root has an id (used by fs-list / fs-read / fs-search), a label, and a path. Start here before reading the disk.',
				'category' => WP_Filesystem_Ability_Base::CATEGORY,
				'input_schema'      => array( 'type' => 'object', 'properties' => new stdClass() ),
				'output_schema'     => array(
					'type'       => 'object',
					'properties' => array(
						'roots' => array(
							'type'  => 'array',
							'items' => array(
								'type'       => 'object',
								'properties' => array(
									'id'       => array( 'type' => 'string' ),
									'label'    => array( 'type' => 'string' ),
									'path'     => array( 'type' => 'string' ),
									'exists'   => array( 'type' => 'boolean' ),
									'writable' => array( 'type' => 'boolean' ),
								),
							),
						),
					),
				),
				'permission_callback' => $fs_can,
				'execute_callback'  => array( __CLASS__, 'execute_fs_roots' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/fs-list', array(
				'label'             => 'List a directory',
				'description'       => 'List the entries of one directory under a filesystem root. `root` is a root id from fs-roots; `path` is a relative path inside it (empty = the root itself). Access is jailed to the root — paths that escape it are rejected. Returns name/type/size/mtime/perms per entry.',
				'category' => WP_Filesystem_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'properties' => array(
						'root' => array( 'type' => 'string', 'description' => 'Root id (from fs-roots).' ),
						'path' => array( 'type' => 'string', 'default' => '', 'description' => 'Relative path inside the root.' ),
					),
					'required'   => array( 'root' ),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $fs_can,
				'execute_callback'  => array( __CLASS__, 'execute_fs_list' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/fs-read', array(
				'label'             => 'Read a file',
				'description'       => 'Read a text file under a filesystem root. Returns the content for text files; for binaries or files larger than 2 MiB it returns a flag instead of bytes (download via the admin UI). Jailed to the root.',
				'category' => WP_Filesystem_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'properties' => array(
						'root' => array( 'type' => 'string', 'description' => 'Root id (from fs-roots).' ),
						'path' => array( 'type' => 'string', 'description' => 'Relative path of the file inside the root.' ),
					),
					'required'   => array( 'root', 'path' ),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $fs_can,
				'execute_callback'  => array( __CLASS__, 'execute_fs_read' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/fs-search', array(
				'label'             => 'Search files',
				'description'       => 'Recursively search under a filesystem root for files/dirs whose NAME matches the query; set content=true to also grep text-file CONTENT. Bounded (caps files scanned + results). Jailed to the root.',
				'category' => WP_Filesystem_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'properties' => array(
						'root'    => array( 'type' => 'string', 'description' => 'Root id (from fs-roots).' ),
						'query'   => array( 'type' => 'string', 'description' => 'Substring to match (case-insensitive).' ),
						'path'    => array( 'type' => 'string', 'default' => '', 'description' => 'Relative sub-path to search within.' ),
						'content' => array( 'type' => 'boolean', 'default' => false, 'description' => 'Also search inside text files.' ),
						'limit'   => array( 'type' => 'integer', 'default' => 100, 'minimum' => 1, 'maximum' => 500 ),
					),
					'required'   => array( 'root', 'query' ),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $fs_can,
				'execute_callback'  => array( __CLASS__, 'execute_fs_search' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );

			self::reg( self::NS . '/fs-clean-md-twins', array(
				'label'             => 'Clean stale .md twins',
				'description'       => 'Remove stale compiled .md files under a filesystem root. A .md is stale ONLY when a .llm source sits beside it: same-basename (foo.md from foo.llm) or a skill entry point (SKILL.md from the dir\'s <name>.llm). .llm is authored-and-served, so these .md are build leftovers. Never deletes a .llm, and never a .md that has no .llm sibling. Dry-run by default (lists twins); set apply=true to delete. Jailed to the root; skips hidden dirs (.trash, .pre-unification-old) unless include_hidden=true.',
				'category' => WP_Filesystem_Ability_Base::CATEGORY,
				'input_schema'      => array(
					'type'       => 'object',
					'properties' => array(
						'root'           => array( 'type' => 'string', 'description' => 'Root id (from fs-roots).' ),
						'path'           => array( 'type' => 'string', 'default' => '', 'description' => 'Relative sub-path to clean within.' ),
						'apply'          => array( 'type' => 'boolean', 'default' => false, 'description' => 'false = dry run (list twins only); true = delete them.' ),
						'include_hidden' => array( 'type' => 'boolean', 'default' => false, 'description' => 'Also clean hidden dirs (.trash, .pre-unification-old, ...).' ),
						'limit'          => array( 'type' => 'integer', 'default' => 5000, 'minimum' => 1, 'maximum' => 20000 ),
					),
					'required'   => array( 'root' ),
				),
				'output_schema'     => array( 'type' => 'object' ),
				'permission_callback' => $fs_can,
				'execute_callback'  => array( __CLASS__, 'execute_fs_clean_md_twins' ),
				'meta'              => array( 'mcp' => array( 'public' => true ) ),
			) );
		}
	}

	public static function execute_fs_roots( $input ): array {
		if ( ! class_exists( 'WP_Filesystem' ) ) {
			return array( 'roots' => array() );
		}
		$out = array();
		foreach ( WP_Filesystem::get_roots() as $root ) {
			$real  = realpath( $root['path'] );
			$out[] = array(
				'id'       => $root['id'],
				'label'    => $root['label'],
				'path'     => $root['path'],
				'exists'   => ( false !== $real && is_dir( $real ) ),
				'writable' => ( false !== $real && wp_is_writable( $real ) ),
			);
		}
		return array( 'roots' => $out );
	}

	public static function execute_fs_list( $input ): array {
		if ( ! class_exists( 'WP_Filesystem' ) ) {
			return array( 'error' => 'filesystem_unavailable' );
		}
		$res = WP_Filesystem::list_dir(
			(string) ( $input['root'] ?? '' ),
			(string) ( $input['path'] ?? '' )
		);
		return is_wp_error( $res ) ? array( 'error' => $res->get_error_message() ) : $res;
	}

	public static function execute_fs_read( $input ): array {
		if ( ! class_exists( 'WP_Filesystem' ) ) {
			return array( 'error' => 'filesystem_unavailable' );
		}
		$res = WP_Filesystem::read_file(
			(string) ( $input['root'] ?? '' ),
			(string) ( $input['path'] ?? '' )
		);
		return is_wp_error( $res ) ? array( 'error' => $res->get_error_message() ) : $res;
	}

	public static function execute_fs_search( $input ): array {
		if ( ! class_exists( 'WP_Filesystem' ) ) {
			return array( 'error' => 'filesystem_unavailable' );
		}
		$res = WP_Filesystem::search(
			(string) ( $input['root'] ?? '' ),
			(string) ( $input['path'] ?? '' ),
			(string) ( $input['query'] ?? '' ),
			! empty( $input['content'] ),
			(int) ( $input['limit'] ?? 100 )
		);
		return is_wp_error( $res ) ? array( 'error' => $res->get_error_message() ) : $res;
	}

	public static function execute_fs_clean_md_twins( $input ): array {
		if ( ! class_exists( 'WP_Filesystem' ) ) {
			return array( 'error' => 'filesystem_unavailable' );
		}
		$res = WP_Filesystem::clean_md_twins(
			(string) ( $input['root'] ?? '' ),
			(string) ( $input['path'] ?? '' ),
			! empty( $input['apply'] ),
			! empty( $input['include_hidden'] ),
			(int) ( $input['limit'] ?? 5000 )
		);
		return is_wp_error( $res ) ? array( 'error' => $res->get_error_message() ) : $res;
	}

}
