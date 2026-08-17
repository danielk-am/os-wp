/* GENERATED from llm-editor src/host/vscode.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * VS Code host.
 *
 * A webview cannot touch the filesystem, by design. So every capability here is
 * a postMessage round-trip to extension/extension.js, which runs in the
 * extension host and can. That is not a workaround, it is the security model,
 * and it is the same shape as the WordPress host's REST calls: the editor asks,
 * something trusted answers.
 *
 * The picker is `vscode.window.showOpenDialog` plus a workspace quick-pick.
 * Native, so it gets recent files, favourites, and the keyboard handling for
 * free. Reimplementing that in a webview would be worse in every direction.
 */

import { setHost } from './host.js';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

let seq = 0;
const pending = new Map();

/** Ask the extension host something and await its reply. */
function rpc(type, payload) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    vscode.postMessage({ id, type, payload });
  });
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m?.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});

export function installVsCodeHost() {
  let onChange = null;

  // The extension pushes the document when it changes on disk or via undo.
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'document' && onChange) onChange(e.data.text);
  });

  setHost({
    name: 'vscode',
    // Set inline by extension.cjs's html(), before this module runs: the
    // extension host knows document.uri, a webview never does.
    ext: window.__LLM_FILE_EXT__ || null,
    sourceName: () => window.__LLM_FILE_NAME__ || null,
    async load() { return rpc('load'); },
    async save(text) { return rpc('save', { text }); },
    // Fire-and-forget on every input event. If the webview closes inside the
    // canvas debounce, the extension host still owns this final snapshot and
    // flushes it from panel.onDidDispose().
    stage(text) { vscode.postMessage({ type: 'stage', payload: { text } }); },

    /**
     * Returns a WORKSPACE-RELATIVE path, not an absolute one. Deliberate: an
     * absolute path bakes /Users/danielkam into a file that gets committed and
     * then read on a server. Workspace-relative survives the trip, and matches
     * the leading-slash convention OKF recommends for exactly this reason.
     */
    async pickFile(opts = {}) {
      const r = await rpc('pickFile', { accept: opts.accept });
      return r ? { uri: r.uri, label: r.label } : null;
    },

    async readFile(uri) { return rpc('readFile', { uri }); },
    async exportFile(artifact) { return rpc('exportFile', artifact); },
    async pickDocuments() { return rpc('pickDocuments'); },
    async exportFiles(artifacts) { return rpc('exportFiles', { artifacts }); },

    onExternalChange(cb) { onChange = cb; },
  });
}
