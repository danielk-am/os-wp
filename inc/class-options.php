<?php
/**
 * Option accessor for the ci_ -> os_ namespace move. The expand half of
 * expand / migrate / contract:
 *
 *   1. expand   — call sites move to the os_ name through this class, which
 *                 falls back to the ci_ row while it is still there  (here)
 *   2. migrate  — wp ci migrate-options --execute moves the rows
 *   3. contract — this class and the read shim are deleted, call sites go
 *                 back to plain get_option() on the os_ name
 *
 * Call sites always name the canonical `os_` option. Whether the value is
 * currently stored under `os_` or `ci_` is this class's problem, not theirs,
 * which is what makes the migration orderable rather than a flag day.
 *
 * Reads prefer the new row and fall back to the legacy one. Writes always go to
 * the new row AND delete the legacy one, so the two names can never hold
 * different values: a legacy row that survived a write would read as stale
 * through the compatibility shim, which is the one failure this whole exercise
 * exists to avoid. That also means a write migrates its own key, so a busy site
 * finishes most of the job before the CLI ever runs.
 *
 * @package OS_Index
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OS_Options {

	/** Sentinel for "no row", so a stored false is not mistaken for absence. */
	private const ABSENT = '__core_index_option_absent__';

	/**
	 * Read the canonical option, falling back to its legacy name.
	 *
	 * @param string $name          Canonical `os_` option name.
	 * @param mixed  $default_value Returned when neither row exists.
	 * @return mixed
	 */
	public static function get( string $name, $default_value = false ) {
		$value = get_option( $name, self::ABSENT );
		if ( self::ABSENT !== $value ) {
			return $value;
		}

		$legacy = self::legacy_name( $name );
		if ( null === $legacy ) {
			return $default_value;
		}

		$value = get_option( $legacy, self::ABSENT );
		return self::ABSENT === $value ? $default_value : $value;
	}

	/**
	 * Write the canonical option and retire the legacy row in the same call.
	 *
	 * @param string    $name     Canonical `os_` option name.
	 * @param mixed     $value    Value to store.
	 * @param bool|null $autoload Autoload preference, or null for the default.
	 */
	public static function update( string $name, $value, ?bool $autoload = null ): bool {
		$updated = null === $autoload
			? update_option( $name, $value )
			: update_option( $name, $value, $autoload );

		$legacy = self::legacy_name( $name );
		if ( null !== $legacy && self::ABSENT !== get_option( $legacy, self::ABSENT ) ) {
			delete_option( $legacy );
		}

		return (bool) $updated;
	}

	/** Delete both names, so a legacy row cannot resurrect a deleted setting. */
	public static function delete( string $name ): bool {
		$deleted = delete_option( $name );
		$legacy  = self::legacy_name( $name );
		if ( null !== $legacy ) {
			$deleted = delete_option( $legacy ) || $deleted;
		}
		return (bool) $deleted;
	}

	/**
	 * The `ci_` name a canonical option came from, or null when there is none.
	 * Delegates to the migration map so the pairing is declared exactly once;
	 * falls back to a literal prefix swap for the runtime-minted families
	 * (`os_field_groups_<slug>`), which no static map can enumerate.
	 */
	private static function legacy_name( string $name ): ?string {
		if ( ! str_starts_with( $name, 'os_' ) ) {
			return null;
		}
		if ( class_exists( 'OS_Option_Migration' ) ) {
			$mapped = OS_Option_Migration::legacy_name( $name );
			if ( null !== $mapped ) {
				return $mapped;
			}
		}
		return 'ci_' . substr( $name, 3 );
	}
}
