/* GENERATED from llm-editor src/editor/boot.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { installStandaloneHost } from '../host/standalone.js';
import { canCompileMany, host, hostIsSet } from '../host/host.js';
import { SEED } from './seed.js';
import { agentText } from '../core/project.js';
import {
  autosave, flushSave, loadRevisions, markDirty, noteLoaded,
  persist, renderRevList, setSaveState, shouldApplyExternal,
} from './store.js';
import { faSvg } from './icons.js';
import { commit, fromSource, syncUndo } from './edit-ops.js';
import { highlight } from '../core/highlight.js';
import { repairDocument } from '../core/repair.js';
import { compileSkillDocument, compileSkillDocuments } from '../core/compile.js';
import { parse } from '../core/parse.js';
import { hist, src } from './state.js';
import { hl, paint } from './paint.js';
import { panel } from './inserter.js';
import { snack } from './interact.js';
import { mountOverview } from './overview.js';
// Side-effect import: view.js wires the zoom buttons, every keyboard shortcut
// and the hand/pan tool at module top level, and exports nothing boot needs. In
// the bundle it ran because concatenation runs everything; as real modules
// NOTHING imported it, so in VS Code the zoom buttons did nothing, Cmd+Z did
// nothing, space-drag did nothing, and the hand button rendered as an empty
// 30px box. All silent. test/reach.mjs now fails the build on an orphan.
import './view.js';
// Same shape: split.js wires the pane-resize handle at module top level, and
// guards on the handle existing so a shell without one boots clean.
import './split.js';
// The control persists its choice locally, so every host gets the same feature
// without each host needing a preference implementation.
import './theme.js';

export const helpPanel = document.getElementById('help-panel');
export const revPanel = document.getElementById('rev-panel');
export function togglePanel(panel, on) {
  [helpPanel, revPanel].forEach(p => { if (p !== panel) p.hidden = true; });
  panel.hidden = on === undefined ? !panel.hidden : !on;
  if (panel === revPanel && !panel.hidden) renderRevList();
}
document.querySelector('#help .menu-ico').innerHTML = faSvg('help', 16);
document.querySelector('#history .menu-ico').innerHTML = faSvg('history', 16);
document.querySelector('#reset .menu-ico').innerHTML = faSvg('restore', 16);
document.querySelector('#repair .menu-ico').innerHTML = faSvg('wrench', 16);
document.querySelector('#compile .menu-ico').innerHTML = faSvg('file', 16);
document.querySelector('#compile-files .menu-ico').innerHTML = faSvg('group', 16);
// The far-right Options anchor: same ellipsis glyph and 24px Gutenberg
// metric as the CI toolbars' settings toggle.
document.getElementById('more').innerHTML = faSvg('more', 24);
document.getElementById('help-close').innerHTML = faSvg('close', 12);
document.getElementById('rev-close').innerHTML = faSvg('close', 12);
document.getElementById('help').addEventListener('click', () => togglePanel(helpPanel));
document.getElementById('history').addEventListener('click', () => togglePanel(revPanel));
document.getElementById('repair').addEventListener('click', () => {
  const repaired = repairDocument(src.value);
  if (repaired.text !== src.value) {
    commit(repaired.text, 'p-src');
    snack(`Document repaired: ${repaired.changes.join('; ')}.`);
  } else {
    snack(repaired.warnings[0] || 'No structural repairs were needed.');
  }
});

function currentSourceName() {
  const actual = host().sourceName?.();
  if (actual) return actual;
  const name = parse(src.value).meta.name || document.getElementById('doc-name')?.textContent || 'untitled';
  return `${name}${host().ext || '.llm'}`;
}

function compileSummary(count, warnings) {
  const warningText = warnings.length
    ? ` ${warnings.length} contract warning${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}.`
    : '';
  return `Compiled ${count} Markdown ${count === 1 ? 'file' : 'files'}.${warningText}`;
}

async function compileCurrent() {
  const artifact = compileSkillDocument(src.value, { sourceName: currentSourceName() });
  const saved = await host().exportFile(artifact);
  if (saved) snack(compileSummary(1, artifact.warnings));
}

async function compileMany() {
  const documents = await host().pickDocuments?.();
  if (!documents?.length) return;
  const artifacts = compileSkillDocuments(documents);
  const saved = await host().exportFiles?.(artifacts);
  if (!saved) return;
  snack(compileSummary(
    artifacts.length,
    [...new Set(artifacts.flatMap(artifact => artifact.warnings))]
  ));
}

document.getElementById('compile').addEventListener('click', () => {
  void compileCurrent().catch(error => {
    console.error('llm-editor: compile failed', error);
    snack(`Compile failed: ${error.message}`);
  });
});
document.getElementById('compile-files').addEventListener('click', () => {
  void compileMany().catch(error => {
    console.error('llm-editor: batch compile failed', error);
    snack(`Compile failed: ${error.message}`);
  });
});
const moreBtn = document.getElementById('more');
const moreMenu = document.getElementById('more-menu');
function setMore(open) {
  moreMenu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
}
moreBtn.addEventListener('click', () => setMore(moreMenu.hidden));
// A chosen menu item closes the menu (its own handler still runs — this
// listens on the container, the action listens on the item).
moreMenu.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) setMore(false); });
document.addEventListener('click', (e) => {
  if (!moreMenu.hidden && !moreMenu.contains(e.target) && !e.target.closest('#more')) setMore(false);
});
document.getElementById('help-close').addEventListener('click', () => { helpPanel.hidden = true; });
document.getElementById('rev-close').addEventListener('click', () => { revPanel.hidden = true; });

export let view = 'src';
export function setView(v) {
  view = v;
  document.getElementById('v-src').setAttribute('aria-pressed', String(v === 'src'));
  document.getElementById('side-note').textContent = v === 'src' ? 'authored' : 'read-only projection';
  src.readOnly = v === 'agent';
  if (v === 'agent') {
    hl.innerHTML = highlight(agentText());
  } else {
    paint();
  }
  src.style.visibility = v === 'agent' ? 'hidden' : 'visible';
}
document.getElementById('v-src').addEventListener('click', () => setView('src'));

// #src is transparent: the text you SEE is #hl, painted by paint(). So paint
// here, first, before anything else gets a say. It used to be reached only at
// the tail of fromSource(), behind this debounce, which put every typed
// character behind a re-parse, a layout, a full node rebuild and a measure pass
// before it could appear. The caret moved instantly and the letters did not.
// Arrow lines were the worst of it, being the only edit that changes topology
// and so makes layout do real work.
//
// The debounce keeps the canvas, which is what it was always for. The text is
// not the canvas's to wait for.
export let t;
src.addEventListener('input', () => {
  paint();
  // Dirty NOW, not after the render debounce. An old host echo arriving inside
  // this 160ms window must not be allowed to replace the character just typed.
  markDirty();
  clearTimeout(t);
  t = setTimeout(() => { fromSource('p-src'); autosave(true); }, 160);
});
window.addEventListener('pagehide', flushSave);

document.getElementById('inserter').innerHTML = faSvg('plus', 16);
document.getElementById('undo').innerHTML = faSvg('undo', 24);
document.getElementById('redo').innerHTML = faSvg('redo', 24);

// Which host are we in? The bundle only ever runs standalone; VS Code and
// WordPress import src/ directly and install their own host before this file is
// reached. Guarding on "already set" keeps one boot path for all three rather
// than three boots that drift.
if (!hostIsSet()) installStandaloneHost({ seed: SEED });
document.getElementById('compile-files').hidden = !canCompileMany();

// Native Electron tabs are real BrowserWindows. Their close event waits here
// until the latest textarea value has crossed IPC and reached the file. Clear
// the canvas timer first: layout does not need to finish for the authored text
// to be durable.
host().onCloseRequest?.(() => {
  clearTimeout(t);
  return flushSave();
});

// The host is the only one who can know the real file's extension (a webview
// cannot read its own document's name). Hosts without a real file, or that
// don't report one, leave the shell's default ".llm" in place.
const ext = host().ext || '.llm';
const extEl = document.getElementById('doc-ext');
if (extEl) extEl.textContent = ext;
const tabExtEl = document.getElementById('tab-ext');
if (tabExtEl) tabExtEl.textContent = ext;

/**
 * Ask the host for the document.
 *
 * An async IIFE rather than top-level await: that needs a module, and the
 * bundled artifact is one inline classic <script> (no CSP-safe way to be a
 * module). This shape runs identically in both.
 */
(async () => {
  loadRevisions();
  const restored = await host().load();
  if (restored == null && host().overview) {
    // Overview tabs have no document and must never trigger Save As through
    // autosave. Keep a clean in-memory seed so document modules remain safe,
    // then hand the visible surface to the project journey.
    src.value = SEED;
    noteLoaded(src.value);
    await mountOverview();
    setSaveState('Saved', false);
    return;
  }
  const initialiseEmpty = restored != null && !String(restored).trim();
  // A new file should open as a document, not as a product tour. Whitespace-only
  // files count as empty; the explicit “Open demo flow” command remains the
  // place for examples.
  src.value = restored == null || initialiseEmpty ? SEED : restored;
  noteLoaded(src.value);
  if (!hist.list.length) hist.list.push({ ts: Date.now(), text: src.value });
  fromSource();
  syncUndo();
  renderRevList();

  // The file changed underneath us: git checkout, an external edit, undo in the
  // plain-text view. Only VS Code implements this; the others have no such
  // event. Guard against echoing our own save back into the textarea.
  host().onExternalChange?.(text => {
    if (!shouldApplyExternal(text)) return;
    src.value = text;
    fromSource();
    setSaveState('Saved', false);
  });

  // A real zero-byte file/post becomes the frontmatter document on disk too.
  // `null` means “there is no document” (for example Electron before Save As),
  // so it is displayed but never triggers a surprise save dialog.
  if (initialiseEmpty) await persist();
  else setSaveState('Saved', false);
})();
