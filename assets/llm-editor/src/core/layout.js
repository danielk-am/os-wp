/* GENERATED from llm-editor src/core/layout.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { fenceOf, tablesOf } from './parse.js';
import { CANVAS_GUTTER, GRID, snap, snapUp } from './grid.js';
import { PAD, HEAD } from './constants.js';
import { span } from '../editor/edit-ops.js';
import { stage, state, visibleBlocks } from '../editor/state.js';

/* ================= layout ================= */
// A layered (Sugiyama-style) layout, because a column cannot show a fork.
// Daniel: "the yes no decisions weren't showing the proper path splits."
// Right: stacking siblings at one x meant a decision's two branches dived
// straight down on top of each other and their labels collided.
//
// Four passes, the classic ones:
//   1. rank    - longest path, so an edge always points down a layer
//   2. dummies - a multi-layer edge gets waypoints, so it routes AROUND
//                intervening nodes instead of through them
//   3. order   - barycentre sweeps, to cut crossings
//   4. place   - x from order, y from rank
// Run per sibling set, so a group lays out its own children independently and
// containment keeps working.
// A .llm node carries prose as well as a title. Start wide enough for that
// prose to scan like a paragraph rather than a receipt, while manual `size=`
// still lets an author choose a narrower card.
export const LEAF_W = 400, TABLE_W = 460, GROUP_MIN_W = 800;
export const V_GAP = GRID * 3, V_GAP_TIGHT = GRID, H_GAP = GRID * 2;
export const COLLAPSED_W = LEAF_W, COLLAPSED_H = GRID * 3;
const LEAF_CPL = 60;

/**
 * A group's title, measured, so the box can make room for it.
 *
 * The group box was sized from its children alone, so a title longer than the
 * children's width wrapped into the header band, and HEAD only ever reserved
 * one line: line two rendered UNDER the first child (Daniel's screenshot,
 * "Generate Host and App Operation References"). Two remedies, both applied:
 * the box widens to fit the title on one line up to GROUP_TITLE_MAX_W, and a
 * title that still wraps past the cap charges the header one TITLE_LH per
 * extra line, so the children start below it either way.
 *
 * Measured with a real canvas context in the node's own font, not a
 * chars-per-line constant: title width varies too much per glyph for the
 * FILE_CPL trick, and the 2d context is exact and cheap. The fallback constant
 * exists for test runners with no canvas, where nothing renders anyway.
 */
export const GROUP_TITLE_MAX_W = TABLE_W;
const TITLE_LH = 16.25;        // 12.5px * line-height 1.3, from .n-title
// Padding 10px a side, group border 1.5px a side, and a rounding px. Generous
// on purpose, and in the SAFE direction on both uses: the width term adds it
// (box a touch wider than the minimum), headOf subtracts it (a line-count
// estimate that over-reserves rather than letting a borderline title wrap
// into the children again).
const TITLE_PAD_X = 24;
let titleCtx = null;
export function titlePx(text) {
  if (!text) return 0;
  if (titleCtx === null) {
    try {
      titleCtx = document.createElement('canvas').getContext('2d');
      const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
      titleCtx.font = `600 12.5px ${family}`;
    } catch (e) {
      titleCtx = false;
    }
  }
  if (titleCtx) return titleCtx.measureText(text).width;
  return text.length * 6.6;    // fallback: no canvas, no rendering either
}

/** Header band height for a group: HEAD, plus a line per wrap of its title. */
export function headOf(b) {
  if (b._head === undefined) {
    const usable = (b._w || LEAF_W) - TITLE_PAD_X;
    const lines = Math.max(1, Math.ceil(titlePx(b.title) / Math.max(1, usable)));
    b._head = HEAD + (lines - 1) * TITLE_LH;
  }
  return b._head;
}

/**
 * Real heights, measured from the DOM, keyed by what a node actually renders.
 *
 * Everything below this is an ESTIMATE, and estimates are why Daniel's File
 * node overflowed and why its meta line then sat jammed against the border. The
 * chip term needed FILE_CPL and FILE_LH; a table needs 21px-per-row; a fence
 * needs +18. Every new node type is another constant tuned against a screenshot,
 * and the tuning is only ever right for the content that was on screen.
 *
 * So the estimate is now only the FIRST guess. render() measures what the
 * browser actually did and writes the answer here; the next layout uses it. See
 * measureRendered() in editor/render.js.
 *
 * Keyed by content, not by id: two nodes with the same body are the same height,
 * and a node whose body changed is not. That also makes the cache self-
 * invalidating without a single invalidation call.
 */
const REAL = new Map();

// `\0` as the separator, written as an ESCAPE. It used to be a raw NUL byte in
// the source, which is a legal string but makes the file "binary" to every tool
// that sniffs for one: `file` reported `data`, grep silently matched NOTHING
// (not even "0 matches"), and `git diff` printed "Binary files differ" for every
// change ever made to this file. That is how the missing PAD/HEAD import below
// survived: grep could not see the identifiers, and neither could review.
//
// `b.tool` belongs here because estimate() charges toolChip(b) for it. It was
// missing, so two nodes with the same body and different `tool=` shared one key
// and one cached height, against this function's own contract.
export function heightKey(b) {
  return [
    b.id, b.ntype || '', b.lang || '', b.tag || '', b.file || '',
    b.tool || '', b.collapsed ? 'collapsed' : '', b.body || '',
  ].join('\0');
}

export function rememberHeight(b, px) { REAL.set(heightKey(b), px); }
export function forgetHeights() { REAL.clear(); }

export function measure(b) {
  const known = REAL.get(heightKey(b));
  if (known !== undefined) return known;
  return estimate(b);
}

/** The first-frame guess, used until the DOM says otherwise. */
export function estimate(b) {
  if (b.collapsed) return COLLAPSED_H;
  const tables = b.body ? tablesOf(b.body) : [];
  if (tables.length) {
    // Mixed bodies pay for their prose plus each actual table. This is only a
    // first-frame estimate; measureRendered() replaces it with the DOM truth.
    const tableLines = new Set(tables.flatMap(table => {
      const lines = [];
      for (let i = table.start; i < table.end; i++) lines.push(i);
      return lines;
    }));
    const prose = b.body.split('\n').reduce((sum, line, i) => tableLines.has(i)
      ? sum
      : sum + Math.max(1, Math.ceil(line.length / LEAF_CPL)), 0);
    const tableHeight = tables.reduce((sum, table) => sum + 22 + table.rows.length * 21 + 16, 0);
    return 16 + 17 + 18 + 8 + prose * 15 + tableHeight;
  }
  const fence = b.body ? fenceOf(b.body) : null;
  const text = fence ? fence.code : b.body;
  const n = !text ? 0 : fence
    ? text.split('\n').length
    : text.split('\n').reduce((a,l) => a + Math.max(1, Math.ceil(l.length / LEAF_CPL)), 0);
  // +3: the box was 4px under what the content needs, on every node, with or
  // without a body. A/B'd against the probe rather than reasoned about:
  // BASE+0 leaves 4px of overflow, BASE+3 leaves 1px (rounding). See
  // test/probe-measure.mjs, and note its header: the FIRST version of that probe
  // reported a phantom 3px on every node and would have "justified" this number
  // for the wrong reason.
  const BASE = 16 + 17 + 18 + 3;
  const body = b.body ? 3 + n * 15 : 0;
  const chrome = fence ? 18 : 0;
  return BASE + body + chrome + fileChip(b) + toolChip(b);
}

// The `.n-file` path chip: 9.5px mono, word-break: break-all, so a long path
// wraps inside the node. measure() had NO term for it, which is why Daniel's
// File node overflowed its box and pushed the meta line out through the border.
//
// Every number here was measured in the DOM, never read off the CSS. The last
// measure() bug survived precisely because the CSS was reasoned about instead of
// the browser being asked, and it was ~18px short for weeks until ports started
// getting clipped.
//
//   chip lines  1      2      3
//   short      +2    +14    +27      (over the +3 every node needed anyway)
//
// which is 2 + (lines - 1) * 12.35, and 12.35px is the chip's computed
// line-height. The first line costs almost nothing because the node already has
// that much slack under the title; each wrap after it costs a full line.
//
// Only wraps are charged, so a short path is free. That matters: most paths are
// short, and rounding every File node up to three lines would leave dead space
// in the common case to serve the rare one.
// At the 400px default width, 60 characters is the measured wrap threshold.
// The DOM measurement remains authoritative after first render; this only
// prevents a visible first-frame jump for long paths and tool names.
const FILE_CPL = 60;
const FILE_LH = 12.35;    // getComputedStyle(chip).lineHeight, not a guess

export function fileChip(b) {
  if (!b.file) return 0;
  const lines = Math.max(1, Math.ceil(b.file.length / FILE_CPL));
  return 2 + (lines - 1) * FILE_LH;
}

/**
 * The `.n-tool` chip. Same shape, same font, same wrap, so the same arithmetic.
 *
 * Written at the same time as the chip rather than after Daniel screenshots it
 * overflowing, which is what happened with `.n-file`: measure() had no term for
 * it and a full MCP tool name (mcp__playwright__browser_take_screenshot, 41
 * chars) wraps to two lines at once. Auto-expand would correct it on the second
 * pass anyway, but the first frame would visibly jump.
 */
export function toolChip(b) {
  if (!b.tool) return 0;
  const lines = Math.max(1, Math.ceil(b.tool.length / FILE_CPL));
  return 2 + (lines - 1) * FILE_LH;
}

/** Strongly connected components, Tarjan. Sibling sets are small; recursion is fine. */
function sccOf(ids, adj) {
  const index = {}, low = {}, onstack = {}, comp = {};
  const stack = [];
  let i = 0, c = 0;
  const strong = v => {
    index[v] = low[v] = i++;
    stack.push(v); onstack[v] = true;
    adj[v].forEach(w => {
      if (index[w] === undefined) { strong(w); low[v] = Math.min(low[v], low[w]); }
      else if (onstack[w]) low[v] = Math.min(low[v], index[w]);
    });
    if (low[v] === index[v]) {
      for (;;) {
        const w = stack.pop(); onstack[w] = false; comp[w] = c;
        if (w === v) break;
      }
      c++;
    }
  };
  ids.forEach(v => { if (index[v] === undefined) strong(v); });
  return comp;
}

export function rankOf(ids, adj) {
  // A cycle used to leave ALL of its members at rank 0: every node in it keeps
  // an incoming edge, so Kahn's queue never seeds, and a loop-shaped graph
  // (the R-Model, any state machine) rendered as one horizontal row the width
  // of the whole loop. So the edges that close a cycle are set aside before
  // ranking: inside a strongly connected component, an edge pointing UP the
  // document (reviewing -> rooting, reflection -> routing) is the loop-back,
  // because the author's reading order is the flow. What remains is acyclic
  // by construction, so ranking always completes; the loop-back edges still
  // draw, they just no longer decide the layers. A graph with no cycle has no
  // multi-node component and keeps every edge, exactly as before.
  const order = {};
  ids.forEach((id, k) => order[id] = k);
  const comp = sccOf(ids, adj);
  const fwd = {};
  ids.forEach(v => fwd[v] = adj[v].filter(w =>
    comp[w] !== comp[v] || order[w] > order[v]));

  const rank = {};
  const indeg = {};
  ids.forEach(i => indeg[i] = 0);
  ids.forEach(i => fwd[i].forEach(j => indeg[j]++));
  const q = ids.filter(i => !indeg[i]);
  ids.forEach(i => rank[i] = 0);
  // Longest path via Kahn.
  const seen = new Set(q);
  while (q.length) {
    const cur = q.shift();
    fwd[cur].forEach(nx => {
      rank[nx] = Math.max(rank[nx], rank[cur] + 1);
      if (--indeg[nx] === 0) { q.push(nx); seen.add(nx); }
    });
  }
  ids.filter(i => !seen.has(i)).forEach(i => { rank[i] = rank[i] || 0; });
  return rank;
}

export function layoutLevel(sibs, originX, originY) {
  if (!sibs.length) return { w: 0, h: 0 };

  // Size each sibling first. A group's box comes from its own children, so
  // recurse before ranking.
  sibs.forEach(b => {
    const expandedGroup = b.children.length && !b.collapsed;
    if (expandedGroup) {
      const inner = layoutLevel(b.children, 0, 0);
      b._inner = inner;
      // The title is a width constraint like the children are, up to the cap.
      b._w = Math.max(GROUP_MIN_W, inner.w + PAD * 2,
        Math.min(Math.ceil(titlePx(b.title)) + TITLE_PAD_X, GROUP_TITLE_MAX_W));
      b._head = undefined;   // width is final now; headOf caches against it
      b._h = inner.h + headOf(b) + PAD;
    } else {
      // A table earns extra width; cramming one into a node column is unreadable.
      b._w = b.collapsed
        ? COLLAPSED_W
        : (tablesOf(b.body).length ? TABLE_W : LEAF_W);
      b._h = measure(b);
      // A manual size (the resize grip; `size=WxH` in the attrs) overrides
      // both estimates. Floors keep a mis-drag from collapsing the node to
      // an unclickable sliver. A collapsed card deliberately ignores it:
      // `size=` describes the expanded editor and returns when re-opened.
      const sz = state.size[b.id] || b.size;
      if (sz && !b.collapsed) {
        b._w = Math.max(LEAF_W, sz.w);
        b._h = Math.max(48, sz.h);
      }
    }
    if (state.snap) {
      b._w = snapUp(b._w);
      b._h = snapUp(b._h);
    }
  });

  const ids = sibs.map(b => b.id);
  const idset = new Set(ids);
  const byId = Object.fromEntries(sibs.map(b => [b.id, b]));
  const adj = {}; ids.forEach(i => adj[i] = []);
  const realEdges = [];
  sibs.forEach(b => b.edges.forEach(e => {
    if (idset.has(e.to) && !adj[b.id].includes(e.to)) {
      adj[b.id].push(e.to);
      realEdges.push([b.id, e.to]);
    }
  }));

  const rank = rankOf(ids, adj);

  // Nodes with no edges at all keep reading order, appended after the flow, so
  // a plain document still reads top to bottom.
  const connected = new Set();
  realEdges.forEach(([a, b]) => { connected.add(a); connected.add(b); });
  const isLoose = i => !connected.has(i);
  const loose = ids.filter(i => !connected.has(i));
  let maxRank = Math.max(0, ...ids.filter(i => connected.has(i)).map(i => rank[i]));
  loose.forEach((i, k) => rank[i] = maxRank + 1 + k);

  // Dummies: an edge spanning >1 rank gets a waypoint per intermediate rank, so
  // it can be routed around whatever sits between.
  const layers = {};
  const put = (r, key) => { (layers[r] = layers[r] || []).push(key); };
  ids.forEach(i => put(rank[i], i));
  const dummies = {};
  realEdges.forEach(([a, b]) => {
    const span = rank[b] - rank[a];
    if (span <= 1) return;
    let prev = a;
    for (let r = rank[a] + 1; r < rank[b]; r++) {
      const key = `~${a}~${b}~${r}`;
      dummies[key] = { id: key, dummy: true, _w: GRID * 3, _h: 0 };
      put(r, key);
      prev = key;
    }
  });
  const all = { ...byId, ...dummies };
  const parentsOf = {};
  Object.keys(all).forEach(k => parentsOf[k] = []);
  realEdges.forEach(([a, b]) => {
    const span = rank[b] - rank[a];
    if (span <= 1) { parentsOf[b].push(a); return; }
    let prev = a;
    for (let r = rank[a] + 1; r < rank[b]; r++) {
      const key = `~${a}~${b}~${r}`;
      parentsOf[key].push(prev);
      prev = key;
    }
    parentsOf[b].push(prev);
  });

  // Order: barycentre sweeps down the layers. Cheap, and enough to keep a
  // two-way branch from crossing itself.
  const rs = Object.keys(layers).map(Number).sort((a, b) => a - b);
  for (let pass = 0; pass < 4; pass++) {
    rs.forEach(r => {
      const above = layers[r - 1] || [];
      const pos = Object.fromEntries(above.map((k, i) => [k, i]));
      layers[r].sort((x, y) => {
        const bx = parentsOf[x].map(p => pos[p]).filter(v => v !== undefined);
        const by = parentsOf[y].map(p => pos[p]).filter(v => v !== undefined);
        const mx = bx.length ? bx.reduce((a, b) => a + b, 0) / bx.length : 0;
        const my = by.length ? by.reduce((a, b) => a + b, 0) / by.length : 0;
        return mx - my;
      });
    });
  }

  // Place. x from order within the layer, y from rank.
  let cy = originY, totalW = 0, lastGap = 0;
  rs.forEach(r => {
    const row = layers[r];
    const widths = row.map(k => all[k]._w);
    const rowW = widths.reduce((a, b) => a + b, 0) + H_GAP * (row.length - 1);
    totalW = Math.max(totalW, rowW);
    let cx = originX;
    let rowH = 0;
    row.forEach((k, i) => {
      const n = all[k];
      n._x = state.snap ? snap(cx) : cx;
      n._y = state.snap ? snap(cy) : cy;
      cx += n._w + H_GAP;
      rowH = Math.max(rowH, n._h);
    });
    // Centre each row against the widest, so a fork looks symmetrical.
    const pad = (totalW - rowW) / 2;
    row.forEach(k => {
      all[k]._x += pad;
      if (state.snap) all[k]._x = snap(all[k]._x);
    });
    // Only leave wire-room if a wire actually leaves this row.
    const next = layers[r + 1];
    const wired = row.some(k => !all[k].dummy && !isLoose(k))
      || (next && next.some(k => all[k].dummy || !isLoose(k)));
    lastGap = wired ? V_GAP : V_GAP_TIGHT;
    cy += rowH + lastGap;
  });

  // Hand the dummy positions to the renderer, so a multi-layer edge follows the
  // lane the layout reserved for it instead of cutting through what is between.
  realEdges.forEach(([a, bb]) => {
    const span = rank[bb] - rank[a];
    if (span <= 1) return;
    const pts = [];
    for (let r = rank[a] + 1; r < rank[bb]; r++) {
      const d = dummies[`~${a}~${bb}~${r}`];
      if (d) pts.push({ x: d._x, y: d._y });
    }
    if (pts.length) state.routes[`${a}->${bb}`] = pts;
  });

  // Commit rects, and lay out each group's children inside its box.
  const placed = [];
  sibs.forEach(b => {
    b.rect = {
      x: state.snap ? snap(b._x) : b._x,
      y: state.snap ? snap(b._y) : b._y,
      w: state.snap ? snapUp(b._w) : b._w,
      h: state.snap ? snapUp(b._h) : b._h,
    };
    const p = state.pos[b.id] || b.pos;
    if (p) {
      b.rect.x = Math.max(CANVAS_GUTTER, state.snap ? snap(p.x) : p.x);
      b.rect.y = Math.max(CANVAS_GUTTER, state.snap ? snap(p.y) : p.y);
    }

    // Positions are hints, not permission to make the diagram illegible.
    // Pinned siblings can share the same old coordinates after one of them
    // expands. Move the later card down until every sibling keeps one grid
    // cell of breathing room. Automatic layout already satisfies this, so the
    // pass is a no-op unless manual geometry would overlap.
    let blockers = placed.filter(other =>
      b.rect.x < other.rect.x + other.rect.w + GRID
      && b.rect.x + b.rect.w + GRID > other.rect.x
      && b.rect.y < other.rect.y + other.rect.h + GRID
      && b.rect.y + b.rect.h + GRID > other.rect.y
    );
    while (blockers.length) {
      const y = Math.max(...blockers.map(other => other.rect.y + other.rect.h + GRID));
      b.rect.y = state.snap ? snapUp(y) : y;
      blockers = placed.filter(other =>
        b.rect.x < other.rect.x + other.rect.w + GRID
        && b.rect.x + b.rect.w + GRID > other.rect.x
        && b.rect.y < other.rect.y + other.rect.h + GRID
        && b.rect.y + b.rect.h + GRID > other.rect.y
      );
    }
    placed.push(b);

    if (b.children.length && !b.collapsed) {
      const childX = b.rect.x + PAD;
      const childY = b.rect.y + headOf(b);
      layoutLevel(
        b.children,
        state.snap ? snap(childX) : childX,
        state.snap ? snap(childY) : childY,
      );
    }
  });

  return { w: totalW, h: Math.max(0, cy - originY - lastGap) };
}

export function layout(roots, x, y) {
  state.routes = {};
  layoutLevel(
    roots,
    Math.max(CANVAS_GUTTER, x),
    Math.max(CANVAS_GUTTER, y),
  );
  // Centre on what is VISIBLE, not on the layout width: that includes the
  // empty lanes reserved for edge detours. Stable between layouts, so a drag
  // cannot move the origin under the pointer.
  recentre(roots);
}

/**
 * Where to sit the graph horizontally, given the current zoom.
 *
 * Split out of layout() because setZoom() calls render() but NOT layout(), so
 * originX would have kept a stale, 100%-shaped value at every other zoom. It is
 * cheap and depends only on the rects, so both callers can afford it.
 */
export function recentre(roots) {
  const all = visibleBlocks(roots);
  if (!all.length) { state.originX = 0; return; }
  const minX = Math.min(...all.map(b => b.rect.x));
  const maxX = Math.max(...all.map(b => b.rect.x + b.rect.w));
  // Centre the SCALED content. The transform is `translateX(tx) scale(z)` with
  // origin 0 0, so a point p lands at tx + z*p: tx is in screen pixels and the
  // content spans z*minX..z*maxX before it applies. Ignoring z here centred the
  // graph correctly at 100% and drifted at every other zoom.
  //
  // max(0, ...) is what makes zoomed-in panning work: once the content is wider
  // than the stage the expression goes negative, tx clamps to 0, and the graph
  // sits flush left where scrollLeft can reach all of it. Centring and scrolling
  // never fight, because only one of them is ever active.
  const z = state.zoom || 1;
  state.originX = Math.max(0, Math.round((stage.clientWidth - (maxX - minX) * z) / 2) - minX * z);
}
export const flatten = (roots, out=[]) => (roots.forEach(b => { out.push(b); flatten(b.children, out); }), out);
