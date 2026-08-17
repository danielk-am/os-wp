/* GENERATED from llm-editor src/editor/store.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { host } from '../host/host.js';
// REVS and esc were both USED here and imported by neither, so both were
// ReferenceErrors on the ES-module path (VS Code + WordPress). REVS is read
// inside try/catch on both sides, so revisions silently never loaded and never
// persisted, and nothing was logged. The bundle flattens every module into one
// scope, so the artifact was green throughout.
import { REV_CAP, REVS } from './panels.js';
import { esc } from '../core/project.js';
import { commit } from './edit-ops.js';
import { hist, src } from './state.js';


export let saveTimer = null;
let saveQueue = Promise.resolve();
let editVersion = 0;
let savedVersion = 0;
let queuedCount = 0;
let lastSavedText = null;
let lastQueuedText = null;
let lastQueuedVersion = -1;

export const saveState = document.getElementById('save-state');

/**
 * The canvas's save state, and the ONE place that knows it.
 *
 * A host may mirror it into its own chrome via the optional `onSaveState` hook.
 * The Context app does: it already draws a SaveStatus in CI's editor header, and
 * two indicators reading two different sources is how they end up disagreeing.
 * So the canvas stays the source of truth and the host renders it, rather than
 * the host guessing from the outside.
 *
 * Optional by design: VS Code and the standalone artifact have no chrome to
 * mirror into, and neither should have to care.
 */
export function setSaveState(t, busy) {
  saveState.textContent = t;
  saveState.classList.toggle('busy', !!busy);
  try { host().onSaveState?.(t, !!busy); }
  catch { /* no host yet, or a host that does not mirror. Not this function's problem. */ }
}

/**
 * The revision list only. The DOCUMENT comes from host().load().
 *
 * These were one function reading localStorage for both, which quietly made the
 * host contract decorative: in VS Code the canvas would have shown whatever was
 * last in localStorage instead of the file on disk, and a save would never have
 * reached the disk at all. The extension would have looked like it worked.
 *
 * Revisions stay local on purpose. They are a scratch undo history, not content:
 * VS Code has real local history and git, WordPress has post revisions, and
 * pushing ours into either would be competing with something better.
 */
export function loadRevisions() {
  try {
    hist.list = JSON.parse(localStorage.getItem(REVS) || '[]');
  } catch { hist.list = []; }
}
function persistSnapshot(text, version) {
  // One ordered queue for every host. Two fire-and-forget writes can finish in
  // reverse order (especially REST), leaving the OLDER snapshot as the durable
  // document. Serial execution makes completion order equal edit order.
  lastQueuedText = text;
  lastQueuedVersion = version;
  queuedCount++;
  saveQueue = saveQueue.catch(() => false).then(async () => {
    let ok = false;
    let cancelled = false;
    try {
      const result = await host().save(text);
      if (result === false || result === null) {
        cancelled = true;
        return false;
      }
      lastSavedText = text;
      savedVersion = Math.max(savedVersion, version);
      ok = true;
    } catch (error) {
      console.error('llm-editor: save failed', error);
    } finally {
      queuedCount--;
      const clean = ok
        && queuedCount === 0
        && savedVersion === editVersion
        && lastSavedText === src.value;
      if (clean) setSaveState('Saved', false);
      else if (cancelled && queuedCount === 0) setSaveState('Not saved', false);
      else if (!ok && queuedCount === 0) setSaveState('Save failed', false);
      else setSaveState('Saving…', true);
    }
    return ok;
  });

  try {
    localStorage.setItem(REVS, JSON.stringify(hist.list));
  } catch { /* private mode or quota: revisions degrade, editing does not */ }
  return saveQueue;
}

/** Mark local text dirty synchronously, before any debounce can run. */
export function markDirty() {
  editVersion++;
  setSaveState('Saving…', true);
  // VS Code keeps this latest snapshot outside the disposable webview. This is
  // deliberately not a save request: normal autosave remains settled/debounced,
  // while closing inside that debounce still cannot discard the last input.
  try { host().stage?.(src.value); }
  catch { /* staging is optional; durable save remains the source of truth */ }
  return editVersion;
}

/** Establish the clean baseline returned by a host load. */
export function noteLoaded(text) {
  lastSavedText = text;
  lastQueuedText = text;
  lastQueuedVersion = 0;
  editVersion = 0;
  savedVersion = 0;
}

/**
 * An external echo may be an old save completing while newer text is still
 * local. Never replace dirty text with it. A genuine external change is still
 * accepted as soon as the local document is settled.
 */
export function shouldApplyExternal(text) {
  if (text === src.value) return false;
  const dirty = editVersion !== savedVersion || queuedCount > 0;
  if (dirty) {
    console.warn('llm-editor: ignored external document update while local edits were pending');
    return false;
  }
  lastSavedText = text;
  lastQueuedText = text;
  return true;
}

/** Explicit persistence, used by Reset and other immediate document changes. */
export function persist() {
  const version = markDirty();
  return persistSnapshot(src.value, version);
}

// A revision per settled change, not per keystroke. WP does the same: the
// autosave debounce is the revision boundary.
export function autosave(alreadyDirty = false) {
  if (!alreadyDirty) markDirty();
  const text = src.value;
  const version = editVersion;
  // Persist the settled snapshot NOW. The 900ms timer below is only the local
  // revision boundary; making durability wait behind it created a full second
  // in which closing a tab lost the most recent edit.
  persistSnapshot(text, version);

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const last = hist.list[hist.list.length - 1];
    if (!last || last.text !== src.value) {
      hist.list.push({ ts: Date.now(), text: src.value });
      if (hist.list.length > REV_CAP) hist.list.shift();
    }
    try {
      localStorage.setItem(REVS, JSON.stringify(hist.list));
    } catch { /* revisions are optional; document persistence is not */ }
    if (!document.getElementById('rev-panel').hidden) renderRevList();
  }, 900);
}

/** Best-effort flush for a tab/window closed inside the short render debounce. */
export function flushSave() {
  clearTimeout(saveTimer);
  if (
    queuedCount > 0
    && lastQueuedText === src.value
    && lastQueuedVersion === editVersion
  ) return saveQueue;
  if (
    queuedCount === 0
    && lastSavedText === src.value
    && savedVersion === editVersion
  ) return saveQueue;
  return persistSnapshot(src.value, editVersion);
}

/* ---- line diff (LCS). Small docs, so the DP table is cheap and exact. ---- */
export function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ctx', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i++] }); }
    else { out.push({ t: 'add', s: b[j++] }); }
  }
  while (i < n) out.push({ t: 'del', s: a[i++] });
  while (j < m) out.push({ t: 'add', s: b[j++] });
  return out;
}
export const diffStat = d => ({
  add: d.filter(x => x.t === 'add').length,
  del: d.filter(x => x.t === 'del').length,
});

// Collapse long unchanged stretches, or the diff is mostly noise.
export function renderDiff(from, to) {
  const d = diffLines(from.split('\n'), to.split('\n'));
  const keep = new Array(d.length).fill(false);
  d.forEach((x, i) => {
    if (x.t === 'ctx') return;
    for (let k = Math.max(0, i - 2); k <= Math.min(d.length - 1, i + 2); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  d.forEach((x, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { out.push(`<span class="l gap">⋯ ${skipped} unchanged</span>`); skipped = 0; }
    const sign = x.t === 'add' ? '+' : x.t === 'del' ? '-' : ' ';
    out.push(`<span class="l ${x.t}">${esc(sign + ' ' + x.s)}</span>`);
  });
  if (skipped) out.push(`<span class="l gap">⋯ ${skipped} unchanged</span>`);
  return out.join('') || '<span class="l ctx">  no changes</span>';
}

export const fmtWhen = ts => {
  const d = new Date(ts), now = Date.now();
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function renderRevList() {
  const ul = document.getElementById('rev-list');
  ul.innerHTML = '';
  if (!hist.list.length) {
    ul.innerHTML = '<li class="rev-empty">No hist.list yet. Edit something and they appear here.</li>';
    document.getElementById('rev-diff').hidden = true;
    return;
  }
  [...hist.list].reverse().forEach((r, idx) => {
    const i = hist.list.length - 1 - idx;
    const prev = i > 0 ? hist.list[i - 1].text : '';
    const st = diffStat(diffLines(prev.split('\n'), r.text.split('\n')));
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rev-item';
    btn.setAttribute('aria-current', String(hist.picked === i));
    btn.innerHTML = `<span class="rev-when">${fmtWhen(r.ts)}${i === hist.list.length - 1 ? ' · current' : ''}</span>`
      + `<span class="rev-stat"><span class="plus">+${st.add}</span> <span class="minus">-${st.del}</span></span>`;
    btn.addEventListener('click', () => showRev(i));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
export function showRev(i) {
  hist.picked = i;
  const r = hist.list[i];
  document.getElementById('rev-diff').hidden = false;
  document.getElementById('rev-diff-label').textContent =
    `${fmtWhen(r.ts)} → now`;
  document.getElementById('diff-out').innerHTML = renderDiff(r.text, src.value);
  document.getElementById('rev-restore').disabled = r.text === src.value;
  renderRevList();
}
document.getElementById('rev-restore').addEventListener('click', () => {
  if (hist.picked === null) return;
  commit(hist.list[hist.picked].text);
  showRev(hist.picked);
});

/* ---- panels ---- */
