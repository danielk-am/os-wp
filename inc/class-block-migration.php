<?php
/**
 * Rewrite `core-index/*` block delimiters in stored post content to `os/*`.
 *
 * Block names live inside `post_content` as HTML comments, so renaming a block
 * is a data migration in the same sense as renaming a post type. Every post
 * holding `<!-- wp:core-index/task -->` renders as a broken block until the
 * stored delimiter moves with the registration.
 *
 * The rewrite is exact and idempotent. It only ever touches the five delimiter
 * forms Gutenberg writes, never free text, so a post that merely mentions the
 * old name in prose is left alone.
 *
 * See docs/contracts/DATA-INVENTORY.md.
 *
 * @package OS
 */

defined( 'ABSPATH' ) || exit;

final class OS_Block_Migration {

	/** Bumped when the rewrite changes; the migration reruns on a bump. */
	const VERSION = 1;

	/** Records the version already applied on this site. */
	const STATE_OPTION = 'os_block_migration';

	/** Blocks that moved from the core-index namespace to os. */
	const BLOCKS = array( 'task', 'wiki', 'csv', 'checklist', 'site-editor-embed' );

	/** Posts rewritten per batch. */
	const BATCH = 100;

	/**
	 * Hook the migration up.
	 *
	 * It runs at `init` priority 1, ahead of block registration at 10 and of
	 * anything that renders, so no request can serve content whose delimiters
	 * disagree with what is registered.
	 */
	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'maybe_run' ), 1 );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command(
				'os block-migration',
				static function ( $args, $assoc ) {
					$result = self::run( ! empty( $assoc['dry-run'] ) );
					\WP_CLI::log( sprintf( 'scanned %d, rewritten %d, replacements %d', $result['scanned'], $result['rewritten'], $result['replacements'] ) );
					if ( array() !== $result['failed'] ) {
						\WP_CLI::warning( 'failed to verify: ' . implode( ', ', $result['failed'] ) );
					}
					\WP_CLI::success( ! empty( $assoc['dry-run'] ) ? 'dry run complete' : 'migration complete' );
				}
			);
		}
	}

	/**
	 * Run once per version, then stay out of the way.
	 */
	public static function maybe_run(): void {
		if ( (int) get_option( self::STATE_OPTION, 0 ) >= self::VERSION ) {
			return;
		}
		$result = self::run( false );
		// Record the version even when nothing matched. A site with no affected
		// posts is migrated, and should not rescan on every request.
		update_option( self::STATE_OPTION, self::VERSION, true );
		if ( array() !== $result['failed'] ) {
			// A post that did not read back clean keeps the site working but
			// must not be silently forgotten.
			error_log( sprintf( '[os] block migration could not verify post IDs: %s', implode( ', ', $result['failed'] ) ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}

	/**
	 * Rewrite every affected post.
	 *
	 * @param bool $dry_run When true, report what would change and write nothing.
	 * @return array{scanned:int,rewritten:int,replacements:int,failed:array<int,int>}
	 */
	public static function run( bool $dry_run = false ): array {
		global $wpdb;

		$scanned      = 0;
		$rewritten    = 0;
		$replacements = 0;
		$failed       = array();
		$last_id      = 0;

		// Page by ascending ID rather than by offset. A rewritten row stops
		// matching the WHERE clause, so an offset would skip rows, and a row
		// left alone would be fetched forever. A moving ID floor does neither.
		while ( true ) {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT ID, post_content FROM {$wpdb->posts} WHERE post_content LIKE %s AND ID > %d ORDER BY ID ASC LIMIT %d",
					'%wp:core-index/%',
					$last_id,
					self::BATCH
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery

			if ( ! $rows ) {
				break;
			}

			foreach ( $rows as $row ) {
				++$scanned;
				$last_id = max( $last_id, (int) $row['ID'] );
				$count   = 0;
				$before  = (string) $row['post_content'];
				$after   = self::rewrite( $before, $count );
				if ( 0 === $count || $after === $before ) {
					continue;
				}
				$replacements += $count;

				if ( $dry_run ) {
					++$rewritten;
					continue;
				}

				// Write through $wpdb rather than wp_update_post: this must not
				// fire save hooks, bump modified dates, or create revisions for
				// what is a lossless delimiter rename.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$wpdb->update( $wpdb->posts, array( 'post_content' => $after ), array( 'ID' => (int) $row['ID'] ) );
				clean_post_cache( (int) $row['ID'] );

				// Independent readback. The claim is that this post no longer
				// holds an old delimiter, so go and look.
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$stored = (string) $wpdb->get_var( $wpdb->prepare( "SELECT post_content FROM {$wpdb->posts} WHERE ID = %d", (int) $row['ID'] ) );
				if ( self::has_legacy( $stored ) ) {
					$failed[] = (int) $row['ID'];
					continue;
				}
				++$rewritten;
			}

			if ( count( $rows ) < self::BATCH ) {
				break;
			}
		}

		return array(
			'scanned'      => $scanned,
			'rewritten'    => $rewritten,
			'replacements' => $replacements,
			'failed'       => $failed,
		);
	}

	/**
	 * Rewrite the delimiters in one post's content.
	 *
	 * Gutenberg writes a block name in exactly two comment forms, opening and
	 * closing, and the name is always followed by a space, a `/`, or the end of
	 * the comment. Anchoring on that is what keeps prose mentioning the old name
	 * untouched.
	 *
	 * @param string   $content Post content.
	 * @param int|null $count   Receives the number of replacements.
	 * @return string
	 */
	public static function rewrite( string $content, ?int &$count = null ): string {
		$count = 0;
		if ( ! str_contains( $content, 'wp:core-index/' ) ) {
			return $content;
		}
		$names   = implode( '|', array_map( 'preg_quote', self::BLOCKS ) );
		$pattern = '#(<!--\s+/?wp:)core-index/(' . $names . ')(?=[\s/}])#';
		$out     = preg_replace( $pattern, '$1os/$2', $content, -1, $count );
		return null === $out ? $content : $out;
	}

	/**
	 * Does this content still hold a legacy delimiter for a block we moved?
	 *
	 * @param string $content Post content.
	 * @return bool
	 */
	public static function has_legacy( string $content ): bool {
		$names = implode( '|', array_map( 'preg_quote', self::BLOCKS ) );
		return 1 === preg_match( '#<!--\s+/?wp:core-index/(' . $names . ')(?=[\s/}])#', $content );
	}
}
