/* GENERATED from llm-editor src/editor/view.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { recentre } from '../core/layout.js';
import { faSvg } from './icons.js';
import { clip, src, stage, state, visibleBlocks } from './state.js';
import { deleteEdge } from './toolbar.js';
import { deleteSelected, doRedo, doUndo, pasteChunk } from './panels.js';
import { render } from './render.js';
import { autoArrange, span } from './edit-ops.js';
import { drag, syncSel } from './interact.js';
import { t } from './boot.js';

/* ================= zoom / fit ================= */
export const ZMIN = 0.25, ZMAX = 2;
export function setZoom(z, keepCentre = true) {
  const prev = state.zoom || 1;
  state.zoom = Math.min(ZMAX, Math.max(ZMIN, +z.toFixed(2)));
  // Hold the viewport's centre still, or zooming walks the graph off-screen.
  if (keepCentre && prev !== state.zoom) {
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    const k = state.zoom / prev;
    stage.scrollLeft = cx * k - stage.clientWidth / 2;
    stage.scrollTop = cy * k - stage.clientHeight / 2;
  }
  // Re-centre for the NEW zoom before drawing. setZoom does not run layout, so
  // without this originX keeps whatever value 100% gave it and the graph drifts
  // off-centre as you zoom.
  recentre(state.roots);
  render();
  document.getElementById('z-pct').textContent = Math.round(state.zoom * 100) + '%';
}

export function fitView() {
  const all = visibleBlocks();
  if (!all.length) return;
  const minX = Math.min(...all.map(b => b.rect.x));
  const maxX = Math.max(...all.map(b => b.rect.x + b.rect.w));
  const minY = Math.min(...all.map(b => b.rect.y));
  const maxY = Math.max(...all.map(b => b.rect.y + b.rect.h));
  const pad = 40;
  const z = Math.min(
    (stage.clientWidth - pad * 2) / Math.max(1, maxX - minX),
    (stage.clientHeight - pad * 2) / Math.max(1, maxY - minY),
  );
  state.zoom = Math.min(ZMAX, Math.max(ZMIN, +z.toFixed(2)));
  // Re-centre for the NEW zoom before drawing. setZoom does not run layout, so
  // without this originX keeps whatever value 100% gave it and the graph drifts
  // off-centre as you zoom.
  recentre(state.roots);
  render();
  document.getElementById('z-pct').textContent = Math.round(state.zoom * 100) + '%';
  // Scroll the content's own box to the middle of the stage.
  stage.scrollLeft = Math.max(0, (minX + (maxX - minX) / 2) * state.zoom
    + state.originX * state.zoom - stage.clientWidth / 2);
  stage.scrollTop = Math.max(0, (minY + (maxY - minY) / 2) * state.zoom - stage.clientHeight / 2);
}

document.getElementById('z-in').addEventListener('click', () => setZoom((state.zoom || 1) + 0.15));
document.getElementById('z-out').addEventListener('click', () => setZoom((state.zoom || 1) - 0.15));
document.getElementById('z-fit').addEventListener('click', fitView);
document.getElementById('z-reset').addEventListener('click', () => setZoom(1));
document.getElementById('z-arrange').addEventListener('click', () => {
  autoArrange();
  requestAnimationFrame(fitView);
});

// Cmd/Ctrl + wheel is the zoom gesture everywhere else; honour it here.
stage.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom((state.zoom || 1) + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

/* ================= keyboard ================= */
// The textarea gets native undo/cut/copy/select-all for free, and fighting it
// would be worse than useless. So these only fire when the canvas has focus.
export function inText(t) {
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
}
document.addEventListener('keydown', e => {
  if (inText(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? doRedo() : doUndo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((state.zoom||1) + 0.15); return; }
  if (mod && e.key === '-') { e.preventDefault(); setZoom((state.zoom||1) - 0.15); return; }
  if (mod && e.key === '0') { e.preventDefault(); setZoom(1); return; }
  if (e.key.toLowerCase() === 'f' && !mod) { e.preventDefault(); fitView(); return; }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    state.selected = new Set(visibleBlocks().map(b => b.id));
    syncSel(); render();
    return;
  }
  if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
    if (!state.selected.size) return;
    e.preventDefault();
    clip.text = [...state.selected].map(id => {
      const s = span(id);
      return s ? src.value.split('\n').slice(s.start, s.end).join('\n') : '';
    }).filter(Boolean).join('\n');
    navigator.clip.text?.writeText(clip.text).catch(() => {});
    if (e.key.toLowerCase() === 'x') deleteSelected();
    return;
  }
  if (mod && e.key.toLowerCase() === 'v') {
    if (!clip.text) return;
    e.preventDefault();
    pasteChunk(clip.text);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selEdge) { e.preventDefault(); deleteEdge(state.selEdge.from, state.selEdge.to); return; }
    if (!state.selected.size) return;
    e.preventDefault();
    deleteSelected();
  }
});

/* ================= hand / pan =================
Daniel: "We also need a 'hand' drag screen, especially when zooming."

Especially when zooming is the whole point. At 200% the graph is larger than
the stage, and the only ways across it were the scrollbars or fit-to-view, which
throws away the zoom you just chose.

Panning writes stage.scrollLeft/Top rather than adding a translate to #world.
#stage is already `overflow: auto`, so scrolling IS the viewport, and hijacking
the transform would mean teaching toWorld(), the marquee, fitView() and the
scrollbars about a second offset. One source of truth for "where are we".

Three ways in, because canvas muscle memory differs: hold Space (Figma, Sketch,
Illustrator), middle-drag (CAD, browsers), or latch the tool with the button.
*/
let pan = null;
let spaceHeld = false;
let latched = false;

const handBtn = document.getElementById('z-hand');
handBtn.innerHTML = faSvg('hand', 14);

function handMode() { return spaceHeld || latched; }

function syncHand() {
  stage.classList.toggle('hand', handMode());
  handBtn.setAttribute('aria-pressed', String(latched));
}

handBtn.addEventListener('click', () => { latched = !latched; syncHand(); });

document.addEventListener('keydown', e => {
  // Space in a textarea is a space. inText() also covers contenteditable, which
  // is what a node body and a table cell are.
  if (e.code !== 'Space' || spaceHeld || inText(e.target)) return;
  spaceHeld = true;
  syncHand();
  e.preventDefault();          // or the stage scrolls a page down under us
});

document.addEventListener('keyup', e => {
  if (e.code !== 'Space') return;
  spaceHeld = false;
  syncHand();
});

// Losing the window mid-hold would otherwise strand the hand cursor on, because
// the keyup lands somewhere else entirely.
window.addEventListener('blur', () => { spaceHeld = false; pan = null; stage.classList.remove('panning'); syncHand(); });

// Capture phase, and stopPropagation: interact.js binds pointerdown on the same
// element to start a marquee or a node drag. Without capture, pan would run
// second and the marquee would already have claimed the gesture.
stage.addEventListener('pointerdown', e => {
  const wants = handMode() || e.button === 1;     // 1 = middle
  if (!wants) return;
  e.preventDefault();
  e.stopPropagation();
  pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('panning');
}, true);

stage.addEventListener('pointermove', e => {
  if (!pan) return;
  e.stopPropagation();
  // No zoom division here: scrollLeft is in the SAME pixels as clientX. The
  // world's scale() is already baked into the scrollable extent, so dividing
  // would make the graph lag the cursor at anything but 100%.
  stage.scrollLeft = pan.sl - (e.clientX - pan.x);
  stage.scrollTop = pan.st - (e.clientY - pan.y);
}, true);

stage.addEventListener('pointerup', e => {
  if (!pan) return;
  e.stopPropagation();
  pan = null;
  stage.classList.remove('panning');
}, true);
