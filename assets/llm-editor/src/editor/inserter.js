/* GENERATED from llm-editor src/editor/inserter.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { faSvg } from './icons.js';
import { BLOCKS, CHATGPT_SDK, CLAUDE_SDK, EMBEDS, FRONTMATTER, OKF_SECTIONS } from './catalog.js';
import { closeColor, colorPop, positionBlockbar } from './toolbar.js';
import { insertFrontmatter, insertNode } from './edit-ops.js';
import { render } from './render.js';
import { state, world } from './state.js';
import { drag, link } from './interact.js';


/* ================= inserter ================= */
export const panel = document.getElementById('inserter-panel');
export const inserterBtn = document.getElementById('inserter');
export const grid = document.getElementById('block-grid');

export function fillGrid(el, specs, act) {
  specs.forEach(spec => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'block-item';
    b.innerHTML = `<span class="glyph">${faSvg(spec.icon, 20)}</span><span class="lbl"></span>`;
    b.querySelector('.lbl').textContent = spec.label;
    b.addEventListener('click', () => { act(spec); setInserter(false); });
    el.appendChild(b);
  });
}
fillGrid(grid, BLOCKS, insertNode);
fillGrid(document.getElementById('embed-grid'), EMBEDS, insertNode);
fillGrid(document.getElementById('fm-grid'), FRONTMATTER, insertFrontmatter);
fillGrid(document.getElementById('okf-grid'), OKF_SECTIONS, insertNode);
fillGrid(document.getElementById('claude-sdk-grid'), CLAUDE_SDK, insertNode);
fillGrid(document.getElementById('codex-sdk-grid'), CHATGPT_SDK, insertNode);

// The SDK sections hide behind a persisted toggle: vendor tool names are
// noise to anyone not scripting a coding agent. Per browser, like the split.
const SDK_KEY = 'llm-editor:sdk';
const sdkToggle = document.getElementById('sdk-toggle');
const sdkSections = document.getElementById('sdk-sections');
function setSdk(on) {
  sdkToggle.checked = on;
  sdkSections.hidden = !on;
  try { localStorage.setItem(SDK_KEY, on ? '1' : ''); } catch { /* private mode */ }
}
try { setSdk(!!localStorage.getItem(SDK_KEY)); } catch { /* private mode */ }
sdkToggle.addEventListener('change', () => setSdk(sdkToggle.checked));

export function setInserter(open) {
  panel.hidden = !open;
  inserterBtn.setAttribute('aria-expanded', String(open));
}
inserterBtn.addEventListener('click', () => setInserter(panel.hidden));
document.addEventListener('click', e => {
  if (!panel.hidden && !panel.contains(e.target) && e.target.closest('#inserter') === null) {
    setInserter(false);
  }
});
document.addEventListener('click', e => {
  if (!colorPop.hidden && !colorPop.contains(e.target) && !e.target.closest('#color-btn')) {
    closeColor();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeColor();
    if (state.selEdge) { state.selEdge = null; render(); }
    setInserter(false);
    if (state.linking) { state.linking = null; render(); }
  }
});

/* ================= drag, select, connect ================= */
// Toggle classes in place instead of re-rendering. render() replaces every
// node element, and an element that vanishes between pointerdown and pointerup
// gets no click event, and therefore no dblclick.
export function refreshSel() {
  const linkFrom = state.linking || (link && link.from);
  world.querySelectorAll('.node').forEach(el => {
    const id = el.dataset.id;
    el.classList.toggle('sel', state.selected.has(id));
    el.classList.toggle('drop', !!linkFrom && linkFrom !== id);
  });
  world.classList.toggle('linking', !!link);
  positionBlockbar();
}
