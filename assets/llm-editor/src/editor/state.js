/* GENERATED from llm-editor src/editor/state.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
export const src = document.getElementById('src');
export const world = document.getElementById('world');
export const wires = document.getElementById('wires');
export const stage = document.getElementById('stage');
export const blockbar = document.getElementById('block-toolbar');

export let state = {
  roots: [], flat: [], pos: {}, size: {},
  sel: null, selected: new Set(), selEdge: null,
  keepPos: false, snap: true, linking: null,
  routes: {}, originX: 0, zoom: 1,
};

/** The headings currently visible after collapsed ancestors are applied. */
export function visibleBlocks(roots = state.roots, out = []) {
  roots.forEach(block => {
    out.push(block);
    if (!block.collapsed) visibleBlocks(block.children, out);
  });
  return out;
}

export const undo = { stack: [], redo: [] };
export const clip = { text: '' };
export const hist = { list: [], picked: null };
