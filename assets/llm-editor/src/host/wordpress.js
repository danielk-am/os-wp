/* GENERATED from llm-editor src/host/wordpress.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * WordPress host.
 *
 * Daniel, 15 Jul: "Can we have filepicker for file node? If it's in WordPress,
 * it'll allow selection of posts or media too."
 *
 * Right, and the three sources are already built. None of this is new surface:
 *
 *   Media   wp.media, the same modal every block uses. Free.
 *   Posts   /wp/v2/search, core's own cross-type search endpoint. Free.
 *   Files   ci-filesystem's /fs/roots + /fs/list, which already exists and is
 *           already jailed to admin-configured roots. Free, and the jail is the
 *           reason to reach for it rather than inventing a browser: an editor
 *           that can read any path on the box is a vulnerability wearing a
 *           feature's clothes.
 *
 * Each source returns a URI (see host.js). Media gives a real upload URL, posts
 * give a permalink, ci-filesystem gives root-relative path. All three round-trip
 * through a git checkout as readable text, which is the requirement.
 */

import { setHost } from './host.js';

const REST = (path) => `${window.wpApiSettings?.root || '/wp-json/'}${path}`;

const headers = () => ({
  'Content-Type': 'application/json',
  'X-WP-Nonce': window.wpApiSettings?.nonce || '',
});

function download({ text, fileName }) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/** Media library. wp.media is already on the page in any block editor context. */
function pickMedia() {
  return new Promise((resolve) => {
    if (!window.wp?.media) return resolve(null);
    const frame = window.wp.media({
      title: 'Choose a file to include',
      button: { text: 'Use this file' },
      multiple: false,
    });
    frame.on('select', () => {
      const a = frame.state().get('selection').first().toJSON();
      // a.url, not a.id. See the URI decision in host.js: attachment_url_to_postid()
      // recovers the id server-side whenever WP actually needs it.
      resolve({ uri: a.url, label: a.filename || a.title });
    });
    frame.on('close', () => setTimeout(() => resolve(null), 0));
    frame.open();
  });
}

/** Posts, pages, and every CPT. Core's search endpoint spans them all. */
async function searchPosts(term) {
  const r = await fetch(REST(`wp/v2/search?search=${encodeURIComponent(term)}&per_page=20`), {
    headers: headers(), credentials: 'same-origin',
  });
  if (!r.ok) return [];
  const rows = await r.json();
  return rows.map((p) => ({ uri: p.url, label: `${p.title} (${p.subtype})` }));
}

/** ci-filesystem: roots first, then one directory at a time. Jailed server-side. */
async function fsRoots() {
  const r = await fetch(REST('context-intelligence/v1/fs/roots'), {
    headers: headers(), credentials: 'same-origin',
  });
  if (!r.ok) return [];
  return (await r.json()).roots || [];
}

async function fsList(root, path = '') {
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  const r = await fetch(REST(`context-intelligence/v1/fs/list?${q}`), {
    headers: headers(), credentials: 'same-origin',
  });
  if (!r.ok) return [];
  return (await r.json()).entries || [];
}

export function installWordPressHost({ postId, restBase = 'wp/v2/os_skill' }) {
  setHost({
    name: 'wordpress',

    async load() {
      const r = await fetch(REST(`${restBase}/${postId}?context=edit`), {
        headers: headers(), credentials: 'same-origin',
      });
      if (!r.ok) return null;
      const p = await r.json();
      return p.content?.raw ?? '';
    },

    async save(text) {
      const r = await fetch(REST(`${restBase}/${postId}`), {
        method: 'POST', headers: headers(), credentials: 'same-origin',
        body: JSON.stringify({ content: text }),
      });
      if (!r.ok) throw new Error(`save failed: ${r.status} ${await r.text()}`);
      return true;
    },

    /**
     * The three-source picker. Returns a URI or null.
     * `openPicker` is the DOM modal; it lives in editor/ because it is chrome,
     * while the three fetchers above are the host's actual knowledge.
     */
    async pickFile(opts = {}) {
      const { openPicker } = await import('../editor/file-picker.js');
      return openPicker({
        sources: [
          { id: 'media', label: 'Media', pick: pickMedia },
          { id: 'posts', label: 'Posts', search: searchPosts },
          { id: 'files', label: 'Files', roots: fsRoots, list: fsList },
        ],
        accept: opts.accept,
      });
    },

    async readFile(uri) {
      // Only ci-filesystem can hand back text; a media URL is just fetched.
      try {
        const r = await fetch(uri, { credentials: 'same-origin' });
        return r.ok ? await r.text() : null;
      } catch {
        return null;   // OKF: consumers MUST tolerate broken links.
      }
    },

    async exportFile(artifact) { return download(artifact); },
  });
}
