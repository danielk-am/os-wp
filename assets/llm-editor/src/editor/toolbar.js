/* GENERATED from llm-editor src/editor/toolbar.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { blockbar, src, state } from './state.js';
import { commit, deleteNode, focusSource, fromSource, shift, span } from './edit-ops.js';
import { faSvg } from './icons.js';
import { render } from './render.js';
import { link, snack } from './interact.js';
import { t } from './boot.js';

export function bbtn(name, title, act) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wp-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = faSvg(name, 15);
  b.addEventListener('click', e => { e.stopPropagation(); act(); });
  return b;
}
/* ================= colour ================= */
// The six JSON Canvas spec colours, by their semantic names. These are not a
// palette I chose: they are the format's own keys 1-6, and they already carry
// meaning in the corpus (red is stop, green is build).
export const PALETTE = [
  { name: 'red',    css: 'var(--n-red)' },
  { name: 'orange', css: 'var(--n-orange)' },
  { name: 'yellow', css: 'var(--n-yellow)' },
  { name: 'green',  css: 'var(--n-green)' },
  { name: 'cyan',   css: 'var(--n-cyan)' },
  { name: 'purple', css: 'var(--n-purple)' },
];
export const KEY_NAME = { '1':'red','2':'orange','3':'yellow','4':'green','5':'cyan','6':'purple' };
export const colorPop = document.getElementById('color-pop');

// Writes color= into the heading's attribute block. Named for a spec colour,
// raw hex otherwise, and the whole attr disappears when cleared, rather than
// lingering as color= with nothing after it.
export function setColor(id, value) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  const m = lines[s.start].match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
  if (!m) return;
  const toks = (m[3] || '').split(/\s+/).filter(Boolean).filter(t => !t.startsWith('color='));
  if (value) toks.push('color=' + value);
  lines[s.start] = `${m[1]} ${m[2]}${toks.length ? ' {' + toks.join(' ') + '}' : ''}`;
  commit(lines.join('\n'));
}

export function currentColor() {
  const b = state.flat.find(x => x.id === state.sel);
  if (!b || !b.color) return null;
  return KEY_NAME[b.color] || b.color;   // named, or a raw #hex
}

export function buildSwatches() {
  const cur = currentColor();
  const g = document.getElementById('swatches');
  g.innerHTML = '';
  PALETTE.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c.css;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-pressed', String(cur === c.name));
    b.addEventListener('click', () => { setColor(state.sel, c.name); closeColor(); });
    g.appendChild(b);
  });
  const hex = document.getElementById('hex');
  hex.value = cur && cur.startsWith('#') ? cur : '';
  document.getElementById('color-hint').innerHTML = cur
    ? `writes <code>color=${cur}</code>` : 'writes <code>color=</code>';
}
export function openColor(anchor) {
  buildSwatches();
  colorPop.hidden = false;
  const r = anchor.getBoundingClientRect();
  colorPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 232)) + 'px';
}
export function closeColor() { colorPop.hidden = true; }

document.getElementById('color-clear').addEventListener('click', () => {
  setColor(state.sel, null); closeColor();
});
document.getElementById('hex').addEventListener('change', e => {
  const v = e.target.value.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) { setColor(state.sel, v); closeColor(); }
});

// EyeDropper is Chromium-only. Disable it honestly elsewhere rather than
// offering a button that does nothing.
export const eyedrop = document.getElementById('eyedrop');
eyedrop.innerHTML = faSvg('eyedropper', 13);
if (!window.EyeDropper) {
  eyedrop.disabled = true;
  eyedrop.title = 'Eyedropper needs a Chromium browser';
}
eyedrop.addEventListener('click', async () => {
  if (!window.EyeDropper) return;
  try {
    const { sRGBHex } = await new window.EyeDropper().open();
    setColor(state.sel, sRGBHex);
    closeColor();
  } catch { /* the user pressed Escape; nothing to report */ }
});

// Remove one wire. Only the first matching line, so a node wired to the same
// target twice loses one, not both.
export function deleteEdge(fromId, toId) {
  const s = span(fromId);
  if (!s) return;
  const lines = src.value.split('\n');
  for (let i = s.start; i < s.end; i++) {
    const m = lines[i].trim().match(/^->\s*#?([\w-]+)/);
    if (m && m[1] === toId) {
      lines.splice(i, 1);
      if (lines[i] !== undefined && lines[i].trim() === '' && lines[i - 1] !== undefined
          && lines[i - 1].trim() === '') lines.splice(i, 1);
      state.selEdge = null;
      commit(lines.join('\n').replace(/\n{4,}/g, '\n\n\n'));
      return;
    }
  }
}

export function setEdgeLabel(fromId, toId, label) {
  const s = span(fromId);
  if (!s) return;
  const lines = src.value.split('\n');
  for (let i = s.start; i < s.end; i++) {
    const m = lines[i].trim().match(/^->\s*#?([\w-]+)/);
    if (m && m[1] === toId) {
      lines[i] = `-> #${toId}` + (label.trim() ? ` "${label.trim()}"` : '');
      commit(lines.join('\n'));
      return;
    }
  }
}

// Layout is presentation, so "fit" just drops the pinned @positions of a group
// and its descendants and lets the auto-layout own it again.
export function fitGroup(id) {
  const b = state.flat.find(x => x.id === id);
  if (!b) return;
  const ids = [];
  (function walk(n) { ids.push(n.id); n.children.forEach(walk); })(b);
  ids.forEach(i => delete state.pos[i]);

  const lines = src.value.split('\n');
  let touched = false;
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
    if (!h || !h[3]) return;
    const toks = h[3].split(/\s+/).filter(Boolean);
    const nid = (toks.find(t => t.startsWith('#')) || '').slice(1);
    if (!ids.includes(nid)) return;
    const kept = toks.filter(t => !t.startsWith('@'));
    if (kept.length !== toks.length) {
      lines[i] = `${h[1]} ${h[2]}${kept.length ? ' {' + kept.join(' ') + '}' : ''}`;
      touched = true;
    }
  });
  if (touched) commit(lines.join('\n'));
  else { fromSource(); snack(`<strong>${b.title}</strong> already fits its contents.`, []); }
}

export function buildEdgebar() {
  blockbar.innerHTML = '';
  const e = state.selEdge;
  const lbl = document.createElement('span');
  lbl.className = 'edge-label-chip';
  lbl.textContent = `${e.from} → ${e.to}`;
  blockbar.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edge-input';
  input.value = e.label || '';
  input.placeholder = 'label';
  input.setAttribute('aria-label', 'Edge label');
  input.addEventListener('change', () => setEdgeLabel(e.from, e.to, input.value));
  blockbar.appendChild(input);

  const d = document.createElement('div'); d.className = 'divider'; blockbar.appendChild(d);
  blockbar.appendChild(bbtn('trash', 'Delete this wire', () => deleteEdge(e.from, e.to)));
}

export function buildBlockbar() {
  blockbar.innerHTML = '';
  const id = state.sel;
  blockbar.appendChild(bbtn('pen', 'Jump to this heading in the source editor', () => focusSource(id)));
  blockbar.appendChild(bbtn('outdent', 'Outdent (fewer #, leaves the group)', () => shift(id, -1)));
  blockbar.appendChild(bbtn('indent', 'Indent (more #, nests in the group above)', () => shift(id, +1)));
  const d1 = document.createElement('div'); d1.className = 'divider'; blockbar.appendChild(d1);
  blockbar.appendChild(bbtn('link', 'Connect to…', () => {
    state.linking = id;
    render();
  }));
  // Colour: a chip showing the node's current colour, WPDS palette on click.
  const cb = document.createElement('button');
  cb.type = 'button';
  cb.className = 'wp-btn';
  cb.id = 'color-btn';
  cb.title = 'Colour';
  cb.setAttribute('aria-label', 'Colour');
  const cur = currentColor();
  const chip = document.createElement('span');
  chip.className = 'chip' + (cur ? '' : ' none');
  if (cur) chip.style.background = cur.startsWith('#') ? cur : `var(--n-${cur})`;
  cb.appendChild(chip);
  cb.addEventListener('click', e => {
    e.stopPropagation();
    colorPop.hidden ? openColor(cb) : closeColor();
  });
  blockbar.appendChild(cb);

  const nodeIsGroup = !!(state.flat.find(x => x.id === id) || {}).children?.length;
  if (nodeIsGroup) {
    blockbar.appendChild(bbtn('fit', 'Fit the boundary to its contents', () => fitGroup(id)));
  }

  const d2 = document.createElement('div'); d2.className = 'divider'; blockbar.appendChild(d2);
  blockbar.appendChild(bbtn('trash', 'Delete', () => deleteNode(id)));
}
// Gutenberg's Top toolbar mode: the block tools live in the header, never over
// the canvas. The floating version sat at node.y - 42, which parked it on top
// of the node ABOVE and swallowed that node's ports. Docking removes the whole
// class of bug rather than nudging the offset.
export function positionBlockbar() {
  if (state.selEdge) {
    const key = `edge:${state.selEdge.from}->${state.selEdge.to}`;
    if (blockbar.dataset.for !== key) { blockbar.dataset.for = key; buildEdgebar(); }
    return;
  }
  const b = state.selected.size === 1 ? state.flat.find(x => x.id === state.sel) : null;
  if (!b) { blockbar.innerHTML = ''; blockbar.dataset.for = ''; return; }
  if (blockbar.dataset.for !== state.sel) {
    blockbar.dataset.for = state.sel;
    buildBlockbar();
  }
}
