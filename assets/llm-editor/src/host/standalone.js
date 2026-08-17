/* GENERATED from llm-editor src/host/standalone.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * Standalone host: the shareable single-file page.
 *
 * Defined by what it CANNOT do. A published artifact runs under a strict CSP
 * with no filesystem and no network, so there is nothing to browse and no server
 * to ask. localStorage is the only durable surface there is.
 *
 * An earlier version marked pickFile unavailable and hid the button. That was
 * half right and half lazy. It cannot ENUMERATE a filesystem, true. But the
 * picker's actual job is to return a URI string, and there are two honest ways
 * to do that here: offer the paths already in this document, and let you type
 * one. Both are real. Refusing to open at all confused "I cannot list your disk"
 * with "you may not reference a file", which are very different claims.
 *
 * What it must not do is pretend. There is no Media tab and no Files tab,
 * because there is no media library and no disk. You get what exists.
 */

import { setHost } from './host.js';

const KEY = 'llm-editor-doc';

function download({ text, fileName }) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * Every file= already in the document.
 *
 * Genuinely useful rather than a consolation prize: a doc that pulls in six
 * files usually pulls in the same six again, and this is the only host where
 * that list is the whole of what is knowable.
 */
function pathsInDoc(term) {
  const text = document.getElementById('src')?.value || '';
  const seen = new Map();
  // [^\s}]+ and NOT \S+. A path lives inside `{#id type=file file=/a/b.llm}`,
  // so \S+ swallows the closing brace and hands back "/a/b.llm}". Round-trip
  // that through setFile and the heading ends `...llm}}`, which is a
  // corrupted document from a read-only list. The real parser is safe: it
  // strips the braces before splitting on whitespace. This regex reads the raw
  // text, so it has to terminate on the brace itself.
  for (const m of text.matchAll(/\bfile=([^\s}]+)/g)) {
    const uri = m[1];
    if (!seen.has(uri)) seen.set(uri, { uri, label: uri.split('/').pop(), hint: uri });
  }
  const q = (term || '').toLowerCase();
  return [...seen.values()].filter((r) => !q || r.uri.toLowerCase().includes(q));
}

export function installStandaloneHost({ seed = '' } = {}) {
  setHost({
    name: 'standalone',
    async load() { return localStorage.getItem(KEY) ?? seed; },
    async save(text) { localStorage.setItem(KEY, text); return true; },

    async pickFile(opts = {}) {
      const { openPicker } = await import('../editor/file-picker.js');
      return openPicker({
        sources: [{ id: 'doc', label: 'In this document', search: pathsInDoc }],
        accept: opts.accept,
      });
    },

    // No network: an include cannot be previewed. null, not a throw, because
    // OKF says consumers MUST tolerate a broken link, and "cannot read" and
    // "does not exist" look identical from here.
    async readFile() { return null; },
    async exportFile(artifact) { return download(artifact); },
  });
}
