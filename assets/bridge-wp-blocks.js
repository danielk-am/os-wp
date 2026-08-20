/**
 * Bridge: re-export window.wp.blocks as @wordpress/blocks.
 *   import { parse, serialize, createBlock } from '@wordpress/blocks'
 *
 * The host page must enqueue `wp-blocks` for `window.wp.blocks` to be
 * populated. We log loudly if it's missing.
 */
const bk = window.wp && window.wp.blocks;
if (!bk) {
  console.error('[os] window.wp.blocks not available — wp-blocks script not enqueued?');
}

export const parse                = bk?.parse;
export const serialize            = bk?.serialize;
export const createBlock          = bk?.createBlock;
export const getBlockType         = bk?.getBlockType;
export const getBlockTypes        = bk?.getBlockTypes;
export const registerBlockType    = bk?.registerBlockType;
export const unregisterBlockType  = bk?.unregisterBlockType;
export const registerBlockVariation   = bk?.registerBlockVariation;
export const unregisterBlockVariation = bk?.unregisterBlockVariation;
export const rawHandler           = bk?.rawHandler;
export const pasteHandler         = bk?.pasteHandler;
export const synchronizeBlocksWithTemplate = bk?.synchronizeBlocksWithTemplate;

export default bk;
