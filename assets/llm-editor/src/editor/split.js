/* GENERATED from llm-editor src/editor/split.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/* Split-handle drag: canvas | source panes resize horizontally.
   Writes --split-l / --split-r as fr RATIOS (editor.css says why: a ratio
   survives a window resize; pixels strand a pane at a stale width). Persists
   the ratio, arrows resize from the keyboard, double-click resets. The handle
   only exists in shells that ship it, so every hook bails when it is absent
   rather than making older embeds throw.

   Names are prefixed (persistSplit, not persist) because the artifact bundle
   flattens every module into ONE scope, and store.js already owns persist().
   Two function declarations with one name do not error in a classic script,
   the later one silently wins, and the loser here would have been the
   document save. seam.mjs asserts this, but only for names it can see. */
import { src } from './state.js';

const SPLIT_KEY = 'llm-editor:split';
const splitHandle = document.getElementById('split-handle');
const splitEl = splitHandle ? splitHandle.closest('.split') : null;

/* Clamped to the aria-valuemin/max the shell declares (20–80%): below that a
   pane's minmax(240px) floor wins anyway and the drag just feels dead. */
function applySplit(pct) {
  const p = Math.min(80, Math.max(20, pct));
  splitEl.style.setProperty('--split-l', `${p}fr`);
  splitEl.style.setProperty('--split-r', `${100 - p}fr`);
  splitHandle.setAttribute('aria-valuenow', String(Math.round(p)));
  return p;
}

function resetSplit() {
  splitEl.style.removeProperty('--split-l');
  splitEl.style.removeProperty('--split-r');
  splitHandle.removeAttribute('aria-valuenow');
  try { localStorage.removeItem(SPLIT_KEY); } catch { /* private mode */ }
}

function persistSplit(p) {
  try { localStorage.setItem(SPLIT_KEY, String(p)); } catch { /* private mode */ }
}

if (splitHandle && splitEl) {
  const stored = (() => {
    try { return parseFloat(localStorage.getItem(SPLIT_KEY)); } catch { return NaN; }
  })();
  if (!Number.isNaN(stored)) applySplit(stored);

  let live = NaN;
  splitHandle.addEventListener('pointerdown', e => {
    e.preventDefault();
    splitHandle.setPointerCapture(e.pointerId);
    splitHandle.classList.add('dragging');
    /* Dragging over the textarea would start a text selection mid-resize. */
    src.style.userSelect = 'none';
  });
  splitHandle.addEventListener('pointermove', e => {
    if (!splitHandle.classList.contains('dragging')) return;
    const r = splitEl.getBoundingClientRect();
    if (!r.width) return;
    live = applySplit(((e.clientX - r.left) / r.width) * 100);
  });
  const endSplitDrag = () => {
    if (!splitHandle.classList.contains('dragging')) return;
    splitHandle.classList.remove('dragging');
    src.style.userSelect = '';
    if (!Number.isNaN(live)) persistSplit(live);
  };
  splitHandle.addEventListener('pointerup', endSplitDrag);
  splitHandle.addEventListener('pointercancel', endSplitDrag);
  splitHandle.addEventListener('dblclick', resetSplit);
  splitHandle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    // No aria-valuenow means nothing stored and nothing dragged yet, so the
    // panes still sit at the CSS default, 1.3fr : 1fr.
    const now = parseFloat(splitHandle.getAttribute('aria-valuenow')) ||
      (1.3 / 2.3) * 100;
    persistSplit(applySplit(now + (e.key === 'ArrowRight' ? 2 : -2)));
  });
}
