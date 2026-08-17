/**
 * Bridge: re-export window.wp.blockEditor as @wordpress/block-editor.
 *   import { BlockEditorProvider, BlockList, BlockTools, … } from '@wordpress/block-editor'
 *
 * The host page must enqueue `wp-block-editor` for `window.wp.blockEditor`
 * to exist. We log loudly if it's missing.
 */
const be = window.wp && window.wp.blockEditor;
if (!be) {
  console.error('[core-index] window.wp.blockEditor not available — wp-block-editor script not enqueued?');
}

export const BlockEditorProvider     = be?.BlockEditorProvider;
export const BlockList               = be?.BlockList;
export const BlockTools              = be?.BlockTools;
export const BlockInspector          = be?.BlockInspector;
export const BlockBreadcrumb         = be?.BlockBreadcrumb;
export const BlockCanvas             = be?.BlockCanvas;
export const BlockPreview            = be?.BlockPreview;
export const WritingFlow             = be?.WritingFlow;
export const ObserveTyping           = be?.ObserveTyping;
export const useBlockProps           = be?.useBlockProps;
// InspectorControls is the Fill a block's edit() renders its sidebar
// settings into; BlockInspector is the matching Slot.
export const InspectorControls       = be?.InspectorControls;
export const RichText                = be?.RichText;
export const InnerBlocks             = be?.InnerBlocks;
export const store                   = be?.store;
export const BlockEditorKeyboardShortcuts = be?.BlockEditorKeyboardShortcuts;
// Top-toolbar pieces: Inserter is the "+" button that opens the block
// inserter; BlockNavigationDropdown is the List View "≡" dropdown.
export const Inserter                = be?.Inserter;
export const BlockNavigationDropdown = be?.BlockNavigationDropdown;
// BlockToolbar is the contextual block toolbar (formatting B/I/link,
// move, options) — what block-theme comment composers render in a fixed
// bar. Pairing it with `hasFixedToolbar: true` gives the real Gutenberg
// editor chrome instead of the floating popover.
export const BlockToolbar            = be?.BlockToolbar;
// ListView — the block-hierarchy overview (the "list view" ☰ in the top
// toolbar). Still behind the experimental export in current WP.
export const ListView                = be?.__experimentalListView || be?.ListView;
// The full inserter library (search + Blocks/Patterns/Media tabs) as a
// composable panel — what edit-post docks in its sidebar. Lets an editor
// offer the inserter as a left rail instead of a popover.
export const BlockLibrary            = be?.__experimentalLibrary;

export default be;
