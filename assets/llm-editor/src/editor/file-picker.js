/* GENERATED from llm-editor src/editor/file-picker.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * The picker modal. Chrome only: it knows how to show a list and return a URI,
 * and nothing about where the list came from.
 *
 * That split is the point. WordPress hands it three sources (Media, Posts,
 * os-filesystem roots); VS Code never opens this at all, because a native
 * showOpenDialog beats anything reimplementable in a webview, and it gets recent
 * files, favourites and keyboard handling for free. Standalone has no sources,
 * so the button that opens this is hidden rather than present-and-dead.
 *
 * Every source resolves to a URI string. See host.js for why that is a URI and
 * never a database id.
 */

import { faSvg } from './icons.js';

/**
 * @param {{sources: Array, accept?: string[]}} opts
 * @returns {Promise<{uri:string,label?:string}|null>} null if dismissed
 */
export function openPicker({ sources, accept }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'pick-back';
    back.innerHTML = `
      <div class="pick" role="dialog" aria-modal="true" aria-label="Choose a file">
        <div class="pick-head">
          <div class="pick-tabs" role="tablist"></div>
          <button class="pick-x" type="button" aria-label="Close"></button>
        </div>
        <input class="pick-search" type="search" placeholder="Search" aria-label="Search">
        <div class="pick-crumbs" hidden></div>
        <div class="pick-list" role="listbox"></div>
        <div class="pick-foot">
          <input class="pick-uri" type="text" spellcheck="false"
                 placeholder="/path/to/file.llm  or  https://…"
                 aria-label="File URI">
          <button class="pick-ok" type="button" disabled>Use this file</button>
        </div>
      </div>`;
    back.querySelector('.pick-x').innerHTML = faSvg('close', 12);

    const tabs = back.querySelector('.pick-tabs');
    const list = back.querySelector('.pick-list');
    const search = back.querySelector('.pick-search');
    const crumbs = back.querySelector('.pick-crumbs');
    const uriEl = back.querySelector('.pick-uri');
    const ok = back.querySelector('.pick-ok');

    let picked = null;
    let active = sources[0];
    let root = null, path = '';

    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && picked) { e.preventDefault(); done(picked); }
    };

    function choose(item) {
      picked = { uri: item.uri, label: item.label };
      uriEl.value = item.uri;
      ok.disabled = false;
      [...list.children].forEach((c) => c.classList.toggle('on', c._item === item));
    }

    // Typing wins over the list. Someone who knows the path should not have to
    // click to it, and a URI the host cannot enumerate (a remote asset, a file
    // not yet created) is still a legal value: OKF requires consumers to
    // tolerate broken links, so the editor has no business refusing one.
    uriEl.addEventListener('input', () => {
      const v = uriEl.value.trim();
      picked = v ? { uri: v } : null;
      ok.disabled = !v;
      [...list.children].forEach((c) => c.classList.remove('on'));
    });

    function rows(items, { onOpen } = {}) {
      list.innerHTML = '';
      if (!items.length) {
        // Say which source is empty. "No results" on a three-tab dialog makes
        // you re-click every tab to find out where you are.
        list.innerHTML = `<p class="pick-empty">Nothing in ${active.label}${search.value ? ` for “${search.value}”` : ''}.</p>`;
        return;
      }
      for (const it of items) {
        const r = document.createElement('button');
        r.type = 'button';
        r.className = 'pick-row' + (it.dir ? ' dir' : '');
        r._item = it;
        r.innerHTML = `<span class="pick-ico">${faSvg(it.dir ? 'group' : 'file', 11)}</span>
                       <span class="pick-label">${it.label}</span>
                       <span class="pick-hint">${it.hint || ''}</span>`;
        r.addEventListener('click', () => (it.dir && onOpen ? onOpen(it) : choose(it)));
        r.addEventListener('dblclick', () => { if (!it.dir) done({ uri: it.uri, label: it.label }); });
        list.appendChild(r);
      }
    }

    /** os-filesystem: roots, then one directory at a time. Jailed server-side. */
    async function showFiles() {
      crumbs.hidden = false;
      if (!root) {
        const rs = await active.roots();
        crumbs.textContent = 'Roots';
        rows(rs.map((r) => ({ label: r.label, hint: r.path, dir: true, root: r.id })),
          { onOpen: (it) => { root = it.root; path = ''; showFiles(); } });
        return;
      }
      crumbs.innerHTML = '';
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'crumb';
      up.textContent = path ? '← up' : '← roots';
      up.addEventListener('click', () => {
        if (!path) root = null; else path = path.split('/').slice(0, -1).join('/');
        showFiles();
      });
      crumbs.appendChild(up);
      const here = document.createElement('span');
      here.className = 'crumb-path';
      here.textContent = `/${path}`;
      crumbs.appendChild(here);

      const entries = await active.list(root, path);
      const q = search.value.toLowerCase();
      rows(entries
        .filter((e) => !q || e.name.toLowerCase().includes(q))
        .filter((e) => e.type === 'dir' || !accept || accept.some((a) => e.name.endsWith(a)))
        .map((e) => ({
          label: e.name,
          hint: e.type === 'dir' ? '' : fmtSize(e.size),
          dir: e.type === 'dir',
          uri: `/${[path, e.name].filter(Boolean).join('/')}`,
        })),
        { onOpen: (it) => { path = [path, it.label].filter(Boolean).join('/'); showFiles(); } });
    }

    async function showActive() {
      picked = null; ok.disabled = true; uriEl.value = '';
      crumbs.hidden = true;
      list.innerHTML = '<p class="pick-empty">Loading…</p>';
      try {
        if (active.roots) return showFiles();
        if (active.search) return rows(await active.search(search.value));
        if (active.pick) {
          // Media hands off to wp.media, which is its own modal. Ours gets out
          // of the way rather than wrapping a wrapper.
          const r = await active.pick();
          return r ? done(r) : rows([]);
        }
      } catch (e) {
        list.innerHTML = `<p class="pick-empty">${active.label} did not answer: ${e.message}</p>`;
      }
    }

    for (const s of sources) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pick-tab'; b.textContent = s.label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => {
        active = s; root = null; path = ''; search.value = '';
        [...tabs.children].forEach((c) => c.setAttribute('aria-selected', String(c === b)));
        showActive();
      });
      tabs.appendChild(b);
    }
    tabs.firstChild.setAttribute('aria-selected', 'true');

    let deb;
    search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(showActive, 200); });
    back.querySelector('.pick-x').addEventListener('click', () => done(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    ok.addEventListener('click', () => done(picked));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(back);
    search.focus();
    showActive();
  });
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
