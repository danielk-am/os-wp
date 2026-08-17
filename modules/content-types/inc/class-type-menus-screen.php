<?php
/**
 * Content type → Menus: where every type's place in the sidebar is decided.
 *
 * The Content Types module already owns what a type IS (its fields, schema,
 * and labels), so it also owns where the type sits: menu label, icon, and
 * position, for built-in and user-defined types alike. Same shape as Secure
 * Custom Fields: one screen, every post type, no code.
 *
 * Writes one option, `os_type_menus`, keyed by post type. The shared admin
 * runtime reads it when building menus, so a change here lands on the next
 * page load. Native admin markup for the same reason the modules screen uses
 * it: the page that arranges the apps must not depend on any of them.
 *
 * @package OS_Content_Types
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OS_Type_Menus_Screen {

	const OPTION = 'os_type_menus';
	const SLUG   = 'os-type-menus';
	const ACTION = 'os_save_type_menus';

	/** The Content type app's top-level page, which this screen lives under. */
	const PARENT = 'os-content-types-content-type';

	public static function register(): void {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ), 60 );
		add_action( 'admin_post_' . self::ACTION, array( __CLASS__, 'handle_save' ) );
	}

	public static function add_page(): void {
		add_submenu_page(
			self::PARENT,
			__( 'Menus & icons', 'os' ),
			__( 'Menus & icons', 'os' ),
			'manage_options',
			self::SLUG,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Every OS post type an administrator can place: label, current icon, and
	 * current position, with any saved override already applied.
	 *
	 * @return array<string,array{label:string,icon:string,position:string}>
	 */
	private static function types(): array {
		$saved = (array) get_option( self::OPTION, array() );
		$rows  = array();

		foreach ( get_post_types( array(), 'objects' ) as $name => $object ) {
			if ( ! str_starts_with( $name, 'os_' ) ) {
				continue;
			}
			$override      = (array) ( $saved[ $name ] ?? array() );
			$rows[ $name ] = array(
				'label'    => (string) ( $override['label'] ?? '' ),
				'icon'     => (string) ( $override['icon'] ?? '' ),
				'position' => (string) ( $override['position'] ?? '' ),
				'plural'   => (string) $object->labels->name,
			);
		}
		ksort( $rows );
		return $rows;
	}

	/**
	 * Save the whole table in one POST. Empty fields mean "use the module's
	 * default", so clearing a row is how you undo an override; only non-empty
	 * values are stored, and the option never accumulates blanks.
	 */
	public static function handle_save(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to manage type menus.', 'os' ) );
		}
		check_admin_referer( self::ACTION );

		$labels    = (array) ( $_POST['os_menu_label'] ?? array() );
		$icons     = (array) ( $_POST['os_menu_icon'] ?? array() );
		$positions = (array) ( $_POST['os_menu_position'] ?? array() );

		$saved = array();
		foreach ( array_keys( self::types() ) as $type ) {
			$entry = array_filter(
				array(
					'label'    => sanitize_text_field( (string) ( $labels[ $type ] ?? '' ) ),
					'icon'     => self::sanitize_icon( (string) ( $icons[ $type ] ?? '' ) ),
					'position' => self::sanitize_position( (string) ( $positions[ $type ] ?? '' ) ),
				),
				static fn( string $value ): bool => '' !== $value
			);
			if ( $entry ) {
				$saved[ $type ] = $entry;
			}
		}

		update_option( self::OPTION, $saved );
		wp_safe_redirect( add_query_arg( 'updated', '1', admin_url( 'admin.php?page=' . self::SLUG ) ) );
		exit;
	}

	/** Icons are dashicon names only; anything else falls back to the default. */
	private static function sanitize_icon( string $icon ): string {
		$icon = trim( $icon );
		return preg_match( '/^dashicons-[a-z0-9-]+$/', $icon ) ? $icon : '';
	}

	/** Positions are numeric, dotted decimals included, e.g. `3.1`. */
	private static function sanitize_position( string $position ): string {
		$position = trim( $position );
		return preg_match( '/^[0-9]+(\.[0-9]+)?$/', $position ) ? $position : '';
	}

	public static function render(): void {
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Menus & icons', 'os' ); ?></h1>
			<p>
				<?php esc_html_e( 'Where each type sits in the sidebar. Leave a field empty to keep the module\'s default; lower positions sit higher. Changes apply on the next page load.', 'os' ); ?>
			</p>
			<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only flag. ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Menus updated.', 'os' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>" />
				<?php wp_nonce_field( self::ACTION ); ?>

				<table class="widefat striped" style="max-width: 900px; margin-top: 12px;">
					<thead>
						<tr>
							<th scope="col"><?php esc_html_e( 'Type', 'os' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Menu label', 'os' ); ?></th>
							<th scope="col" style="width: 240px;"><?php esc_html_e( 'Icon', 'os' ); ?></th>
							<th scope="col" style="width: 110px;"><?php esc_html_e( 'Position', 'os' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( self::types() as $type => $row ) : ?>
							<tr>
								<td>
									<strong><?php echo esc_html( $row['plural'] ); ?></strong><br />
									<code><?php echo esc_html( $type ); ?></code>
								</td>
								<td>
									<input type="text" class="regular-text" style="max-width: 200px;"
										name="os_menu_label[<?php echo esc_attr( $type ); ?>]"
										value="<?php echo esc_attr( $row['label'] ); ?>"
										placeholder="<?php echo esc_attr( $row['plural'] ); ?>" />
								</td>
								<td>
									<?php if ( '' !== $row['icon'] ) : ?>
										<span class="dashicons <?php echo esc_attr( $row['icon'] ); ?>" style="vertical-align: middle;"></span>
									<?php endif; ?>
									<input type="text" style="max-width: 190px;"
										name="os_menu_icon[<?php echo esc_attr( $type ); ?>]"
										value="<?php echo esc_attr( $row['icon'] ); ?>"
										placeholder="dashicons-…" />
								</td>
								<td>
									<input type="text" style="max-width: 80px;"
										name="os_menu_position[<?php echo esc_attr( $type ); ?>]"
										value="<?php echo esc_attr( $row['position'] ); ?>"
										placeholder="auto" />
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>

				<?php submit_button( __( 'Save menus', 'os' ) ); ?>
			</form>

			<p class="description" style="max-width: 900px;">
				<?php
				printf(
					/* translators: %s: link to the dashicons reference. */
					esc_html__( 'Icons take any name from the %s. Fields for each type live under its own Manage screen.', 'os' ),
					'<a href="https://developer.wordpress.org/resource/dashicons/" target="_blank" rel="noreferrer">' . esc_html__( 'dashicons reference', 'os' ) . '</a>'
				);
				?>
			</p>
		</div>
		<?php
	}
}
