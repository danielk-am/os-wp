/* GENERATED from llm-editor src/editor/interact.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { connect, fromSource, pulse, setSize, shift, startEdit, writePositions } from './edit-ops.js';
import { CANVAS_GUTTER, GRID, snap } from '../core/grid.js';
import { refreshSel } from './inserter.js';
import { render } from './render.js';
import { stage, state, visibleBlocks, world } from './state.js';

export function toWorld(e) {
  // Against #world, not #stage: world carries a transform, so a stage-relative
  // sum would miss the centring. Divide by zoom because the rect is scaled but
  // the rects stored on nodes are not.
  const r = world.getBoundingClientRect();
  const z = state.zoom || 1;
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
}

export const selOnly = id => { state.selected = new Set(id ? [id] : []); state.sel = id || null; };
export function syncSel() {
  // The block toolbar acts on one node, so it only makes sense at exactly one.
  state.sel = state.selected.size === 1 ? [...state.selected][0] : null;
}

stage.addEventListener('dblclick', e => {
  const node = e.target.closest('.node');
  if (!node || node.classList.contains('editing')) return;
  // Tables already have a better editor: click the exact cell and type. Do not
  // replace the rendered table with the whole raw body on a double-click.
  if (e.target.closest('.n-table')) return;
  startEdit(node.dataset.id, e.target.closest('.n-body') ? 'body' : 'title');
});

export let drag = null, link = null, marq = null;
let resize = null;   // the n-resize grip's drag, exclusive with the others
export const marquee = document.getElementById('marquee');
const MIN_NODE_W = GRID * 20, MIN_NODE_H = GRID * 3;

function resizedRect(start, corner, dx, dy) {
  const west = corner.includes('w');
  const north = corner.includes('n');
  const w = Math.max(MIN_NODE_W, start.w + (west ? -dx : dx));
  const h = Math.max(MIN_NODE_H, start.h + (north ? -dy : dy));
  const raw = {
    x: west ? start.x + start.w - w : start.x,
    y: north ? start.y + start.h - h : start.y,
    w, h,
  };
  if (!state.snap) {
    const left = Math.max(CANVAS_GUTTER, raw.x);
    const top = Math.max(CANVAS_GUTTER, raw.y);
    return {
      x: left,
      y: top,
      w: west ? Math.max(MIN_NODE_W, start.x + start.w - left) : raw.w,
      h: north ? Math.max(MIN_NODE_H, start.y + start.h - top) : raw.h,
    };
  }

  const fixedRight = start.x + start.w;
  const fixedBottom = start.y + start.h;
  let left = west ? snap(raw.x) : start.x;
  let right = west ? fixedRight : snap(raw.x + raw.w);
  let top = north ? snap(raw.y) : start.y;
  let bottom = north ? fixedBottom : snap(raw.y + raw.h);
  left = Math.max(CANVAS_GUTTER, left);
  top = Math.max(CANVAS_GUTTER, top);
  if (right - left < MIN_NODE_W) west ? left = right - MIN_NODE_W : right = left + MIN_NODE_W;
  if (bottom - top < MIN_NODE_H) north ? top = bottom - MIN_NODE_H : bottom = top + MIN_NODE_H;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

stage.addEventListener('pointerdown', e => {
  if (e.target.closest('#blockbar') || e.target.closest('.edge-add')) return;
  if (e.target.closest('button, input, a')) return;
  if (e.target.closest('[contenteditable]')) return;
  if (e.target.closest('.node.editing')) return;

  // Port -> start a wire.
  const port = e.target.closest('.port');
  if (port) {
    e.preventDefault();
    // Remember WHICH port. The ghost has to leave from the handle under your
    // finger: Daniel grabbed the right port and the wire came out of the middle
    // of the node, which reads as "it ignored my click".
    //
    // This does not contradict sides-are-presentation. That rule is about the
    // FILE: a committed edge stores no side and re-derives it from geometry on
    // every render, so dragging a node re-routes it. But during the gesture the
    // side is not presentation, it is the gesture, and feedback that does not
    // track the pointer is just wrong.
    const side = ['t', 'b'].find(s => port.classList.contains(s));
    link = { from: port.closest('.node').dataset.id, side, to: toWorld(e) };
    stage.setPointerCapture(e.pointerId);
    render();
    return;
  }

  const grip = e.target.closest('.n-resize');
  if (grip) {
    const gel = grip.closest('.node');
    const gb = gel && state.flat.find(x => x.id === gel.dataset.id);
    if (gb) {
      const w = toWorld(e);
      resize = {
        id: gb.id,
        el: gel,
        corner: grip.dataset.corner || 'se',
        start: { ...gb.rect },
        pointer: w,
        live: null,
      };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
  }

  const el = e.target.closest('.node');
  if (!el) {
    // Empty canvas: arm the rubber band, but do not show it yet. Unhiding here
    // flashed the PREVIOUS drag's rectangle on every plain click, because the
    // geometry is only written on move.
    state.selEdge = null;
    const w = toWorld(e);
    marq = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: e.shiftKey, live: false };
    if (!e.shiftKey) selOnly(null);
    refreshSel();
    return;
  }

  const id = el.dataset.id;
  const b = state.flat.find(x => x.id === id);
  if (!b) return;
  state.selEdge = null;

  if (state.linking && state.linking !== id) {   // toolbar link mode
    const from = state.linking;
    state.linking = null;
    connect(from, id);
    return;
  }

  if (e.shiftKey || e.metaKey) {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    syncSel();
  } else if (!state.selected.has(id)) {
    selOnly(id);
  }

  const w = toWorld(e);
  // Dragging a group carries its whole subtree. A group's box is derived from
  // its children, so moving the box alone strands them outside it and they all
  // read as strayed, which is what happened in Daniel's screenshot: the boxes
  // moved right and the children stayed put.
  const withKids = new Set();
  state.selected.forEach(sid => {
    const n = state.flat.find(x => x.id === sid);
    if (!n) return;
    (function walk(node) { withKids.add(node.id); node.children.forEach(walk); })(n);
  });

  drag = {
    moved: false,
    id,
    plain: !e.shiftKey && !e.metaKey,
    // Only the nodes the user actually selected are boundary-checked; children
    // dragged along by their parent have not "strayed" anywhere.
    checkIds: [...state.selected],
    items: [...withKids].map(sid => {
      const n = state.flat.find(x => x.id === sid);
      // A collapsed group's descendants stay in the parsed tree but have no
      // rendered rect. They are invisible and layout will place them again on
      // expand, so there is neither geometry nor a reason to drag them now.
      return n && n.rect ? { id: sid, dx: w.x - n.rect.x, dy: w.y - n.rect.y } : null;
    }).filter(Boolean)
  };
  refreshSel();
});

stage.addEventListener('pointermove', e => {
  const w = toWorld(e);
  if (resize) {
    // Live via style only; layout re-runs once from the committed size= token
    // on release. The opposite corner stays fixed, so all four grips behave
    // like the matching handles in a design tool.
    const live = resizedRect(resize.start, resize.corner, w.x - resize.pointer.x, w.y - resize.pointer.y);
    Object.assign(resize.el.style, {
      left: live.x + 'px', top: live.y + 'px',
      width: live.w + 'px', height: live.h + 'px',
    });
    resize.live = live;
    return;
  }
  if (link) { link.to = w; render(); return; }
  if (marq) {
    marq.x1 = w.x; marq.y1 = w.y;
    const x = Math.min(marq.x0, marq.x1), y = Math.min(marq.y0, marq.y1);
    const wd = Math.abs(marq.x1 - marq.x0), ht = Math.abs(marq.y1 - marq.y0);
    // A few px of slop, so a slightly shaky click is still a click.
    if (!marq.live && wd < 4 && ht < 4) return;
    const wr = world.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const ox = wr.left - sr.left, oy = wr.top - sr.top;
    Object.assign(marquee.style, {
      left: (x + ox) + 'px', top: (y + oy) + 'px',
      width: wd + 'px', height: ht + 'px'
    });
    // Geometry is written, so it is now safe to show.
    marq.live = true;
    marquee.hidden = false;
    const hit = visibleBlocks().filter(b =>
      b.rect.x < x + wd && b.rect.x + b.rect.w > x &&
      b.rect.y < y + ht && b.rect.y + b.rect.h > y);
    if (!marq.additive) state.selected = new Set();
    hit.forEach(b => state.selected.add(b.id));
    syncSel();
    render();
    return;
  }
  if (!drag) return;
  drag.moved = true;
  const primary = drag.items.find(item => item.id === drag.id) || drag.items[0];
  const rawPrimary = primary
    ? { x: w.x - primary.dx, y: w.y - primary.dy }
    : { x: w.x, y: w.y };
  const snapDx = state.snap ? snap(rawPrimary.x) - rawPrimary.x : 0;
  const snapDy = state.snap ? snap(rawPrimary.y) - rawPrimary.y : 0;
  const proposed = drag.items.map(it => ({
    ...it,
    x: w.x - it.dx + snapDx,
    y: w.y - it.dy + snapDy,
  }));
  const gutterDx = Math.max(0, CANVAS_GUTTER - Math.min(...proposed.map(it => it.x)));
  const gutterDy = Math.max(0, CANVAS_GUTTER - Math.min(...proposed.map(it => it.y)));
  proposed.forEach(it => {
    state.pos[it.id] = {
      x: it.x + gutterDx,
      y: it.y + gutterDy,
    };
    const b = state.flat.find(x => x.id === it.id);
    if (b) { b.rect.x = state.pos[it.id].x; b.rect.y = state.pos[it.id].y; }
  });
  render();
});

window.addEventListener('pointerup', e => {
  if (resize) {
    if (resize.live) {
      state.size[resize.id] = { w: resize.live.w, h: resize.live.h };
      const moved = resize.live.x !== resize.start.x || resize.live.y !== resize.start.y;
      // `size=` is always persisted. A top or left grip also has a live
      // position, but that belongs in the file only when the author enabled
      // Positions. Otherwise the layout remains free to keep nested children
      // inside their derived group after the resize commits.
      if (moved && state.keepPos) state.pos[resize.id] = { x: resize.live.x, y: resize.live.y };
      setSize(resize.id, resize.live.w, resize.live.h);
      if (moved && state.keepPos) writePositions();
    }
    resize = null;
    return;
  }
  if (link) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetPort = el && el.closest('.port.t, .port.b');
    const target = targetPort && targetPort.closest('.node');
    const from = link.from;
    link = null;
    if (target && target.dataset.id !== from) connect(from, target.dataset.id);
    else render();
    return;
  }
  if (marq) { marq = null; marquee.hidden = true; render(); return; }
  if (drag && !drag.moved && drag.plain && state.selected.size > 1) {
    selOnly(drag.id);
    refreshSel();
  } else if (drag && drag.moved) {
    if (state.keepPos) writePositions(); else pulse('p-canvas');
    checkBoundary(drag.checkIds);
  }
  drag = null;
});

/* ================= boundary notice ================= */
// Gutenberg's snackbar shape. Actions are [{label, primary, fn}].
export const snackEl = document.getElementById('snack');
export let snackTimer = null;
export function snack(html, actions = [], ms = 9000) {
  clearTimeout(snackTimer);
  snackEl.innerHTML = '';
  const msg = document.createElement('div');
  msg.innerHTML = html;
  snackEl.appendChild(msg);
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'snack-actions';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'snack-btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { snackEl.hidden = true; a.fn(); });
      row.appendChild(b);
    });
    snackEl.appendChild(row);
  }
  snackEl.hidden = false;
  if (ms) snackTimer = setTimeout(() => { snackEl.hidden = true; }, ms);
}

export const inRect = (n, g) =>
  n.rect.x >= g.rect.x && n.rect.y >= g.rect.y &&
  n.rect.x + n.rect.w <= g.rect.x + g.rect.w &&
  n.rect.y + n.rect.h <= g.rect.y + g.rect.h;

export function parentOf(id) {
  let found = null;
  (function walk(nodes, parent) {
    nodes.forEach(n => { if (n.id === id) found = parent; walk(n.children, n); });
  })(state.roots, null);
  return found;
}

// Daniel: "When a sub node drags outside the boundary, prompt or notify if the
// action is intended."
//
// This is where the format and the gesture disagree, and the editor must not
// paper over it. In JSON Canvas, dragging out IS leaving the group, because
// geometry is containment. In .llm, containment is heading depth, so dragging
// out changes nothing structural. The drag looks like intent to un-nest; the
// file says it is only layout. So say so, and offer both readings.
export function checkBoundary(movedIds) {
  for (const id of movedIds) {
    const n = state.flat.find(x => x.id === id);
    if (!n) continue;
    const g = parentOf(id);
    if (!g || inRect(n, g)) continue;
    snack(
      `<strong>${n.title}</strong> was dragged outside <strong>${g.title}</strong>, `
      + `but it is still inside it. Containment is heading depth in <code>.llm</code>, `
      + `not geometry, so this move is layout only.`,
      [
        { label: 'Put it back', fn: () => { delete state.pos[id]; fromSource(); } },
        { label: 'Outdent it for real', primary: true, fn: () => { delete state.pos[id]; shift(id, -1); } },
      ]
    );
    return true;
  }
  return false;
}
