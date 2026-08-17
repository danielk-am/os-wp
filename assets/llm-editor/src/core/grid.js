/* GENERATED from llm-editor src/core/grid.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/** Shared geometry contract for automatic layout and direct manipulation. */
export const GRID = 20;
// Keep cards and their connection handles away from the viewport boundary.
// Two grid cells is enough room to read the outline without wasting canvas.
export const CANVAS_GUTTER = GRID * 2;

export function snap(value, step = GRID) {
  return Math.round(Number(value || 0) / step) * step;
}

export function snapUp(value, step = GRID) {
  return Math.ceil(Number(value || 0) / step) * step;
}
