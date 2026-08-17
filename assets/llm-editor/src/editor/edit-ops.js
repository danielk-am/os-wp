/* GENERATED from llm-editor src/editor/edit-ops.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { agentText } from '../core/project.js';
import { autosave } from './store.js';
import { flatten, layout } from '../core/layout.js';
import { highlight } from '../core/highlight.js';
import { hl, paint } from './paint.js';
import { parse, tablesOf } from '../core/parse.js';
import { render } from './render.js';
import { link, selOnly, snack } from './interact.js';
import { src, state, undo, world } from './state.js';
import { t, view } from './boot.js';

export function fromSource(pulseSide) {
  const err = document.getElementById('err');
  try {
    const { roots, meta } = parse(src.value);
    // The doc-bar was the literal string "collaboration-pipeline" in
    // shell.html: the SEED's frontmatter name, baked into the markup. So every
    // document that was not the seed sat under someone else's title, in every
    // host, and it looked authoritative. Read it from the document instead.
    // Here because this is the one place the source is re-parsed on any change,
    // so the bar cannot drift from the text.
    const nameEl = document.getElementById('doc-name');
    if (nameEl) nameEl.textContent = meta.name || 'untitled';
    state.roots = roots;
    state.flat = flatten(roots);
    layout(roots, 0, 40);
    render();
    if (view === 'agent') hl.innerHTML = highlight(agentText());
    else paint();
    err.textContent = '';
    if (pulseSide) pulse(pulseSide);
  } catch (e) { err.textContent = 'parse: ' + e.message; }
}

// Every canvas edit is a text splice, never a regenerate. The source stays the
// object, so comments and formatting survive a round of visual editing.
export function commit(newText, side) {
  undo.stack.push(src.value);
  if (undo.stack.length > 60) undo.stack.shift();
  undo.redo = [];
  src.value = newText;
  fromSource(side || 'p-canvas');
  syncUndo();
  autosave();
}
export function syncUndo() {
  document.getElementById('undo').disabled = !undo.stack.length;
  document.getElementById('redo').disabled = !undo.redo.length;
}
export const pulse = id => {
  const el = document.getElementById(id);
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 420);
};

/* A block's line span: its heading through its whole subtree.
   Takes explicit text, because multi-step edits (delete-many, insert-between)
   must re-span against the text they are building, not the stale textarea. */
export function spanIn(text, id) {
  const { blocks } = parse(text);
  const i = blocks.findIndex(b => b.id === id);
  if (i < 0) return null;
  const b = blocks[i];
  const next = blocks.slice(i + 1).find(x => x.depth <= b.depth);
  return { start: b.line, end: next ? next.line : text.split('\n').length, block: b, blocks };
}
export const span = id => spanIn(src.value, id);

/**
 * Put the authored heading under the user's cursor in the source editor.
 *
 * The source is a transparent textarea over a highlighted mirror. A browser
 * does not expose caret geometry for textareas, and simple `line * lineHeight`
 * arithmetic fails as soon as an earlier line wraps. Measure the prefix in a
 * short-lived mirror with the textarea's exact typography, then scroll both
 * layers together. Selecting the heading makes the landing unmistakable.
 */
export function focusSource(id) {
  const section = span(id);
  if (!section) return;
  const lines = src.value.split('\n');
  const start = lines.slice(0, section.start).reduce((count, line) => count + line.length + 1, 0);
  const end = start + (lines[section.start] || '').length;
  const style = getComputedStyle(src);
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    boxSizing: 'border-box',
    width: src.clientWidth + 'px',
    margin: '0',
    padding: style.padding,
    border: '0',
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    tabSize: style.tabSize,
    whiteSpace: style.whiteSpace,
    wordBreak: style.wordBreak,
    overflowWrap: style.overflowWrap,
  });
  mirror.append(document.createTextNode(src.value.slice(0, start)));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();

  src.setSelectionRange(start, end);
  src.focus({ preventScroll: true });
  src.scrollTop = Math.max(0, top - src.clientHeight * 0.18);
  hl.scrollTop = src.scrollTop;
  hl.scrollLeft = src.scrollLeft;
  pulse('p-src');
}

export function uniqueId(base) {
  const taken = new Set(state.flat.map(b => b.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/* ================= canvas -> source ops ================= */
export function insertNode(spec) {
  const lines = src.value.split('\n');
  const sel = state.sel ? span(state.sel) : null;
  const depth = sel ? sel.block.depth : 1;
  const at = sel ? sel.end : lines.length;
  // A tool node's anchor reads as the tool: AskUserQuestion -> #ask-user-question.
  const toolBase = spec.tool && spec.tool.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const base = spec.tag || toolBase || spec.lang || spec.type || 'node';
  const id = uniqueId(base);

  const attrs = ['#' + id];
  if (spec.type && spec.type !== 'text' && spec.type !== 'group') attrs.push('type=' + spec.type);
  if (spec.lang) attrs.push('lang=' + spec.lang);
  if (spec.tag) attrs.push('tag=' + spec.tag);
  if (spec.file) attrs.push('file=' + spec.file);
  if (spec.tool) attrs.push('tool=' + spec.tool);

  const chunk = [''];
  chunk.push(`${'#'.repeat(depth)} ${spec.label} {${attrs.join(' ')}}`);
  chunk.push('');
  if (spec.body) { chunk.push(spec.body); chunk.push(''); }
  if (spec.group) {
    chunk.push(`${'#'.repeat(depth+1)} First child {#${id}-1}`);
    chunk.push('');
    chunk.push('Nested because the heading is one level deeper.');
    chunk.push('');
  }

  lines.splice(at, 0, ...chunk);
  state.sel = id;
  commit(lines.join('\n').replace(/\n{4,}/g,'\n\n\n'));
}

// OKF: "Consumers SHOULD preserve unknown keys when round-tripping." So this
// merges keys into the existing frontmatter and never clobbers what is there.
// An existing key wins, because the author meant it.
export function insertFrontmatter(spec) {
  let text = src.value;
  const has = text.startsWith('---');
  let fmLines = [], rest = text;

  if (has) {
    const parts = text.split('---');
    fmLines = parts[1].split('\n').filter(l => l.trim());
    rest = parts.slice(2).join('---');
  }

  const present = new Set(fmLines.map(l => l.split(':')[0].trim()));
  const added = [];
  // OKF field priority: type first (the only required one), then the
  // recommended set in the spec's own order.
  Object.entries(spec.keys).forEach(([k, v]) => {
    if (present.has(k)) return;
    added.push(`${k}: ${v}`);
  });
  if (!added.length) { pulse('p-src'); return; }

  const merged = ['---', ...fmLines, ...added, '---'];
  commit(merged.join('\n') + (has ? rest : '\n\n' + rest));
}

export function deleteNode(id) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  lines.splice(s.start, s.end - s.start);
  // Drop wires pointing at what no longer exists.
  const cleaned = lines.filter(l => !new RegExp(`^->\\s*${id}(\\s|$)`).test(l.trim()));
  state.sel = null;
  commit(cleaned.join('\n').replace(/\n{4,}/g,'\n\n\n'));
}

export function shift(id, delta) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  // Move the whole subtree, or indenting a parent would orphan its children.
  for (let i = s.start; i < s.end; i++) {
    const m = lines[i].match(/^(#{1,6})(\s+.*)$/);
    if (!m) continue;
    const d = Math.min(6, Math.max(1, m[1].length + delta));
    lines[i] = '#'.repeat(d) + m[2];
  }
  commit(lines.join('\n'));
}

// Daniel: "Edit only edits the title, but not the body."
// Correct. Rewrite the body while keeping the edges, which live in the same
// span and must not be swallowed by a body edit.
export function updateNode(id, title, text) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  const heading = lines[s.start].match(/^(#{1,6})\s+(.*?)(\s*\{[^}]*\})?\s*$/);
  if (!heading) return;
  lines[s.start] = `${heading[1]} ${(title || '').trim() || 'Untitled'}${heading[3] || ''}`;

  const inner = lines.slice(s.start + 1, s.end);
  // Anything belonging to a child heading stays put too.
  const childAt = inner.findIndex(l => /^#{1,6}\s/.test(l));
  const tail = childAt >= 0 ? inner.slice(childAt) : [];
  const own = childAt >= 0 ? inner.slice(0, childAt) : inner;
  // Keep this block's own wires; they are not body, they are structure. Do not
  // copy wires from descendants, which already survive inside `tail`.
  const edges = own.filter(l => /^->\s*#?[\w-]+/.test(l.trim()));

  const body = text.trim();
  const rebuilt = [''];
  if (body) { rebuilt.push(body, ''); }
  edges.forEach(e => rebuilt.push(e.trim()));
  if (edges.length) rebuilt.push('');
  if (tail.length) rebuilt.push(...tail);

  lines.splice(s.start + 1, s.end - s.start - 1, ...rebuilt);
  commit(lines.join('\n').replace(/\n{4,}/g, '\n\n\n'));
}

export function setBody(id, text) {
  const block = state.flat.find(item => item.id === id);
  if (!block) return;
  updateNode(id, block.title, text);
}

// Daniel: "I want to be able to edit exactly the cell when I double click."
// A table is markdown in the body, so editing a cell is a surgical rewrite of
// one pipe-separated field. Row/col index in, source out.
export function setCell(id, tableIndex, row, col, value) {
  const b = state.flat.find(x => x.id === id);
  if (!b) return;
  const tbl = tablesOf(b.body)[tableIndex];
  if (!tbl) return;
  const head = [...tbl.head];
  const rows = tbl.rows.map(r => [...r]);
  const clean = value.replace(/\n/g, ' ').trim();
  if (row === -1) head[col] = clean; else rows[row][col] = clean;
  replaceTable(id, tbl, renderTable(head, rows));
}

export function renderTable(head, rows) {
  const clean = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const out = ['| ' + head.map(clean).join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'];
  rows.forEach(r => {
    // Pad short rows so the markdown stays well-formed.
    const cells = head.map((_, i) => clean(r[i] !== undefined ? r[i] : ''));
    out.push('| ' + cells.join(' | ') + ' |');
  });
  return out.join('\n');
}

function replaceTable(id, table, markdown) {
  const b = state.flat.find(x => x.id === id);
  if (!b) return;
  const lines = b.body.split('\n');
  lines.splice(table.start, table.end - table.start, ...markdown.split('\n'));
  setBody(id, lines.join('\n'));
}

export function addRow(id, tableIndex = 0) {
  const b = state.flat.find(x => x.id === id);
  const tbl = tablesOf(b && b.body)[tableIndex];
  if (!tbl) return;
  replaceTable(id, tbl, renderTable(tbl.head, [...tbl.rows, tbl.head.map(() => '')]));
}
export function addCol(id, tableIndex = 0) {
  const b = state.flat.find(x => x.id === id);
  const tbl = tablesOf(b && b.body)[tableIndex];
  if (!tbl) return;
  replaceTable(id, tbl, renderTable([...tbl.head, 'New'], tbl.rows.map(r => [...r, ''])));
}
export function delRow(id, tableIndex = 0, row) {
  const b = state.flat.find(x => x.id === id);
  const tbl = tablesOf(b && b.body)[tableIndex];
  if (!tbl || tbl.rows.length <= 1) return;
  replaceTable(id, tbl, renderTable(tbl.head, tbl.rows.filter((_, i) => i !== row)));
}
export function delCol(id, tableIndex = 0, col) {
  const b = state.flat.find(x => x.id === id);
  const tbl = tablesOf(b && b.body)[tableIndex];
  if (!tbl || tbl.head.length <= 1) return;
  replaceTable(id, tbl, renderTable(tbl.head.filter((_, i) => i !== col),
                                    tbl.rows.map(r => r.filter((_, i) => i !== col))));
}

// Click straight into a cell. No edit mode, no toolbar hop: the cell you
// pointed at is the cell you type in.
export function editCell(td, id, tableIndex, row, col) {
  if (td.isContentEditable) return;
  const original = td.dataset.raw ?? td.textContent;
  // The displayed cell is rendered Markdown and may also carry a delete
  // button. Editing swaps in the exact source value, then a normal render puts
  // the presentation back. This is the same source/render split as node prose.
  td.textContent = original;
  td.setAttribute('contenteditable', 'plaintext-only');
  td.classList.add('editing-cell');
  td.focus();
  document.getSelection().selectAllChildren(td);
  let done = false;
  const finish = keep => {
    if (done) return;
    done = true;
    const v = td.textContent;
    td.removeAttribute('contenteditable');
    td.classList.remove('editing-cell');
    if (keep && v !== original) setCell(id, tableIndex, row, col, v);
    else fromSource();
  };
  td.addEventListener('keydown', ev => {
    ev.stopPropagation();          // Delete/Cmd+A belong to the cell, not the canvas
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); td.textContent = original; finish(false); }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      finish(true);
      // Hop to the next cell, which is what a table wants.
      setTimeout(() => {
        let next = world.querySelector(`[data-id="${id}"] [data-table="${tableIndex}"][data-cell="${row},${col + 1}"]`);
        if (!next) {
          const nextRow = row < 0 ? 0 : row + 1;
          next = world.querySelector(`[data-id="${id}"] [data-table="${tableIndex}"][data-cell="${nextRow},0"]`);
        }
        if (next) next.click();
      }, 30);
    }
  });
  td.addEventListener('blur', () => finish(true), { once: true });
}

// One edit session covers title AND body. Enter in the title hops to the body;
// in the body it is a newline, because a body with newlines is the point.
export function startEdit(id, which) {
  const node = world.querySelector(`[data-id="${id}"]`);
  if (!node) return;
  const b = state.flat.find(x => x.id === id);
  if (!b) return;

  node.classList.add('editing');   // height:auto, so it grows as you type

  let content = node.querySelector('.n-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'n-content';
    node.insertBefore(content, node.querySelector('.n-meta'));
  }
  let bodyEl = content.querySelector('.n-body');
  if (!bodyEl) {
    // A node with no prose yet still needs somewhere to type.
    bodyEl = document.createElement('div');
    bodyEl.className = 'n-body';
  }
  // A mixed body may have several rendered prose fragments and tables. Whole
  // body editing is one raw source field; visual table editing stays per-cell.
  content.replaceChildren(bodyEl);
  const titleEl = node.querySelector('.n-title');

  [titleEl, bodyEl].forEach(el => el.setAttribute('contenteditable', 'plaintext-only'));
  bodyEl.dataset.placeholder = 'Body…';

  // What is on screen is the RENDERING, not the source: prose bodies render
  // their markdown as HTML and a fenced body renders as bare highlighted code.
  // Committing that innerText back through setBody would strip the syntax it
  // was rendered from — the fence-eating bug: click into a code node, click
  // out, and the ``` markers were gone. So the edit session swaps in the raw
  // source; every exit path below re-renders, so the swap never sticks.
  bodyEl.textContent = b.body || '';

  const target = which === 'body' ? bodyEl : titleEl;
  target.focus();
  document.getSelection().selectAllChildren(target);
  document.getSelection().collapseToEnd();

  let done = false;
  const finish = (commitIt) => {
    if (done) return;
    done = true;
    const newTitle = titleEl.textContent.trim();
    const newBody = bodyEl.innerText.replace(/ /g, ' ').trim();
    [titleEl, bodyEl].forEach(el => el.removeAttribute('contenteditable'));
    node.classList.remove('editing');
    if (!commitIt) { fromSource(); return; }
    // Title first: setBody re-spans, so a stale heading line would corrupt it.
    if (newTitle && newTitle !== b.title) renameNode(id, newTitle);
    if (newBody !== (b.body || '').trim()) setBody(id, newBody);
    else fromSource();
  };

  const onKey = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    if (ev.key === 'Enter' && ev.target === titleEl) { ev.preventDefault(); bodyEl.focus(); }
    if (ev.key === 'Enter' && ev.metaKey) { ev.preventDefault(); finish(true); }
  };
  const onBlur = () => setTimeout(() => {
    // Only finish when focus has left the node entirely, or hopping from title
    // to body would commit half an edit.
    if (!node.contains(document.activeElement)) finish(true);
  }, 0);

  [titleEl, bodyEl].forEach(el => {
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  });
}

export function renameNode(id, title) {
  const block = state.flat.find(item => item.id === id);
  if (!block) return;
  updateNode(id, title, block.body || '');
}

/**
 * Persist a heading's collapsed state, then return its geometry to layout.
 *
 * A manual `size=` is useful while shaping a card, but it is the wrong thing
 * to restore after a collapse: the content or descendants may have changed,
 * and the old rectangle can land across its neighbours. Toggling therefore
 * opts the node back into content measurement. Collapse gets the compact
 * layout size; expand gets the browser-measured natural size.
 */
export function toggleCollapsed(id) {
  const s = span(id);
  const block = state.flat.find(item => item.id === id);
  if (!s || !block) return;
  const lines = src.value.split('\n');
  const m = lines[s.start].match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
  if (!m) return;
  const toks = (m[3] || '').split(/\s+/).filter(Boolean)
    .filter(tok =>
      tok !== 'collapsed'
      && tok !== 'collapsed=true'
      && !tok.startsWith('size=')
    );
  if (!block.collapsed) toks.push('collapsed');
  lines[s.start] = `${m[1]} ${m[2]}${toks.length ? ' {' + toks.join(' ') + '}' : ''}`;
  delete state.size[id];
  selOnly(id);
  commit(lines.join('\n'));
}

/** Drop every pinned @position and return ownership to the clean auto-layout. */
export function autoArrange() {
  state.pos = {};
  state.keepPos = false;
  document.getElementById('pos')?.setAttribute('aria-pressed', 'false');
  const out = src.value.split('\n').map(line => {
    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
    if (!h || !h[3]) return line;
    const toks = h[3].split(/\s+/).filter(Boolean).filter(tok => !tok.startsWith('@'));
    return `${h[1]} ${h[2]}${toks.length ? ' {' + toks.join(' ') + '}' : ''}`;
  }).join('\n');
  if (out === src.value) fromSource('p-canvas');
  else commit(out, 'p-canvas');
}

export function connect(fromId, toId) {
  const from = state.flat.find(x => x.id === fromId);
  if (from && from.edges.some(e => e.to === toId)) {
    snack(`<strong>${from.title}</strong> already wires to <code>#${toId}</code>.`, []);
    render();   // clear the in-flight link state; bailing without this stranded it
    return;
  }
  const s = span(fromId);
  if (!s) return;
  const lines = src.value.split('\n');
  let at = s.start + 1;
  while (at < s.end && !/^#{1,6}\s/.test(lines[at])) at++;
  // Sit the wire directly under the heading's own content, above any child.
  let ins = at;
  while (ins > s.start + 1 && lines[ins-1].trim() === '') ins--;
  lines.splice(ins, 0, '', `-> #${toId}`);
  commit(lines.join('\n').replace(/\n{4,}/g,'\n\n\n'));
}

// Insert a node into an existing edge: A -> B becomes A -> C -> B. Three text
// edits, in an order that cannot leave a dangling wire: add C, rewire A, done.
export function insertBetween(fromId, toId) {
  const id = uniqueId('step');
  let lines = src.value.split('\n');
  const s = spanIn(src.value, fromId);
  if (!s) return;

  // Retarget A's wire at the new node, leaving any other edge of A alone.
  let rewired = false;
  for (let i = s.start; i < s.end; i++) {
    const m = lines[i].trim().match(/^->\s*#?([\w-]+)(\s+"[^"]*")?\s*$/);
    if (m && m[1] === toId && !rewired) {
      lines[i] = `-> #${id}${m[2] || ''}`;
      rewired = true;
    }
  }
  if (!rewired) return;

  // Then place C after A's subtree, carrying the wire on to B.
  const at = spanIn(lines.join('\n'), fromId).end;
  const depth = s.block.depth;
  lines.splice(at, 0, '', `${'#'.repeat(depth)} Step {#${id}}`, '', `-> #${toId}`, '');
  selOnly(id);
  commit(lines.join('\n').replace(/\n{4,}/g, '\n\n\n'));
}

/* positions: presentation, so opt-in only */
export function writePositions() {
  const out = src.value.split('\n').map(line => {
    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
    if (!h) return line;
    let toks = (h[3] || '').split(/\s+/).filter(Boolean).filter(t => !t.startsWith('@'));
    const id = (toks.find(t => t.startsWith('#')) || '').slice(1);
    if (state.keepPos && state.pos[id]) {
      toks.push(`@${Math.round(state.pos[id].x)},${Math.round(state.pos[id].y)}`);
    }
    return `${h[1]} ${h[2]}${toks.length ? ' {'+toks.join(' ')+'}' : ''}`;
  }).join('\n');
  commit(out);
}

/**
 * Point a File node at a different URI.
 *
 * Same shape as setColor: rewrite one token on the heading and leave every other
 * token alone. The filter is what does that, and it is why `{#id @x,y type=file}`
 * survives a re-pick. Attributes are a set, not a string to regenerate.
 *
 * A falsy uri REMOVES file=, which is how you clear a node without hand-editing
 * the heading. `file=` with nothing after it would parse to an empty string and
 * render as a chip containing no path.
 */
/* The resize grip's landing: write `size=WxH` into the heading attrs, the
   way writePositions writes `@x,y`. Round to ints; the token grammar has no
   room for a locale's decimal comma. */
export function setSize(id, w, h) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  const m = lines[s.start].match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
  if (!m) return;
  const toks = (m[3] || '').split(/\s+/).filter(Boolean).filter(t => !t.startsWith('size='));
  toks.push(`size=${Math.max(1, Math.round(w))}x${Math.max(1, Math.round(h))}`);
  lines[s.start] = `${m[1]} ${m[2]}${toks.length ? ' {' + toks.join(' ') + '}' : ''}`;
  commit(lines.join('\n'));
}

export function setFile(id, uri) {
  const s = span(id);
  if (!s) return;
  const lines = src.value.split('\n');
  const m = lines[s.start].match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
  if (!m) return;
  const toks = (m[3] || '').split(/\s+/).filter(Boolean).filter(t => !t.startsWith('file='));
  // Defend the delimiters here too, not only in whoever supplies the uri. A
  // stray `}` closes the attribute block early and a space starts a new token,
  // so either one silently rewrites the heading into something else. This is
  // the last place that can tell, and the caller may be a host we did not
  // write. (A picker DID hand this a "/a/b.llm}" once, from a \S+ regex.)
  if (uri) toks.push('file=' + String(uri).trim().replace(/[}\s]+$/g, ''));
  lines[s.start] = `${m[1]} ${m[2]}${toks.length ? ' {' + toks.join(' ') + '}' : ''}`;
  commit(lines.join('\n'));
}
