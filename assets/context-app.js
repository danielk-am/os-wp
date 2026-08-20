/**
 * Context — custom WordPress admin app for editing markdown CPTs.
 * Runtime-only: no build step. Bare specifiers resolved via importmap.
 */

import { createElement, cloneElement, Children, useState, useEffect, useReducer, useRef, useMemo, useCallback, useContext, createContext, Fragment } from 'react';
import { createRoot, createPortal } from 'react-dom/client';
import { HashRouter, Routes, Route, Link, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
// Context Core foundation (htm renderer, BOOT, REST client, entity decode,
// app registry). Extracted to its own ES module — see assets/os-core.js.
import { h, BOOT, API_VERSION, rest, restWithHeaders, restAllPages, decodeEntities, CIRegistry, registerEditor, registerListView, registerRoute, registerNavRow, registerNewFile, registerCalendarSource, onRegistryChange, setNavBadge, editorChoices, buildParentTree, typeKeys, typeMeta, typeKind, isTermType, isNativeReplace, treeKind, applyTemplate, listUrl, normalizeItem } from 'os/core';
// Context UI kernel (icons + base presentational components) — see assets/os-ui.js.
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, CI_ICONS, PICKABLE_ICONS, SelectCheckbox, SegmentedToggle, PageHeading, SelectMenu } from 'os/ui';
// Context Engine (field-group / taxonomy / validation layer) — see assets/os-engine.js.
import { FG_FIELD_TYPES, FG_PRESENTATIONAL, FG_WIDTHS, fgCols, fgWithId, fgStrip, FG_COND_OPS, evalConditional, fgCptOptions, RelationshipField, TaxonomyField } from 'os/engine';
// Context Shell (app-wide toast + dialog providers/hooks) — see assets/os-shell.js.
import { ToastProvider, useToast, DialogProvider, useDialog } from 'os/shell';
// Context Editors (shared CodeMirror + Gutenberg composer) — see assets/os-editors.js.
import { CodeEditor, monacoReady, GutenbergComposer, useEditorFullWidth, EditorFullWidthButton } from 'os/editors';
// Workspaces — the Reference companion drawer, mounted in the Shell below.
import { ReferencePanel } from 'os/app-workspace';
// Shared editor chrome — self-contained leaf; sets the shared EditorHeader /
// MarkdownInsertPopover on the registry (read by every editor) and registers
// the `block` Gutenberg-redirect editor.
import 'os/editor-chrome';
// Skill structure → Mermaid outline. Self-registers CIRegistry.SkillOutline,
// read by the cpt editor's Settings drawer. The 3 MB mermaid bundle is only
// pulled in when that panel actually mounts (lazy dynamic import).
import 'os/skill-mermaid';
// Type layer — the nav/list/editor spine. Importing it self-registers the
// meta/term/cpt editors + content-types/structure routes and sets the shared
// chrome (TypeLayout/NewFileButton/MobileMenuButton/starterTemplateFor) on the
// registry. ListView + EditorPage are used by the App router below.
import { ListView, EditorPage } from 'os/type';
// (Previously: BlockPreview + parse from @wordpress/{block-editor,blocks}.
// Replaced with a server-side render endpoint — see
// inc/admin/class-pattern-preview.php — because the core block types
// don't reliably register outside the native block-editor admin pages,
// so BlockPreview rendered as an empty frame. Server-side rendering
// uses WP's own do_blocks() pipeline, so previews are identical to
// the front-end render.)
// (FontAwesome language glyphs now live in os-editor-chrome.js with FaIcon.)
// WPDS — @wordpress/components, bridged from window.wp.components.
import {
  Button as WPButton,
  Spinner as WPSpinner, Notice as WPNotice,
  Card as WPCard, CardBody as WPCardBody,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup,
  ToolbarButton as WPToolbarButton,
  Dropdown as WPDropdown, ColorPalette as WPColorPalette,
  ColorIndicator as WPColorIndicator,
  TextControl as WPTextControl, TextareaControl as WPTextareaControl,
  FormTokenField as WPFormTokenField,
  CheckboxControl as WPCheckboxControl, SearchControl as WPSearchControl,
  TreeGrid as WPTreeGrid, TreeGridRow as WPTreeGridRow, TreeGridCell as WPTreeGridCell,
  ItemGroup as WPItemGroup, Item as WPItem,
  MenuGroup as WPMenuGroup, MenuItem as WPMenuItem,
  TabPanel as WPTabPanel,
  SlotFillProvider as WPSlotFillProvider,
  HStack as WPHStack, VStack as WPVStack, Flex as WPFlex, FlexItem as WPFlexItem,
} from '@wordpress/components';
// Lightweight markdown → HTML for rendering text-node bodies in display
// mode (when not selected). When selected the user edits the raw markdown.
import { marked } from 'marked';
// Gutenberg block-editor primitives. Used by the wizard composer to
// render an inline Block Editor per step. The bridges resolve to
// window.wp.* globals (no second bundle); the host page enqueues
// wp-block-editor / wp-blocks / wp-block-library so the globals exist
// and core blocks register on load.
// (@wordpress/block-editor primitives now live in ci/editors with GutenbergComposer.)
import { ShortcutProvider } from '@wordpress/keyboard-shortcuts';
import { parse as parseBlocks, serialize as serializeBlocks } from '@wordpress/blocks';
// Native Gutenberg icons for the editor chrome — keeps our toolbar
// buttons visually identical to the block toolbar's own controls.
// Chrome glyphs — formerly @wordpress/icons, now FontAwesome-backed `<Icon/>`
// elements (one shared element each). They still work as WPButton `icon=` props
// and as `WPGlyph icon=…` (which clones them), so no call sites changed.
const iconPlus = h`<${Icon} name="plus" />`;
const iconUndo = h`<${Icon} name="undo" />`;
const iconRedo = h`<${Icon} name="redo" />`;
const iconCog = h`<${Icon} name="cog" />`;
const iconDrawerRight = h`<${Icon} name="drawer-right" />`;
const iconListView = h`<${Icon} name="list-view" />`;
const iconTrash = h`<${Icon} name="trash" />`;
const iconChevronUp = h`<${Icon} name="chevron-up" />`;
const iconChevronDown = h`<${Icon} name="chevron-down" />`;
const iconChevronRight = h`<${Icon} name="chevron-right" />`;
const iconChevronLeft = h`<${Icon} name="chevron-left" />`;
const iconClose = h`<${Icon} name="close" />`;
const iconPage = h`<${Icon} name="page" />`;
const iconGrid = h`<${Icon} name="grid" />`;
const iconCheck = h`<${Icon} name="check" />`;
marked.setOptions({ gfm: true, breaks: true });

// h, BOOT, rest, restWithHeaders, restAllPages now imported from 'os/core'.

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = (e) => setMatch(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return match;
}

// typeKeys/typeMeta/typeKind/isTermType/isNativeReplace/treeKind/applyTemplate/
// listUrl/normalizeItem now imported from 'os/core'.

/**
 * Build a tree from a flat list of items linked by `parent` (id of another
 * item or 0 for root). Used for Pages and Categories. Returned shape mirrors
 * buildPathTree so TreePanel can render either with the same components.
 *
 * Each item becomes a node that can hold both children-as-folder (when other
 * items reference it as parent) and remain selectable as a leaf — we treat
 * items with children as folders that ALSO link to their own edit page.
 */

/**
 * Build a tree from a flat list of items that each have a `meta.os_path`
 * (slash-separated string, like "engineering-happiness/using-zendesk/private-note").
 *
 * Items without a os_path are returned in a "(unrouted)" branch.
 *
 * Returns a recursive shape: { name, fullPath, children: [], items: [item, ...] }
 */

// ---------------------------------------------------------------------------
// Icons are imported from the curated Font Awesome Free bundle in `ci/ui`.
// ---------------------------------------------------------------------------

// ICONS / Icon / WPGlyph now imported from 'os/ui'.

// ---------------------------------------------------------------------------
// Toast system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Command palette (Cmd-K) — search across all CPTs
// ---------------------------------------------------------------------------

const PaletteCtx = createContext(null);
const usePalette = () => useContext(PaletteCtx);

function PaletteProvider({ children }) {
  const [open, setOpen] = useState(false);
  const api = { open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen((o) => !o) };

  useEffect(() => {
    function onKey(e) {
      // Command palette triggers (⌘⇧` / ⌘⇧P / ⌘K, + Escape to close). Capture
      // phase + stopImmediatePropagation so WP core's own Cmd+K listener never
      // fires. NOTE: WP's native CommandMenu (@wordpress/commands) does not
      // render standalone on this admin page — it opens then self-closes
      // outside the editor shell — so we keep this bespoke palette.
      const mod = e.metaKey || e.ctrlKey;
      const cmdShiftBacktick = mod && e.shiftKey && (e.key === '`' || e.code === 'Backquote');
      const cmdShiftP        = mod && e.shiftKey && e.key.toLowerCase() === 'p';
      const cmdK             = mod && !e.shiftKey && e.key.toLowerCase() === 'k';
      if (cmdShiftBacktick || cmdShiftP || cmdK) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return h`<${PaletteCtx.Provider} value=${api}>
    ${children}
    ${open ? h`<${CommandPalette} onClose=${() => setOpen(false)} />` : null}
  </${PaletteCtx.Provider}>`;
}

// Build the static admin-page entries served by the boot payload.
// Each entry becomes a "Go: <Parent> → <Label>" command in the palette;
// score is computed against the user's query at search time.
function buildAdminMenuPaletteItems() {
  const menu = Array.isArray(BOOT.admin_menu) ? BOOT.admin_menu : [];
  return menu.map((m, i) => {
    const parent = m.parent && m.parent !== m.label ? m.parent : '';
    const label  = parent ? `${parent} → ${m.label}` : m.label;
    return {
      kind:      'admin-page',
      id:        `admin-${i}`,
      title:     label,
      subtitle:  m.source || 'WordPress',
      url:       m.url,
      icon:      m.kind === 'top' ? '▤' : '↳',
      // Searchable text — match by either label or parent independently.
      _search:   (m.label + ' ' + (m.parent || '') + ' ' + (m.source || '')).toLowerCase(),
    };
  });
}

// Build "Setting" entries from BOOT.settings_fields. Each one
// deep-links to its parent admin page with a text-fragment hash
// (`#:~:text=…`) so the browser scrolls to the exact field label.
// Supported in Chrome / Edge / Safari 16.4+; silently ignored
// elsewhere, in which case the user just lands on the parent page.
function buildSettingsPaletteItems() {
  const fields = Array.isArray(BOOT.settings_fields) ? BOOT.settings_fields : [];
  return fields.map((f, i) => ({
    kind:     'admin-setting',
    id:       'setting-' + i,
    title:    f.label,
    subtitle: (f.source || 'WordPress') + (f.section ? ' · ' + f.section : ''),
    url:      f.url,
    icon:     '⚙',
    _search:  (f.label + ' ' + (f.section || '') + ' ' + (f.page || '') + ' ' + (f.source || '')).toLowerCase(),
  }));
}

// Read commands registered with @wordpress/commands, if it's loaded
// on this page. WP exposes a Redux store under `core/commands`;
// `getCommands()` returns the array of registered commands. Most
// non-block-editor admin pages don't have the script enqueued — in
// which case we just return [] and the integration silently no-ops.
function buildWpCommandsPaletteItems() {
  try {
    const select = window.wp?.data?.select;
    if (!select) return [];
    const store = select('core/commands');
    if (!store || typeof store.getCommands !== 'function') return [];
    const cmds = store.getCommands() || [];
    return cmds.map((c, i) => ({
      kind:      'wp-command',
      id:        'wpcmd-' + (c.name || i),
      title:     c.label || c.name || 'Untitled command',
      subtitle:  'WordPress command',
      callback:  c.callback || null,
      icon:      '▶',
      _search:   ((c.label || '') + ' ' + (c.searchLabel || '') + ' ' + (c.name || '')).toLowerCase(),
    }));
  } catch { return []; }
}

// In-app navigation destinations: the core routes + every registered nav row
// (CIRegistry.navRows — Activity and any future app row). Lets the palette
// jump anywhere the sidebar can, by name. De-duped by route.
function buildNavPaletteItems() {
  const core = [
    { to: '/', title: 'Home' },
    { to: '/calendar', title: 'Calendar' },
    { to: '/content-types', title: 'Content Types' },
    { to: '/settings', title: 'Settings' },
  ];
  const fromRegistry = (CIRegistry.navRows || []).map((r) => ({ to: r.path, title: r.label || r.key }));
  const seen = new Set();
  return [...core, ...fromRegistry]
    .filter((r) => r.to && !seen.has(r.to) && seen.add(r.to))
    .map((r) => ({
      kind:     'nav',
      id:       'nav-' + r.to,
      title:    r.title,
      subtitle: 'Go to ' + r.title,
      to:       r.to,
      icon:     '◆',
      _search:  ('go ' + r.title + ' ' + r.to).toLowerCase(),
    }));
}

// Quick-create actions: "New <singular>" for each Context-owned content type
// (cpt starts with ci_, excluding taxonomy types). Routes to the type's /new
// editor — the same target the sidebar "+ File" button uses.
function buildActionPaletteItems() {
  const out = [];
  for (const key of typeKeys()) {
    const m = typeMeta(key);
    if (!m || !(m.cpt || '').startsWith('ci_') || isTermType(m)) continue;
    const singular = m.singular || m.label || key;
    out.push({
      kind:     'action',
      id:       'new-' + key,
      title:    'New ' + singular,
      subtitle: 'Create · ' + (m.label || key),
      to:       `/t/${key}/new`,
      icon:     '＋',
      _search:  ('new create ' + singular + ' ' + (m.label || '')).toLowerCase(),
    });
  }
  return out;
}

// App-level palette commands: actions that toggle in-app overlays rather than
// navigate. Currently just the Reference drawer — its floating button was
// removed in favour of this palette entry (window.ciRefOpen is published by the
// always-mounted ReferencePanel).
function buildAppCommandPaletteItems() {
  return [{
    kind:     'app-command',
    id:       'open-reference',
    title:    'Open Reference',
    subtitle: 'Browse ci:// content beside your work',
    icon:     '▤',
    callback: () => window.ciRefOpen?.('ci://'),
    _search:  'open reference drawer workspace browse ci:// beside your work',
  }];
}

// Fuzzy + token-based score. Each query token must match as a
// subsequence of the target (characters in order, gaps allowed) — so
// "site visi" matches "Search Engine Visibility" and "clr trans"
// matches "Clear transients". Word-boundary matches and consecutive
// runs score higher; long gaps cost a little.
//
// Returns a score where LOWER = better, to match the surrounding
// `.sort((a,b) => a.score - b.score)` convention. Returns -1 to mark
// "no match" — those entries are filtered out before sorting.
function fuzzySubseq(query, target) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (target || '').toLowerCase();
  let qi = 0;
  let bonus = 0;
  let prevIdx = -2;
  let gapPenalty = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
      // Word-start bonus: character follows a separator or is at index 0.
      const prevCh = ti > 0 ? t[ti - 1] : ' ';
      if (/[\s\-:_>\/.]/.test(prevCh)) bonus += 6;
      // Consecutive-run bonus / gap penalty.
      if (ti - prevIdx === 1) bonus += 4;
      else if (prevIdx >= 0) gapPenalty += (ti - prevIdx - 1) * 0.3;
      prevIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return Infinity; // didn't consume the whole query → no match
  // Aggregate: prefix gap before the first match, plus gaps inside,
  // minus bonuses, plus a tiny length term so short targets win ties.
  // A strong match (big word-start / consecutive bonus) is NEGATIVE — lower is
  // better — so the no-match sentinel must be Infinity, not a negative number,
  // or short high-bonus targets (e.g. "go calendar") get wrongly rejected.
  return gapPenalty - bonus + t.length * 0.05;
}

function scorePaletteItem(item, terms) {
  const hay = item._search || '';
  let total = 0;
  for (const t of terms) {
    const s = fuzzySubseq(t, hay);
    if (s === Infinity) return Infinity; // any term unmatched → drop the item
    total += s;
  }
  return total;
}

function CommandPalette({ onClose }) {
  const [q, setQ] = useState('');
  const [contentResults, setContentResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Pre-build the static palette pool (admin pages + wp.commands) on
  // open. Both lists are bounded (~80 + ~0–30 entries) so this is cheap
  // and avoids re-scanning per keystroke.
  const staticPool = useMemo(() => {
    return [
      ...buildNavPaletteItems(),
      ...buildActionPaletteItems(),
      ...buildAdminMenuPaletteItems(),
      ...buildSettingsPaletteItems(),
      ...buildWpCommandsPaletteItems(),
      ...buildAppCommandPaletteItems(),
    ];
  }, []);

  // ci:// path-navigator mode. When the query starts with "ci:", the palette
  // becomes a Spotlight-style path browser over the content VFS: it lists the
  // entries of the nearest directory and filters them by the trailing segment,
  // so "ci://wiki/onb" autocompletes folders/posts under ci://wiki. Picking a
  // folder drills in; picking a post jumps to its editor.
  const pathMode = /^ci:/i.test(q.trim());
  const [vfsResults, setVfsResults] = useState([]);
  useEffect(() => {
    if (!pathMode) { setVfsResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const body = q.trim().replace(/^ci:\/*/i, '');       // strip the scheme
        const segs = body.split('/');
        const endsSlash = /\/$/.test(body);
        const leaf = endsSlash ? '' : (segs.pop() || '');
        const dirPath = 'ci://' + segs.filter(Boolean).join('/');
        const node = await rest(`/activity/v1/vfs/ls?path=${encodeURIComponent(dirPath)}`);
        let entries = Array.isArray(node.entries) ? node.entries : [];
        if (leaf) { const lf = leaf.toLowerCase(); entries = entries.filter((e) => (e.name || '').toLowerCase().includes(lf)); }
        setVfsResults(entries.map((e) => ({
          kind:     'vfs',
          id:       'vfs-' + e.path,
          title:    e.name,
          subtitle: e.path,
          icon:     e.kind === 'dir' ? '▸' : '•',
          isDir:    e.kind === 'dir',
          vfsPath:  e.path,
          appRoute: e.app_route || null,
        })));
      } catch (e) { setVfsResults([]); }
      finally { setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, pathMode]);

  // Content search via the slim /find endpoint — hits skill-search +
  // wiki-search + cross-CPT. Debounced 150ms.
  useEffect(() => {
    if (!q.trim()) { setContentResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const items = await rest(`/activity/v1/find?q=${encodeURIComponent(q)}&limit=20`);
        const annotated = items.map((it) => {
          const m = typeMeta(it.type);
          return {
            kind:     'content',
            id:       `content-${it.type}-${it.id}`,
            title:    typeof it.title === 'object' ? (it.title?.rendered || '(untitled)') : (it.title || '(untitled)'),
            subtitle: (m ? m.label : it.type) + ' · ' + (it.slug || ''),
            icon:     m ? m.icon : '•',
            edit_url: it.edit_url,
            type:     it.type,
            postId:   it.id,
          };
        });
        setContentResults(annotated);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // Filter the static pool client-side by the current query and merge
  // with content results. Content first (most relevant), then admin
  // pages, then wp.commands. Cap at ~40 items to keep the list usable.
  const results = useMemo(() => {
    if (pathMode) return vfsResults.slice(0, 40);
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const staticScored = staticPool
      .map((it) => ({ it, score: scorePaletteItem(it, terms) }))
      .filter(({ score }) => score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .slice(0, 25)
      .map(({ it }) => it);
    return [...contentResults, ...staticScored].slice(0, 40);
  }, [q, contentResults, staticPool, pathMode, vfsResults]);

  useEffect(() => { setActiveIndex(0); }, [q, contentResults, vfsResults]);

  // Dispatch picked item by `kind`:
  //   content      → in-app editor route (or `edit_url` if it links
  //                  out, e.g. WP posts edited via wp-admin)
  //   admin-page   → navigate to wp-admin URL
  //   wp-command   → invoke the registered callback
  const openResult = (pick) => {
    if (!pick) return;
    if (pick.kind === 'content') {
      if (pick.edit_url) window.location.href = pick.edit_url;
      else navigate(`/t/${pick.type}/${pick.postId}`);
    } else if (pick.kind === 'nav' || pick.kind === 'action') {
      navigate(pick.to);
    } else if (pick.kind === 'vfs') {
      // Drilling into a folder keeps the palette open with the path pre-filled
      // so you can keep navigating; a file jumps to its in-app editor route.
      if (pick.isDir) { setQ(pick.vfsPath + '/'); inputRef.current?.focus(); return; }
      if (pick.appRoute) {
        const hashIdx = pick.appRoute.indexOf('#');
        if (hashIdx >= 0) navigate(pick.appRoute.slice(hashIdx + 1));
        else window.location.href = pick.appRoute;
      }
    } else if (pick.kind === 'admin-page' || pick.kind === 'admin-setting') {
      window.location.href = pick.url;
    } else if ((pick.kind === 'wp-command' || pick.kind === 'app-command') && typeof pick.callback === 'function') {
      try { pick.callback({ close: onClose }); } catch (e) { console.error(e); }
    }
    onClose();
  };
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      openResult(results[activeIndex]);
    }
  }

  // The palette covers the content area (right of the WP admin
  // sidebar), not the full viewport, with 10% padding on each side of
  // that content area. `--os-sidebar-w` is published by
  // context-app-shell.js and tracks the live WP menu width (collapsed
  // / expanded / folded); it falls back to 160px during initial paint.
  // The inner palette caps at max-w-4xl on ultrawide monitors so it
  // doesn't stretch into an unreadable line length.
  return h`<div className="fixed inset-0 z-[100000]" onClick=${onClose}>
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
    <div
      className="fixed top-0 right-0 bottom-0 flex items-start justify-center pt-[10vh] pb-8 px-[10%]"
      style=${{ left: 'var(--os-sidebar-w, 160px)' }}
    >
      <div className="relative w-full max-w-4xl bg-card rounded-xl shadow-2xl border border-border overflow-hidden pointer-events-auto" onClick=${(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-muted-foreground text-xs font-mono">${'⌘⇧`'}</span>
        <input
          ref=${inputRef}
          value=${q}
          onChange=${(e) => setQ(e.target.value)}
          onKeyDown=${onKeyDown}
          placeholder="Search content, pages, commands — or type ci:// to browse…"
          className="flex-1 bg-transparent border-0 focus:outline-none text-base"
        />
        ${loading ? h`<${Spinner} />` : null}
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        ${!q.trim() ? h`<div className="p-6 text-center text-sm text-muted-foreground">Search content, jump to a page or destination, create something new${staticPool.some((s) => s.kind === 'wp-command') ? ', run a command' : ''}, or type <code className="font-mono bg-muted px-1 rounded">ci://</code> to browse content by path.</div>` :
          results.length === 0 && !loading ? h`<div className="p-6 text-center text-sm text-muted-foreground">${pathMode ? 'No entries at that path' : 'No matches'}</div>` :
          results.map((r, i) => h`<div
            key=${r.id}
            onClick=${() => openResult(r)}
            onMouseEnter=${() => setActiveIndex(i)}
            className=${`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${i === activeIndex ? 'bg-muted' : 'hover:bg-muted'}`}>
            <span className="text-base shrink-0 w-5 text-center text-muted-foreground">${r.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">${r.title}</div>
              <div className="text-xs text-muted-foreground truncate">${r.subtitle}</div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 shrink-0">${
              r.kind === 'content' ? 'Content' :
              r.kind === 'admin-page' ? 'Page' :
              r.kind === 'admin-setting' ? 'Setting' :
              r.kind === 'nav' ? 'Go' :
              r.kind === 'action' ? 'New' :
              r.kind === 'vfs' ? (r.isDir ? 'Folder' : 'Path') :
              'Command'
            }</span>
            ${i === activeIndex ? h`<span className="text-xs text-muted-foreground">↵</span>` : null}
          </div>`)}
      </div>
      <div className="px-4 py-2 border-t border-border bg-sidebar text-xs text-muted-foreground flex items-center justify-between">
        <span>↑↓ navigate · ↵ open · esc close · ${'⌘⇧`'}, ⌘⇧P, ⌘K to reopen</span>
        <span>${results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

// Card / PadCard / Button / Badge / Spinner now imported from 'os/ui'.

// ---------------------------------------------------------------------------
// Linear-style sidebar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Layout shell — WP admin sidebar is the primary nav. We just own the content.
// ---------------------------------------------------------------------------

function Shell({ children }) {
  // #os-app-root is position:fixed with concrete inset values, so children that
  // want to fill it use `absolute inset-0`. Shell is just a positioned
  // container that establishes the context + paints the page background.
  return h`<div className="absolute inset-0 text-foreground antialiased bg-sidebar overflow-hidden">
    ${children}
    <${ReferencePanel} />
  </div>`;
}

/**
 * Mounted once near root — on first load, navigates to the initial route
 * carried in the bootstrap (set by PHP based on which submenu was clicked).
 * Subsequent in-app navigation (list → editor → back) uses the hash router
 * normally.
 */
function InitialRouteSync() {
  const navigate = useNavigate();
  useEffect(() => {
    const target = BOOT.initial_route || '/';
    if (target && target !== '/' && !window.location.hash) {
      navigate(target, { replace: true });
    }
  }, []);
  return null;
}

// Map an in-app hash route to its wp-admin `?page=` slug so the address bar
// stays coherent (e.g. /activity → page=activity, not the stale
// page=skill you happened to enter from). Slugs are bare — the server
// registers them without the old `context-` prefix and 302s legacy URLs.
function routeToPageSlug(pathname) {
  const seg = String(pathname || '/').replace(/^\//, '').split('/');
  const first = seg[0] || '';
  if ('t' === first && seg[1]) return seg[1];
  const direct = ['settings', 'calendar', 'content-types', 'filesystem', 'quick-start', 'design', 'activity', 'notifications', 'apps', 'graph'];
  if (direct.includes(first)) return first;
  return 'context';
}

// Keep `?page=` in sync with the SPA route via replaceState.
function RouteSync() {
  const loc = useLocation();
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const want = routeToPageSlug(loc.pathname);
      if (url.searchParams.get('page') !== want) {
        url.searchParams.set('page', want);
        window.history.replaceState(null, '', url.toString());
      }
    } catch { /* non-fatal */ }
  }, [loc.pathname]);
  return null;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function CopyButton({ value, label = 'Copy' }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return h`<${Button}
    size="sm"
    variant="ghost"
    className=${`!bg-accent !text-accent-foreground hover:!bg-accent/80 !px-3 ${copied ? 'opacity-70' : ''}`}
    onClick=${async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast?.success?.('Copied to clipboard');
        setTimeout(() => setCopied(false), 1500);
      } catch (e) { toast?.error?.('Copy failed', e.message); }
    }}>
    ${copied ? '✓ Copied' : label}
  </${Button}>`;
}

function CodeBlock({ children, copyValue }) {
  return h`<div className="relative group">
    <pre className="bg-foreground text-background text-[12.5px] leading-relaxed rounded-md p-4 pr-12 overflow-x-auto font-mono whitespace-pre">${children}</pre>
    <div className="absolute top-2 right-2">
      <${CopyButton} value=${copyValue ?? children} />
    </div>
  </div>`;
}

// HomePage — landing page that replaces /wp-admin/index.php for users
// with edit_posts. Renders a personalised greeting, a palette-trigger
// search field, and a tile grid of "Add a <type>" actions sourced from
// BOOT.types so admin-defined custom CPTs (ci_todo, os_journal, etc.)
// surface automatically.
function HomePage() {
  const navigate = useNavigate();
  const palette = usePalette();
  const [designHomeVisible, setDhv] = useState(() => isDesignHomeVisible());
  useEffect(() => {
    const onChange = (e) => setDhv(!!e.detail);
    window.addEventListener('ci:design-home-visible', onChange);
    return () => window.removeEventListener('ci:design-home-visible', onChange);
  }, []);

  const firstName = useMemo(() => {
    const dn = (BOOT.user?.display_name || '').trim();
    return dn ? dn.split(/\s+/)[0] : 'there';
  }, []);
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5)  return 'Up late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Burning the midnight oil';
  }, []);

  // CI-managed types (skills, memory, wiki, customs) → use
  // singular labels because the tile reads "Add a <singular>". Skip
  // the native_replace types (Posts, Pages, etc.) which get their own row.
  const ciTiles = useMemo(() => {
    return Object.entries(BOOT.types || {})
      .filter(([, m]) => m && m.placement !== 'native_replace')
      .map(([key, m]) => ({
        key,
        label: m.singular || m.label,
        action: 'Add a ' + (m.singular || m.label).toLowerCase(),
        to: `/t/${key}`,
        kind: 'ci',
      }));
  }, []);

  // Workspace / system surfaces — the management apps (also in the sidebar).
  const manageTiles = [
    { key: 'activity',      label: 'Activity',      action: 'Open the activity log',  to: '/activity',      kind: 'ci' },
    { key: 'notifications', label: 'Notifications', action: 'View notifications',      to: '/notifications', kind: 'ci' },
    { key: 'apps',          label: 'Apps',          action: 'Manage apps & abilities', to: '/apps',          kind: 'ci' },
    { key: 'calendar',      label: 'Calendar',      action: 'Open the calendar',       to: '/calendar',      kind: 'ci' },
    { key: 'content-types', label: 'Content Types', action: 'Manage content types',    to: '/content-types', kind: 'ci' },
  ];

  const wpTiles = [
    { key: 'post',      label: 'Post',           action: 'Write a post',        href: '/wp-admin/post-new.php',                kind: 'wp' },
    { key: 'page',      label: 'Page',           action: 'Add a page',          href: '/wp-admin/post-new.php?post_type=page', kind: 'wp' },
    { key: 'media',     label: 'Media',          action: 'Upload media',        href: '/wp-admin/media-new.php',               kind: 'wp' },
    { key: 'customize', label: 'Site Editor',    action: 'Customize the site',  href: '/wp-admin/site-editor.php',             kind: 'wp' },
    { key: 'menus',     label: 'Navigation',     action: 'Edit the menus',      href: '/wp-admin/nav-menus.php',               kind: 'wp' },
    { key: 'comments',  label: 'Comments',       action: 'Moderate comments',   href: '/wp-admin/edit-comments.php',           kind: 'wp' },
  ];

  // Rotating heading for each section — picked once per page load so
  // it feels alive without churning between renders. Phrasing stays
  // verb-forward ("doing-with-X") because each section is itself a
  // list of doable actions.
  const rotating = (phrases) => phrases[Math.floor(Math.random() * phrases.length)];
  const wpHeading = useMemo(() => rotating([
    'Building with WordPress',
    'Writing with WordPress',
    'Publishing with WordPress',
    'Crafting with WordPress',
    'Creating with WordPress',
    'Designing with WordPress',
    'Shipping with WordPress',
    'Telling stories with WordPress',
  ]), []);
  const wcHeading = useMemo(() => rotating([
    'Selling with WooCommerce',
    'Running your store',
    'Powering commerce',
    'Operating WooCommerce',
    'Growing the shop',
    'Trading with WooCommerce',
    'Stocking the shelves',
  ]), []);
  const ciHeading = useMemo(() => rotating([
    'Your knowledge base',
    'Capturing context',
    'Curating skills',
    'Building context for AI',
    'Stocking the brain',
    'Memory for your agent',
    'Crafting prompts visually',
    'Authoring the agent',
  ]), []);

  // WooCommerce surfaces. Hardcoded canonical wp-admin paths because
  // WC abilities live in WooCommerce itself; we just link to the right
  // screen. Extension tiles only render when BOOT.woocommerce.extensions
  // says the plugin is installed.
  const wc = BOOT.woocommerce || { active: false, extensions: {} };
  const wcTiles = useMemo(() => {
    if (!wc.active) return [];
    const t = [
      {
        key: 'wc-products', kind: 'wc', category: 'WooCommerce',
        action: 'Manage products', label: 'Products',
        actions: [
          { label: 'Add a product',   href: '/wp-admin/post-new.php?post_type=product' },
          { label: 'All products',    href: '/wp-admin/edit.php?post_type=product' },
          { label: 'Stock & reports', href: '/wp-admin/admin.php?page=wc-reports&tab=stock' },
        ],
      },
      {
        key: 'wc-orders', kind: 'wc', category: 'WooCommerce',
        action: 'Process orders', label: 'Orders',
        actions: [
          { label: 'Open orders', href: '/wp-admin/admin.php?page=wc-orders' },
          { label: 'New order',   href: '/wp-admin/admin.php?page=wc-orders&action=new' },
          { label: 'Customers',   href: '/wp-admin/admin.php?page=wc-admin&path=%2Fcustomers' },
        ],
      },
      {
        key: 'wc-marketing', kind: 'wc', category: 'WooCommerce',
        action: 'Run promotions', label: 'Marketing',
        actions: [
          { label: 'New coupon', href: '/wp-admin/post-new.php?post_type=shop_coupon' },
          { label: 'All coupons', href: '/wp-admin/edit.php?post_type=shop_coupon' },
          { label: 'Marketing hub', href: '/wp-admin/admin.php?page=wc-admin&path=%2Fmarketing' },
        ],
      },
    ];
    if (wc.extensions?.payments) t.push({
      key: 'wc-payments', kind: 'wc', category: 'WooCommerce · Payments',
      action: 'Track payments', label: 'WooPayments',
      actions: [
        { label: 'Transactions', href: '/wp-admin/admin.php?page=wc-admin&path=%2Fpayments%2Ftransactions' },
        { label: 'Deposits',     href: '/wp-admin/admin.php?page=wc-admin&path=%2Fpayments%2Fdeposits' },
        { label: 'Disputes',     href: '/wp-admin/admin.php?page=wc-admin&path=%2Fpayments%2Fdisputes' },
      ],
    });
    if (wc.extensions?.analytics) t.push({
      key: 'wc-analytics', kind: 'wc', category: 'WooCommerce · Analytics',
      action: 'Read the numbers', label: 'Analytics',
      actions: [
        { label: 'Overview', href: '/wp-admin/admin.php?page=wc-admin&path=%2Fanalytics%2Foverview' },
        { label: 'Revenue',  href: '/wp-admin/admin.php?page=wc-admin&path=%2Fanalytics%2Frevenue' },
        { label: 'Products', href: '/wp-admin/admin.php?page=wc-admin&path=%2Fanalytics%2Fproducts' },
      ],
    });
    if (wc.extensions?.mailpoet) t.push({
      key: 'wc-mailpoet', kind: 'wc', category: 'WooCommerce · MailPoet',
      action: 'Send a newsletter', label: 'MailPoet',
      actions: [
        { label: 'Create a newsletter', href: '/wp-admin/admin.php?page=mailpoet-newsletters' },
        { label: 'Subscribers',         href: '/wp-admin/admin.php?page=mailpoet-subscribers' },
        { label: 'Lists',               href: '/wp-admin/admin.php?page=mailpoet-lists' },
      ],
    });
    if (wc.extensions?.subscriptions) t.push({
      key: 'wc-subscriptions', kind: 'wc', category: 'WooCommerce · Subscriptions',
      action: 'Manage recurring revenue', label: 'Subscriptions',
      actions: [
        { label: 'All subscriptions', href: '/wp-admin/edit.php?post_type=shop_subscription' },
        { label: 'Reports',           href: '/wp-admin/admin.php?page=wc-reports&tab=subscriptions' },
      ],
    });
    if (wc.extensions?.bookings) t.push({
      key: 'wc-bookings', kind: 'wc', category: 'WooCommerce · Bookings',
      action: 'Take bookings', label: 'Bookings',
      actions: [
        { label: 'Calendar',            href: '/wp-admin/edit.php?post_type=wc_booking&page=booking_calendar' },
        { label: 'All bookings',        href: '/wp-admin/edit.php?post_type=wc_booking' },
        { label: 'New bookable product', href: '/wp-admin/post-new.php?post_type=product' },
      ],
    });
    if (wc.extensions?.automatewoo) t.push({
      key: 'wc-automatewoo', kind: 'wc', category: 'WooCommerce · AutomateWoo',
      action: 'Automate workflows', label: 'AutomateWoo',
      actions: [
        { label: 'Create a workflow', href: '/wp-admin/admin.php?page=automatewoo-workflows&action=new' },
        { label: 'Workflows',         href: '/wp-admin/admin.php?page=automatewoo-workflows' },
        { label: 'Carts',             href: '/wp-admin/admin.php?page=automatewoo-carts' },
      ],
    });
    return t;
  }, [wc.active, wc.extensions]);

  // Inline-style tokens (Tailwind-free; resolve from os-wpds-theme.css vars).
  const EYEBROW = { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' };
  const SECTION_H = { ...EYEBROW, fontSize: '13px', letterSpacing: '0.04em', margin: 0 };
  const TILE_TITLE = { fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' };
  const SUB = { fontSize: '12px', color: 'var(--muted-foreground)' };

  const Section = ({ heading, sub, right, children }) => h`<section>
    <${WPVStack} spacing=${3}>
      <div style=${{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style=${SECTION_H}>${heading}</h2>
        ${sub ? h`<span style=${SUB}>${sub}</span>` : null}
        ${right || null}
      </div>
      ${children}
    </${WPVStack}>
  </section>`;

  const Tile = ({ tile }) => {
    const onClick = (e) => {
      if (tile.to) { e.preventDefault(); navigate(tile.to); }
    };
    // Multi-action tile: header + inline link list. Used by
    // WooCommerce and extension tiles where one "click the whole tile"
    // doesn't capture the 2-3 real entry points the plugin exposes.
    if (tile.actions && tile.actions.length) {
      return h`<${WPCard} size="small" isRounded=${true} className="os-card-hover" style=${{ height: '100%' }}>
        <${WPCardBody}>
          <${WPVStack} spacing=${2}>
            <span style=${EYEBROW}>${tile.category || 'WordPress'}</span>
            <span style=${TILE_TITLE}>${tile.action}</span>
            <div style=${{ display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: '4px', fontSize: '12px', paddingTop: '2px' }}>
              ${tile.actions.map((a, i) => h`<a key=${i} href=${a.href} className="os-link-muted">→ ${a.label}</a>`)}
            </div>
          </${WPVStack}>
        </${WPCardBody}>
      </${WPCard}>`;
    }
    const category = tile.category || (tile.kind === 'ci' ? 'Context' : 'WordPress');
    return h`<a href=${tile.href || '#'} onClick=${onClick} className="os-tile">
      <${WPCard} size="small" isRounded=${true} className="os-card-hover" style=${{ height: '100%' }}>
        <${WPCardBody}>
          <${WPVStack} spacing=${1}>
            <span style=${EYEBROW}>${category}</span>
            <span style=${TILE_TITLE}>${tile.action}</span>
            <span className="os-tile-arrow" style=${{ fontSize: '12px', fontWeight: 500 }}>→ ${tile.label}</span>
          </${WPVStack}>
        </${WPCardBody}>
      </${WPCard}>
    </a>`;
  };

  return h`<div className="os-home-scroll" style=${{ position: 'absolute', inset: 0, overflowY: 'auto', overscrollBehavior: 'contain', background: 'var(--background)', touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    <div style=${{ padding: '48px 24px', maxWidth: '64rem', margin: '0 auto', width: '100%' }}>
      <${WPVStack} spacing=${10}>
        <header>
          <${WPVStack} spacing=${1}>
            <div style=${{ fontSize: '14px' }}>
              <span style=${{ fontWeight: 600, color: 'var(--foreground)' }}>Context</span>
              <span style=${{ color: 'var(--muted-foreground)' }}> — an operating system for your WordPress</span>
            </div>
            <h1 style=${{ fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.01em', margin: 0, color: 'var(--foreground)' }}>${greeting}, ${firstName}.</h1>
            <p style=${{ color: 'var(--muted-foreground)', fontSize: '1.125rem', margin: 0 }}>What would you like to do today?</p>
          </${WPVStack}>
        </header>

        <button type="button" onClick=${() => palette?.open?.()} className="os-search-trigger">
          <span style=${{ color: 'var(--muted-foreground)' }}><i className="fa fa-search" /></span>
          <span style=${{ flex: 1, fontSize: '14px', color: 'var(--muted-foreground)' }}>Search everything, or jump to a page…</span>
          <span style=${{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--muted-foreground)' }}>${'⌘`'} · ⌘⇧P · /</span>
        </button>

        <${Section} heading=${wpHeading}>
          <div className="os-home-grid">${wpTiles.map((t) => h`<${Tile} key=${t.key} tile=${t} />`)}</div>
        </${Section}>

        ${wcTiles.length ? h`<${Section} heading=${wcHeading} sub=${`WooCommerce ${wc.extensions && Object.values(wc.extensions).some(Boolean) ? '+ detected extensions' : ''}`}>
          <div className="os-home-grid">${wcTiles.map((t) => h`<${Tile} key=${t.key} tile=${t} />`)}</div>
        </${Section}>` : null}

        ${ciTiles.length ? h`<${Section} heading=${ciHeading} sub="private notes, skills, snippets — the context an AI agent reads when it works with you">
          <div className="os-home-grid">${ciTiles.map((t) => h`<${Tile} key=${t.key} tile=${t} />`)}</div>
        </${Section}>` : null}

        <${Section} heading="Workspace" sub="activity, notifications, apps & abilities — the OS surfaces for your Context">
          <div className="os-home-grid">${manageTiles.map((t) => h`<${Tile} key=${t.key} tile=${t} />`)}</div>
        </${Section}>

        <${Section} heading="More">
          <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <${Button} variant="secondary" size="compact" href="#/quick-start">Quick Start (MCP setup)</${Button}>
            <${Button} variant="secondary" size="compact" href="#/settings">Settings</${Button}>
            <${Button} variant="secondary" size="compact" href="#/dev/wizards">Wizards API</${Button}>
            <${Button} variant="secondary" size="compact" href="/wp-admin/index.php?ci_classic=1">Classic WP dashboard</${Button}>
          </div>
        </${Section}>

        ${designHomeVisible ? h`<${Section} heading="Design Setup" right=${h`<${Link} to="/design" className="os-link-muted" style=${{ fontSize: '12px' }}>View all ${DESIGN_STEPS.length} steps →</${Link}>`}>
          <div className="os-home-grid">
            ${HOME_DESIGN_HIGHLIGHTS.map((key) => {
              const s = DESIGN_STEPS.find((x) => x.key === key);
              if (!s) return null;
              return h`<${Link} key=${s.key} to=${`/design/${s.key}`} className="os-tile">
                <${WPCard} size="small" isRounded=${true} className="os-card-hover" style=${{ height: '100%' }}>
                  <${WPCardBody}>
                    <${WPVStack} spacing=${1}>
                      <span style=${EYEBROW}>Design Setup</span>
                      <span style=${TILE_TITLE}>${s.label}</span>
                      <span className="os-tile-arrow" style=${{ fontSize: '12px', fontWeight: 500 }}>→ Set up</span>
                    </${WPVStack}>
                  </${WPCardBody}>
                </${WPCard}>
              </${Link}>`;
            })}
          </div>
        </${Section}>` : null}
      </${WPVStack}>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Quick Start wizard — second use of the context-stack primitives.
// Walks the user from "blank install" to "talking to an AI agent":
//   1. Token       — read token for /v1/skill/<slug>?key=…
//   2. MCP server  — connect any MCP-aware client
//   3. Test        — verify the endpoint responds
//   4. Author      — write your first skill + curl-friendly URLs
// ---------------------------------------------------------------------------

const QUICK_START_STEPS = [
  { key: 'token',  label: 'Token',         description: 'Generate or copy your read token.' },
  { key: 'mcp',    label: 'MCP server',    description: 'Connect any MCP-aware AI client.' },
  { key: 'test',   label: 'Test',          description: 'Verify the endpoint is reachable.' },
  { key: 'author', label: 'First content', description: 'Write your first skill or wiki article.' },
];

// Quick-Start preset for WizardShell. No header actions — the design
// wizard's "Continue in Site Editor" link is design-specific.
function QuickStartShell(props) {
  return h`<${WizardShell}
    ...${props}
    steps=${QUICK_START_STEPS}
    basePath="/quick-start"
    title="Quick Start"
  >${props.children}</${WizardShell}>`;
}

// All the data each step needs. Memoized so the constants don't
// rebuild on every keystroke, and so the MCP tool list (~16 entries)
// is identical across steps.
function useQuickStartContext() {
  return useMemo(() => {
    const host = BOOT.site_url.replace(/\/$/, '');
    const token = BOOT.read_token || '<token-not-set>';
    const mcpUrl = `${host}/wp-json/mcp/mcp-adapter-default-server`;
    return {
      host,
      token,
      mcpUrl,
      skillUrlExample: `${host}/wp-json/activity/v1/skill/private-note?key=${token}`,
      curlExample:     `curl '${host}/wp-json/activity/v1/skill/<slug>?key=${token}'`,
      aliasExample: `# in ~/.zshrc or ~/.bashrc
skill() {
  curl -sS "${host}/wp-json/activity/v1/skill/$1?key=${token}"
}`,
      mcpJsonConfig: JSON.stringify({
        mcpServers: {
          'core-index': {
            url: mcpUrl,
            headers: { Authorization: 'Basic <base64(username:app-password)>' },
          },
        },
      }, null, 2),
      mcpVscodeConfig: JSON.stringify({
        servers: {
          'core-index': {
            type: 'http',
            url: mcpUrl,
            headers: { Authorization: 'Basic <base64(username:app-password)>' },
          },
        },
      }, null, 2),
      mcpLibreChatYaml: `mcpServers:
  core-index:
    type: streamable-http
    url: ${ mcpUrl }
    headers:
      Authorization: "Basic <base64(username:app-password)>"`,
      mcpCurl: `curl -u 'admin:YOUR-APP-PASSWORD' \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \\
  ${mcpUrl}`,
      mcpTools: [
        // Read / search — agent starts with ci/search.
        [ 'os/search',         'read',  '★ START HERE. Search across both skills and the wiki. Returns slugs to feed into ci/read.' ],
        [ 'os/read',           'read',  'Read one post by slug (either type). Use after ci/search has narrowed the target.' ],
        [ 'os/skill-read',     'read',  'Read one skill / memory by slug.' ],
        [ 'os/skill-list',     'read',  'List skills, optionally filtered by folder (os_path) or type.' ],
        [ 'os/skill-search',   'read',  'Keyword search across skills only.' ],
        [ 'os/wiki-read',      'read',  'Read one wiki article by slug.' ],
        [ 'os/wiki-list',      'read',  'List wiki articles (optionally by parent article).' ],
        [ 'os/wiki-search',    'read',  'Keyword search across the wiki only.' ],
        // Write — guarded by draft-by-default + trash-not-force-delete.
        [ 'os/skill-create',   'write', 'Create a os_skill. Defaults to draft — human publishes via wp-admin.' ],
        [ 'os/skill-update',   'write', 'Update an existing os_skill (only passed fields change).' ],
        [ 'os/skill-append',   'write', 'Append a markdown section to an existing skill. Marked with <!-- mcp-append --> for human review.' ],
        [ 'os/skill-delete',   'write', 'Trash a os_skill (recoverable from .trash; never force-deletes).' ],
        [ 'os/wiki-create',    'write', 'Create a os_wiki article. Defaults to draft.' ],
        [ 'os/wiki-update',    'write', 'Update an existing os_wiki article.' ],
        [ 'os/wiki-append',    'write', 'Append a section to an existing wiki article. Marked for human review.' ],
        [ 'os/wiki-delete',    'write', 'Trash a os_wiki article (recoverable from .trash).' ],
      ],
    };
  }, []);
}

// === Step 1 — Token ========================================================
function QuickStartTokenStep() {
  const ctx = useQuickStartContext();
  return h`<${QuickStartShell} stepKey="token">
    <${PadCard} className="space-y-3">
      <p className="text-sm text-foreground">
        The <code className="font-mono bg-muted px-1 rounded">?key=</code> parameter is a read-only access token used by the slim REST endpoints
        (<code className="font-mono bg-muted px-1 rounded">/wp-json/activity/v1/skill/${'<slug>'}</code>).
        Treat it like a password — anyone with the token + URL can read your content.
      </p>
      <div className="flex items-center gap-2 p-2.5 bg-muted rounded-md">
        <code className="flex-1 font-mono text-xs text-foreground break-all">${ctx.token}</code>
        <${CopyButton} value=${ctx.token} />
      </div>
      <p className="text-xs text-muted-foreground">
        Rotate any time via <code className="font-mono bg-muted px-1 rounded">wp option delete core_index_read_token</code> (next request regenerates).
        For MCP clients (next step), authentication is a separate WordPress Application Password — the token here is only for the slim curl-friendly URLs.
      </p>
    </${PadCard}>
  </${QuickStartShell}>`;
}

// === Step 2 — MCP server ===================================================
function QuickStartMcpStep() {
  const ctx = useQuickStartContext();
  return h`<${QuickStartShell} stepKey="mcp">
    <${PadCard} className="space-y-4">
      <p className="text-sm text-foreground">
        The plugin auto-instantiates an MCP server. Point any MCP-aware client at the URL below — Claude Desktop, Claude Code, Cursor, Zed, LibreChat, Continue all use the same shape (HTTP URL + HTTP Basic auth).
      </p>
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1.5">MCP server URL</div>
        <${CodeBlock} copyValue=${ctx.mcpUrl}>${ctx.mcpUrl}</${CodeBlock}>
      </div>
      <div className="text-xs text-muted-foreground">
        Auth: a WordPress <strong className="text-foreground">Application Password</strong> (Users → Profile → Application Passwords) sent as HTTP Basic. Any user with <code className="font-mono bg-muted px-1 rounded">edit_posts</code> can read; abilities enforce capability checks per call.
      </div>
      <${WPTabPanel}
        className="os-mcp-tabs"
        activeClass="is-active"
        tabs=${[
          { name: 'claude',    title: 'Claude Desktop' },
          { name: 'vscode',    title: 'VS Code' },
          { name: 'cursor',    title: 'Cursor / Zed' },
          { name: 'librechat', title: 'LibreChat' },
          { name: 'continue',  title: 'Continue / Cline' },
          { name: 'tools',     title: `Tools (${ ctx.mcpTools.length })` },
        ]}
      >${(tab) => {
        if (tab.name === 'claude') {
          return h`<div className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Add to <code className="font-mono bg-muted px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code> and restart Claude Desktop. The same shape works for Claude Code via <code className="font-mono bg-muted px-1 rounded">claude mcp add</code>.</p>
            <${CodeBlock} copyValue=${ctx.mcpJsonConfig}>${ctx.mcpJsonConfig}</${CodeBlock}>
          </div>`;
        }
        if (tab.name === 'vscode') {
          return h`<div className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Save as <code className="font-mono bg-muted px-1 rounded">.vscode/mcp.json</code> in the project root (or globally via user settings → MCP servers). VS Code's native MCP client picks it up on the next reload.</p>
            <${CodeBlock} copyValue=${ctx.mcpVscodeConfig}>${ctx.mcpVscodeConfig}</${CodeBlock}>
          </div>`;
        }
        if (tab.name === 'cursor') {
          return h`<div className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Same JSON shape as Claude Desktop. Cursor reads <code className="font-mono bg-muted px-1 rounded">.cursor/mcp.json</code> (project) or <code className="font-mono bg-muted px-1 rounded">~/.cursor/mcp.json</code> (user). Zed: <code className="font-mono bg-muted px-1 rounded">Settings → MCP Servers → Add Custom Server</code>.</p>
            <${CodeBlock} copyValue=${ctx.mcpJsonConfig}>${ctx.mcpJsonConfig}</${CodeBlock}>
          </div>`;
        }
        if (tab.name === 'librechat') {
          return h`<div className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Add to <code className="font-mono bg-muted px-1 rounded">librechat.yaml</code> and restart the LibreChat service. The <code className="font-mono bg-muted px-1 rounded">streamable-http</code> transport is what this plugin speaks.</p>
            <${CodeBlock} copyValue=${ctx.mcpLibreChatYaml}>${ctx.mcpLibreChatYaml}</${CodeBlock}>
          </div>`;
        }
        if (tab.name === 'continue') {
          return h`<div className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Continue (VS Code / JetBrains extension) and Cline both read the same JSON. Continue: <code className="font-mono bg-muted px-1 rounded">~/.continue/config.json</code>. Cline: VS Code Settings → Cline → MCP Servers.</p>
            <${CodeBlock} copyValue=${ctx.mcpJsonConfig}>${ctx.mcpJsonConfig}</${CodeBlock}>
          </div>`;
        }
        // tools
        return h`<div className="pt-3 space-y-3">
          <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded p-3 leading-relaxed">
            <strong className="text-foreground">Discovery pattern for crowded MCP setups:</strong>
            if your client has dozens of tools loaded, lead with <code className="font-mono bg-card px-1 rounded">ci/search</code>
            — one call narrows the slug, then <code className="font-mono bg-card px-1 rounded">ci/read</code> fetches it.
            Writes default to <code className="font-mono bg-card px-1 rounded">status=draft</code>; a human still has to publish in the React admin.
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Tool</th>
              <th className="py-2 pr-3 font-medium">Kind</th>
              <th className="py-2 font-medium">What it does</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              ${ctx.mcpTools.map(([id, kind, desc]) => h`<tr key=${id}>
                <td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${id}</code></td>
                <td className="py-2 pr-3 align-top">
                  <span className=${`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wider font-semibold ${kind === 'write' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>${kind}</span>
                </td>
                <td className="py-2 align-top text-foreground">${desc}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>`;
      }}</${WPTabPanel}>
    </${PadCard}>
  </${QuickStartShell}>`;
}

// === Step 3 — Test =========================================================
function QuickStartTestStep() {
  const ctx = useQuickStartContext();
  return h`<${QuickStartShell} stepKey="test">
    <${PadCard} className="space-y-4">
      <p className="text-sm text-foreground">
        Quick sanity check. The curl below pings the MCP endpoint with a <code className="font-mono bg-muted px-1 rounded">tools/list</code> JSON-RPC call. A successful response includes a <code className="font-mono bg-muted px-1 rounded">tools</code> array with ~16 entries (the abilities from the previous step).
      </p>
      <${CodeBlock} copyValue=${ctx.mcpCurl}>${ctx.mcpCurl}</${CodeBlock}>
      <div className="text-xs text-muted-foreground">
        Replace <code className="font-mono bg-muted px-1 rounded">YOUR-APP-PASSWORD</code> with the Application Password from <code className="font-mono bg-muted px-1 rounded">Users → Profile → Application Passwords</code>. If you get a <code className="font-mono bg-muted px-1 rounded">401</code>, check the password; if you get an empty <code className="font-mono bg-muted px-1 rounded">tools</code> array, the plugin isn't loaded.
      </div>
      <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded p-3">
        <strong className="text-foreground">Note:</strong> a real MCP client also runs an <code className="font-mono bg-card px-1 rounded">initialize</code> handshake first — this raw curl skips it and is just a "is the server up?" ping.
      </div>
    </${PadCard}>
  </${QuickStartShell}>`;
}

// === Step 4 — Author content + curl-friendly URLs ==========================
function QuickStartAuthorStep() {
  const ctx = useQuickStartContext();
  return h`<${QuickStartShell} stepKey="author">
    <${Fragment}>
      <${PadCard} className="text-sm text-foreground space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Write your first piece of content</h2>
        <p>Open <strong>Skills</strong>, <strong>Memory</strong>, <strong>Artifacts</strong>, or <strong>Wiki</strong> in the sidebar and click <code className="font-mono bg-muted px-1 rounded">+ File</code>. Pick a language (Markdown by default; Python, CSV, JSON, YAML, etc. for code-flavoured files).</p>
        <ul className="space-y-1 text-muted-foreground list-disc list-inside">
          <li><strong className="text-foreground">Skills</strong> — behavioral instructions an agent loads when triggered</li>
          <li><strong className="text-foreground">Memory</strong> — facts the agent should remember across conversations</li>
          <li><strong className="text-foreground">Artifacts</strong> — reusable assets (configs, prompts, code snippets)</li>
          <li><strong className="text-foreground">Wiki</strong> — long-form articles, journal entries, reference docs</li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">The frontmatter <code className="font-mono bg-muted px-1 rounded">name:</code> field auto-syncs with WordPress's slug on save. Use the palette (<kbd className="font-mono bg-muted px-1.5 py-0.5 rounded">${'⌘⇧`'}</kbd>, <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded">⌘⇧P</kbd>, <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>, or <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded">/</kbd>) to jump to anything.</p>
      </${PadCard}>

      <${PadCard} className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Optional — curl-friendly read URLs</h2>
        <p className="text-sm text-foreground">If you'd rather skip MCP and stuff a single URL into a prompt, every post is reachable at a slim REST route. The agent fetches it as plain markdown and follows it.</p>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Skill URL pattern</div>
          <${CodeBlock} copyValue=${ctx.skillUrlExample}>${ctx.skillUrlExample.replace(/private-note/g, '<slug>')}</${CodeBlock}>
        </div>
        <div className="text-xs text-muted-foreground">
          Replace <code className="font-mono bg-muted px-1.5 py-0.5 rounded">${'<slug>'}</code> with the skill's slug. The same shape works for <code className="font-mono bg-muted px-1.5 py-0.5 rounded">${'/wiki/<slug>'}</code> and <code className="font-mono bg-muted px-1.5 py-0.5 rounded">${'/memory/<slug>'}</code>.
        </div>
      </${PadCard}>

      <${PadCard} className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">How to invoke from a prompt</h2>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-100 text-emerald-700 text-xs font-semibold">A</span>
            <h3 className="font-medium text-foreground">Bash + curl — verbatim, recommended</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Returns the raw SKILL.md straight into Claude's context. Use this when the skill has precise steps or output formats.</p>
          <${CodeBlock} copyValue=${`Run \`${ctx.curlExample}\` and follow those instructions exactly.`}>
${`Run \`${ctx.curlExample}\`
and follow those instructions exactly.`}
          </${CodeBlock}>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-100 text-blue-700 text-xs font-semibold">B</span>
            <h3 className="font-medium text-foreground">WebFetch — summarized, casual</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Claude's built-in WebFetch summarizes the content through a small model. Good for high-level skills, lossy for precise ones.</p>
          <${CodeBlock} copyValue=${`Run ${ctx.host}/wp-json/activity/v1/skill/<slug>?key=${ctx.token} — apply this skill to the current task.`}>
${`Run ${ctx.host}/wp-json/activity/v1/skill/<slug>?key=${ctx.token}
— apply this skill to the current task.`}
          </${CodeBlock}>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-violet-100 text-violet-700 text-xs font-semibold">C</span>
            <h3 className="font-medium text-foreground">Shell alias — fewest keystrokes</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Drop this into your <code className="font-mono bg-muted px-1 rounded">~/.zshrc</code> and you can just write <code className="font-mono bg-muted px-1 rounded">skill private-note</code> anywhere on your machine.</p>
          <${CodeBlock} copyValue=${ctx.aliasExample}>${ctx.aliasExample}</${CodeBlock}>
          <p className="text-xs text-muted-foreground mt-2">Then in any prompt: <code className="font-mono bg-muted px-1 rounded">Run \`skill private-note\` and follow those instructions.</code></p>
        </div>
      </${PadCard}>
    </${Fragment}>
  </${QuickStartShell}>`;
}

// ---------------------------------------------------------------------------
// Design Setup wizard
//
// Multi-step guided onboarding for the site's design: theme, header, footer,
// homepage pattern, colors/fonts. Each step is its own component; the shell
// (`WizardShell`) handles step navigation, progress, and the back/next bar.
// Step 1 (theme) ships fully functional; later steps are stubbed with their
// final routes registered so the URL is the contract from day one.
// ---------------------------------------------------------------------------

const DESIGN_STEPS = [
  { key: 'theme',    label: 'Theme',         description: 'Pick the visual foundation.' },
  { key: 'identity', label: 'Site Identity', description: 'Logo, title, and tagline.' },
  { key: 'header',   label: 'Header',        description: 'Edit your header inline.' },
  { key: 'nav',      label: 'Navigation',    description: 'Build the primary menu.' },
  { key: 'hero',     label: 'Hero',          description: 'A landing banner with a clear CTA.' },
  { key: 'body',     label: 'Body',          description: 'The body of your homepage — what makes you memorable.' },
  { key: 'faq',      label: 'FAQ',           description: 'Common questions, or an alternative trust-building section.' },
  { key: 'cta',      label: 'CTA',           description: 'A focused call-to-action section.' },
  { key: 'footer',   label: 'Footer',        description: 'Edit your footer inline.' },
  { key: 'styles',   label: 'Styles',        description: 'Colors and typography.' },
];

// Curated set of design steps to feature on the Home page. The wizard
// keeps all 10 (foundational + frequent-edit). The Home tiles are a
// shortcut for the moments people return to: pick the theme once,
// then iterate on the parts that change campaign-to-campaign.
const HOME_DESIGN_HIGHLIGHTS = ['theme', 'hero', 'nav', 'cta'];

// Per-browser preference: whether the Home page shows the Design Setup
// strip. Toggleable from Settings. Defaults to visible; an empty
// localStorage value is treated as "yes show it." Stored as 'no' to opt
// out so the default stays robust if the entry is missing.
const DESIGN_HOME_LS_KEY = 'ci_home_design_visible';
function isDesignHomeVisible() {
  try { return localStorage.getItem(DESIGN_HOME_LS_KEY) !== 'no'; } catch { return true; }
}
function setDesignHomeVisible(on) {
  try { localStorage.setItem(DESIGN_HOME_LS_KEY, on ? 'yes' : 'no'); } catch {}
  window.dispatchEvent(new CustomEvent('ci:design-home-visible', { detail: !!on }));
}

// Per-step deep links into wp-admin's Site Editor. The wizard is meant
// to *complement* the Site Editor, not replace it — so every step
// surfaces a "Continue in Site Editor" link that drops the user into
// the corresponding native screen with the right context. Falls back
// to the root Site Editor for steps we can't deep-link precisely yet.
function siteEditorLinkFor(stepKey) {
  const base = '/wp-admin/site-editor.php';
  switch (stepKey) {
    case 'theme':    return '/wp-admin/themes.php';
    case 'identity': return base + '?p=%2Fpages%2Fhome'; // closest first-edit surface; user can pop the site-identity panel
    case 'header':   return base + '?p=%2Fpattern&postType=wp_template_part&categoryType=wp_template_part&categoryId=header';
    case 'nav':      return base + '?p=%2Fnavigation';
    case 'hero':
    case 'body':
    case 'cta':
    case 'faq':      return base + '?p=%2Fpattern';
    case 'footer':   return base + '?p=%2Fpattern&postType=wp_template_part&categoryType=wp_template_part&categoryId=footer';
    case 'styles':   return base + '?p=%2Fstyles';
    default:         return base;
  }
}

// ---------------------------------------------------------------------------
// context-stack — reusable wizard primitives
//
// `WizardShell` + `SectionTipsPanel` are generic over which wizard mounts
// them. Pass `steps` (config array), `basePath` (route prefix), `title`
// (header H1), and optional `headerActions` (extra header buttons —
// e.g., the Design wizard's "Continue in Site Editor" link). Step grid
// width adapts: 5 columns when there are 5+ steps, otherwise matches the
// step count so each pill is full-width.
// ---------------------------------------------------------------------------

// Design-wizard preset for WizardShell. Closes over DESIGN_STEPS +
// the "/design" basePath + the "Continue in Site Editor" header
// action, so the 6 design-step components don't repeat the same
// config arguments.
function DesignWizardShell(props) {
  const seUrl = siteEditorLinkFor(props.stepKey);
  const headerActions = h`<${Button} variant="primary" href=${seUrl}>Continue in Site Editor</${Button}>`;
  return h`<${WizardShell}
    ...${props}
    steps=${DESIGN_STEPS}
    basePath="/design"
    title="Design Setup"
    headerActions=${headerActions}
  >${props.children}</${WizardShell}>`;
}

function WizardShell({
  stepKey, steps, basePath, title, headerActions,
  children, aside, onPrev, onNext, nextLabel = 'Next', wide = false,
}) {
  const navigate = useNavigate();
  const stepIdx = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const step = steps[stepIdx] || steps[0];
  const isFirst = stepIdx === 0;
  const isLast  = stepIdx === steps.length - 1;
  const gotoStep = (idx) => {
    const next = steps[idx];
    if (next) navigate(`${basePath}/${next.key}`);
  };
  const AppHeader = CIRegistry.AppHeader;
  return h`<div className="absolute inset-0 flex flex-col pt-14 bg-background">
    <${AppHeader} onBack=${() => navigate('/home')} backLabel="Back to Home" actions=${headerActions || null} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    <div
      className=${`p-6 md:p-10 mx-auto w-full pb-32 mb-24 ${wide ? 'max-w-none' : 'max-w-6xl'}`}
    >
      <header className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">${title}</h1>
        <p className="text-muted-foreground">${step?.description || ''}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">
        <main className="min-w-0 space-y-6">${children}</main>
        <aside className="space-y-4 order-first lg:order-none lg:sticky lg:top-6">
          <${WPCard} isRounded=${true}>
            <${WPCardBody}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">Steps</div>
              <ol className="space-y-0.5 list-none m-0 p-0" aria-label="Wizard steps">
                ${steps.map((s, i) => {
                  const state = i < stepIdx ? 'done' : (i === stepIdx ? 'current' : 'todo');
                  return h`<li key=${s.key}>
                    <button
                      type="button"
                      onClick=${() => gotoStep(i)}
                      aria-current=${state === 'current' ? 'step' : undefined}
                      className=${`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[2px] text-left text-sm transition-colors ${
                        state === 'current' ? 'bg-accent text-foreground font-medium' : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span className=${`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${
                        state === 'done' ? 'bg-primary text-white' :
                        state === 'current' ? 'border-2 border-primary text-primary' :
                        'border border-border text-muted-foreground'
                      }`}>
                        ${state === 'done' ? h`<${WPGlyph} icon=${iconCheck} size=${14} />` : (i + 1)}
                      </span>
                      <span className="truncate">${s.label}</span>
                    </button>
                  </li>`;
                })}
              </ol>
            </${WPCardBody}>
          </${WPCard}>
          ${aside || null}
        </aside>
      </div>
    </div>
    </div>
    <footer
      className="fixed bottom-0 right-0 z-20 bg-card border-t border-border py-3 flex items-center justify-between gap-3"
      style=${{ left: 'var(--os-sidebar-w, 0px)', paddingLeft: 'max(env(safe-area-inset-left), 2rem)', paddingRight: 'max(env(safe-area-inset-right), 2rem)' }}
    >
      <${WPButton}
        variant="secondary"
        onClick=${() => (onPrev ? onPrev() : (isFirst ? null : gotoStep(stepIdx - 1)))}
        disabled=${isFirst}
      >← Back</${WPButton}>
      <div className="text-xs text-muted-foreground">Step ${stepIdx + 1} of ${steps.length}</div>
      <${WPButton}
        variant="primary"
        onClick=${() => (onNext ? onNext() : (isLast ? navigate('/home') : gotoStep(stepIdx + 1)))}
      >${isLast ? 'Finish' : (nextLabel + ' →')}</${WPButton}>
    </footer>
  </div>`;
}

// Step 1 — Theme picker. Lists installed themes via /wp/v2/themes,
// shows the active one, and exposes an "Activate" affordance per
// inactive theme. Core REST is read-only on themes; we open
// wp-admin/themes.php for the activation step (one click, returns
// the user to the wizard). Future: add a custom POST endpoint here
// to flip themes without leaving the wizard.
// Themes recommended by the wizard when not already installed. Assembler is a
// block theme designed by Automattic, WordPress.com-only, so the action goes to
// the WordPress.com theme page where the user can preview / activate (or grab
// the source from GitHub to side-load it). Only shown when WooCommerce is NOT
// active: an active store is a different build, so we don't push a general
// theme over it.
const RECOMMENDED_THEMES = [
  {
    slug:        'assembler',
    name:        'Assembler',
    blurb:       'Modular sections, AI-friendly defaults, and built for first-time site builders.',
    source:      'WordPress.com',
    actionLabel: 'Preview Assembler',
    actionUrl:   'https://wordpress.com/theme/assembler',
    external:    true,
    extraLinks:  [
      { label: 'View theme source on GitHub', url: 'https://github.com/Automattic/themes/tree/trunk/assembler' },
    ],
  },
];

// WooCommerce teaser blurbs. Rotated once per page load (like the homepage
// headings) so the store nudge feels alive rather than a fixed advert. Shown
// only when WooCommerce is not active. Framed as a "did you know" / "building a
// store?" prompt rather than a hard sell.
const WOO_BOOSTERS = [
  { eyebrow: 'Did you know', blurb: 'WooCommerce turns this site into a full store, products, cart, checkout, and payments, right inside the block editor.' },
  { eyebrow: 'Building a store?', blurb: 'Selling something? WooCommerce adds products, orders, and payments to WordPress, and it is free to start.' },
  { eyebrow: 'Did you know', blurb: 'From a single product to a full catalogue, WooCommerce scales with you, with no rebuild required.' },
  { eyebrow: 'Building a store?', blurb: 'WooCommerce powers a large share of online shops. Add it whenever you are ready to sell.' },
];

function WizardThemeStep() {
  const [themes, setThemes] = useState(null);
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const list = await rest('/wp/v2/themes?status=active,inactive');
        setThemes(Array.isArray(list) ? list : []);
      } catch (e) {
        setErr(e.message || 'Failed to load themes');
      }
    })();
  }, []);

  // Block themes only — classic themes don't work with the rest of the
  // wizard (Site Editor pages 404 for them), so showing them here only
  // sets the user up for a disappointing experience two steps later.
  // `is_block_theme` is a WP 6.6+ field; fall back to checking
  // `theme_supports['block-templates']` for older sites.
  const blockThemes = (themes || []).filter((t) =>
    t.is_block_theme === true || t.theme_supports?.['block-templates'] === true
  );
  // Sort: active first, then version descending. The active theme is
  // the most important card to show; the rest are alternates the user
  // may want to switch to.
  const sorted = blockThemes.slice().sort((a, b) => {
    const aActive = a.status === 'active';
    const bActive = b.status === 'active';
    if (aActive !== bActive) return aActive ? -1 : 1;
    const av = (a.version || '').toString();
    const bv = (b.version || '').toString();
    return bv.localeCompare(av, undefined, { numeric: true });
  });
  // Filter the recommendations against what's already installed (by
  // stylesheet slug) — if Assembler is present it's already in `sorted`,
  // so we don't need a separate install card.
  const installedSlugs = new Set(blockThemes.map((t) => (t.stylesheet || '').toLowerCase()));
  const wooActive = !!BOOT.woocommerce?.active;
  const assemblerActive = (themes || []).some((t) => t.status === 'active' && (t.stylesheet || '').toLowerCase() === 'assembler');
  // Recommendations are mutually directional: if the site already runs
  // WooCommerce it's a store build, so we don't push the general-purpose
  // Assembler theme. Assembler also drops out once it's installed (it's then
  // already in the installed grid above; if it's the ACTIVE theme we show a
  // short "you're set" note instead).
  const recsToShow = RECOMMENDED_THEMES.filter((r) => !installedSlugs.has(r.slug) && !(r.slug === 'assembler' && wooActive));
  // WooCommerce teaser: rotate one blurb per mount, shown only when WC is off.
  const wooBooster = useMemo(() => (wooActive ? null : WOO_BOOSTERS[Math.floor(Math.random() * WOO_BOOSTERS.length)]), [wooActive]);
  const hasBoosters = recsToShow.length > 0 || !!wooBooster || assemblerActive;

  const PREVIEW_COUNT = 6;
  const visible = showAll ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hiddenCount = Math.max(0, sorted.length - PREVIEW_COUNT);

  return h`<${DesignWizardShell} stepKey="theme" wide=${true}>
    ${err ? h`<${WPNotice} status="error" isDismissible=${false}>${err}</${WPNotice}>` : null}
    ${themes === null
      ? h`<div className="p-10 flex items-center justify-center"><${Spinner} /></div>`
      : sorted.length === 0 && !hasBoosters
        ? h`<${Card} className="p-5 text-sm text-muted-foreground">No block themes detected.</${Card}>`
        : h`<${Fragment}>
        ${sorted.length > 0 ? h`<div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Block themes installed on this site</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            ${visible.map((t) => {
              const active = t.status === 'active';
              const screenshot = t.screenshot || '';
              const stylesheet = t.stylesheet || t.template || '';
              const activateUrl = wpAdminUrl(`themes.php?action=activate&stylesheet=${encodeURIComponent(stylesheet)}&_wpnonce_redirect=context-design`);
              const themeName = stripHtml(t.name?.rendered || t.name || stylesheet);
              const authorName = stripHtml(t.author?.rendered || t.author || 'Unknown author');
              return h`<${Card} key=${stylesheet} className=${`p-0 overflow-hidden ${active ? 'border-primary' : ''}`}>
                <div className="aspect-[16/10] bg-muted overflow-hidden">
                  ${screenshot
                    ? h`<img src=${screenshot} alt="" className="w-full h-full object-cover" loading="lazy" />`
                    : h`<div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No screenshot</div>`}
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">${themeName}</div>
                      <div className="text-xs text-muted-foreground truncate">v${t.version || '?'} · ${authorName}</div>
                    </div>
                    ${active ? h`<span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wider">Active</span>` : null}
                  </div>
                  ${t.description?.rendered
                    ? h`<div className="text-xs text-muted-foreground line-clamp-3" dangerouslySetInnerHTML=${{ __html: t.description.rendered }} />`
                    : null}
                  <div className="pt-1">
                    ${active
                      ? h`<${WPButton} variant="secondary" size="small" disabled=${true}>Active</${WPButton}>`
                      : h`<${WPButton} variant="primary" size="small" href=${activateUrl}>Activate</${WPButton}>`}
                  </div>
                </div>
              </${Card}>`;
            })}
          </div>
          ${hiddenCount > 0
            ? h`<div className="pt-3">
                <${WPButton} variant="link" onClick=${() => setShowAll((v) => !v)}>${showAll ? 'Show fewer' : `Show all themes (+${hiddenCount} more)`}</${WPButton}>
              </div>`
            : null}
        </div>` : null}

        ${hasBoosters ? h`<div className="pt-8 pb-12 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommendations</div>

          ${assemblerActive ? h`<${Card} className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <${Icon} name="check" className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-base text-foreground">You're on Assembler. You've got this.</div>
                <p className="text-sm text-muted-foreground mt-1">Assembler is the recommended starting theme for this wizard: modular sections, AI-friendly defaults. You're all set.</p>
              </div>
            </div>
          </${Card}>` : null}

          ${(wooBooster || recsToShow.length) ? h`<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${wooBooster ? h`<${Card} className="p-5 space-y-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">${wooBooster.eyebrow}</div>
                <div className="font-semibold text-base text-foreground mt-0.5">WooCommerce</div>
              </div>
              <p className="text-sm text-muted-foreground">${wooBooster.blurb}</p>
              <div className="pt-1">
                <${WPButton} variant="primary" size="small"
                  href=${wpAdminUrl('plugin-install.php?s=WooCommerce&tab=search&type=term')}
                  style=${{ background: '#720EEC', borderColor: '#720EEC', color: '#fff' }}
                >Explore WooCommerce →</${WPButton}>
              </div>
              <ul className="space-y-1 border-t border-border pt-3 list-none m-0">
                <li><${WPButton} variant="link" href="https://woocommerce.com/" target="_blank" rel="noopener">Learn more at WooCommerce.com ↗</${WPButton}></li>
              </ul>
            </${Card}>` : null}

            ${recsToShow.map((r) => {
              const isAdminLink = !r.external;
              const actionHref = isAdminLink ? wpAdminUrl(r.actionUrl) : r.actionUrl;
              return h`<${Card} key=${r.slug} className="p-5 space-y-3">
                <div className="min-w-0">
                  <div className="font-semibold text-base text-foreground">${r.name}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">Block theme · ${r.source}</div>
                </div>
                <p className="text-sm text-muted-foreground">${r.blurb}</p>
                <div className="pt-1">
                  <${WPButton} variant="primary" size="small" href=${actionHref}
                    target=${isAdminLink ? undefined : '_blank'} rel=${isAdminLink ? undefined : 'noopener'}
                  >${r.actionLabel} →</${WPButton}>
                </div>
                ${Array.isArray(r.extraLinks) && r.extraLinks.length ? h`<ul className="space-y-1 border-t border-border pt-3 list-none m-0">
                  ${r.extraLinks.map((l) => h`<li key=${l.url}>
                    <${WPButton} variant="link" href=${l.url} target="_blank" rel="noopener">${l.label} ↗</${WPButton}>
                  </li>`)}
                </ul>` : null}
              </${Card}>`;
            })}
          </div>` : null}
        </div>` : null}
      </${Fragment}>`}
  </${DesignWizardShell}>`;
}

// Strip HTML tags from a string. Used for theme name/author fields
// that come back from WP's REST as HTML (e.g. author wrapped in an
// anchor) — we want plain text to display in a small label slot.
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

function wpAdminUrl(rel) {
  // BOOT.site_url has no trailing slash already; admin lives at /wp-admin/.
  return (BOOT.site_url || '').replace(/\/$/, '') + '/wp-admin/' + rel.replace(/^\//, '');
}

// Stub steps — final route shape locked in (Tier 1). Each renders inside
// the same WizardShell so the chrome (progress bar, prev/next) stays
// consistent while the bodies are built out in following tiers.
function WizardIdentityStep() { return h`<${SiteIdentityStep} />`; }
function WizardHeaderStep()   { return h`<${TemplateEditFullWidth} stepKey="header" />`; }
function WizardNavStep()      { return h`<${TemplateEditFullWidth} stepKey="nav" />`; }
function WizardHeroStep()     { return h`<${TemplateEditFullWidth} stepKey="hero" />`; }
function WizardBodyStep()     { return h`<${TemplateEditFullWidth} stepKey="body" />`; }
function WizardFaqStep()      { return h`<${TemplateEditFullWidth} stepKey="faq" />`; }
function WizardCtaStep()      { return h`<${TemplateEditFullWidth} stepKey="cta" />`; }
function WizardFooterStep()   { return h`<${TemplateEditFullWidth} stepKey="footer" />`; }
function WizardStylesStep()   { return h`<${TemplateEditFullWidth} stepKey="styles" />`; }

// Per-step deep-link into the Site Editor. Header/Footer go to the
// template-part editor in focus mode. Hero/Body/FAQ/CTA all go to
// the same homepage template — they're sections inside it. Navigation
// and Styles have their own first-class panels in wp-admin.
function siteEditorDeepLink(stepKey, theme) {
  const ss = theme?.stylesheet ? encodeURIComponent(theme.stylesheet) : '';
  const partUrl = (slug) => `site-editor.php?p=${encodeURIComponent('/wp_template_part/' + theme.stylesheet + '//' + slug)}&canvas=edit&focusMode=true`;
  switch (stepKey) {
    case 'header':   return partUrl('header');
    case 'footer':   return partUrl('footer');
    case 'nav':      return 'site-editor.php?p=%2Fnavigation';
    case 'styles':   return 'site-editor.php?p=%2Fstyles';
    case 'hero':
    case 'body':
    case 'faq':
    case 'cta':      return `site-editor.php?p=${encodeURIComponent('/wp_template/' + theme.stylesheet + '//home')}&canvas=edit`;
    default:         return 'site-editor.php';
  }
}

// Per-step guidance shown alongside the editor iframe. Tells the user
// what the step is for, where to find the section inside the Site
// Editor (since hero/body/faq/cta all share the homepage template,
// this is the critical bit), and what pattern names usually fit.
// Bracket tokens like [list-view] [plus] [panel] [design] [save]
// [block] are replaced with inline SVGs by renderWithIcons() so users
// can pattern-match the icon in the editor against the word in the tip.
// `docUrl` deep-links to the WordPress.com support article that best
// matches the step.
const STEP_TIPS = {
  header: {
    summary: 'You\'re editing the site-wide header in focus mode — just this template part, no surrounding chrome.',
    findIt: 'The header is the entire canvas — site title, navigation, optional search/cart on the right.',
    addPattern: 'Open the [panel] right panel → **Design** tab to swap pattern variations without leaving this view.',
    saveBehaviour: 'Click **Save** to apply site-wide. Every page that includes the header picks up your change.',
    docs: [
      { label: 'Learn more about Template Parts',         url: 'https://wordpress.com/support/site-editor/template-parts/' },
      { label: 'Learn more about the Site Editor',        url: 'https://wordpress.com/support/site-editor/' },
      { label: 'Learn more about using the Site Title block', url: 'https://wordpress.com/support/wordpress-editor/blocks/site-title-block/' },
    ],
  },
  footer: {
    summary: 'You\'re editing the site-wide footer in focus mode.',
    findIt: 'The footer is the entire canvas — site name, social icons, secondary nav, copyright.',
    addPattern: 'Open the [panel] right panel → **Design** tab to swap pattern variations.',
    saveBehaviour: 'Click **Save** to apply site-wide.',
    docs: [
      { label: 'Learn more about Template Parts',     url: 'https://wordpress.com/support/site-editor/template-parts/' },
      { label: 'Learn more about using the Social Icons block', url: 'https://wordpress.com/support/wordpress-editor/blocks/social-icons-block/' },
    ],
  },
  nav: {
    summary: 'Pick a navigation menu, then add / reorder / rename items in the Site Editor\'s native navigation panel.',
    findIt: 'Click any navigation on the left. The right panel shows menu items — click to edit, drag to reorder, [plus] **Add** to insert a link, page, post, or submenu.',
    addPattern: 'Each block theme has its own primary navigation. Pick the one your header references (usually the only one).',
    saveBehaviour: 'Click **Save** inside the panel; the navigation block on every template picks up the change.',
    docs: [
      { label: 'Learn more about using the Navigation block', url: 'https://wordpress.com/support/wordpress-editor/blocks/navigation-block/' },
      { label: 'Learn more about Site Editor Navigation',     url: 'https://wordpress.com/support/site-editor/navigation/' },
    ],
  },
  hero: {
    summary: 'The hero is the first section visitors see on your homepage — usually a **Cover** block with a heading and a button.',
    findIt: [
      'Open [list-view] **List View** — icon at top-left of the editor toolbar.',
      'The hero is almost always the first or second top-level block in the list.',
      'Look for: **Cover**, **Image**, or a **Group** with a large Heading + Button inside.',
    ],
    addPattern: 'No hero yet? Use [plus] the inserter at the top of the template and search "hero" or "banner" — Twenty Twenty-Five ships a few.',
    saveBehaviour: 'Click **Save** to apply the homepage change site-wide; the editor stays open for further tweaks.',
    docs: [
      { label: 'Learn more about using the Cover block',   url: 'https://wordpress.com/support/wordpress-editor/blocks/cover-block/' },
      { label: 'Learn more about using the Image block',   url: 'https://wordpress.com/support/wordpress-editor/blocks/image-block/' },
      { label: 'Learn more about using the Heading block', url: 'https://wordpress.com/support/wordpress-editor/blocks/heading-block/' },
      { label: 'Learn more about Patterns',                url: 'https://wordpress.com/support/wordpress-editor/blocks/block-patterns/' },
    ],
  },
  body: {
    summary: 'The body of your homepage — between the hero and the CTA. What visitors should remember about you: what you offer, who you are, what others say.',
    findIt: [
      'Open [list-view] **List View**. The body sections are typically the 2nd through 2nd-to-last top-level blocks on the homepage.',
      'Look for a **Columns** block, **Query Loop**, **Gallery**, or a **Group** containing cards / images / quotes.',
    ],
    addPattern: 'Open [plus] the inserter, switch to the **Patterns** tab, then pick a category from the sidebar (see suggestions below). Click a pattern to drop it in.',
    saveBehaviour: 'Same homepage template — clicking **Save** here also saves any hero / CTA edits.',
    // Suggested pattern categories — these are the WP-standard category
    // slugs you'll see in the Site Editor's pattern inserter sidebar.
    // Each entry tells the user when to reach for that category.
    suggestedPatterns: [
      { category: 'Services',     when: 'You sell something. List what you offer.' },
      { category: 'Testimonials', when: 'You want trust fast. Social proof in quotes.' },
      { category: 'Gallery',      when: 'You have visuals. Portfolio, products, work.' },
      { category: 'About',        when: 'You\'re a person or small team. Tell visitors who.' },
      { category: 'Posts',        when: 'You blog. Surface latest posts via Query Loop.' },
      { category: 'Featured',     when: 'You want a curated mix — anchor + supporting blocks.' },
    ],
    docs: [
      { label: 'Learn more about Patterns',                   url: 'https://wordpress.com/support/wordpress-editor/blocks/block-patterns/' },
      { label: 'Learn more about using the Columns block',    url: 'https://wordpress.com/support/wordpress-editor/blocks/columns-block/' },
      { label: 'Learn more about using the Query Loop block', url: 'https://wordpress.com/support/wordpress-editor/blocks/query-loop-block/' },
      { label: 'Learn more about using the Group block',      url: 'https://wordpress.com/support/wordpress-editor/blocks/group-block/' },
    ],
  },
  faq: {
    summary: 'FAQ blocks build trust by answering objections before visitors ask. Use them when your offer has friction (price, complexity, novelty).',
    findIt: [
      'Open [list-view] **List View**. FAQs are usually near the bottom of the homepage — look for a **Group** containing multiple Heading + Paragraph pairs, or a **Details** block.',
      'Some themes ship an "FAQ" pattern; others use plain **Details** blocks.',
    ],
    addPattern: 'Insert "faq" or "questions" via [plus] the inserter. If nothing matches, drop a **Details** block and duplicate it per question.',
    saveBehaviour: 'Click **Save** to apply homepage-wide.',
    docs: [
      { label: 'Learn more about using the Details block', url: 'https://wordpress.com/support/wordpress-editor/blocks/details-block/' },
      { label: 'Learn more about using the Heading block', url: 'https://wordpress.com/support/wordpress-editor/blocks/heading-block/' },
    ],
  },
  cta: {
    summary: 'A focused call-to-action section — usually a final push near the bottom of the homepage. One headline, one button, one outcome.',
    findIt: [
      'Open [list-view] **List View**. The CTA is almost always the LAST top-level block before the footer.',
      'Look for a **Cover** or **Group** with a Heading + single **Button**.',
    ],
    addPattern: 'Insert "call to action" or "cta" via [plus] the inserter. Resist multiple CTAs — one focused ask converts better.',
    saveBehaviour: 'Click **Save** to apply homepage-wide.',
    docs: [
      { label: 'Learn more about using the Buttons block', url: 'https://wordpress.com/support/wordpress-editor/blocks/buttons-block/' },
      { label: 'Learn more about using the Cover block',   url: 'https://wordpress.com/support/wordpress-editor/blocks/cover-block/' },
    ],
  },
  styles: {
    summary: 'Site-wide colors, typography, and spacing. Stored in a user override of **theme.json**; the theme\'s defaults stay untouched.',
    findIt: [
      'Left panel groups the controls by surface: **Colors**, **Typography**, **Layout**, **Blocks**.',
      'Pick a top-level area to start; the [panel] right panel shows the controls.',
    ],
    addPattern: 'Try a style variation from the carousel at the top — many block themes ship 3–6 preset moods (light, dark, warm, etc.).',
    saveBehaviour: 'Click **Save** to apply site-wide. Affects every block that hasn\'t had its style explicitly overridden.',
    docs: [
      { label: 'Learn more about Global Styles',            url: 'https://wordpress.com/support/site-editor/styles/' },
      { label: 'Learn more about Style Variations',         url: 'https://wordpress.com/support/themes/style-variations/' },
    ],
  },
};

// Inline SVGs that mirror the Site Editor's actual toolbar icons.
// Only kept for elements the user identifies by SHAPE, not by label —
// the list-view hamburger, the inserter +, and the right-panel toggle.
// Text-labelled UI ("Design" tab, "Save" button, block names like
// "Group") are rendered as **bold** instead of icons.
const UI_ICONS = {
  'list-view': h`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`,
  'plus':       h`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  'panel':      h`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`,
};

// Render tip text with inline icons + bold spans. Tokens:
//   [name]   → inline SVG from UI_ICONS (used for shape-only UI like
//              the list-view hamburger, inserter, right-panel toggle)
//   **text** → bold span (used for text-labelled UI: button names,
//              tab names, block names, paths)
// Non-string input is returned as-is (defensive).
function renderWithIcons(text) {
  if (typeof text !== 'string') return text;
  // First-pass: split out icon tokens and bold runs. We do this with a
  // single regex that captures both forms so the surrounding plain
  // text is preserved in order.
  const parts = text.split(/(\[[a-z\-]+\]|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const icon = part.match(/^\[([a-z\-]+)\]$/);
    if (icon && UI_ICONS[icon[1]]) {
      return h`<span key=${i} className="inline-flex items-center justify-center mx-0.5 text-foreground" style=${{ verticalAlign: '-3px' }}>${UI_ICONS[icon[1]]}</span>`;
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return h`<strong key=${i} className="font-semibold text-foreground">${bold[1]}</strong>`;
    }
    return part;
  });
}

// Unified full-width editor step. Renders the WizardShell in wide mode
// with a Site Editor iframe on the left (taking full content width)
// and a sticky tips panel on the right. Loads the active theme once
// to build the deep-link URL and to detect block-theme support.
function TemplateEditFullWidth({ stepKey }) {
  const [theme, setTheme] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const list = await rest('/wp/v2/themes?status=active');
        setTheme((Array.isArray(list) ? list : [])[0] || null);
      } catch (e) { setErr(e.message || 'Failed to load active theme'); }
    })();
  }, []);

  if (err) {
    return h`<${DesignWizardShell} stepKey=${stepKey}>
      <${Card} className="p-5 border-destructive/40 bg-destructive/5 text-sm text-foreground">${err}</${Card}>
    </${DesignWizardShell}>`;
  }
  if (!theme) {
    return h`<${DesignWizardShell} stepKey=${stepKey}>
      <div className="p-10 flex items-center justify-center"><${Spinner} /></div>
    </${DesignWizardShell}>`;
  }
  const isBlockTheme = !!(theme.is_block_theme === true || theme.theme_supports?.['block-templates'] === true);
  // Navigation has its own surface in wp-admin even for classic themes
  // (sort of) — but realistically, block themes are the only ones with
  // the Site Editor + Navigation post-type UI. Same gate for all
  // Site-Editor-backed steps.
  if (!isBlockTheme) {
    return h`<${DesignWizardShell} stepKey=${stepKey}>
      <${Card} className="p-6 text-sm text-foreground space-y-2">
        <div className="text-base font-semibold">This step needs a block theme</div>
        <p className="text-muted-foreground">Your active theme is a classic theme, so the Site Editor isn't available. <${Link} to="/design/theme" className="text-primary hover:underline">Switch to a block theme on the Theme step →</${Link}></p>
      </${Card}>
    </${DesignWizardShell}>`;
  }

  const url = wpAdminUrl(siteEditorDeepLink(stepKey, theme));
  const tips = STEP_TIPS[stepKey] || null;
  // The "About this step" rail rides in the shell's right column (`aside`),
  // below the Steps checklist — so the page stays two panels: editor on the
  // left, Steps + guidance stacked on the right.
  return h`<${DesignWizardShell}
    stepKey=${stepKey}
    wide=${true}
    aside=${tips ? h`<${SectionTipsPanel} stepKey=${stepKey} tips=${tips} url=${url} />` : null}
  >
    <${Card} className="p-0 overflow-hidden">
      <iframe
        src=${url}
        title=${`Site Editor — ${stepKey}`}
        className="w-full block"
        style=${{ height: 'calc(100vh - 360px)', minHeight: 540, border: 0 }}
      />
    </${Card}>
  </${DesignWizardShell}>`;
}

// Render the `findIt` field as either a single paragraph (when it's a
// string or a 1-item array) or a bulleted list (multi-item). Bullets
// for one item look odd and waste vertical space. List uses
// `list-outside` + `pl-5` so wrapped lines align cleanly under the
// first line of text instead of hugging the marker.
function renderFindIt(findIt) {
  if (!findIt) return null;
  const items = Array.isArray(findIt) ? findIt : [findIt];
  if (items.length === 1) {
    return h`<p className="text-sm text-foreground">${renderWithIcons(items[0])}</p>`;
  }
  return h`<ul className="text-sm text-foreground space-y-2 list-disc list-outside pl-5 marker:text-muted-foreground">
    ${items.map((t, i) => h`<li key=${i} className="pl-1">${renderWithIcons(t)}</li>`)}
  </ul>`;
}

function SectionTipsPanel({ stepKey, tips, url }) {
  return h`<${Card} className="p-5 space-y-3">
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">About this step</div>
      <p className="text-sm text-foreground">${renderWithIcons(tips.summary)}</p>
    </div>
    ${tips.findIt ? h`<div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Find it in the editor</div>
      ${renderFindIt(tips.findIt)}
    </div>` : null}
    ${tips.addPattern ? h`<div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Add or swap a pattern</div>
      <p className="text-sm text-foreground">${renderWithIcons(tips.addPattern)}</p>
    </div>` : null}
    ${Array.isArray(tips.suggestedPatterns) && tips.suggestedPatterns.length ? h`<div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Pattern categories to browse</div>
      <ul className="text-sm space-y-1">
        ${tips.suggestedPatterns.map((p, i) => h`<li key=${i} className="flex gap-2 leading-snug">
          <span className="font-semibold text-foreground shrink-0 w-24">${p.category}</span>
          <span className="text-muted-foreground">${p.when}</span>
        </li>`)}
      </ul>
    </div>` : null}
    ${tips.saveBehaviour ? h`<div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">When you save</div>
      <p className="text-sm text-foreground">${renderWithIcons(tips.saveBehaviour)}</p>
    </div>` : null}
    ${Array.isArray(tips.docs) && tips.docs.length ? h`<div className="pt-3 border-t border-border space-y-1.5">
      ${tips.docs.map((d) => h`<a
        key=${d.url}
        href=${d.url}
        target="_blank"
        rel="noopener"
        className="block text-xs text-primary hover:underline no-underline"
      >${d.label} ↗</a>`)}
    </div>` : null}
    <div className="pt-2 border-t border-border">
      <a
        href=${url}
        target="_blank"
        rel="noopener"
        className="block text-xs text-muted-foreground hover:text-foreground hover:underline no-underline"
      >Open in a new tab for full screen ↗</a>
    </div>
  </${Card}>`;
}

function SiteIdentityStep() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [iconPreview, setIconPreview] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await rest('/wp/v2/settings');
        setSettings(s);
        setTitle(s.title || '');
        setTagline(s.description || '');
        if (s.site_icon) {
          const m = await rest(`/wp/v2/media/${s.site_icon}`).catch(() => null);
          setIconPreview(m?.source_url || '');
        }
      } catch (e) {
        toast.error('Load failed', e.message);
      }
    })();
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await rest('/wp/v2/settings', {
        method: 'POST',
        body: JSON.stringify({ title, description: tagline }),
      });
      toast.success('Saved');
      setDirty(false);
    } catch (e) {
      toast.error('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }, [title, tagline, toast]);

  return h`<${DesignWizardShell} stepKey="identity" wide=${true}>
    ${settings === null
      ? h`<div className="p-10 flex items-center justify-center"><${Spinner} /></div>`
      : h`<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <${Card} className="space-y-4 os-wpds-fields">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Site title"
            value=${title}
            onChange=${(v) => { setTitle(v); setDirty(true); }}
          />
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Tagline"
            value=${tagline}
            onChange=${(v) => { setTagline(v); setDirty(true); }}
            placeholder="A short description of your site."
          />
          <div className="pt-1">
            <${Button}
              variant="primary"
              onClick=${save}
              isBusy=${saving}
              disabled=${!dirty || saving}
            >${saving ? 'Saving…' : 'Save'}</${Button}>
          </div>
        </${Card}>
        <${Card} className="p-5 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Site icon</div>
            <div className="flex items-center gap-3">
              ${iconPreview
                ? h`<img src=${iconPreview} alt="" className="w-16 h-16 rounded-md border border-border object-cover" />`
                : h`<div className="w-16 h-16 rounded-md border border-dashed border-border bg-muted flex items-center justify-center text-[10px] text-muted-foreground text-center">No icon</div>`}
              <a
                href=${wpAdminUrl('options-general.php#site_icon')}
                className="text-sm text-primary hover:underline no-underline"
              >Change in wp-admin →</a>
            </div>
            <p className="text-xs text-muted-foreground pt-2">The site icon shows in browser tabs, mobile home-screen shortcuts, and the WordPress app. Recommended: 512×512px PNG.</p>
          </div>
        </${Card}>
      </div>`}
  </${DesignWizardShell}>`;
}

// ---------------------------------------------------------------------------
// Wizards — developer API reference
//
// /dev/wizards renders inline docs for the context-stack primitives
// (WizardShell, SectionTipsPanel, STEP_TIPS, tokens, routing). A live
// 3-step demo wizard mounts at /dev/wizards/demo/<key> so devs see the
// rendered chrome alongside the source.
// ---------------------------------------------------------------------------

const WIZARDS_DEMO_STEPS = [
  { key: 'intro',  label: 'Intro',  description: 'A 3-step demo wizard built with WizardShell.' },
  { key: 'tips',   label: 'Tips',   description: 'Per-step guidance with icons and bold tokens.' },
  { key: 'finish', label: 'Finish', description: 'The Next button on the last step closes the wizard.' },
];

const WIZARDS_DEMO_TIPS = {
  intro: {
    summary: 'This whole panel is a `SectionTipsPanel` reading a `tips` object. The wizard is just **3 lines** of code in `Routes` + this config.',
    findIt: 'Press [list-view] List View ↦ no wait, you\'re still here. Press **Next** to advance.',
    addPattern: 'The right rail (you\'re reading it) auto-renders when you pass `tips` to the step component.',
    saveBehaviour: 'Click **Next** to advance to the Tips step.',
    docs: [
      { label: 'Learn more about WizardShell',     url: '#wizard-shell' },
      { label: 'Learn more about SectionTipsPanel', url: '#tips-panel' },
    ],
  },
  tips: {
    summary: 'Tip text supports inline tokens: [list-view] [plus] [panel] for icons, `**bold**` for emphasis.',
    findIt: [
      'Use [list-view] for the List View hamburger.',
      'Use [plus] for the inserter / add button.',
      'Use [panel] for the settings panel toggle.',
      'Wrap UI labels in `**double asterisks**` to render as **bold**.',
    ],
    addPattern: 'A `suggestedPatterns: [{category, when}]` array renders an extra "Pattern categories to browse" block.',
    saveBehaviour: 'Click **Next** to finish.',
    docs: [
      { label: 'Learn more about the tip token grammar', url: '#tokens' },
    ],
  },
  finish: {
    summary: '🎉 That\'s the whole API. Now build your wizard.',
    findIt: 'Read the recipe below and copy-paste your way to a working wizard in ~30 lines of JS.',
    saveBehaviour: 'Click **Finish** to return to Home.',
    docs: [
      { label: 'Recipe: build a wizard in 30 lines', url: '#recipe' },
    ],
  },
};

function DemoWizardShell(props) {
  return h`<${WizardShell}
    ...${props}
    steps=${WIZARDS_DEMO_STEPS}
    basePath="/dev/wizards/demo"
    title="Demo wizard"
  >${props.children}</${WizardShell}>`;
}

function WizardsDemoStep() {
  const { step } = useParams();
  const tips = WIZARDS_DEMO_TIPS[step];
  return h`<${DemoWizardShell}
    stepKey=${step}
    wide=${true}
    aside=${tips ? h`<${SectionTipsPanel} stepKey=${step} tips=${tips} url="" />` : null}
  >
    <${Card} className="text-sm text-foreground space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Body slot</div>
      <p>This is the body slot — anything you pass as <code className="font-mono bg-muted px-1 rounded">children</code> to <code className="font-mono bg-muted px-1 rounded">WizardShell</code> renders here. In a real wizard you'd put forms, iframes, pattern grids, etc.</p>
      <p className="text-muted-foreground">Current step: <code className="font-mono bg-muted px-1 rounded">${step}</code></p>
      <p className="text-muted-foreground">The step strip above and the back/next footer below come from <code className="font-mono bg-muted px-1 rounded">WizardShell</code> for free.</p>
    </${Card}>
  </${DemoWizardShell}>`;
}

function WizardsDocsPage() {
  const recipeSrc = `// 1. Define your steps.
const MY_STEPS = [
  { key: 'one', label: 'One', description: 'First step.' },
  { key: 'two', label: 'Two', description: 'Second step.' },
];

// 2. (Optional) define per-step tips. Each key maps to a tips object.
const MY_TIPS = {
  one: {
    summary: 'What this step is about.',
    findIt: 'How to spot the relevant UI ([list-view] / [plus] / [panel]).',
    addPattern: 'Optional — how to insert something. Use **bold** for buttons.',
    saveBehaviour: 'What happens when the user clicks **Save**.',
    docs: [{ label: 'Learn more about thing', url: 'https://example.com/' }],
  },
  // …
};

// 3. (Optional) preset wrapper — closes over your config so each
//    step component only passes \`stepKey\` + \`children\`.
function MyWizardShell(props) {
  return h\`<\${WizardShell}
    ...\${props}
    steps=\${MY_STEPS}
    basePath="/my-wizard"
    title="My Wizard"
  >\${props.children}</\${WizardShell}>\`;
}

// 4. Step components.
function MyStepOne() {
  return h\`<\${MyWizardShell} stepKey="one">
    <\${Card} className="p-5">Hello from step one.</\${Card}>
    <\${SectionTipsPanel} stepKey="one" tips=\${MY_TIPS.one} url="" />
  </\${MyWizardShell}>\`;
}

// 5. Wire routes in the parent <Routes>:
//    <Route path="/my-wizard"      element={<Navigate to="/my-wizard/one" replace />} />
//    <Route path="/my-wizard/one"  element={<MyStepOne />} />
//    <Route path="/my-wizard/two"  element={<MyStepTwo />} />`;

  const WIZARD_COMPOSER_SNIPPET = `// Mount a Gutenberg block editor on any element. The app's assets must be
// loaded on the page, and the target should sit inside a #os-app-root-scoped
// container so the design tokens resolve.
const editor = window.CI.mountComposer( '#my-editor', {
  value: '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->',
  onChange: ( markup ) => {
    // markup = serialized block HTML; POST it to wp/v2 as \`content\`.
  },
  placeholder: 'Write…',
  showInspector: true,
} );

// Tear down when you're done:
editor.unmount();`;

  return h`<div className="absolute inset-0 overflow-y-auto overscroll-contain bg-background">
    <div className="p-6 md:p-10 mx-auto w-full max-w-4xl space-y-10 pb-32">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Wizards — Developer Reference</h1>
            <p className="text-muted-foreground">Build a guided multi-step admin page in ~30 lines of JS using the context-stack primitives.</p>
          </div>
          <${Link} to="/home" className="text-sm text-primary hover:underline">← back to Home</${Link}>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <${Link} to="/dev/wizards/demo" className="px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 no-underline">
            Open the demo wizard ↗
          </${Link}>
          <a href="https://github.com/Automattic/core-index" target="_blank" rel="noopener" className="text-sm text-primary hover:underline">View source on GitHub ↗</a>
        </div>
      </header>

      <section id="authoring" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Two ways to build a wizard</h2>
        <${Card} className="p-5 space-y-3 text-sm">
          <p><strong className="font-semibold text-foreground">User-authored — no code.</strong> Create a <code className="font-mono bg-muted px-1 rounded">Wizard</code> in the app; each step has a <em>Body</em> and a <em>Side panel</em> composed in the real Gutenberg block editor (<code className="font-mono bg-muted px-1 rounded">GutenbergComposer</code>, below). Step content is saved as block markup and rendered on the front end with WordPress's <code className="font-mono bg-muted px-1 rounded">do_blocks()</code> — the same pipeline as <code className="font-mono bg-muted px-1 rounded">content.rendered</code>, inline (no iframe). Most wizards should use this path.</p>
          <p><strong className="font-semibold text-foreground">Code-based — this reference.</strong> The built-in <${Link} to="/design" className="text-primary hover:underline">Design Setup</${Link}> and <${Link} to="/quick-start" className="text-primary hover:underline">Quick Start</${Link}> wizards are written in JS with <code className="font-mono bg-muted px-1 rounded">WizardShell</code> + <code className="font-mono bg-muted px-1 rounded">SectionTipsPanel</code> — for flows that need custom forms, live API calls, or iframes a block editor can't express. The primitives below document that path.</p>
        </${Card}>
      </section>

      <section id="composer" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">GutenbergComposer — block editor</h2>
        <${Card} className="p-5 space-y-3 text-sm">
          <p>A self-contained Gutenberg block editor (fixed block toolbar, block inspector, native chrome). It backs user-authored wizard bodies/side-panels and reminder notes, and is reusable anywhere the app's assets are loaded.</p>
          <ul className="space-y-1.5 list-disc list-outside pl-5 marker:text-muted-foreground">
            <li><code className="font-mono bg-muted px-1 rounded">value</code> — block markup string.</li>
            <li><code className="font-mono bg-muted px-1 rounded">onChange(markup)</code> — fires on every edit with the serialized block markup (same shape as <code className="font-mono bg-muted px-1 rounded">value</code>; POST it straight to <code className="font-mono bg-muted px-1 rounded">wp/v2</code> <code className="font-mono bg-muted px-1 rounded">content</code>).</li>
            <li><code className="font-mono bg-muted px-1 rounded">placeholder</code>, <code className="font-mono bg-muted px-1 rounded">showInspector</code> (default true), <code className="font-mono bg-muted px-1 rounded">minHeight</code> (px), <code className="font-mono bg-muted px-1 rounded">className</code> — optional.</li>
          </ul>
          <p>Exposed on <code className="font-mono bg-muted px-1 rounded">window.CI</code> for imperative mounting (target should sit inside a <code className="font-mono bg-muted px-1 rounded">#os-app-root</code>-scoped container so the design tokens resolve):</p>
          <${Card} className="p-0 overflow-hidden">
            <${CodeBlock} copyValue=${WIZARD_COMPOSER_SNIPPET}>${WIZARD_COMPOSER_SNIPPET}</${CodeBlock}>
          </${Card}>
        </${Card}>
      </section>

      <section id="wizard-shell" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">WizardShell</h2>
        <${Card} className="p-5 space-y-3 text-sm">
          <p>The chrome: top header (title + description), step strip (clickable), body slot, sticky back/next footer. Generic over which wizard mounts it.</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Prop</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">Purpose</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">stepKey</code></td><td className="py-2 pr-4 align-top text-muted-foreground">string</td><td className="py-2 align-top">Which step is current. Must match a key in <code className="font-mono bg-muted px-1 rounded">steps[]</code>.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">steps</code></td><td className="py-2 pr-4 align-top text-muted-foreground">{ key, label, description }[]</td><td className="py-2 align-top">Step config array. Drives the strip + footer counter.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">basePath</code></td><td className="py-2 pr-4 align-top text-muted-foreground">string</td><td className="py-2 align-top">URL prefix. Clicking a step pill navigates to <code className="font-mono bg-muted px-1 rounded">{basePath}/{key}</code>.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">title</code></td><td className="py-2 pr-4 align-top text-muted-foreground">string</td><td className="py-2 align-top">Page H1.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">headerActions</code></td><td className="py-2 pr-4 align-top text-muted-foreground">node (optional)</td><td className="py-2 align-top">Extra header buttons. Design wizard uses this for "Continue in Site Editor".</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">wide</code></td><td className="py-2 pr-4 align-top text-muted-foreground">boolean (default false)</td><td className="py-2 align-top">Drop the <code className="font-mono bg-muted px-1 rounded">max-w-5xl</code> cap. Use for full-width iframe steps.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">onPrev / onNext</code></td><td className="py-2 pr-4 align-top text-muted-foreground">() => void (optional)</td><td className="py-2 align-top">Override prev/next behaviour. Default: navigate to siblings; Finish goes to /home.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">nextLabel</code></td><td className="py-2 pr-4 align-top text-muted-foreground">string (default 'Next')</td><td className="py-2 align-top">Override the Next button label. Last step always says "Finish".</td></tr>
            </tbody>
          </table>
        </${Card}>
      </section>

      <section id="tips-panel" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">SectionTipsPanel</h2>
        <${Card} className="p-5 space-y-3 text-sm">
          <p>A side rail with structured guidance: <em>About this step</em>, <em>Find it in the editor</em>, <em>Add or swap a pattern</em>, <em>Pattern categories to browse</em>, <em>When you save</em>, and a docs link list.</p>
          <p className="text-muted-foreground">Pass <code className="font-mono bg-muted px-1 rounded">stepKey</code>, <code className="font-mono bg-muted px-1 rounded">tips</code> (one object from your tips map), and <code className="font-mono bg-muted px-1 rounded">url</code> (optional "open in new tab" link).</p>
          <p>Each <code className="font-mono bg-muted px-1 rounded">tips</code> object accepts these fields (all optional except <code className="font-mono bg-muted px-1 rounded">summary</code>):</p>
          <ul className="space-y-1.5 list-disc list-outside pl-5 marker:text-muted-foreground">
            <li><code className="font-mono bg-muted px-1 rounded">summary</code> — paragraph at the top.</li>
            <li><code className="font-mono bg-muted px-1 rounded">findIt</code> — string OR array. Single string renders as a paragraph; array renders as a bulleted list (gracefully handles long-text wrap).</li>
            <li><code className="font-mono bg-muted px-1 rounded">addPattern</code> — paragraph about adding or swapping content.</li>
            <li><code className="font-mono bg-muted px-1 rounded">suggestedPatterns</code> — array of <code className="font-mono bg-muted px-1 rounded">{ category, when }</code>. Renders a two-column list (category in bold, when in muted).</li>
            <li><code className="font-mono bg-muted px-1 rounded">saveBehaviour</code> — paragraph about what saving does.</li>
            <li><code className="font-mono bg-muted px-1 rounded">docs</code> — array of <code className="font-mono bg-muted px-1 rounded">{ label, url }</code>. Renders as a list of "Learn more about …" links.</li>
          </ul>
        </${Card}>
      </section>

      <section id="tokens" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tip-text tokens</h2>
        <${Card} className="p-5 space-y-3 text-sm">
          <p>Tip text is passed through <code className="font-mono bg-muted px-1 rounded">renderWithIcons()</code> which expands two kinds of tokens:</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Token</th>
              <th className="py-2 pr-4 font-medium">Renders as</th>
              <th className="py-2 font-medium">Use for</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">[list-view]</code></td><td className="py-2 pr-4 align-top">${renderWithIcons('[list-view]')}</td><td className="py-2 align-top">The 3-line hamburger that opens the List View panel.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">[plus]</code></td><td className="py-2 pr-4 align-top">${renderWithIcons('[plus]')}</td><td className="py-2 align-top">The inserter "+" button.</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">[panel]</code></td><td className="py-2 pr-4 align-top">${renderWithIcons('[panel]')}</td><td className="py-2 align-top">The right-panel toggle (settings sidebar).</td></tr>
              <tr><td className="py-2 pr-4 align-top"><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">**text**</code></td><td className="py-2 pr-4 align-top"><strong className="font-semibold text-foreground">text</strong></td><td className="py-2 align-top">Button names, tab labels, block names, paths. Anything text-labelled.</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">Don't try to invent new icon tokens unless the UI element is recognised by shape, not by label. Use bold for everything else.</p>
        </${Card}>
      </section>

      <section id="recipe" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recipe — Build a wizard in ~30 lines</h2>
        <${Card} className="p-0 overflow-hidden">
          <${CodeBlock} copyValue=${recipeSrc}>${recipeSrc}</${CodeBlock}>
        </${Card}>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Reference wizards</h2>
        <${Card} className="p-5 text-sm space-y-2">
          <p>Both ship with this plugin and use the same primitives — read the source if you want a full-fat example:</p>
          <ul className="space-y-1.5 list-disc list-outside pl-5 marker:text-muted-foreground">
            <li>
              <${Link} to="/design" className="text-primary hover:underline">Design Setup</${Link}>
              — 10 steps. <code className="font-mono bg-muted px-1 rounded">DesignWizardShell</code> + iframe-heavy steps + the Site Editor deep-link in <code className="font-mono bg-muted px-1 rounded">headerActions</code>.
            </li>
            <li>
              <${Link} to="/quick-start" className="text-primary hover:underline">Quick Start</${Link}>
              — 4 steps. <code className="font-mono bg-muted px-1 rounded">QuickStartShell</code>, form / config / curl test / curl-friendly URLs. No iframes; no header actions.
            </li>
          </ul>
        </${Card}>
      </section>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Settings tabs, each its own hash route (/settings, /settings/data, ...).
const SETTINGS_TABS = [
  { name: 'general',   title: 'General' },
  { name: 'wordpress', title: 'WordPress' },
  { name: 'data',      title: 'Import / Export' },
  { name: 'access',    title: 'Access & keys' },
  { name: 'mcp',       title: 'MCP' },
  { name: 'health',    title: 'Diagnostics' },
];

// The native WordPress option screens, surfaced as a Settings tab so the
// sidebar carries ONE Settings entry (the native Settings menu is hidden
// while only these core screens live under it — see
// maybe_hide_native_settings_menu). Relative hrefs resolve against
// /wp-admin/, where the app itself is mounted.
const WP_SETTINGS_SCREENS = [
  { slug: 'options-general.php',    label: 'General',    desc: 'Site title, tagline, URLs, timezone, and language.' },
  { slug: 'options-connectors.php', label: 'Connectors', desc: 'AI service connections.' },
  { slug: 'options-writing.php',    label: 'Writing',    desc: 'Default post category and format.' },
  { slug: 'options-reading.php',    label: 'Reading',    desc: 'Homepage display, posts per page, and search engine visibility.' },
  { slug: 'options-discussion.php', label: 'Discussion', desc: 'Comments, moderation, and avatars.' },
  { slug: 'options-media.php',      label: 'Media',      desc: 'Image sizes and upload organisation.' },
  { slug: 'options-permalink.php',  label: 'Permalinks', desc: 'URL structure for posts and archives.' },
  { slug: 'options-privacy.php',    label: 'Privacy',    desc: 'Privacy policy page.' },
];

function SettingsWordPress() {
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">WordPress settings</h2>
    <p className="text-sm text-muted-foreground">The native WordPress option screens, in classic wp-admin. Plugin settings pages restore the native Settings menu automatically.</p>
    <${Card} className="p-0 overflow-hidden">
      <div className="divide-y divide-border">
        ${WP_SETTINGS_SCREENS.map((s) => h`<a key=${s.slug} href=${s.slug} className="flex items-center justify-between gap-4 px-5 py-3 no-underline hover:bg-muted group">
          <span>
            <span className="block text-sm font-medium text-foreground group-hover:text-primary">${s.label}</span>
            <span className="block text-xs text-muted-foreground">${s.desc}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground shrink-0">→</span>
        </a>`)}
      </div>
    </${Card}>
  </section>`;
}

function SettingsPage() {
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    try { setData(await rest('/activity/v1/settings')); }
    catch (e) { toast.error('Load failed', e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const m = location.pathname.match(/\/settings\/([^/]+)/);
  const tab = (m && SETTINGS_TABS.some((t) => t.name === m[1])) ? m[1] : 'general';
  const AppHeader = CIRegistry.AppHeader;
  const tabsToggle = h`<${SegmentedToggle} value=${tab} ariaLabel="Settings section"
    onChange=${(t) => navigate(t === 'general' ? '/settings' : `/settings/${t}`)}
    options=${SETTINGS_TABS.map((t) => ({ key: t.name, label: t.title }))} />`;

  // Only show the full-page spinner on the FIRST load (data still null).
  if (!data) {
    return h`<div className="absolute inset-0 flex flex-col pt-14">
      <${AppHeader} title="Settings" icon="cog" actions=${tabsToggle} />
      <div className="flex-1 min-h-0 overflow-y-auto"><div className="p-10 mx-auto w-full max-w-5xl"><${Spinner} /></div></div>
    </div>`;
  }

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Settings" icon="cog" actions=${tabsToggle} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    <div className="p-6 md:p-10 mx-auto w-full max-w-5xl">
      <${PageHeading} icon="cog" title="Settings" description="Import and export, access keys, MCP exposure, diagnostics, and the native WordPress option screens. Manage post types under Content Types." />
      <div className="space-y-8">
        ${tab === 'general' ? h`<${Fragment}>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Content types</h2>
            <${Card} className="p-5 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">Register custom post types, adopt third-party ones, and define their fields, taxonomies, and layout. Managed in the dedicated <strong className="text-foreground">Content Types</strong> area.</p>
              <${WPButton} __next40pxDefaultSize variant="primary" href="#/content-types">Add / manage content types</${WPButton}>
            </${Card}>
          </section>
          <${SettingsHomePreferences} />
        </${Fragment}>` : null}
        ${tab === 'wordpress' ? h`<${SettingsWordPress} />` : null}
        ${tab === 'data' ? h`<${Fragment}>
          <${SettingsExport} toast=${toast} />
          <${SettingsImport} data=${data} toast=${toast} dialog=${dialog} />
        </${Fragment}>` : null}
        ${tab === 'access' ? h`<${Fragment}>
          <${SettingsReadToken}  data=${data} reload=${reload} toast=${toast} dialog=${dialog} />
          <${SettingsAnthropicKey} data=${data} reload=${reload} toast=${toast} />
        </${Fragment}>` : null}
        ${tab === 'mcp' ? h`<${Fragment}>
          <${SettingsInstanceId} data=${data} reload=${reload} toast=${toast} />
          <${SettingsMcpTools} data=${data} reload=${reload} toast=${toast} />
        </${Fragment}>` : null}
        ${tab === 'health' ? h`<${SettingsHealth} data=${data} />` : null}
      </div>
    </div>
    </div>
  </div>`;
}

// Per-browser Home page preferences. Stored in localStorage rather than
// REST options because they're UI knobs, not server-side configuration —
// each user can hide/show sections of the Home page without affecting
// other admins on the same site.
function SettingsHomePreferences() {
  const [designVisible, setDesignVisible] = useState(() => isDesignHomeVisible());
  const flip = (on) => {
    setDesignVisible(on);
    setDesignHomeVisible(on);
  };
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Home page</h2>
    <${Card} className="os-wpds-fields">
      <${WPCheckboxControl}
        __nextHasNoMarginBottom
        checked=${designVisible}
        onChange=${(v) => flip(v)}
        label="Show Design Setup tiles"
        help="Wizard tiles for theme, header, navigation, hero, footer, etc. Per-browser preference; the wizard at ?page=design is always reachable directly."
      />
    </${Card}>
  </section>`;
}

function SettingsExport({ toast }) {
  const [busy, setBusy] = useState(false);
  const doExport = async () => {
    setBusy(true);
    try {
      const res = await rest('/activity/v1/settings/export');
      if (res?.url) {
        window.open(res.url, '_blank');
        const total = Object.values(res.counts || {}).reduce((a, b) => a + b, 0);
        toast.success('Export ready', `${ total } post${ total === 1 ? '' : 's' } in ${ Math.round((res.size || 0) / 1024) } KB`);
      }
    } catch (e) { toast.error('Export failed', e.message); }
    finally { setBusy(false); }
  };
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Export</h2>
    <${Card} className="p-5 space-y-3">
      <p className="text-sm text-muted-foreground">
        Bundle every CI post into a zip of <code className="font-mono bg-muted px-1 rounded">.md</code> files,
        organised by post-type and <code className="font-mono bg-muted px-1 rounded">os_path</code> folder
        (e.g. <code className="font-mono bg-muted px-1 rounded">os_skill/engineering/empathy-writing.md</code>).
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <${Button} variant="primary" disabled=${busy} onClick=${doExport} className="!h-9">Export everything as zip</${Button}>
        <span className="text-xs text-muted-foreground">→ saves to <code className="font-mono bg-muted px-1 rounded">wp-content/uploads/core-index-exports/</code></span>
      </div>
    </${Card}>
  </section>`;
}

function SettingsImport({ data, toast, dialog }) {
  const [busy, setBusy] = useState(false);
  const [importPlan, setImportPlan] = useState(null);
  const [file, setFile] = useState(null);
  const [targetCpt, setTargetCpt] = useState('');
  const [targetFolder, setTargetFolder] = useState('');
  const fileRef = useRef(null);

  // Build the dropdown list from built-ins + admin-defined CPTs.
  // Empty value = "use whatever the zip path says".
  const importableCpts = useMemo(() => {
    const set = new Set(['os_skill', 'os_wiki']);
    for (const row of (data?.custom_cpts || [])) {
      if (row?.slug) set.add(row.slug);
    }
    return Array.from(set);
  }, [data?.custom_cpts]);

  const buildUrl = (mode) => {
    const params = new URLSearchParams({ mode });
    if (targetCpt)    params.set('target_cpt',    targetCpt);
    if (targetFolder) params.set('target_folder', targetFolder);
    return REST_BASE + '/activity/v1/settings/import?' + params.toString();
  };

  const doDryRun = async () => {
    if (!file) { toast.error('Choose a file first'); return; }
    setBusy(true); setImportPlan(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(buildUrl('dry-run'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-WP-Nonce': BOOT.nonce },
        body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || `HTTP ${ res.status }`);
      setImportPlan(d);
    } catch (e) { toast.error('Dry-run failed', e.message); }
    finally { setBusy(false); }
  };

  const doApply = async () => {
    if (!file) return;
    const ok = await dialog.confirm(
      'Apply import?',
      `${ importPlan?.totals?.create || 0 } new post${ importPlan?.totals?.create === 1 ? '' : 's' } (as drafts), ${ importPlan?.totals?.update || 0 } updates. Updates overwrite existing posts with the same slug.`,
      { confirmLabel: 'Apply', danger: false }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(buildUrl('apply'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-WP-Nonce': BOOT.nonce },
        body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || `HTTP ${ res.status }`);
      const t = d.totals || {};
      toast.success('Import done', `created ${ t.created || 0 } · updated ${ t.updated || 0 } · skipped ${ t.skipped || 0 }${ t.failed ? ` · failed ${ t.failed }` : '' }`);
      setImportPlan(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { toast.error('Import failed', e.message); }
    finally { setBusy(false); }
  };

  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import</h2>
    <${Card} className="p-6 space-y-5">
      <p className="text-sm text-muted-foreground">
        Re-importing a CI export zip is a safe round-trip — existing slugs are updated in place; new ones land as drafts.
        Use the overrides below to redirect everything to a specific type or folder regardless of the zip's own structure.
      </p>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Zip file</label>
        <input
          ref=${fileRef}
          type="file"
          accept=".zip,application/zip"
          onChange=${(e) => { setFile(e.target.files?.[0] || null); setImportPlan(null); }}
          className="block w-full text-sm text-foreground"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <${SelectMenu}
            label="Target type"
            value=${targetCpt}
            onChange=${setTargetCpt}
            options=${[{ label: '(from zip path)', value: '' }, ...importableCpts.map((s) => ({ label: s, value: s }))]}
            __nextHasNoMarginBottom=${true}
            __next40pxDefaultSize=${true}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Overrides the first path segment from the zip.</p>
        </div>
        <div>
          <${WPTextControl}
            label="Target folder (os_path)"
            value=${targetFolder}
            onChange=${setTargetFolder}
            placeholder="(from zip path)"
            __nextHasNoMarginBottom=${true}
            __next40pxDefaultSize=${true}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Prefixed onto each post's os_path.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-4 border-t border-border">
        <${Button}
          variant="primary"
          disabled=${busy || !file}
          onClick=${doDryRun}
        >Dry-run preview</${Button}>
        ${importPlan ? h`<${Button}
          variant="primary"
          disabled=${busy}
          onClick=${doApply}
        >Apply ${ importPlan.totals?.create || 0 } + ${ importPlan.totals?.update || 0 }</${Button}>` : null}
        ${(targetCpt || targetFolder) ? h`<span className="text-xs text-muted-foreground">override → ${ targetCpt || '(zip cpt)' }/${ targetFolder || '(zip path)' }</span>` : null}
      </div>

      ${importPlan ? h`<div className="text-xs border border-border rounded p-3 space-y-2 bg-muted/30">
        <div className="text-foreground">
          Plan: <strong>${ importPlan.totals?.create || 0 } new</strong>,
          <strong className="ml-1">${ importPlan.totals?.update || 0 } updates</strong>,
          <strong className="ml-1">${ importPlan.totals?.skip || 0 } skipped</strong>
          ${importPlan.totals?.by_cpt ? h` · per type: ${ Object.entries(importPlan.totals.by_cpt).map(([k, n]) => `${ k }: ${ n }`).join(' · ') }` : null}
        </div>
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">First 20 files</summary>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            ${(importPlan.plan || []).slice(0, 20).map((r, i) => h`<li key=${i}>
              <span className=${`inline-block w-14 ${ r.action === 'create' ? 'text-emerald-700' : r.action === 'update' ? 'text-amber-700' : 'text-muted-foreground' }`}>${r.action}</span>
              <span>${r.path}</span>
            </li>`)}
            ${(importPlan.plan || []).length > 20 ? h`<li className="text-muted-foreground italic">… ${ importPlan.plan.length - 20 } more</li>` : null}
          </ul>
        </details>
      </div>` : null}
    </${Card}>
  </section>`;
}

function SettingsReadToken({ data, reload, toast, dialog }) {
  const [busy, setBusy] = useState(false);
  const token = data.read_token || '';
  const regen = async () => {
    const ok = await dialog.confirm(
      'Regenerate read token?',
      'Anything still using the old token will start returning 401 immediately. Update your shell aliases and prompts before refreshing.',
      { confirmLabel: 'Rotate', danger: true }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await rest('/activity/v1/settings/regenerate-token', { method: 'POST' });
      toast.success('Read token rotated');
      await reload();
    } catch (e) { toast.error('Rotate failed', e.message); }
    finally { setBusy(false); }
  };
  const base = `${window.location.origin}/wp-json/activity/v1`;
  const example = `${base}/run/<slug>?key=${token}`;
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Read token</h2>
    <${Card} className="p-5 space-y-3">
      <p className="text-sm text-muted-foreground">
        A read-only bearer for fetching content over plain URLs, no login needed. Append it as
        <code className="font-mono bg-muted px-1 rounded">?key=</code> to the slug routes:
        <code className="font-mono bg-muted px-1 rounded">/run/&lt;slug&gt;</code> (any type),
        or the typed <code className="font-mono bg-muted px-1 rounded">/skill</code>,
        <code className="font-mono bg-muted px-1 rounded">/memory</code>, and
        <code className="font-mono bg-muted px-1 rounded">/wiki</code> routes. The intended use is pasting a URL
        into an agent prompt ("Run this") so the agent fetches the body itself; the Reminders webcal feed reuses it.
        It cannot write anything. For tool access from chat clients, use the connector URL on the MCP tab instead.
      </p>
      <div className="space-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Copy-ready example (swap in a real slug)</span>
        <div className="flex items-center gap-2 p-2.5 bg-muted rounded-md">
          <code className="flex-1 font-mono text-xs text-foreground break-all">${example}</code>
          <${CopyButton} value=${example} />
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Token</span>
        <div className="flex items-center gap-2 p-2.5 bg-muted rounded-md">
          <code className="flex-1 font-mono text-xs text-foreground break-all">${token || '(none)'}</code>
          <${CopyButton} value=${token} />
          <${Button} variant="ghost" disabled=${busy} onClick=${regen} className="!h-8 !text-xs">Regenerate</${Button}>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Regenerating revokes the old token immediately. Full endpoint list and auth matrix:${' '}
        <a href="https://github.a8c.com/1dr0/core-index/blob/main/docs/API.md" target="_blank" rel="noreferrer" className="text-primary hover:underline">API reference</a>.
      </p>
    </${Card}>
  </section>`;
}

function SettingsAnthropicKey({ data, reload, toast }) {
  const isSet = !!data.anthropic_key_set;
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (clear) => {
    setBusy(true);
    try {
      await rest('/activity/v1/settings/anthropic-key', { method: 'POST', body: JSON.stringify({ key: clear ? '' : val }) });
      toast.success(clear ? 'Key removed' : 'Key saved');
      setVal('');
      await reload();
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setBusy(false); }
  };
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Anthropic API key</h2>
    <${Card} className="p-5 space-y-3">
      <p className="text-sm text-muted-foreground">Powers the <strong>Run agent → This site</strong> automation channel — agents run server-side via Claude. Stored write-only (never returned). ${isSet ? h`<span className="text-emerald-700 font-medium">A key is set.</span>` : 'No key set yet.'}</p>
      <div className="os-wpds-fields flex items-end gap-2">
        <div className="flex-1">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            type="password"
            label="API key"
            value=${val}
            onChange=${setVal}
            placeholder=${isSet ? '•••••••• (saved) — enter a new key to replace' : 'sk-ant-…'}
          />
        </div>
        <${WPButton} variant="primary" isBusy=${busy} disabled=${busy || !val} onClick=${() => save(false)}>Save</${WPButton}>
        ${isSet ? h`<${WPButton} variant="secondary" isDestructive=${true} disabled=${busy} onClick=${() => save(true)}>Remove</${WPButton}>` : null}
      </div>
    </${Card}>
  </section>`;
}

// The ci:// authority this site answers to. Configured, never derived from the
// hostname: local, staging and production are one instance and must keep one
// ID, while their hostnames differ.
function SettingsInstanceId({ data, reload, toast }) {
  const saved = data.instance_id || '';
  const locked = !!data.instance_id_locked;
  const [val, setVal] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(saved); }, [saved]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await rest('/activity/v1/settings/instance-id', { method: 'POST', body: JSON.stringify({ instance_id: val.trim() }) });
      toast.success(r.instance_id ? `Instance ID set to ${r.instance_id}` : 'Instance ID cleared');
      await reload();
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setBusy(false); }
  };
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Instance ID</h2>
    <${Card} className="p-5 space-y-3">
      <p className="text-sm text-muted-foreground">
        Lets a document address content on another Context site: <code>ci://ci-a8c/skill/identity/soul</code>.
        Unscoped <code>ci://skill/…</code> paths always mean this site, so existing content keeps working.
        ${saved
          ? h`<span> This site answers to <strong>${saved}</strong>.</span>`
          : h`<span> Not set — every scoped address resolves as another instance's.</span>`}
      </p>
      <div className="os-wpds-fields flex items-end gap-2">
        <div className="flex-1">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="ID"
            value=${val}
            onChange=${setVal}
            disabled=${locked}
            placeholder="ci-a8c"
            help=${locked
              ? 'Pinned in wp-config.php by the CI_INSTANCE_ID constant.'
              : 'Lowercase letters, digits and hyphens, starting with "os-". Keep it stable — changing it breaks every address pointing here.'}
          />
        </div>
        <${WPButton} variant="primary" isBusy=${busy} disabled=${busy || locked || val.trim() === saved} onClick=${save}>Save</${WPButton}>
      </div>
    </${Card}>
  </section>`;
}

function SettingsMcpTools({ data, reload, toast }) {
  const [busy, setBusy] = useState(false);
  const disabled = new Set(data.mcp_disabled_tools || []);

  // Tool list comes from the server now (built-ins + a septuple per
  // custom CPT). Fall back to hardcoded built-ins for older backends.
  const allTools = (data.mcp_all_tools && data.mcp_all_tools.length)
    ? data.mcp_all_tools
    : [
        'os/skill-read','os/skill-list','os/skill-search',
        'os/wiki-read','os/wiki-list','os/wiki-search',
        'os/read','os/search',
        'os/skill-create','os/skill-update','os/skill-append','os/skill-delete',
        'os/wiki-create','os/wiki-update','os/wiki-append','os/wiki-delete',
      ];

  // Group by sub-type (skill / wiki / todo / etc.). ci/read + ci/search
  // are global; everything else has the shape ci/<type>-<op>.
  const groups = useMemo(() => {
    const out = new Map();
    const global = [];
    for (const tool of allTools) {
      const m = tool.match(/^ci\/([a-z0-9_]+)-(read|list|search|create|update|append|delete)$/);
      if (!m) { global.push(tool); continue; }
      const type = m[1];
      if (!out.has(type)) out.set(type, []);
      out.get(type).push(tool);
    }
    return { perType: Array.from(out.entries()), global };
  }, [allTools.join(',')]);

  const isWrite = (t) => /-(create|update|append|delete)$/.test(t);
  const writeTools = allTools.filter(isWrite);

  const save = async (nextSet, successMsg) => {
    setBusy(true);
    try {
      await rest('/activity/v1/settings/mcp-tools', {
        method: 'POST',
        body: JSON.stringify({ disabled: Array.from(nextSet) }),
      });
      if (successMsg) toast.success(successMsg);
      await reload();
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setBusy(false); }
  };
  const toggle = (tool) => {
    const next = new Set(disabled);
    if (next.has(tool)) next.delete(tool); else next.add(tool);
    save(next);
  };
  const setGroup = (tools, enable) => {
    const next = new Set(disabled);
    for (const t of tools) {
      if (enable) next.delete(t); else next.add(t);
    }
    save(next);
  };
  const disableAllWrites = () => save(new Set([...disabled, ...writeTools]), 'All write tools disabled');
  const enableAll = () => save(new Set(), 'All tools enabled');

  const renderTool = (tool) => {
    const off = disabled.has(tool);
    const w = isWrite(tool);
    return h`<li key=${tool}>
      <div className=${`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted ${ off ? 'opacity-50' : '' }`}>
        <${WPCheckboxControl} checked=${!off} disabled=${busy} onChange=${() => toggle(tool)} __nextHasNoMarginBottom=${true} />
        <code className="font-mono text-xs">${tool}</code>
        <span className=${`ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${ w ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800' }`}>${w ? 'write' : 'read'}</span>
      </div>
    </li>`;
  };

  return h`<${Fragment}>
  <${SettingsMcpConnector} data=${data} reload=${reload} toast=${toast} />
  <section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">MCP tool exposure</h2>
    <${Card} className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground flex-1 min-w-[16rem]">
          Disable individual tools to hide them from MCP clients. Useful when you want MCP to stay read-only on a public-facing site.
          Each registered post type gets its own block below.
        </p>
        <div className="flex gap-2 text-xs">
          <${Button} variant="ghost" disabled=${busy} onClick=${disableAllWrites}>Disable all writes</${Button}>
          <${Button} variant="ghost" disabled=${busy} onClick=${enableAll}>Enable everything</${Button}>
        </div>
      </div>

      ${groups.perType.map(([type, tools]) => {
        const enabledCount = tools.filter((t) => !disabled.has(t)).length;
        const allOn  = enabledCount === tools.length;
        const allOff = enabledCount === 0;
        return h`<div key=${type} className="border border-border rounded-md">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">ci_${type}</code>
              <span className="text-[11px] text-muted-foreground">${enabledCount} / ${tools.length} enabled</span>
            </div>
            <div className="flex gap-1">
              <${Button} variant="ghost" disabled=${busy || allOn}  onClick=${() => setGroup(tools, true)}>Enable all</${Button}>
              <${Button} variant="ghost" disabled=${busy || allOff} onClick=${() => setGroup(tools, false)}>Disable all</${Button}>
            </div>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-0.5 p-2">
            ${tools.map(renderTool)}
          </ul>
        </div>`;
      })}

      ${groups.global.length ? h`<div className="border border-border rounded-md">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-semibold text-foreground">Cross-type</span>
          <span className="text-[11px] text-muted-foreground">searches/reads across every CI post type</span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-0.5 p-2">
          ${groups.global.map(renderTool)}
        </ul>
      </div>` : null}
    </${Card}>
  </section>
  </${Fragment}>`;
}

// The public tokened MCP URL for chat clients that add custom connectors
// (claude.ai and friends) but cannot send WordPress auth. The token IS the
// credential; rotating it revokes the old URL instantly.
function SettingsMcpConnector({ data, reload, toast }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const url = data.mcp_connector_url || '';
  if (!url) return null;
  const rotate = async () => {
    const ok = await dialog.confirm(
      'Rotate the connector URL?',
      'Every client using the current URL disconnects until you paste the new one.',
      { confirmLabel: 'Rotate', danger: true }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await rest('/activity/v1/settings/mcp-connector-rotate', { method: 'POST' });
      toast.success('Connector URL rotated');
      await reload();
    } catch (e) { toast.error('Rotate failed', e.message); }
    finally { setBusy(false); }
  };
  return h`<section className="space-y-3 mb-8">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Connector URL</h2>
    <${Card} className="p-6 space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste this URL into an MCP client that cannot send WordPress auth, like claude.ai's custom connectors
        (leave its OAuth fields empty). The token in the path is the whole credential: whoever has the URL gets
        every tool enabled below, so treat it like a password and rotate it if it leaks.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded break-all flex-1 min-w-[16rem]">${url}</code>
        <${CopyButton} value=${url} label="Copy URL" />
        <${Button} variant="ghost" disabled=${busy} onClick=${rotate}>Rotate</${Button}>
      </div>
    </${Card}>
  </section>`;
}

function SettingsHealth({ data }) {
  const d = data.diagnostics || {};
  const row = (label, ok, value) => h`<li className="flex items-center gap-3 py-2 border-b border-border last:border-b-0">
    <span className=${`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${ ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700' }`}>${ok ? '✓' : '!'}</span>
    <span className="text-sm text-foreground flex-1">${label}</span>
    <span className="text-xs text-muted-foreground font-mono">${value}</span>
  </li>`;
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Health check</h2>
    <${Card} className="p-5">
      <ul>
        ${row('WordPress version', true, d.wp_version || '?')}
        ${row('PHP version', true, d.php_version || '?')}
        ${row('Abilities API loaded', !!d.abilities_api, d.abilities_api ? 'yes' : 'missing — install Abilities API plugin')}
        ${row('Official MCP Adapter', !!d.mcp_adapter_loaded, d.mcp_adapter_loaded ? `v${ d.mcp_adapter_version || '?' }` : 'install and activate mcp-adapter')}
        ${row('CI abilities registered', (d.ci_abilities_count || 0) >= 8, `${ d.ci_abilities_count || 0 } registered`)}
        ${row('os_skill CPT', !!(d.cpts && d.cpts.os_skill), d.cpts && d.cpts.os_skill ? 'registered' : 'missing')}
        ${row('os_wiki CPT', !!(d.cpts && d.cpts.os_wiki), d.cpts && d.cpts.os_wiki ? 'registered' : 'missing')}
        ${row('Font Awesome Free', true, 'GPL-compatible Free icons in use')}
      </ul>
    </${Card}>
  </section>`;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

// Total leaf count across this subtree — for the badge next to a folder.

// --- Lazy app modules -------------------------------------------------------
// Route-scoped leaf modules load on first navigation instead of riding the
// initial payload. Only modules that register nothing other pages depend on
// qualify: no editors (EditorPage deep links would miss them) and no
// module-scope polling (the Notifications badge). Each entry carries a static
// copy of the module's nav row so the sidebar is complete before load; when
// the module loads, its own registerNavRow call replaces the stub by key.
const LAZY_APPS = [
  {
    spec: 'os/app-activity',
    routes: ['/activity'],
    nav: { adminMenu: true, key: 'activity', label: 'Activity', icon: 'bolt', path: '/activity', order: 10, match: (p) => p === '/activity' || p.indexOf('/activity') === 0 },
  },
  {
    spec: 'os/app-notifications',
    routes: ['/notifications'],
    nav: { adminMenu: true, key: 'notifications', label: 'Notifications', icon: 'flag', path: '/notifications', order: 11, match: (p) => p === '/notifications' },
  },
  {
    spec: 'os/app-apps',
    routes: ['/apps'],
    nav: { adminMenu: true, key: 'apps', label: 'Apps', icon: 'store', path: '/apps', order: 12, match: (p) => p === '/apps' },
  },
];
// Editor-registering modules: the stubs below keep every registry the UI
// reads (editors, list views, quick-add, the Content Types picker) complete
// before load; the editor stub renders LazyApp, and the module's own
// registrations replace the stubs by key when the import lands.
LAZY_APPS.push(
  {
    spec: 'os/app-media',
    routes: [],
    editors: [ { key: 'media', listView: true, opts: {} } ],
  },
  {
    spec: 'os/app-wizards',
    routes: ['/w'],
    editors: [
      { key: 'wizard', opts: { selectable: true, title: 'Wizard (steps)', description: 'Multi-step guided flow with block-editor bodies.', newFile: { label: 'New wizard', desc: 'Composer with steps, body + tips block editors.' } } },
    ],
  },
);

LAZY_APPS.forEach((a) => {
  if (a.nav) registerNavRow(a.nav);
  (a.editors || []).forEach((e) => {
    const boot = () => h`<${LazyApp} spec=${a.spec} />`;
    registerEditor(e.key, boot, { ...(e.opts || {}), listView: e.listView ? boot : undefined });
  });
  Object.entries(a.newFiles || {}).forEach(([k, def]) => registerNewFile(k, def));
});

// The Notifications unread badge, owned by the shell so it shows before the
// module loads. The page refreshes its own feed while open; this is only the
// sidebar count.
async function pollNotificationsBadge() {
  try {
    const d = await rest('/activity/v1/notifications');
    setNavBadge('notifications', d.unread_count > 0 ? d.unread_count : '');
  } catch { /* not logged in / transient — ignore */ }
}
pollNotificationsBadge();
setInterval(() => { if (!document.hidden) pollNotificationsBadge(); }, 45000);

// Fallback element for a lazy route: import the module (it self-registers the
// real route, which outranks this fallback on the next render), show a
// spinner meanwhile.
function LazyApp({ spec }) {
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    import(spec).catch((e) => { if (on) setErr(e.message || String(e)); });
    return () => { on = false; };
  }, [spec]);
  if (err) return h`<div className="p-10"><${Card} className="p-4 text-sm text-red-600">Couldn't load this app: ${err}</${Card}></div>`;
  return h`<div className="p-10 flex justify-center"><${Spinner} /></div>`;
}

function App() {
  // ShortcutProvider sets up the @wordpress/keyboard-shortcuts store so
  // <BlockEditorKeyboardShortcuts.Register /> inside any embedded block
  // editor can register the slash inserter + Cmd+Z/Y + selection
  // shortcuts. Without it, slash-to-insert is silently dead in our
  // composer block editors.
  // Re-render when a lazily loaded module registers its routes/nav rows.
  const [, bumpRegistry] = useReducer((x) => x + 1, 0);
  useEffect(() => onRegistryChange(bumpRegistry), []);

  return h`<${ShortcutProvider || 'div'}>
    <${WPSlotFillProvider || 'div'}>
    <${ToastProvider}>
    <${DialogProvider}>
      <${HashRouter}>
        <${PaletteProvider}>
          <${InitialRouteSync} />
          <${RouteSync} />
          <${Shell}>
            <${Routes}>
              <${Route} path="/" element=${h`<${HomePage} />`} />
              <${Route} path="/home" element=${h`<${Navigate} to="/" replace />`} />
              <${Route} path="/settings" element=${h`<${SettingsPage} />`} />
              <${Route} path="/settings/:tab" element=${h`<${SettingsPage} />`} />
              ${CIRegistry.routes.map((r) => h`<${Route} key=${r.path} path=${r.path} element=${r.element} />`)}
              ${LAZY_APPS.flatMap((a) => a.routes
                .filter((path) => !CIRegistry.routes.some((r) => r.path === path || r.path.indexOf(path + '/') === 0))
                .map((path) => h`<${Route} key=${'lazy:' + path} path=${path + '/*'} element=${h`<${LazyApp} spec=${a.spec} />`} />`))}
              <${Route} path="/t/:type" element=${h`<${ListView} />`} />
              ${/* Edit mode is a route, not component state: linkable, and
                  the back button leaves it. Static segment outranks :id. */''}
              <${Route} path="/t/:type/edit" element=${h`<${ListView} />`} />
              <${Route} path="/t/:type/:id" element=${h`<${EditorPage} />`} />
              <${Route} path="*" element=${h`<${Navigate} to="/" replace />`} />
            </${Routes}>
          </${Shell}>
        </${PaletteProvider}>
      </${HashRouter}>
    </${DialogProvider}>
  </${ToastProvider}>
  </${WPSlotFillProvider || 'div'}>
  </${ShortcutProvider || 'div'}>`;
}

// Inject the toast slide-in keyframes once.
(function injectKeyframes() {
  if (document.getElementById('os-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'os-keyframes';
  s.textContent = '@keyframes os-toast { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }';
  document.head.appendChild(s);
})();

// Sidebar width is driven by a CSS variable so the user can drag the
// right edge to resize. We can't use Tailwind's md-prefixed width
// utilities once the width is dynamic — they pin to 16rem.
// Hand-rolled CSS rules keyed by the same media query give the same
// breakpoint behaviour without forcing a Tailwind config change.
(function injectSidebarCss() {
  if (document.getElementById('os-sidebar-css')) return;
  const s = document.createElement('style');
  s.id = 'os-sidebar-css';
  s.textContent = `
/* Width/left are applied as INLINE styles by useSidebarWidth(); no
 * stylesheet rule needed for the CSS var. The resizer handle + the
 * Quick Start MCP tabs live here. */

/* MCP client tabs — WPDS TabPanel buttons crowd each other when there
 * are 6+ of them. Wrap + space them out, and put a subtle bottom
 * border on the tablist so the active-state underline has something
 * to register against. */
#os-app-root .os-mcp-tabs .components-tab-panel__tabs {
  gap: 0.5rem;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.25rem;
}
#os-app-root .os-mcp-tabs .components-tab-panel__tabs-item {
  padding-left: 1rem !important;
  padding-right: 1rem !important;
}

.os-sidebar-resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  /* Below the fixed editor header (z-30) — without this the drag
   * line bleeds visually across the title-bar's Close / Save row.
   * The header still receives clicks in that area; the resizer
   * stays grabbable on the rest of the sidebar's vertical extent. */
  z-index: 20;
  background: transparent;
  transition: background 120ms;
}
.os-sidebar-resizer:hover, .os-sidebar-resizer.dragging {
  background: var(--ring);
}
.os-sidebar-resizer.dragging { background: var(--ring); opacity: 0.55; }
@media (max-width: 767px) {
  .os-sidebar-resizer { display: none; }
}
`;
  document.head.appendChild(s);
})();

// Restore a previously-dragged tree-panel width on boot. Clamping mirrors
// SidebarResizer's bounds so a stale localStorage value can't blow the
// editor off-screen. Uses `--os-tree-w` (NOT `--os-sidebar-w` — that
// one is owned by context-app-shell for the WP admin menu offset and
// must not be touched here).
(function applyTreeWidth() {
  try {
    const stored = localStorage.getItem('ci:tree-w');
    if (stored) {
      const n = parseFloat(stored);
      if (Number.isFinite(n) && n >= 180 && n <= 640) {
        document.documentElement.style.setProperty('--os-tree-w', n + 'px');
      }
    }
    // Also clean up any value the buggy previous version wrote to the
    // WP-admin shell's var so the layout doesn't stay shifted on
    // first load after upgrading. Drop only when it doesn't look like
    // a WP-admin menu width (160 / 36 mobile collapsed).
    const stale = document.documentElement.style.getPropertyValue('--os-sidebar-w');
    if (stale && parseFloat(stale) >= 180) {
      document.documentElement.style.removeProperty('--os-sidebar-w');
    }
    // Drop the misnamed legacy localStorage key from the first
    // resize implementation so it doesn't get re-applied on the next
    // page that still references the old var name.
    localStorage.removeItem('ci:sidebar-w');
  } catch {}
})();

// ---------------------------------------------------------------------------
// Public composer API. `GutenbergComposer` is a self-contained block editor
// (fixed toolbar + block inspector + native chrome) that can be dropped in
// anywhere the CI app assets are loaded:
//
//   • inside the React app:  h`<${window.CI.GutenbergComposer} value=… onChange=… />`
//   • imperatively on any node (ideally one inside a `#os-app-root`-scoped
//     container so the design tokens resolve):
//       const editor = window.CI.mountComposer('#my-el', {
//         value: '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
//         onChange: (html) => console.log(html),   // serialized block markup
//         placeholder, showInspector, minHeight, className,
//       });
//       editor.unmount();
//
// onChange receives the serialized block markup string (same shape the
// value prop accepts), so it round-trips through wp/v2 `content` + do_blocks.
// ---------------------------------------------------------------------------
window.CI = window.CI || {};
// The ci/* public API major, mirrored from ci/core so non-module code and
// companion plugins can read window.CI?.apiVersion without a hard named import.
window.CI.apiVersion = API_VERSION;
window.CI.GutenbergComposer = GutenbergComposer;
// Public extension API — lets an external app module (or an inline script)
// register a new editor without importing the ci/core module. ESM modules can
// instead `import { registerEditor, h } from 'os/core'`; this mirrors that for
// non-module use. Example:
//   CI.registerEditor('json', () => CI.h`<${MyJsonEditor} />`,
//     { selectable: true, title: 'JSON', description: 'Raw JSON editor.' });
window.CI.h = h;
window.CI.registerEditor = registerEditor;
window.CI.registerListView = registerListView;
window.CI.registerRoute = registerRoute;
window.CI.registerNewFile = registerNewFile;
// Let app modules contribute events to the Calendar (Bookings, Subscriptions…):
//   CI.registerCalendarSource({ key:'bookings', label:'Bookings', color:'#2563eb',
//     fetch: async ({ after, before }) => [{ date:'2026-06-10', title:'…', time:'14:00', url:'…' }] })
window.CI.registerCalendarSource = registerCalendarSource;
window.CI.CIRegistry = CIRegistry;
window.CI.mountComposer = function mountComposer(target, props = {}) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node) {
    console.error('[core-index] mountComposer: target not found', target);
    return null;
  }
  const root = createRoot(node);
  root.render(h`<${GutenbergComposer} ...${props} />`);
  return { unmount: () => root.unmount(), node };
};

// ---------------------------------------------------------------------------
// App registration — every built-in feature wires itself into the Core
// registry here, grouped by target layer so the future module split is
// mechanical (each block moves to its own os-*.js and calls these same
// register fns at import time). Runs at module eval, before App mounts.
// ---------------------------------------------------------------------------
// layer: type — the nav/list/editor spine (TypeLayout, nav tree, DataViews,
// ListView, NewFileButton, the meta/term/cpt editors, and the content-types/
// structure routes) now lives in assets/os-type.js, which self-registers them
// and sets the shared chrome on the registry on import (see the ci/type import
// at the top of this file).

// layer: app — Wizard editor + runner now live in assets/os-app-wizards.js
// (self-registers the 'wizard' editor + /w/:slug routes on import). The
// /dev/wizards* developer docs stay here (they ride the onboarding shell).
registerRoute('/dev/wizards', h`<${WizardsDocsPage} />`);
registerRoute('/dev/wizards/demo', h`<${Navigate} to="/dev/wizards/demo/intro" replace />`);
registerRoute('/dev/wizards/demo/:step', h`<${WizardsDemoStep} />`);

// layer: app — Media now lives in its own leaf module (assets/os-app-media.js)
// and self-registers the 'media' editor + list view on import (top of file).

// layer: app — Reminders + Calendar + Automations now live in their own leaf
// module (assets/os-app-reminders.js) and self-register on import (top of file).

// TypeLayout / NewFileButton / MobileMenuButton / starterTemplateFor are set on
// the registry by os-type.js (it owns them). EditorHeader / MarkdownInsertPopover
// by the markdown leaf. Only the onboarding-owned chrome is published here:
// WizardShell + SectionTipsPanel are shared with the onboarding/design wizard
// (which stays here); the wizard editor/runner leaf reads them off the registry.
CIRegistry.WizardShell = WizardShell;
CIRegistry.SectionTipsPanel = SectionTipsPanel;

// layer: app — Onboarding (Quick Start).
registerRoute('/quick-start', h`<${Navigate} to="/quick-start/token" replace />`);
registerRoute('/quick-start/token', h`<${QuickStartTokenStep} />`);
registerRoute('/quick-start/mcp', h`<${QuickStartMcpStep} />`);
registerRoute('/quick-start/test', h`<${QuickStartTestStep} />`);
registerRoute('/quick-start/author', h`<${QuickStartAuthorStep} />`);

// layer: app — Design wizard.
registerRoute('/design', h`<${Navigate} to="/design/theme" replace />`);
registerRoute('/design/theme', h`<${WizardThemeStep} />`);
registerRoute('/design/identity', h`<${WizardIdentityStep} />`);
registerRoute('/design/header', h`<${WizardHeaderStep} />`);
registerRoute('/design/nav', h`<${WizardNavStep} />`);
registerRoute('/design/hero', h`<${WizardHeroStep} />`);
registerRoute('/design/body', h`<${WizardBodyStep} />`);
registerRoute('/design/featured', h`<${Navigate} to="/design/body" replace />`);
registerRoute('/design/faq', h`<${WizardFaqStep} />`);
registerRoute('/design/cta', h`<${WizardCtaStep} />`);
registerRoute('/design/homepage', h`<${Navigate} to="/design/body" replace />`);
registerRoute('/design/footer', h`<${WizardFooterStep} />`);
registerRoute('/design/styles', h`<${WizardStylesStep} />`);

const rootEl = document.getElementById('os-app-root');
if (rootEl) {
  // Load any external editor/app ES modules (BOOT.app_modules — dropped in
  // uploads/os-apps/ or added via the `core_index_app_modules`
  // filter) BEFORE the first render, so their registerEditor() calls land in
  // time to appear in the picker + dispatch. A module that fails to load is
  // logged, never fatal. This is the public "create your own editor" path:
  // a module just does `import { registerEditor, h } from 'os/core'` + registers.
  (async () => {
    for (const url of (BOOT.app_modules || [])) {
      try { await import(url); }
      catch (e) { console.error('[core-index] app module failed to load:', url, e); }
    }
    createRoot(rootEl).render(h`<${App} />`);
    // Reveal the (otherwise opacity:0) root once React has painted at least
    // once. Two RAFs to ensure layout has settled past the first React commit.
    requestAnimationFrame(() => requestAnimationFrame(() => rootEl.classList.add('os-ready')));
  })();
}
