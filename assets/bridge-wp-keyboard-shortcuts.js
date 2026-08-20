/**
 * Bridge: re-export window.wp.keyboardShortcuts as @wordpress/keyboard-shortcuts.
 *   import { ShortcutProvider, useShortcut } from '@wordpress/keyboard-shortcuts'
 */
const ks = window.wp && window.wp.keyboardShortcuts;
if ( ! ks ) {
  console.error( '[os] window.wp.keyboardShortcuts not available — wp-keyboard-shortcuts not enqueued?' );
}

export const ShortcutProvider = ks?.ShortcutProvider;
export const useShortcut      = ks?.useShortcut;
export const store            = ks?.store;

export default ks;
