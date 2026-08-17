/* GENERATED from llm-editor src/editor/render.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import {
  addCol, addRow, delCol, delRow, editCell, insertBetween,
  focusSource, setFile, toggleCollapsed,
} from './edit-ops.js';
import { CANVAS_GUTTER, GRID, snapUp } from '../core/grid.js';
import { mdBody } from '../core/md.js';
import { canPick, host } from '../host/host.js';
import { faSvg } from './icons.js';
import { fenceOf, tablesOf, runInfo } from '../core/parse.js';
import { drag, inRect, link, selOnly } from './interact.js';
import { layout, rememberHeight } from '../core/layout.js';
import { paint } from './paint.js';
import { positionBlockbar } from './toolbar.js';
import { stage, state, visibleBlocks, wires, world } from './state.js';
import { t } from './boot.js';

/**
 * Where a named port sits, in world coordinates.
 *
 * The ports are 9px circles offset -5px (see .port.t/.r/.b/.l in the CSS), so
 * each one straddles its edge and its centre lands on the edge midpoint to
 * within half a pixel. Rounding that to the edge is exact enough for a wire and
 * keeps this readable.
 *
 * Deliberately NOT anchor(). That one picks a side from geometry, which is right
 * for a committed edge (no side is stored, so it re-routes when you drag a node)
 * and wrong for a ghost, where the side is the thing the user just chose.
 * Opposite jobs, so they stay separate rather than growing a flag.
 */
export function portPoint(r, side) {
  switch (side) {
    case 't': return { x: r.x + r.w / 2, y: r.y };
    case 'b': return { x: r.x + r.w / 2, y: r.y + r.h };
    default: return { x: r.x + r.w / 2, y: r.y + r.h };
  }
}

function appendProse(parent, lines) {
  const text = lines.join('\n').replace(/^\n+|\n+$/g, '');
  if (!text) return;
  const body = document.createElement('div');
  body.className = 'n-body';
  body.innerHTML = mdBody(text);
  parent.appendChild(body);
}

function appendTable(parent, b, tbl, tableIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'n-table-wrap';
  const table = document.createElement('table');
  table.className = 'n-table';
  table.dataset.table = String(tableIndex);

  const fillCell = (cell, value, row, col) => {
    cell.dataset.cell = `${row},${col}`;
    cell.dataset.table = String(tableIndex);
    cell.dataset.raw = value;
    cell.innerHTML = mdBody(value);
    cell.addEventListener('click', ev => {
      ev.stopPropagation();
      editCell(cell, b.id, tableIndex, row, col);
    });
  };

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  tbl.head.forEach((value, ci) => {
    const th = document.createElement('th');
    fillCell(th, value, -1, ci);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cell-x';
    remove.title = 'Delete column';
    remove.textContent = '×';
    remove.addEventListener('click', ev => {
      ev.stopPropagation();
      delCol(b.id, tableIndex, ci);
    });
    th.appendChild(remove);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  tbl.rows.forEach((row, ri) => {
    const tr = document.createElement('tr');
    tbl.head.forEach((_, ci) => {
      const td = document.createElement('td');
      fillCell(td, row[ci] !== undefined ? row[ci] : '', ri, ci);
      if (ci === 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'cell-x row-x';
        remove.title = 'Delete row';
        remove.textContent = '×';
        remove.addEventListener('click', ev => {
          ev.stopPropagation();
          delRow(b.id, tableIndex, ri);
        });
        td.appendChild(remove);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  const addR = document.createElement('button');
  addR.type = 'button';
  addR.className = 'tbl-add tbl-add-row';
  addR.title = 'Add row';
  addR.textContent = '+';
  addR.addEventListener('click', ev => {
    ev.stopPropagation();
    addRow(b.id, tableIndex);
  });
  const addC = document.createElement('button');
  addC.type = 'button';
  addC.className = 'tbl-add tbl-add-col';
  addC.title = 'Add column';
  addC.textContent = '+';
  addC.addEventListener('click', ev => {
    ev.stopPropagation();
    addCol(b.id, tableIndex);
  });
  wrap.appendChild(addR);
  wrap.appendChild(addC);
  parent.appendChild(wrap);
}

function appendBody(parent, b) {
  const content = document.createElement('div');
  content.className = 'n-content';
  const tables = tablesOf(b.body);
  const fence = tables.length ? null : fenceOf(b.body);

  if (tables.length) {
    const lines = b.body.split('\n');
    let at = 0;
    tables.forEach((table, index) => {
      appendProse(content, lines.slice(at, table.start));
      appendTable(content, b, table, index);
      at = table.end;
    });
    appendProse(content, lines.slice(at));
  } else {
    const body = document.createElement('div');
    body.className = fence ? 'n-body n-code' : 'n-body';
    if (fence) body.textContent = fence.code;
    else body.innerHTML = mdBody(b.body);
    content.appendChild(body);
    if (fence && fence.lang) parent.dataset.lang = fence.lang;
  }
  parent.appendChild(content);
}

export function render() {
  [...world.querySelectorAll('.node')].forEach(n => n.remove());
  const all = visibleBlocks();
  const byId = Object.fromEntries(all.map(b => [b.id, b]));
  const parentMap = {};
  (function walk(nodes, parent) {
    nodes.forEach(n => {
      parentMap[n.id] = parent;
      if (!n.collapsed) walk(n.children, n);
    });
  })(state.roots, null);
  const visibleTarget = {};
  (function mapTargets(nodes, collapsedAncestor) {
    nodes.forEach(node => {
      visibleTarget[node.id] = collapsedAncestor || node;
      mapTargets(node.children, collapsedAncestor || (node.collapsed ? node : null));
    });
  })(state.roots, null);
  let maxX = 0, maxY = 0;

  all.forEach(b => {
    const el = document.createElement('div');
    const par = parentMap[b.id];
    const stray = par && !inRect(b, par);
    const expandedGroup = b.children.length && !b.collapsed;
    el.className = 'node ' + (expandedGroup ? 'group' : 'leaf')
      + (b.collapsed ? ' collapsed' : '')
      + (stray ? ' stray' : '')
      + (state.selected.has(b.id) ? ' sel' : '')
      + ((state.linking || link) && (state.linking || link.from) !== b.id ? ' drop' : '');
    Object.assign(el.style, {
      left: b.rect.x + 'px', top: b.rect.y + 'px',
      width: b.rect.w + 'px', height: b.rect.h + 'px'
    });
    if (b.color) el.dataset.color = b.color;
    if (b.file) el.dataset.file = b.file;
    if (b.tool) el.dataset.tool = b.tool;
    if (b.run) el.dataset.run = b.run;
    if (b.children.length) el.dataset.hasChildren = String(b.children.length);
    el.dataset.id = b.id;
    // Manual size (grip / size= attr): the body scrolls its overflow.
    if (state.size[b.id] || b.size) el.dataset.sized = '';

    const t = document.createElement('div');
    t.className = 'n-title';
    t.textContent = b.title;
    if (b.file) {
      // The chip IS the picker. Daniel: "How to use the File node?" — it had no
      // affordance at all, just a path someone had to know to hand-edit. A
      // button on the thing you want to change beats a button in a toolbar
      // somewhere else.
      const chip = document.createElement(canPick() ? 'button' : 'span');
      chip.className = 'n-file';
      chip.textContent = b.file;
      if (canPick()) {
        chip.type = 'button';
        chip.title = 'Choose a different file. Pulled in at read time; OKF says a broken link is not malformed.';
        chip.addEventListener('click', async ev => {
          ev.stopPropagation();     // or the node just selects underneath
          const ref = await host().pickFile({ accept: ['.llm', '.md'] });
          if (ref) setFile(b.id, ref.uri);
        });
      } else {
        chip.title = 'Pulled in at read time. OKF: a broken link is not malformed.';
      }
      t.appendChild(chip);
    }
    if (b.tool) {
      // CORE-26. The tool a step fires, shown on the step. Same reasoning as
      // the file chip: the attribute that decides behaviour belongs on the node,
      // not buried in a heading you have to read the source to see.
      const chip = document.createElement('span');
      chip.className = 'n-tool';
      chip.textContent = b.tool;
      chip.title = 'Fires this exact tool. Projects to <tool use="…" />.';
      t.appendChild(chip);
    }
    if (b.run) {
      // SPEC section 15. An executable step shows how it runs, the same
      // reasoning as the tool chip: the attribute that decides behaviour rides
      // on the node. A ▶ marks that this runs, not just reads. In file form
      // (run=x.py) the interpreter chip is joined by a file chip: the script is
      // a real file with its own highlighting, the node only points at it.
      const info = runInfo(b.run);
      const kind = info && info.kind ? info.kind : b.run;
      const chip = document.createElement('span');
      chip.className = 'n-run';
      // The ▶ marker rides in CSS (content: "\25B6"), not here: a bare glyph in
      // textContent decodes wrong on any host that does not declare UTF-8, and
      // this bundle is a fragment three hosts embed. Text stays ASCII.
      chip.textContent = kind;
      chip.title = kind === 'webhook'
        ? 'Executable: posts the fenced request. Output binds to the anchor. Outward, so L3.'
        : info && info.file
          ? `Executable: runs ${info.file} (${kind}). Output binds to #${b.id} for downstream {{#${b.id}}}.`
          : `Executable: runs the fenced ${kind}. stdout binds to #${b.id} for downstream {{#${b.id}}}.`;
      t.appendChild(chip);
      if (info && info.file) {
        const f = document.createElement('span');
        f.className = 'n-run-file';
        f.textContent = info.file;
        f.title = 'External script. Bundle-relative; keeps its own syntax highlighting.';
        t.appendChild(f);
      }
    }
    if (b.tag) {
      // An XML section shows its tag, because that is what it projects to.
      const chip = document.createElement('span');
      chip.className = 'n-tag';
      chip.textContent = `<${b.tag}>`;
      t.appendChild(chip);
    }
    el.appendChild(t);

    const actions = document.createElement('div');
    actions.className = 'n-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'n-action n-edit';
    edit.title = 'Jump to this heading in the source editor';
    edit.setAttribute('aria-label', edit.title);
    edit.innerHTML = faSvg('pen', 11);
    edit.addEventListener('click', event => {
      event.stopPropagation();
      focusSource(b.id);
    });
    actions.appendChild(edit);
    if (b.body || b.children.length) {
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className = 'n-action n-collapse';
      collapse.title = b.collapsed ? 'Expand this heading' : 'Collapse this heading';
      collapse.setAttribute('aria-label', collapse.title);
      collapse.setAttribute('aria-expanded', String(!b.collapsed));
      collapse.addEventListener('click', event => {
        event.stopPropagation();
        toggleCollapsed(b.id);
      });
      actions.appendChild(collapse);
    }
    el.classList.add('has-actions');
    el.appendChild(actions);

    if (b.body && !expandedGroup && !b.collapsed) appendBody(el, b);
    if (!expandedGroup && !b.collapsed) {
      // Leaves only: a group's box is derived from its children, so a manual
      // group size would fight the layout every pass. Each corner is a real
      // handle, not one large invisible target, so its cursor tells you which
      // edges will move before you start dragging.
      ['nw', 'ne', 'se', 'sw'].forEach(corner => {
        const rg = document.createElement('div');
        rg.className = `n-resize ${corner}`;
        rg.dataset.corner = corner;
        rg.title = `Resize from the ${corner === 'nw' ? 'top left' : corner === 'ne' ? 'top right' : corner === 'se' ? 'bottom right' : 'bottom left'} corner`;
        el.appendChild(rg);
      });
    }
    const m = document.createElement('div');
    m.className = 'n-meta';
    const isTbl = tablesOf(b.body).length > 0;
    const lang = b.lang || (b.body && !isTbl ? (fenceOf(b.body) || {}).lang : null);
    m.innerHTML = `<span>#${b.id}</span>`
      + (b.collapsed && b.children.length
        ? `<span class="n-type">${b.children.length} heading${b.children.length === 1 ? '' : 's'}</span>`
        : (b.ntype ? `<span class="n-type">${b.ntype}</span>` : (isTbl ? '<span class="n-type">table</span>' : '')))
      + (lang ? `<span class="n-lang">${lang}</span>` : '');
    el.appendChild(m);

    // Vertical flow only: connections enter and leave through top/bottom.
    ['t','b'].forEach(sd => {
      const pt = document.createElement('div');
      pt.className = 'port ' + sd;
      el.appendChild(pt);
    });

    world.appendChild(el);
    maxX = Math.max(maxX, b.rect.x + b.rect.w);
    maxY = Math.max(maxY, b.rect.y + b.rect.h);
  });

  // Daniel: "Maybe show the circle handles to indicate connectable node?"
  // While a wire is in flight, every candidate shows its ports rather than
  // making you guess what is droppable.
  world.classList.toggle('linking', !!link);
  stage.classList.toggle('snap-grid', !!state.snap);

  // The box must be the SCALED size, because transform: scale() is visual only
  // and never touches layout. Sizing it unscaled meant #stage.scrollWidth did
  // not grow with zoom, so at 200% the right-hand third of the graph was drawn
  // off the edge with no scroll left to reach it. Daniel: "we need a hand drag
  // screen, especially when zooming" — the pan was only half of it; there was
  // nowhere to pan TO.
  //
  // transform-origin is 0 0 (see CSS), so scaled content spans 0..z*extent and
  // the box matches it exactly.
  const z = state.zoom || 1;
  stage.style.setProperty('--grid', GRID * z + 'px');
  stage.style.setProperty('--grid-x', (state.originX || 0) + 'px');
  world.style.width = (maxX + CANVAS_GUTTER) * z + 'px';
  world.style.height = (maxY + CANVAS_GUTTER) * z + 'px';
  // getBoundingClientRect() accounts for both, so toWorld stays correct as long
  // as it divides by the zoom. transform-origin is 0 0 (see CSS).
  world.style.transform = `translateX(${state.originX || 0}px) scale(${state.zoom})`;

  const marker = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5"
    markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`;
  wires.innerHTML = `<defs>${marker('ah', 'var(--rule-strong)')}${marker('ah-sel', 'var(--wp-accent)')}${marker('ah-ghost', 'var(--wp-accent)')}</defs>`;
  [...world.querySelectorAll('.edge-add')].forEach(x => x.remove());

  // A workflow is vertical: every committed edge uses top/bottom, even when
  // two cards sit far apart horizontally.
  function anchor(a, bb) {
    const ax = a.rect.x + a.rect.w/2, ay = a.rect.y + a.rect.h/2;
    const bx = bb.rect.x + bb.rect.w/2, by = bb.rect.y + bb.rect.h/2;
    return by >= ay
      ? [{ x: ax, y: a.rect.y + a.rect.h }, { x: bx, y: bb.rect.y }, 'v']
      : [{ x: ax, y: a.rect.y }, { x: bx, y: bb.rect.y + bb.rect.h }, 'v'];
  }

  let n = 0;
  all.forEach(b => b.edges.forEach(e => {
    const t = byId[e.to] || visibleTarget[e.to];
    if (!t || t.id === b.id) return;
    n++;
    const [p1, p2] = anchor(b, t);
    const way = state.routes[`${b.id}->${e.to}`];
    let dstr, mid;
    if (way && way.length) {
      // Follow the reserved lane: through each waypoint's centre, smoothed.
      const pts = [p1, ...way.map(w => ({ x: w.x + 28, y: w.y })), p2];
      dstr = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const a0 = pts[i - 1], b0 = pts[i];
        const dy = Math.max(16, Math.abs(b0.y - a0.y) * 0.5);
        dstr += ` C${a0.x},${a0.y + dy} ${b0.x},${b0.y - dy} ${b0.x},${b0.y}`;
      }
      mid = way[Math.floor((way.length - 1) / 2)];
      mid = { x: mid.x + 28, y: mid.y };
    } else {
      const d = Math.max(20, Math.abs(p2.y - p1.y) * 0.4);
      const c1 = { x: p1.x, y: p1.y + (p2.y >= p1.y ? d : -d) };
      const c2 = { x: p2.x, y: p2.y - (p2.y >= p1.y ? d : -d) };
      dstr = `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
      mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }
    const isSel = state.selEdge && state.selEdge.from === b.id && state.selEdge.to === e.to;

    // Fat invisible path first: the hit target. Daniel: "Clicking on wire
    // should allow me an option to delete the wiring/path."
    const hit = document.createElementNS('http://www.w3.org/2000/svg','path');
    hit.setAttribute('d', dstr);
    hit.setAttribute('fill','none');
    hit.setAttribute('stroke','transparent');
    hit.setAttribute('stroke-width','12');
    hit.setAttribute('class','hit');
    // Show this edge's "+" only while the pointer is on this edge.
    const showPlus = on => {
      const btn = world.querySelector(`.edge-add[data-for="${b.id}->${e.to}"]`);
      if (btn) btn.classList.toggle('near', on);
      path.setAttribute('stroke', on && !isSel ? 'var(--ink-faint)' : (isSel ? 'var(--wp-accent)' : 'var(--rule-strong)'));
    };
    hit.addEventListener('pointerenter', () => showPlus(true));
    hit.addEventListener('pointerleave', () => showPlus(false));
    hit.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      state.selEdge = { from: b.id, to: e.to, label: e.label || '' };
      selOnly(null);
      render();   // wires must redraw: the selected one changes colour + marker
    });
    wires.appendChild(hit);

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', dstr);
    path.setAttribute('fill','none');
    path.setAttribute('stroke','var(--rule-strong)');
    path.setAttribute('stroke-width','1.5');
    path.setAttribute('marker-end', isSel ? 'url(#ah-sel)' : 'url(#ah)');
    path.setAttribute('class','wire' + (isSel ? ' sel' : ''));
    path.dataset.from = b.id;
    path.dataset.to = e.to;
    wires.appendChild(path);

    if (e.label) {
      const g = document.createElementNS('http://www.w3.org/2000/svg','text');
      g.setAttribute('x', mid.x); g.setAttribute('y', mid.y - 5);
      g.setAttribute('fill','var(--ink-soft)');
      g.setAttribute('font-size','10');
      g.setAttribute('font-family','var(--mono)');
      g.setAttribute('text-anchor','middle');
      g.setAttribute('stroke','var(--stage-bg)');
      g.setAttribute('stroke-width','3.5');
      g.setAttribute('paint-order','stroke fill');
      g.textContent = e.label;
      wires.appendChild(g);
    }

    // "+" mid-path: insert a node into this edge.
    // Only where the midpoint is in free space. A "+" sitting on top of a node
    // would swallow that node's hover and drag, which is a worse trade than
    // losing the affordance on a short edge.
    const blocked = all.some(o =>
      !o.children.length &&
      mid.x > o.rect.x - 9 && mid.x < o.rect.x + o.rect.w + 9 &&
      mid.y > o.rect.y - 9 && mid.y < o.rect.y + o.rect.h + 9);
    if (!blocked) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'edge-add' + (isSel ? ' near' : '');
      add.dataset.for = `${b.id}->${e.to}`;
      add.title = `Insert a node between ${b.id} and ${e.to}`;
      add.setAttribute('aria-label', add.title);
      add.style.left = mid.x + 'px';
      add.style.top = (e.label ? mid.y + 12 : mid.y) + 'px';
      add.innerHTML = faSvg('plus', 9);
      add.addEventListener('pointerenter', () => add.classList.add('near'));
      add.addEventListener('pointerleave', () => add.classList.remove('near'));
      add.addEventListener('click', ev => { ev.stopPropagation(); insertBetween(b.id, e.to); });
      world.appendChild(add);
    }
  }));

  // Ghost wire while dragging from a port.
  if (link) {
    const from = byId[link.from];
    if (from) {
      const g = document.createElementNS('http://www.w3.org/2000/svg','path');
      // From the port that was grabbed, not the node's centre. The centre was
      // why a drag off the right-hand port appeared to start from the middle of
      // the box and cross its own body on the way out.
      const p1 = portPoint(from.rect, link.side);
      g.setAttribute('d', `M${p1.x},${p1.y} L${link.to.x},${link.to.y}`);
      g.setAttribute('stroke','var(--wp-accent)');
      g.setAttribute('stroke-width','1.5');
      g.setAttribute('stroke-dasharray','4 3');
      g.setAttribute('fill','none');
      g.setAttribute('marker-end','url(#ah-ghost)');
      wires.appendChild(g);
    }
  }

  const depth = all.length ? Math.max(...all.map(b => b.depth)) : 0;
  const hidden = state.flat.length - all.length;
  document.getElementById('stat').textContent = `${all.length} nodes`
    + (hidden ? ` · ${hidden} hidden` : '')
    + ` · ${n} edges · depth ${depth}`;
  positionBlockbar();
  measureRendered(all, byId);
}

/**
 * Auto-expand: ask the browser how tall each node actually is, and relayout if
 * the estimate was wrong.
 *
 * Daniel: "Auto expand will be nice." Right, and it is the fix rather than a
 * nicety. measure() guessing heights is why his File node overflowed, and then
 * why its meta line sat pinned to the border once the guess was tuned to within
 * a pixel. Every node type was another constant fitted to whatever content
 * happened to be on screen.
 *
 * A node is laid out at a fixed height with `.n-body { overflow: hidden }`, so
 * being wrong CLIPS. Setting height:auto for one frame gives the natural height;
 * we cache that and let layout run again with the truth.
 *
 * Convergence, which is the only real risk here:
 *   - `measuring` blocks re-entry, so render -> relayout -> render cannot spiral.
 *   - The cache is keyed by CONTENT, so the second pass reads the measured
 *     height, computes the same box, finds nothing changed, and stops. Two
 *     passes, always, never three.
 *   - Only LEAF nodes are measured. A group's height comes from its children, so
 *     measuring its box would feed layout's own output back into layout.
 *   - A 1px tolerance, because sub-pixel text metrics jitter and would otherwise
 *     relayout forever on a node nobody touched.
 */
let measuring = false;

function measureRendered(all, byId) {
  if (measuring || state.keepPos) return;   // never fight a drag

  // Write every height, then read every height, then restore every height.
  // Interleaved (write, read, restore, per node) each read has a pending style
  // write in front of it, so the browser must flush layout to answer it: one
  // forced reflow per node, every render, and render runs on every drag frame.
  // Batched, the reads share a single flush.
  //
  // Safe only because .node is position:absolute and every node is a direct
  // child of #world (groups hold their children by geometry, not by nesting).
  // Nodes in flow would resize each other and all-auto-at-once would measure
  // something no single node ever sees.
  const pend = [];
  for (const el of world.querySelectorAll('.node.leaf')) {
    const b = byId[el.dataset.id];
    if (!b) continue;
    pend.push({ el, b, was: el.style.height });
    el.style.height = 'auto';
  }
  const real = pend.map(p => Math.ceil(p.el.getBoundingClientRect().height / (state.zoom || 1)));
  pend.forEach(p => { p.el.style.height = p.was; });

  let dirty = false;
  pend.forEach((p, i) => {
    const compared = state.snap ? snapUp(real[i]) : real[i];
    if (Math.abs(compared - p.b.rect.h) > 1) { rememberHeight(p.b, real[i]); dirty = true; }
    else rememberHeight(p.b, p.b.rect.h);
  });
  if (!dirty) return;

  measuring = true;
  try {
    layout(state.roots, 0, 40);
    render();
  } finally {
    measuring = false;
  }
}

/* ================= agent projection ================= */
// Daniel: "XML section expects <instructions><firstChild>…</firstChild></instructions>."
// Right. A tag that does not wrap its children is not a container, it is
// decoration. So tagging is INHERITED: inside a tagged region every descendant
// heading becomes a tag too, named by its own tag= or camelCased from its
// title. Outside one, headings stay markdown headings.
//
// This is the format's whole thesis paying out. One structure, three
// renderings: heading depth in the file, a group on the canvas, nested tags
// for the agent.
export const camel = s => s.trim().toLowerCase()
  .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
  .replace(/[^a-zA-Z0-9]/g, '') || 'node';
