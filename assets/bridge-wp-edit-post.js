/**
 * Bridge: re-export window.wp.editPost as @wordpress/edit-post.
 *   import { Editor, store } from '@wordpress/edit-post'
 *
 * The full `<Editor>` is what wp-admin/post.php uses. It expects a
 * registered post type + post id, but the wizard composer mounts it
 * against a synthetic in-memory post — we drive the data through
 * @wordpress/editor's EditorProvider instead.
 */
const ep = window.wp && window.wp.editPost;
if ( ! ep ) {
  console.error( '[core-index] window.wp.editPost not available — wp-edit-post script not enqueued?' );
}

export const Editor      = ep?.Editor;
export const store       = ep?.store;
export const initializeEditor = ep?.initializeEditor;
export const reinitializeEditor = ep?.reinitializeEditor;

export default ep;
