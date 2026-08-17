<?php
/**
 * Settings → OS Modules: the human surface for the module toggle.
 *
 * Native admin markup on purpose. Every module's own app is a React bundle,
 * but the screen that turns modules off must not depend on anything a module
 * ships: when a module is broken and tripped, this page is how you see why and
 * how you recover, so it has to render from core WordPress alone.
 *
 * Writes only the two options the registry owns (`os_disabled_modules`,
 * `os_tripped_modules`), through OS_Modules so the rules live in one place.
 *
 * @package OS
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OS_Modules_Screen {

	const SLUG   = 'os-modules';
	const ACTION = 'os_save_modules';

	public static function register(): void {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_post_' . self::ACTION, array( __CLASS__, 'handle_save' ) );
	}

	public static function add_page(): void {
		add_options_page(
			__( 'OS Modules', 'os' ),
			__( 'OS Modules', 'os' ),
			'manage_options',
			self::SLUG,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * One POST for the whole table. Checkbox state is the desired end state,
	 * so saving is a plain diff — no per-row actions, no ordering concerns.
	 * Saving an unchecked tripped module keeps it off; checking it clears the
	 * trip too, because "turn it on" should mean on, not "on unless the
	 * breaker remembers otherwise".
	 */
	public static function handle_save(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to manage OS modules.', 'os' ) );
		}
		check_admin_referer( self::ACTION );

		$wanted_on = array_map( 'sanitize_key', (array) ( $_POST['os_module_enabled'] ?? array() ) );

		foreach ( array_keys( OS_Modules::all() ) as $module ) {
			OS_Modules::set_enabled( $module, in_array( $module, $wanted_on, true ) );
		}

		wp_safe_redirect( add_query_arg( 'updated', '1', self::page_url() ) );
		exit;
	}

	public static function page_url(): string {
		return admin_url( 'options-general.php?page=' . self::SLUG );
	}

	public static function render(): void {
		$disabled = OS_Modules::disabled();
		$tripped  = OS_Modules::tripped();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'OS Modules', 'os' ); ?></h1>
			<p>
				<?php esc_html_e( 'Everything OS does, one module per row. A module that is off does not boot: its content types, abilities, and REST routes simply do not exist until it is turned back on. Nothing is deleted either way.', 'os' ); ?>
			</p>
			<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only flag. ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Modules updated.', 'os' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>" />
				<?php wp_nonce_field( self::ACTION ); ?>

				<table class="widefat striped" style="max-width: 980px; margin-top: 12px;">
					<thead>
						<tr>
							<th scope="col" style="width: 70px;"><?php esc_html_e( 'On', 'os' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Module', 'os' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Status', 'os' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Owns', 'os' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( OS_Modules::all() as $name => $manifest ) : ?>
							<?php
							$is_tripped = isset( $tripped[ $name ] );
							$is_on      = ! $is_tripped && ! in_array( $name, $disabled, true );
							$owned      = array_map( 'strval', (array) ( $manifest['owned_data'] ?? array() ) );
							$rest       = array_map( 'strval', (array) ( $manifest['rest_namespaces'] ?? array() ) );
							?>
							<tr>
								<td>
									<input
										type="checkbox"
										name="os_module_enabled[]"
										id="os-module-<?php echo esc_attr( $name ); ?>"
										value="<?php echo esc_attr( $name ); ?>"
										<?php checked( $is_on ); ?>
									/>
								</td>
								<td>
									<label for="os-module-<?php echo esc_attr( $name ); ?>">
										<strong><?php echo esc_html( (string) ( $manifest['label'] ?? $name ) ); ?></strong>
									</label>
									<br />
									<code><?php echo esc_html( $name ); ?></code>
								</td>
								<td>
									<?php if ( $is_tripped ) : ?>
										<span style="color: #b32d2e; font-weight: 600;"><?php esc_html_e( 'Tripped', 'os' ); ?></span>
										<br />
										<span class="description"><?php echo esc_html( (string) $tripped[ $name ] ); ?></span>
									<?php elseif ( $is_on ) : ?>
										<span style="color: #007017;"><?php esc_html_e( 'Running', 'os' ); ?></span>
									<?php else : ?>
										<span class="description"><?php esc_html_e( 'Off', 'os' ); ?></span>
									<?php endif; ?>
								</td>
								<td>
									<span class="description">
										<?php
										echo esc_html(
											sprintf(
												/* translators: 1: count of data identifiers, 2: REST namespaces. */
												__( '%1$d data key(s) · %2$s', 'os' ),
												count( $owned ),
												implode( ', ', $rest )
											)
										);
										?>
									</span>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>

				<?php submit_button( __( 'Save modules', 'os' ) ); ?>
			</form>

			<p class="description" style="max-width: 980px;">
				<?php esc_html_e( 'Tripped means the circuit breaker switched a module off because it failed to load. Ticking it and saving clears the trip and boots it again on the next request.', 'os' ); ?>
			</p>
		</div>
		<?php
	}
}
