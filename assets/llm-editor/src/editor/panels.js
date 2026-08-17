/* GENERATED from llm-editor src/editor/panels.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { SEED } from './seed.js';
import { commit, fromSource, span, spanIn, syncUndo, writePositions } from './edit-ops.js';
import { hist, src, state, undo } from './state.js';
import { autosave, persist, renderRevList } from './store.js';
import { selOnly } from './interact.js';


export function deleteSelected() {
  // Delete deepest-first so removing a parent cannot invalidate a child's span.
  const ids = [...state.selected].sort((a, b) => {
    const A = state.flat.find(x => x.id === a), B = state.flat.find(x => x.id === b);
    return (B?.line || 0) - (A?.line || 0);
  });
  let text = src.value;
  ids.forEach(id => {
    const s = spanIn(text, id);
    if (!s) return;
    const lines = text.split('\n');
    lines.splice(s.start, s.end - s.start);
    text = lines.filter(l => !new RegExp(`^->\\s*#?${id}(\\s|$)`).test(l.trim())).join('\n');
  });
  selOnly(null);
  commit(text.replace(/\n{4,}/g, '\n\n\n'));
}
export function pasteChunk(chunk) {
  const lines = src.value.split('\n');
  const sel = state.sel ? span(state.sel) : null;
  const at = sel ? sel.end : lines.length;
  // Re-id, or the paste collides with what it was copied from.
  const taken = new Set(state.flat.map(b => b.id));
  const re = chunk.replace(/\{#([\w-]+)/g, (m, id) => {
    let n = id, i = 2;
    while (taken.has(n)) n = `${id}-${i++}`;
    taken.add(n);
    return `{#${n}`;
  });
  lines.splice(at, 0, '', ...re.split('\n'));
  commit(lines.join('\n').replace(/\n{4,}/g, '\n\n\n'));
}
export function doUndo() {
  if (!undo.stack.length) return;
  undo.redo.push(src.value);
  src.value = undo.stack.pop();
  fromSource('p-canvas'); syncUndo();
  autosave();
}
export function doRedo() {
  if (!undo.redo.length) return;
  undo.stack.push(src.value);
  src.value = undo.redo.pop();
  fromSource('p-canvas'); syncUndo();
  autosave();
}

/* ================= header controls ================= */
document.getElementById('pos').addEventListener('click', e => {
  state.keepPos = !state.keepPos;
  e.currentTarget.setAttribute('aria-pressed', String(state.keepPos));
  writePositions();
});
document.getElementById('snap').addEventListener('click', e => {
  state.snap = !state.snap;
  e.currentTarget.setAttribute('aria-pressed', String(state.snap));
  fromSource('p-canvas');
});
document.getElementById('undo').addEventListener('click', () => {
  if (!undo.stack.length) return;
  undo.redo.push(src.value);
  src.value = undo.stack.pop();
  fromSource('p-canvas');
  syncUndo();
  autosave();
});
document.getElementById('redo').addEventListener('click', () => {
  if (!undo.redo.length) return;
  undo.stack.push(src.value);
  src.value = undo.redo.pop();
  fromSource('p-canvas');
  syncUndo();
  autosave();
});
document.getElementById('reset').addEventListener('click', () => {
  hist.list = [{ ts: Date.now(), text: SEED }];
  hist.picked = null;
  undo.stack = []; undo.redo = [];
  state.pos = {}; state.size = {}; state.sel = null;
  state.keepPos = false; state.snap = true; state.linking = null;
  document.getElementById('pos').setAttribute('aria-pressed','false');
  document.getElementById('snap').setAttribute('aria-pressed','true');
  src.value = SEED;
  fromSource();
  syncUndo();
  persist();
  renderRevList();
});

/* ================= autosave + hist.list ================= */
// Mirrors what ci_canvas already declares: supports => hist.list, autosave.
// So this is not an invention, it is the WordPress model. Storage is
// localStorage here because an artifact has no DB; in CI it would be the
// post's own revision table.
export const STORE = 'llm-editor:doc', REVS = 'llm-editor:revs';
export const REV_CAP = 30;
