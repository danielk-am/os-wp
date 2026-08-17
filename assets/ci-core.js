/**
 * Context Core — foundational primitives shared by the engine, the type
 * layer, and every feature app: the htm renderer (`h`), the BOOT payload,
 * the REST client, a small entity-decode helper, and the client-side app
 * registry. Loaded first via the importmap specifier `ci/core`; the main
 * `context-app.js` and (later) the extracted engine/type/app modules all
 * import from here.
 *
 * No build step — this is a hand-authored native ES module; bare specifiers
 * (`react`, `htm`) resolve through the same importmap.
 */
import { createElement } from 'react';
import htm from 'htm';

export const h = htm.bind(createElement);
export const BOOT = window.CI_BOOTSTRAP;

// Public API major for the ci/* modules (ci/core, ci/ui, ci/shell, ci/editors,
// ci/type). Companion plugins in other repos import these, so removing or
// renaming an export is a breaking change: bump this major then. Additive
// exports do not bump it. Mirrored on window.CI.apiVersion for undefined-safe
// runtime checks (a companion can read window.CI?.apiVersion without a hard
// named import). See docs/SPLIT.md "The ci/* API is a versioned public contract".
export const API_VERSION = 1;

// On wpcom staging mirrors the canonical home_url is the production domain,
// so rest_url() (echoed into BOOT.rest) becomes cross-origin from the mirror
// and the nonce fails. Rewrite to a same-origin path when BOOT.rest points at
// a different host than the page we're loaded on.
export const REST_BASE = (() => {
  try {
    const parsed = new URL(BOOT.rest, window.location.origin);
    if (parsed.host === window.location.host) {
      return parsed.toString().replace(/\/$/, '');
    }
    return window.location.origin + parsed.pathname.replace(/\/$/, '');
  } catch {
    return (BOOT.rest || '').replace(/\/$/, '');
  }
})();

export async function rest(path, opts = {}) {
  const url = REST_BASE + path;
  const headers = {
    'X-WP-Nonce': BOOT.nonce,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { credentials: 'include', ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Same as rest() but also exposes response headers (X-WP-TotalPages). */
export async function restWithHeaders(path, opts = {}) {
  const url = REST_BASE + path;
  const headers = {
    'X-WP-Nonce': BOOT.nonce,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { credentials: 'include', ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return { data: await res.json(), headers: res.headers };
}

/**
 * Page through a list endpoint and return every item. Fetches page 1 to read
 * X-WP-TotalPages, then fires pages 2..N in parallel. Hard cap 50 pages.
 */
export async function restAllPages(path) {
  const sep = path.includes('?') ? '&' : '?';
  const first = await restWithHeaders(`${path}${sep}page=1`);
  const firstChunk = Array.isArray(first.data) ? first.data : [];
  const totalPages = Math.min(50, Number(first.headers.get('X-WP-TotalPages') || 1));
  if (totalPages <= 1) return firstChunk;
  const rest_ = await Promise.allSettled(
    Array.from({ length: totalPages - 1 }, (_, i) => rest(`${path}${sep}page=${i + 2}`))
  );
  const out = firstChunk.slice();
  for (const r of rest_) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) out.push(...r.value);
  }
  return out;
}

// Decode HTML entities in a string (e.g. WP `title.rendered` returns
// "Fortune-teller&#8217;s table"). Returns the input unchanged when there's
// nothing to decode.
export function decodeEntities(s) {
  if (typeof s !== 'string' || s.indexOf('&') === -1) return s || '';
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

// ---------------------------------------------------------------------------
// Relevance search & ranking — ONE scoring model shared by every ci-* surface
// (the content-type lists AND the Filesystem browser), so "search" means the
// same thing everywhere.
//
// It replaces the old "substring-filter, then sort by date" behaviour (which
// buried an exact title hit under whatever happened to be edited most
// recently) with field-boosted relevance in the Lucene / lunr tradition:
//
//   score(item) = Σ_terms  max_fields( matchQuality(term, field) × field.weight )
//
//   • Each searchable FIELD carries a weight = how strongly a hit there
//     identifies the record (title ≫ slug ≫ path ≫ description ≫ body).
//   • Each query TERM scores by MATCH QUALITY, not just presence:
//        exact whole-field   1.0
//        field starts-with   0.7
//        word-start          0.5   (term begins a word: after space/-/_/./ /)
//        mid-word substring  0.25
//   • A contiguous PHRASE hit (all terms in order in one field) adds a bonus,
//     so "wp content" ranks "wp-content" above a doc that merely contains both
//     words far apart.
//   • ALL terms must hit SOME field (AND across terms, OR across fields) — this
//     keeps precision and is a strict superset of the vendored DataViews global
//     search (whole-string substring ⊆ per-term substring), so nothing that
//     used to match stops matching; it just gets ordered sensibly.
//   • Ties break by recency, so equal-relevance rows still lead with the newest.
// ---------------------------------------------------------------------------

// Normalize exactly like DataViews' global search (accents stripped, trimmed,
// lowercased) so our matcher and theirs agree on what a "match" is.
export function normalizeText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

// Match-quality tier for one already-normalized term against one normalized
// haystack. Returns 0..1; 0 = no match.
function termTier(hay, term) {
  if (!hay || !term) return 0;
  if (hay === term) return 1;
  if (hay.startsWith(term)) return 0.7;
  const idx = hay.indexOf(term);
  if (idx < 0) return 0;
  const before = hay[idx - 1];
  const wordStart = before === ' ' || before === '-' || before === '_' || before === '/' || before === '.';
  return wordStart ? 0.5 : 0.25;
}

/**
 * Rank items by relevance to a query. Non-matches are dropped.
 *
 * @param {Array}  items  rows to rank.
 * @param {string} query  raw search string (may hold several space-separated terms).
 * @param {object} opts
 *   - fields:  [{ weight:number, get:(item)=>string|string[] }]  searchable fields.
 *   - recency: (item)=>number|string   optional tiebreaker (higher/later = first).
 * @return {Array} matching items, most-relevant first.
 */
export function rankSearch(items, query, { fields = [], recency } = {}) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!terms.length || !items) return items || [];
  const scored = [];
  for (const item of items) {
    // Normalize each field's text once, keeping its weight alongside.
    const cells = fields.map((f) => {
      const v = f.get(item);
      return { w: f.weight, hay: normalizeText(Array.isArray(v) ? v.join(' ') : v) };
    });
    let total = 0;
    let allHit = true;
    for (const term of terms) {
      let best = 0;
      for (const c of cells) {
        const s = termTier(c.hay, term) * c.w;
        if (s > best) best = s;
      }
      if (best === 0) { allHit = false; break; }
      total += best;
    }
    if (!allHit) continue;
    // Contiguous-phrase bonus (multi-term queries only).
    if (terms.length > 1) {
      const phrase = terms.join(' ');
      let bestPhrase = 0;
      for (const c of cells) {
        const s = termTier(c.hay, phrase) * c.w;
        if (s > bestPhrase) bestPhrase = s;
      }
      total += bestPhrase * 1.5;
    }
    scored.push({ item, score: total, r: recency ? recency(item) : 0 });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.r < b.r ? 1 : a.r > b.r ? -1 : 0));
  return scored.map((s) => s.item);
}

/**
 * Turn a DataViews field list into weighted search fields for rankSearch.
 * Only fields flagged `enableGlobalSearch` are searched (identical set to the
 * vendored search), but each is weighted by its ROLE in identifying the record
 * — derived from the field id, so every type is ranked by its OWN fields:
 *
 *   title 10 · slug 6 · os_path / name / label / trigger 5 · description 4
 *   · other searchable meta & list fields 2 · body content 1
 */
export function dataViewsSearchFields(fields) {
  const weightFor = (id) => {
    if (id === 'title') return 10;
    if (id === 'slug') return 6;
    if (id === 'content') return 1;
    const key = id.replace(/^(meta|tax):/, '');
    if (key === 'os_path') return 5;
    if (/^(name|label|title|alias|trigger|triggers)$/.test(key)) return 5;
    if (/^(description|summary|tagline|tip|hint|excerpt)$/.test(key)) return 4;
    return 2;
  };
  return (fields || [])
    .filter((f) => f.enableGlobalSearch && typeof f.getValue === 'function')
    .map((f) => ({ weight: weightFor(f.id), get: (item) => f.getValue({ item }) }));
}

// ---------------------------------------------------------------------------
// App registry. Features register their editor + list + route + new-file
// handlers here instead of being hard-wired into the core dispatchers
// (EditorPage / ListView / App routes / NewFileButton).
//
//   editors[key]   : (ctx) => element     ctx = { type, id, isNew, meta }
//   listViews[key] : (ctx) => element     overrides the generic DataViews list
//   routes[]       : { path, element }     extra React Router routes
//   newFile[key]   : {label,desc} | (meta)=>({label,desc})  single-new entries
// ---------------------------------------------------------------------------
export const CIRegistry = { editors: {}, listViews: {}, routes: [], newFile: {}, editorMeta: {}, calendarSources: [], navRows: [] };
export function registerEditor(key, render, opts = {}) {
  CIRegistry.editors[key] = render;
  if (opts.listView) CIRegistry.listViews[key] = opts.listView;
  if (opts.newFile) CIRegistry.newFile[key] = opts.newFile;
  // `selectable: true` opts an editor into the per-content-type editor picker
  // (Content Types). This is what lets editors live in their own leaf modules
  // (ci-app-*.js) yet still appear as a choice — the picker reads the registry,
  // not a hard-coded list. title/description describe it in the UI.
  if (opts.selectable) {
    CIRegistry.editorMeta[key] = { title: opts.title || key, description: opts.description || '' };
  }
  notifyRegistry();
}
// User-selectable editors (registered with `selectable: true`), for the
// Content Types editor picker. Returns [{ key, title, description }].
export function editorChoices() {
  return Object.entries(CIRegistry.editorMeta).map(([key, m]) => ({ key, title: m.title, description: m.description }));
}
export function registerListView(key, render) { CIRegistry.listViews[key] = render; notifyRegistry(); }
// Lazily loaded app modules register routes after the shell's first render;
// subscribers (the App component) re-render to pick them up.
let registryListeners = [];
export function onRegistryChange(fn) {
  registryListeners.push(fn);
  return () => { registryListeners = registryListeners.filter((f) => f !== fn); };
}
function notifyRegistry() { registryListeners.forEach((f) => f()); }
export function registerRoute(path, element) { CIRegistry.routes.push({ path, element }); notifyRegistry(); }
export function registerNewFile(key, def) { CIRegistry.newFile[key] = def; notifyRegistry(); }
// Calendar event-source registry. Any app module (ci-app-*.js or a sideloaded
// uploads/ci-apps/*.js) can contribute events to the Calendar without the
// Calendar leaf knowing about it — this is how e.g. WooCommerce Bookings /
// Subscriptions hook in. A source is:
//   { key, label, color, fetch({ after, before, start, end }) => [{ date:'YYYY-MM-DD', title, time?, url?, color? }] }
// `after`/`before` are ISO strings spanning the visible 6-week grid; `fetch`
// may be async and should resolve to an array (errors are caught + isolated).
export function registerCalendarSource(source) {
  if (!source || !source.key || typeof source.fetch !== 'function') {
    console.error('[ci] registerCalendarSource: requires { key, fetch }', source);
    return;
  }
  const i = CIRegistry.calendarSources.findIndex((s) => s.key === source.key);
  if (i >= 0) CIRegistry.calendarSources[i] = source; else CIRegistry.calendarSources.push(source);
}

// Top-level nav registry. Apps register a destination row that renders at the
// top of the sidebar alongside the built-in Calendar / Content Types rows —
// the extension point that lets a leaf module (ci-app-*.js) add an OS-style
// "place" without the type layer hard-coding it. A row is:
//   { key, label, icon, path, order?, match?(pathname)=>bool }
// `icon` is a CI_ICONS name; `path` is the hash route (without '#'); `match`
// decides the active state (defaults to exact-path or path-prefix). Higher
// `order` sinks lower (default 0). Re-registering the same key replaces it.
export function registerNavRow(row) {
  if (!row || !row.key || !row.path) {
    console.error('[ci] registerNavRow: requires { key, path }', row);
    return;
  }
  const next = { order: 0, ...row };
  const i = CIRegistry.navRows.findIndex((r) => r.key === row.key);
  if (i >= 0) CIRegistry.navRows[i] = next; else CIRegistry.navRows.push(next);
  notifyRegistry();
}

// Update the live badge (e.g. unread count) on a registered nav row and ask
// the sidebar to re-render. Apps poll their count and call this; the sidebar
// listens for the `ci:nav-badges` event. Pass 0/'' to clear.
export function setNavBadge(key, value) {
  const row = CIRegistry.navRows.find((r) => r.key === key);
  if (!row) return;
  row.badge = value;
  try { window.dispatchEvent(new CustomEvent('ci:nav-badges')); } catch { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Type-registry helpers — read BOOT.types (the per-CPT metadata the PHP side
// localises) and derive list URLs / normalized items. Pure functions used by
// the list, editor, and nav layers.
// ---------------------------------------------------------------------------
// Shared code-language list. Lives in Core (not Canvas) so any layer can read it
// without a back-edge into an app: the Canvas code node consumes it. Writing
// `data.language` into the fenced opener (```lang) lets an external markdown
// reader pick up the right syntax highlight.
export const CODE_LANGUAGES = [
  { id: 'python',     label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json',       label: 'JSON' },
  { id: 'csv',        label: 'CSV (table editor)' },
  { id: 'bash',       label: 'Bash / Shell' },
  { id: 'php',        label: 'PHP' },
  { id: 'yaml',       label: 'YAML' },
  { id: 'plain',      label: 'Plain text' },
];

// Build the runnable curl URL for a CI slug, from the bootstrap host + read
// token. Agents reading serialized content can hit this URL directly to fetch
// the post body. Returns null when the token isn't set (onboarding incomplete).
export function fileCurlUrlFor(slug) {
  const s = (slug || '').trim();
  if (!s) return null;
  const host = (BOOT.site_url || '').replace(/\/$/, '');
  const token = BOOT.read_token || '';
  if (!host) return null;
  const base = `${host}/wp-json/activity/v1/run/${encodeURIComponent(s)}`;
  return token ? `${base}?key=${encodeURIComponent(token)}` : base;
}

// Rewrite [[wikilink]] / [[slug|label]] markup into markdown links pointing at
// the curl URL (or a #wikilink: anchor when the slug can't resolve). Shared by
// the canvas previews, the wizard runner, and the automation email preview.
const WIKILINK_RX = /\[\[([^\[\]\|]+?)(?:\|([^\[\]]+?))?\]\]/g;
export function rewriteWikilinks(md) {
  return (md || '').replace(WIKILINK_RX, (_, slug, label) => {
    const s = slug.trim();
    const t = (label || s).trim();
    const url = fileCurlUrlFor(s);
    const href = url || `#wikilink:${encodeURIComponent(s)}`;
    return `[${t}](${href} "ci:slug=${s}")`;
  });
}

// Insert-item catalogue, shared by the Canvas add-menu and the Markdown
// insert popover (markdown filters to entries with a `template`). Pure data,
// so it lives in Core and neither app reaches into the other.
export const CANVAS_ADD_ITEMS = [
    // Items carry both a canvas `type` (for handleAdd → newNodeFromToolbar)
    // and an optional markdown `template` / `cursorOffset` (for the
    // Markdown editor's Insert popover). One registry, two consumers —
    // the canvas panel uses every entry, the markdown popover filters
    // to entries with `template`.
    { type: 'skill-triggers', label: 'Triggers', section: 'Skills',
      tip: 'Body-level activation block — the agent reads this to decide whether the skill applies. Replaces the old frontmatter `trigger:` / `auto-trigger:` fields. Searchable via intelligence/skill-search and inlined when the agent fetches the skill body.',
      template: '<Triggers>\n## When to invoke\n\n- Explicit: `/your-skill`, `--your-skill`\n- Auto: when the user [describe situation]\n- Contexts: [code review, debugging, …]\n- Avoid when: [counter-cases the agent should NOT pick this skill]\n\n</Triggers>\n', cursorOffset: 12 },
    { type: 'skill-deal', label: 'DEAL framework', section: 'Skills',
      tip: 'Four-step thinking framework — Define → Empathy → Action → Lead. Inserts four connected blocks pre-filled with the DEAL output templates and <Goto> chained so the diagram renders as Define → Empathy → Action → Lead out of the box.',
      template: '<Define id="define-objectives">\n## Objectives\n> What are we trying to achieve, and what are the supporting objectives underneath it?\n\nPrime objective:    [one sentence — the single most important outcome]\nSub-objectives:     [2–4 supporting outcomes that make the prime objective possible]\nDone when:          [a testable condition]\n\n<Goto ref="empathy-gap" />\n</Define>\n\n<Empathy id="empathy-gap">\n## Gap analysis\n> What did they expect, what actually happened, and why does it matter? Use SPIN.\n\nWhy:\n  - Situation:   [context]\n  - Problem:     [the specific failure]\n  - Implication: [what happens if unsolved]\n  - Need-payoff: [outcome they\'re after]\n\n<Goto ref="action-workflow" />\n</Empathy>\n\n<Action id="action-workflow">\n## Workflow\n> What are the concrete steps that close the gap?\n\nFirst action: [the single next thing]\nMilestones:\n  - [checkpoint 1]\n  - [checkpoint 2]\n\n<Goto ref="lead-output" />\n</Action>\n\n<Lead id="lead-output">\n## Output\n> Who owns what comes next?\n\nOwner:    [me / end-user / agent]\nSolution: [the primary recommended path]\nAction:   [what they need to do first]\n\n</Lead>\n',
      cursorOffset: 12 },
    // STRUCTURE — content building blocks, ordered simplest → richest.
    // The first three (Card / Section / Code) are what you write IN; the
    // last three (Wikilink / File / Link) are how you POINT at other
    // content. Section is the one that participates in the flow graph.
    { type: 'text',      label: 'Card',      section: 'Structure',
      tip: 'START HERE for prose. A plain heading + memo + body — no id, no graph node. Use Card for a single thought or note. Reach for Section instead when this block is a STEP in a flow that other blocks need to point at.',
      template: '## Card heading\n> One-line memo — what this card says in a single sentence.\n\nBody paragraph goes here. Add as much detail as you need; sub-headings (`###`) work too.\n', cursorOffset: 3 },
    { type: 'group',     label: 'Section',   section: 'Structure',
      tip: 'A graph-aware wrapper. Use Section when this block is a STEP in a flow — the id="" makes it referenceable from <Decision>, <Switch>, <Merge>, and <Goto>. The trailing <Goto ref="…"/> wires it to whatever comes next; delete it if this is the terminal step. Pre-filled so the diagram renders on first save.',
      template: '<Section id="step-1">\n## Step heading\n> What this step does — one sentence.\n\nBody content here.\n\n<Goto ref="step-2" />\n</Section>\n', cursorOffset: 17 },
    { type: 'code',      label: 'Code',      section: 'Structure',
      tip: 'Fenced code block with language picker (Python, JavaScript, JSON, CSV, Bash, PHP, YAML, plain). CSV switches to a table grid editor with row search + column show/hide. Use for runnable examples; agents read fenced blocks verbatim.',
      template: '```python\n# code\n```\n', cursorOffset: 3 },
    { type: 'wikilink',  label: 'Wikilink',  section: 'Structure',
      tip: 'Lightweight INLINE cross-reference — mentions another CI post by slug. Rendered as a link in the preview; the agent treats [[slug]] as a stable retrieval pointer but does NOT auto-fetch the body. Use [[slug|label]] for custom anchor text. Pick this over File when the link is conversational ("see also …").',
      template: '[[skills/related-skill|optional label]]\n', cursorOffset: 2 },
    { type: 'file',      label: 'File',      section: 'Structure',
      tip: 'EMBEDDED reference to another CI post — agent retrieves the full body via /wp-json/activity/v1/run/{slug} and inlines it. Pick this over Wikilink when the agent must HAVE the content (skill chains, dependent context). The card surfaces a runnable curl URL.',
      template: '<File ref="skills/related-skill" />\n', cursorOffset: 11 },
    { type: 'link',      label: 'Link',      section: 'Structure',
      tip: 'External URL — anything not in CI. Includes a "Copy curl" affordance so an agent can fetch it inline. For internal CI references prefer Wikilink (light) or File (embedded).',
      template: '[link text](https://example.com/)\n', cursorOffset: 1 },

    // FLOW — relational connectors. The first three (Decision / Switch /
    // Merge) build the graph topology; Checklist is for sub-tasks WITHIN
    // a step. Pre-filled with <Goto ref="…"/> targets so the diagram
    // renders immediately — replace `step-X` slugs with your real ids.
    { type: 'decision',  label: 'Decision',  section: 'Flow',
      tip: 'Binary fork — Yes / No on a single condition. Each branch points to a downstream Section/Decision/Switch id via <Goto ref="…"/>. Pick this when there are exactly TWO outcomes; reach for Switch when there are 3+ cases.',
      template: '<Decision id="decision-1" condition="What are we deciding?">\n- Yes → <Goto ref="step-yes" />\n- No  → <Goto ref="step-no" />\n</Decision>\n', cursorOffset: 33 },
    { type: 'switch',    label: 'Switch',    section: 'Flow',
      tip: 'N-way dispatch on a value (3+ cases). Each case routes to a downstream id via <Goto ref="…"/>. Pick this over Decision when the fork has more than two outcomes; pick Decision when it\'s a binary yes/no.',
      template: '<Switch id="switch-1" value="What are we routing on?">\n- case A → <Goto ref="step-a" />\n- case B → <Goto ref="step-b" />\n- case C → <Goto ref="step-c" />\n</Switch>\n', cursorOffset: 29 },
    { type: 'merge',     label: 'Merge',     section: 'Flow',
      tip: 'Join point where multiple branches converge. The from="" attribute lists upstream Decision/Switch/Section ids being merged — gives the agent (and the diagram) a complete graph without re-deriving it from layout. Use right before a step that runs regardless of which branch ran.',
      template: '<Merge id="merge-1" from="step-yes, step-no" label="continue" />\n', cursorOffset: 15 },
    { type: 'checklist', label: 'Checklist', section: 'Flow',
      tip: 'Sub-tasks within a single step. Plain markdown checkbox list — the agent treats unchecked items as TODO. Use INSIDE a Section to break a step into atomic actions; do NOT use as a substitute for Decision/Switch (the diagram won\'t draw checklist edges).',
      template: '- [ ] First check\n- [ ] Second check\n- [ ] Third check\n', cursorOffset: 6 },

    // PATTERNS — multi-block macros for common flow shapes. Each inserts
    // a complete <Section>/<Decision>/<Merge> graph chained with <Goto>
    // refs so the diagram renders immediately. Rename the auto-generated
    // ids (reproduce / diagnose / fix / verify, context / options, …) to
    // fit your domain after inserting.
    { type: 'pattern-bug', label: 'Bug investigation', section: 'Patterns',
      tip: 'Four-step macro: Reproduce → Diagnose → Fix → Verify. The canonical shape for debugging a customer issue; gives the agent a stable order so it doesn\'t skip steps.',
      template: '<Section id="reproduce">\n## Reproduce\n> Get a deterministic local repro before touching code.\n\nSteps:\n1. [exact steps]\n2. [expected behaviour]\n3. [actual behaviour]\n\n<Goto ref="diagnose" />\n</Section>\n\n<Section id="diagnose">\n## Diagnose\n> Find the root cause, not just a symptom.\n\nHypothesis: [what you think is happening]\nEvidence:    [logs / traces / git blame that confirms]\n\n<Goto ref="fix" />\n</Section>\n\n<Section id="fix">\n## Fix\n> The smallest change that resolves the cause.\n\nChange:     [files/lines]\nWhy this works: [link cause → fix]\n\n<Goto ref="verify" />\n</Section>\n\n<Section id="verify">\n## Verify\n> Prove the fix works AND nothing else broke.\n\nRepro now: [should fail / pass as expected]\nRegression: [adjacent tests that still pass]\n\n</Section>\n', cursorOffset: 17 },
    { type: 'pattern-adr', label: 'Decision record (ADR)', section: 'Patterns',
      tip: 'Architectural Decision Record macro: Context → Options → Decision → Consequences. Use to capture WHY a non-trivial choice was made so the next person doesn\'t re-litigate it.',
      template: '<Section id="adr-context">\n## Context\n> The forces in play — what made this decision necessary.\n\n[constraints, deadlines, who\'s affected, what triggered the call]\n\n<Goto ref="adr-options" />\n</Section>\n\n<Section id="adr-options">\n## Options considered\n> The alternatives, with honest tradeoffs.\n\n- **Option A** — [pros, cons]\n- **Option B** — [pros, cons]\n- **Option C** — [pros, cons]\n\n<Goto ref="adr-decision" />\n</Section>\n\n<Section id="adr-decision">\n## Decision\n> The chosen path, in one sentence + the deciding factor.\n\nChose: [option]\nBecause: [the single most important reason]\n\n<Goto ref="adr-consequences" />\n</Section>\n\n<Section id="adr-consequences">\n## Consequences\n> What follows from this choice — both upside and downside.\n\nUpside:   [what we now enable]\nDownside: [what we now pay / lose]\nRevisit if: [the condition that would force a re-decision]\n\n</Section>\n', cursorOffset: 19 },
    { type: 'pattern-loop', label: 'Loop / retry', section: 'Patterns',
      tip: 'Retry pattern: a Section that ends in a Decision pointing BACK to itself when the check fails. Use for polling, validation retries, "keep working until done" workflows.',
      template: '<Section id="loop-body">\n## Work step\n> The action that runs each iteration.\n\n[describe the work]\n\n<Goto ref="loop-check" />\n</Section>\n\n<Decision id="loop-check" condition="Did it succeed / are we done?">\n- No  → <Goto ref="loop-body" />\n- Yes → <Goto ref="loop-exit" />\n</Decision>\n\n<Section id="loop-exit">\n## Done\n> What to do after the loop succeeds.\n\n[finalisation, return value, cleanup]\n\n</Section>\n', cursorOffset: 17 },
    { type: 'pattern-fanout', label: 'Parallel branches', section: 'Patterns',
      tip: 'Fan-out / fan-in: one Switch routes to N parallel Sections, all of which converge into a Merge. Use when independent sub-tasks run in parallel before a shared next step.',
      template: '<Switch id="dispatch" value="route">\n- branch-a → <Goto ref="branch-a" />\n- branch-b → <Goto ref="branch-b" />\n- branch-c → <Goto ref="branch-c" />\n</Switch>\n\n<Section id="branch-a">\n## Branch A\n> [what this branch does]\n\n<Goto ref="converge" />\n</Section>\n\n<Section id="branch-b">\n## Branch B\n> [what this branch does]\n\n<Goto ref="converge" />\n</Section>\n\n<Section id="branch-c">\n## Branch C\n> [what this branch does]\n\n<Goto ref="converge" />\n</Section>\n\n<Merge id="converge" from="branch-a, branch-b, branch-c" label="continue" />\n\n<Section id="after-merge">\n## After merge\n> Step that runs once all branches finish.\n\n</Section>\n', cursorOffset: 18 },

    { type: 'role',         label: 'Role',         section: 'Prompt',
      tip: 'Anthropic prompt pattern: tells the LLM what persona / expertise to assume. Use at the top of a workflow.',
      template: '<Role>\nYou are a helpful assistant…\n</Role>\n', cursorOffset: 7 },
    { type: 'examples',     label: 'Examples',     section: 'Prompt',
      tip: 'Prompt pattern: input → output example pairs for few-shot learning. Improves consistency.',
      template: '<Examples>\n- Input:  …\n  Output: …\n</Examples>\n', cursorOffset: 11 },
    { type: 'constraints',  label: 'Constraints',  section: 'Prompt',
      tip: 'Prompt pattern: explicit do / don\'t lists. Use to bound LLM behavior (escaping rules, scope limits, etc.).',
      template: '<Constraints>\nDo:\n  - …\nDon\'t:\n  - …\n</Constraints>\n', cursorOffset: 14 },
    { type: 'thinking',     label: 'Thinking',     section: 'Prompt',
      tip: 'Prompt pattern: prefilled <thinking> block. Steers chain-of-thought toward specific considerations.',
      template: '<Thinking>\n…\n</Thinking>\n', cursorOffset: 11 },

    // Agent SDK — declarative cards that define HOW an agent behaves.
    { type: 'agent-system',   label: 'System prompt', section: 'Agent SDK',
      tip: 'Claude Agent SDK: define the agent\'s core system prompt. Preset = "claude_code" inherits the default; "custom" replaces it.',
      template: '<AgentSystem preset="custom">\nYou are…\n</AgentSystem>\n', cursorOffset: 22 },
    { type: 'agent-subagent', label: 'Sub-agent',     section: 'Agent SDK',
      tip: 'Claude Agent SDK: define a specialized sub-agent (own tools, prompt, model). The main agent dispatches to it.',
      template: '<AgentSubagent name="" description="" model="sonnet">\nSystem prompt for the sub-agent…\n</AgentSubagent>\n', cursorOffset: 21 },
    { type: 'agent-command',  label: 'Slash command', section: 'Agent SDK',
      tip: 'Claude Agent SDK: define a /command users can invoke. The template is the prompt that runs.',
      template: '<AgentCommand name="" description="">\nPrompt the command runs…\n</AgentCommand>\n', cursorOffset: 20 },
    { type: 'agent-ask',      label: 'AskUserQuestion',   section: 'Agent SDK',
      tip: 'SDK tool: render multiple-choice buttons in chat. Use when the workflow needs an explicit human decision.',
      template: '<AskUserQuestion question="">\n- Option A\n- Option B\n</AskUserQuestion>\n', cursorOffset: 27 },
    { type: 'agent-task',     label: 'TaskCreate',        section: 'Agent SDK',
      tip: 'SDK tool: create a task in the Cowork todo widget. Subject + description + spinner text.',
      template: '<TaskCreate subject="" description="" />\n', cursorOffset: 21 },
    { type: 'agent-skill',    label: 'Skill',             section: 'Agent SDK',
      tip: 'SDK tool: invoke a named CI skill at runtime (by slug). Args passed through.',
      template: '<Skill slug="" />\n', cursorOffset: 13 },
    { type: 'agent-spawn',    label: 'Agent (spawn)',     section: 'Agent SDK',
      tip: 'SDK tool: spawn a sub-agent for a specific task. Supports worktree isolation for git work.',
      template: '<Agent type="" prompt="" />\n', cursorOffset: 13 },
    { type: 'agent-widget',   label: 'show_widget',       section: 'Agent SDK',
      tip: 'SDK tool: render an inline SVG or HTML widget. Use for visualizations / status displays.',
      template: '<Widget kind="svg">\n<!-- markup here -->\n</Widget>\n', cursorOffset: 14 },

    { type: 'mcp-tool',     label: 'Tool',     section: 'MCP',
      tip: 'MCP server tool definition. Name + description + JSON input schema. Any MCP client (Claude Desktop, Cursor, LibreChat) can invoke.',
      template: '<McpTool name="" description="">\n```json\n{\n  "type": "object",\n  "properties": {}\n}\n```\n</McpTool>\n', cursorOffset: 16 },
    { type: 'mcp-resource', label: 'Resource', section: 'MCP',
      tip: 'MCP resource definition: a URI + content the client can fetch. Exposes content as a named slot.',
      template: '<McpResource uri="" mimeType="text/markdown">\nResource content…\n</McpResource>\n', cursorOffset: 18 },
    { type: 'mcp-prompt',   label: 'Prompt',   section: 'MCP',
      tip: 'MCP prompt definition: a parameterized template the client surfaces as a quick-action.',
      template: '<McpPrompt name="" description="">\nPrompt template with {placeholders}…\n</McpPrompt>\n', cursorOffset: 18 },

    // Task control — niche; for dynamic mutation of in-flight tasks.
    { type: 'agent-task-update', label: 'TaskUpdate', section: 'Task control',
      tip: 'Update an existing task (status / subject / dependencies). Drives the in_progress → completed transition in Cowork.' },
    { type: 'agent-task-get',    label: 'TaskGet',    section: 'Task control',
      tip: 'Fetch full details for a task by ID.' },
    { type: 'agent-task-list',   label: 'TaskList',   section: 'Task control',
      tip: 'List all tasks and their current status.' },
    { type: 'agent-task-stop',   label: 'TaskStop',   section: 'Task control',
      tip: 'Stop a running background task by ID.' },
];

export const typeKeys = () => Object.keys(BOOT.types);
export const typeMeta = (slug) => BOOT.types[slug];
// `kind` defaults to 'post' (CPT-backed); 'term' uses the taxonomy REST routes.
export const typeKind = (meta) => meta?.kind || 'post';
export const isTermType = (meta) => typeKind(meta) === 'term';
export const isNativeReplace = (meta) => meta?.placement === 'native_replace';
// `tree`: 'os_path' (default) | 'parent' (Pages/Categories) | 'flat' (Posts/Tags).
export const treeKind = (meta) => meta?.tree || 'os_path';

export function applyTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function listUrl(meta, extra = '', taxFields = []) {
  if (isTermType(meta)) {
    return `/wp/v2/${meta.rest_base}?per_page=100&hide_empty=false&orderby=name&order=asc&_fields=id,name,slug,parent,count,description,link${extra}`;
  }
  const filter = meta.term_id ? `&${meta.taxonomy}=${meta.term_id}` : '';
  const baseFields = treeKind(meta) === 'parent'
    ? 'id,title,modified,slug,excerpt,meta,parent,status'
    : 'id,title,modified,slug,excerpt,meta,status';
  let fields = isNativeReplace(meta) ? `${baseFields},link` : baseFields;
  if (Array.isArray(taxFields) && taxFields.length) {
    fields += ',' + taxFields.join(',');
  }
  return `/wp/v2/${meta.rest_base}?per_page=100&orderby=modified&order=desc&status=any&context=edit&_fields=${fields}${filter}${extra}`;
}

/**
 * Normalize a raw REST item (post or term) into a uniform shape the tree +
 * list renderers consume. Terms get a synthetic `title.rendered` from `name`
 * and an empty `meta.os_path`.
 */
export function normalizeItem(meta, raw) {
  const edit_url = meta.edit_url ? applyTemplate(meta.edit_url, { id: raw.id }) : '';
  if (isTermType(meta)) {
    return {
      id: raw.id,
      title: { rendered: raw.name || '' },
      slug: raw.slug || '',
      modified: '',
      parent: raw.parent || 0,
      count: raw.count || 0,
      meta: { os_path: '' },
      link: raw.link || '',
      edit_url,
      _raw: raw,
    };
  }
  return {
    ...raw,
    parent: raw.parent || 0,
    meta: raw.meta || {},
    link: raw.link || '',
    edit_url,
  };
}

// Build a parent/child tree from a flat list of items with {id, parent, title,
// slug}. Pure helper shared by the nav tree (Pages/Categories) + the Media
// folder sidebar. Items whose parent isn't in the set are promoted to root.
export function buildParentTree(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const childrenOf = new Map();
  for (const it of items) {
    const pid = it.parent || 0;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(it);
  }
  const rootIds = new Set();
  for (const it of items) {
    if (!it.parent || !byId.has(it.parent)) rootIds.add(it.id);
  }
  const sortItems = (arr) => arr.slice().sort(
    (a, b) => (a.title?.rendered || a.slug || '').localeCompare(b.title?.rendered || b.slug || '')
  );
  const toNode = (item) => {
    const kids = sortItems(childrenOf.get(item.id) || []);
    return { name: item.title?.rendered || item.slug || '(untitled)', fullPath: `id:${item.id}`, item, children: kids.map(toNode), items: [] };
  };
  const rootItems = sortItems(items.filter((it) => rootIds.has(it.id)));
  return { name: '', fullPath: '', children: rootItems.map(toNode), items: [] };
}

// Build a os_path folder tree from items' os_path meta. Pure; shared by the
// nav tree + type list. (Moved from the monolith during the ci-type split.)
export function buildPathTree(items, emptyFolders = [], trashedItems = []) {
  const root = { name: '', fullPath: '', children: new Map(), items: [] };
  const orphans = { name: '(unrouted)', fullPath: '__orphans__', children: new Map(), items: [] };

  const ensurePath = (node, parts) => {
    let cursor = node;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const segPath = parts.slice(0, i + 1).join('/');
      if (!cursor.children.has(seg)) {
        cursor.children.set(seg, { name: seg, fullPath: segPath, children: new Map(), items: [] });
      }
      cursor = cursor.children.get(seg);
    }
    return cursor;
  };

  for (const item of items) {
    const path = item.meta?.os_path || '';
    if (!path) { orphans.items.push(item); continue; }
    const parts = path.split('/').filter(Boolean);
    // The LAST segment is the skill's own dir name — the item itself lives
    // at that level. Everything before it is the parent chain.
    const parent = ensurePath(root, parts.slice(0, -1));
    parent.items.push(item);
  }

  // Empty folders (user-created via "+ Folder", persisted in localStorage)
  // are added to the tree so they're visible even with no items inside.
  // They become real once a file is dragged in or created under their path.
  for (const folderPath of emptyFolders) {
    const parts = folderPath.split('/').filter(Boolean);
    if (parts.length) ensurePath(root, parts);
  }

  // Convert Maps to sorted arrays for stable rendering.
  const finalize = (n) => ({
    name: n.name,
    fullPath: n.fullPath,
    children: Array.from(n.children.values()).map(finalize).sort((a, b) => a.name.localeCompare(b.name)),
    items: n.items.sort((a, b) => (a.title?.rendered || a.slug).localeCompare(b.title?.rendered || b.slug)),
  });

  const tree = finalize(root);
  if (orphans.items.length) tree.children.push(finalize(orphans));
  // Always-present `.trash` folder at the bottom. Hidden when empty so
  // it doesn't add visual noise on clean trees. Items inside come from
  // posts with post_status='trash' — the user can either restore them
  // by editing & re-saving, or empty the folder to force-delete.
  if (trashedItems.length > 0) {
    const trashSorted = trashedItems.slice().sort((a, b) => (a.title?.rendered || a.slug || '').localeCompare(b.title?.rendered || b.slug || ''));
    tree.children.push({
      name: '.trash',
      fullPath: '.trash',
      children: [],
      items: trashSorted,
      __isTrash: true,
    });
  }
  return tree;
}
