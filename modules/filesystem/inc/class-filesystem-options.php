<?php
/**
 * Option accessor for the ci_ -> os_ namespace move, the expand half of
 * expand / migrate / contract. Call sites name the canonical `os_` option and
 * this class falls back to the `ci_` row while it is still there, so the data
 * migration can run later without a flag day.
 *
 * Deliberately a local copy rather than a shared dependency: this plugin is a
 * standalone product and must not require OS, which is exactly what
 * tools/check-standalone-plugin.php enforces. Forty lines duplicated is the
 * price of that independence, and the price is correct.
 *
 * Writes go to the new row AND delete the legacy one, so the two names can
 * never hold different values. That also means every write migrates its own
 * key, so most of the job is done before `wp ci migrate-options` ever runs.
 *
 * Delete this class once the rows have moved and the fallback is dead weight.
 *
 * @package OS_Filesystem
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class CI_Filesystem_Options {

	/** Sentinel for "no row", so a stored false is not mistaken for absence. */
	private const ABSENT = '__ci_filesystem_option_absent__';

	/**
	 * Canonical name => the legacy name it came from.
	 *
	 * @var array<string,string>
	 */
	private const LEGACY = array(
		'os_fs_roots'   => 'ci_fs_roots',
		'os_fs_exec'    => 'ci_fs_exec',
		'os_fs_console' => 'ci_fs_console',
	);

	/**
	 * @param string $name          Canonical `os_` option name.
	 * @param mixed  $default_value Returned when neither row exists.
	 * @return mixed
	 */
	public static function get( string $name, $default_value = false ) {
		$value = get_option( $name, self::ABSENT );
		if ( self::ABSENT !== $value ) {
			return $value;
		}
		$legacy = self::LEGACY[ $name ] ?? null;
		if ( null === $legacy ) {
			return $default_value;
		}
		$value = get_option( $legacy, self::ABSENT );
		return self::ABSENT === $value ? $default_value : $value;
	}

	/**
	 * @param string    $name     Canonical `os_` option name.
	 * @param mixed     $value    Value to store.
	 * @param bool|null $autoload Autoload preference, or null for the default.
	 */
	public static function update( string $name, $value, ?bool $autoload = null ): bool {
		$updated = null === $autoload
			? update_option( $name, $value )
			: update_option( $name, $value, $autoload );

		$legacy = self::LEGACY[ $name ] ?? null;
		if ( null !== $legacy && self::ABSENT !== get_option( $legacy, self::ABSENT ) ) {
			delete_option( $legacy );
		}
		return (bool) $updated;
	}

	/** Delete both names, so a legacy row cannot resurrect a deleted setting. */
	public static function delete( string $name ): bool {
		$deleted = delete_option( $name );
		$legacy  = self::LEGACY[ $name ] ?? null;
		if ( null !== $legacy ) {
			$deleted = delete_option( $legacy ) || $deleted;
		}
		return (bool) $deleted;
	}
}
