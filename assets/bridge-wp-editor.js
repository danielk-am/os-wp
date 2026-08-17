/**
 * Bridge: re-export window.wp.editor as @wordpress/editor.
 *   import { EditorProvider, BlockBreadcrumb, ... } from '@wordpress/editor'
 *
 * The host page must enqueue `wp-editor` for `window.wp.editor` to exist.
 */
const ed = window.wp && window.wp.editor;
if ( ! ed ) {
  console.error( '[core-index] window.wp.editor not available — wp-editor script not enqueued?' );
}

export const EditorProvider        = ed?.EditorProvider;
export const EditorNotices         = ed?.EditorNotices;
export const PostTitle             = ed?.PostTitle;
export const PostTitleRaw          = ed?.PostTitleRaw;
export const VisualEditor          = ed?.VisualEditor;
export const TextEditor            = ed?.TextEditor;
export const PluginSidebar         = ed?.PluginSidebar;
export const PluginDocumentSettingPanel = ed?.PluginDocumentSettingPanel;
export const PluginMoreMenuItem    = ed?.PluginMoreMenuItem;
export const store                 = ed?.store;
export const ErrorBoundary         = ed?.ErrorBoundary;

export default ed;
