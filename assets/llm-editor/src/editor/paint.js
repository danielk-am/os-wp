/* GENERATED from llm-editor src/editor/paint.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { highlight } from '../core/highlight.js';
import { src } from './state.js';


export const hl = document.getElementById('hl');
export function paint() {
  hl.innerHTML = highlight(src.value);
  hl.scrollTop = src.scrollTop;
  hl.scrollLeft = src.scrollLeft;
}
src.addEventListener('scroll', () => {
  hl.scrollTop = src.scrollTop;
  hl.scrollLeft = src.scrollLeft;
});
