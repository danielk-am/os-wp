/**
 * Context App — shared editor chrome (self-contained leaf module).
 *
 * Publishes the chrome every editor reads off the registry: `EditorHeader` (the
 * fixed top toolbar + title bar + settings panel) and `MarkdownInsertPopover`
 * (the Insert drawer, consumed by wizard). Also registers the `block`
 * editor — the Gutenberg redirect for block-mode CPTs.
 *
 * Formerly os-app-markdown.js: the markdown editor it hosted is retired (CSV
 * moved to the os-csv companion; prose authoring is the Fields form editor), so
 * that editor and its file / CSV / Mermaid-graph code is gone and only the
 * shared chrome remains.
 *
 * No build step — native ES module; bare specifiers resolve via the importmap.
 */
import { createElement, cloneElement, Children, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } from 'react';
import { createPortal } from 'react-dom/client';
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  Button as WPButton, Spinner as WPSpinner, Notice as WPNotice,
  Card as WPCard, CardBody as WPCardBody,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton,
  Dropdown as WPDropdown, ColorPalette as WPColorPalette, ColorIndicator as WPColorIndicator,
  TextControl as WPTextControl, TextareaControl as WPTextareaControl,
  FormTokenField as WPFormTokenField,
  CheckboxControl as WPCheckboxControl, SearchControl as WPSearchControl,
  TreeGrid as WPTreeGrid, TreeGridRow as WPTreeGridRow, TreeGridCell as WPTreeGridCell,
  ItemGroup as WPItemGroup, Item as WPItem, MenuGroup as WPMenuGroup, MenuItem as WPMenuItem,
  TabPanel as WPTabPanel, SlotFillProvider as WPSlotFillProvider,
  Panel as WPPanel, PanelBody as WPPanelBody,
  createSlotFill as WPCreateSlotFill, useSlotFills as WPUseSlotFills,
} from '@wordpress/components';
import { marked } from 'marked';
import { faPython, faJs, faPhp, faCode, faFileCode, faTable, faTerminal, faMarkdown, faDiagramProject } from '@ci/fa-icons';
import { h, BOOT, rest, restAllPages, decodeEntities, typeMeta, editorChoices, CIRegistry, registerEditor } from 'os/core';
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, OS_ICONS, Toolbar as CIToolbar, CptIcon, SelectMenu } from 'os/ui';
import { useToast, useDialog } from 'os/shell';
import { CodeEditor, useEditorFullWidth, EditorFullWidthButton } from 'os/editors';
import { CANVAS_ADD_ITEMS } from 'os/core';

// Shared type chrome via the registry (set by the main bundle before mount).
const TypeLayout = ({ children, ...rest }) => h`<${CIRegistry.TypeLayout} ...${rest}>${children}</${CIRegistry.TypeLayout}>`;
const NewFileButton = (props) => h`<${CIRegistry.NewFileButton} ...${props} />`;
const MobileMenuButton = (props) => h`<${CIRegistry.MobileMenuButton} ...${props} />`;

// Chrome glyphs used by the markdown editor + header.
const iconPlus = h`<${Icon} name="plus" />`;
const iconClose = h`<${Icon} name="close" />`;
const iconChevronDown = h`<${Icon} name="chevron-down" />`;
const iconChevronLeft = h`<${Icon} name="chevron-left" />`;
const iconChevronRight = h`<${Icon} name="chevron-right" />`;


const MARKDOWN_INSERT_TEMPLATES = CANVAS_ADD_ITEMS
  .filter((it) => typeof it.template === 'string')
  .map((it) => ({ id: it.type, section: it.section, label: it.label, tip: it.tip, template: it.template, cursorOffset: it.cursorOffset ?? 0 }));

// Right-side slide-in Insert drawer. Replaces the prior floating
// popover so the panel has its own scroll context (the markdown
// editor underneath stays still) and the 25-item catalogue can fit
// without bumping into the viewport edge. Anchors to the right of
// the content area — respects the WP admin sidebar offset via the
// `--os-sidebar-w` CSS var, same as the command palette.
// Lightweight YAML-ish frontmatter parser for custom snippet bodies.
// Returns `{ meta: { key: value, … }, body: rest-of-content }`. Keys are
// lowercased so authors can write `Section:`, `section:`, or `SECTION:`
// interchangeably. Doesn't try to be a full YAML parser — values are
// taken verbatim with surrounding quotes stripped. When no frontmatter
// block is present, returns `{ meta: {}, body: original }`.
function parseSnippetFrontmatter(content) {
  const s = content || '';
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: s };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*?)\s*$/);
    if (!kv) continue;
    let v = kv[2].trim();
    v = v.replace(/^["']|["']$/g, '');
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: s.slice(m[0].length) };
}

function MarkdownInsertPopover({ onPick, onClose, open }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [customSnippets, setCustomSnippets] = useState([]);
  // Collapsible section headings — default collapsed so all sections are
  // visible/scannable at a glance; expand one to reveal its snippets. A live
  // search overrides this and expands everything so matches always show.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleSection = (s) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      // Focus the search input after the slide-in transition.
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open]);
  // Fetch user-authored snippets from the os_snippet CPT each time
  // the drawer opens. Small payload, no caching: snippets are rare
  // edits, and a fresh fetch means newly-saved snippets show up
  // immediately. Failure is silent — built-ins still work.
  //
  // Snippet authoring contract: a snippet's body MAY start with a YAML
  // frontmatter block whose keys override the WP fields:
  //   section / category   — Add-menu grouping (default: post meta
  //                          `os_section`, then "Custom")
  //   label / name         — display label (default: post title)
  //   tip / description    — one-line explanation (default: excerpt)
  //   cursoroffset         — caret position after insert
  // Anything below the `---\n…\n---` block is the template content itself,
  // so users can edit the entire snippet — including its categorisation —
  // through the markdown editor without touching post meta.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await restAllPages('/wp/v2/os_snippet?per_page=100&context=edit&status=any&_fields=id,title,excerpt,content,meta,slug');
        if (cancelled) return;
        const mapped = items.map((p) => {
          const { meta: fm, body } = parseSnippetFrontmatter(p.content?.raw || '');
          const cursorOffset = parseInt(fm.cursoroffset || fm['cursor-offset'] || '0', 10) || 0;
          return {
            id: 'os-snippet-' + p.id,
            label: fm.label || fm.name || (p.title?.raw || p.title?.rendered || p.slug || 'Snippet').trim(),
            section: fm.section || fm.category || (p.meta?.os_section || '').trim() || 'Custom',
            tip: fm.tip || fm.description || (p.meta?.os_tip || '').trim() || (p.excerpt?.raw || '').trim(),
            template: body.replace(/\n*$/, '\n'),
            cursorOffset,
            isCustom: true,
            // Tracks which JS built-in this seeded post overrides (if any).
            // Used by allItems to dedup the built-in's copy out of the
            // Add menu once the user has a snippet for it.
            builtinId: (p.meta?.os_builtin_id || '').trim(),
          };
        }).filter((s) => s.template.trim());
        setCustomSnippets(mapped);
      } catch {/* silent */}
    })();
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Combined list: user snippets first (default section "Custom"),
  // then built-in templates — minus any built-in that has already been
  // seeded as a snippet (matched by os_builtin_id meta). The seeded
  // snippet wins because the user may have edited it; the JS built-in
  // is the fallback for fresh installs and for built-ins the user
  // hasn't materialised yet.
  const allItems = useMemo(() => {
    const seededBuiltins = new Set(
      customSnippets.map((s) => s.builtinId).filter(Boolean)
    );
    const filteredBuiltins = MARKDOWN_INSERT_TEMPLATES.filter((it) => !seededBuiltins.has(it.id));
    return [...customSnippets, ...filteredBuiltins];
  }, [customSnippets]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter((it) => (
      it.label.toLowerCase().includes(needle)
      || it.section.toLowerCase().includes(needle)
      || (it.tip || '').toLowerCase().includes(needle)
    ));
  }, [q, allItems]);
  const grouped = useMemo(() => filtered.reduce((acc, it) => {
    (acc[it.section] = acc[it.section] || []).push(it);
    return acc;
  }, {}), [filtered]);
  // Section order: Custom first, then built-ins in the order they
  // first appear in CANVAS_ADD_ITEMS.
  const sectionOrder = useMemo(() => {
    const order = ['Custom'];
    for (const it of filtered) if (!order.includes(it.section)) order.push(it.section);
    return order.filter((s) => grouped[s]);
  }, [filtered, grouped]);

  return h`<aside
    ref=${ref}
    aria-hidden=${!open}
    style=${{ top: 'calc(var(--os-adminbar-h, 32px) + 56px)', right: 0, bottom: 0 }}
    className=${`fixed z-[1000] w-96 max-w-full bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${ open ? 'translate-x-0' : 'translate-x-full pointer-events-none' }`}
  >
    <div className="p-3 border-b border-border shrink-0 flex items-center gap-2 os-wpds-fields os-sidebar-search">
      <div className="flex-1 min-w-0">
        <${WPSearchControl}
          __nextHasNoMarginBottom
          size="compact"
          value=${q}
          onChange=${setQ}
          placeholder="Search snippets…"
        />
      </div>
      <${WPButton} size="small" icon=${iconClose} onClick=${onClose} label="Close inserter" showTooltip=${true} className="shrink-0" />
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      ${sectionOrder.length === 0
        ? h`<div className="px-3 py-6 text-center text-xs text-muted-foreground italic">No matches</div>`
        : h`<${WPPanel} className="os-insert-panel">
          ${sectionOrder.map((section) => {
            const isOpen = !!q.trim() || expanded.has(section);
            const rows = grouped[section] || [];
            return h`<${WPPanelBody}
              key=${section}
              opened=${isOpen}
              onToggle=${() => toggleSection(section)}
              title=${h`<span className="os-insert-sec"><span className="os-insert-sec-label">${section}</span><span className="os-insert-count">${rows.length}</span></span>`}
            >
              <${WPItemGroup}>
                ${rows.map((it) => h`<${WPItem}
                  key=${it.id}
                  onClick=${() => { onPick(it); }}
                  size="small"
                >
                  <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    ${it.label}
                    ${it.isCustom ? h`<span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-primary/15 text-primary">custom</span>` : null}
                  </div>
                  ${it.tip ? h`<div className="text-[11px] text-muted-foreground leading-snug mt-0.5">${it.tip}</div>` : null}
                </${WPItem}>`)}
              </${WPItemGroup}>
            </${WPPanelBody}>`;
          })}
        </${WPPanel}>`}
    </div>
  </aside>`;
}


// Block-mode CPTs (admin opted them into Gutenberg in Settings) don't
// have a CodeMirror editor inside CI — clicking + or an existing entry
// punts to wp-admin's post.php / post-new.php. Showing a spinner while
// the browser navigates avoids the blank-flash UX.
function BlockEditorRedirect({ meta, id, isNew }) {
  useEffect(() => {
    const target = isNew
      ? (meta.new_url || `/wp-admin/post-new.php?post_type=${meta.cpt}`)
      : (meta.edit_url ? meta.edit_url.replace('{id}', String(id)) : '/wp-admin/');
    window.location.href = target;
  }, []);
  return h`<div className="absolute inset-0 flex items-center justify-center"><${Spinner} /></div>`;
}

// Render a FontAwesome icon definition (the tree-shaken { prefix, iconName,
// icon: [w, h, _, _, path] } shape) as an inline SVG. Avoids pulling the
// @fortawesome/react-fontawesome wrapper for ~3KB of overhead we don't need.
function FaIcon({ icon, size = 16, className = '', title }) {
  if (!icon || !icon.icon) return null;
  const [w, h2, , , path] = icon.icon;
  return h`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox=${`0 0 ${w} ${h2}`}
    width=${size}
    height=${size}
    fill="currentColor"
    aria-hidden=${title ? 'false' : 'true'}
    role=${title ? 'img' : null}
    className=${className}
  >${title ? h`<title>${title}</title>` : null}<path d=${path} /></svg>`;
}

// Map a detected file language → FA icon + display label. Falls back to
// the generic <code> glyph for anything not in the table.
const LANG_ICON_MAP = {
  python:     { icon: faPython,   label: 'Python' },
  javascript: { icon: faJs,       label: 'JavaScript' },
  typescript: { icon: faJs,       label: 'TypeScript' },
  json:       { icon: faCode,     label: 'JSON' },
  yaml:       { icon: faFileCode, label: 'YAML' },
  bash:       { icon: faTerminal, label: 'Bash' },
  shell:      { icon: faTerminal, label: 'Shell' },
  php:        { icon: faPhp,      label: 'PHP' },
  csv:        { icon: faTable,    label: 'CSV' },
  plain:      { icon: faFileCode, label: 'Plain text' },
};
function langInfo(lang) {
  if (!lang) return null;
  return LANG_ICON_MAP[lang] || { icon: faCode, label: lang };
}

// ---------------------------------------------------------------------------
// Editor toolbar API (Slot/Fill).
//
// EditorHeader renders two placement Slots: one on the LEFT (after the
// inserter / history / editor switcher) and one on the RIGHT (just before the
// settings gear + Close). Any editor — in core or a companion plugin —
// contributes a toolbar button by rendering `CIRegistry.EditorToolbar.Item`
// (or a raw Fill) anywhere in its own tree; the button portals into the chosen
// Slot and inherits the header's Gutenberg-style toolbar styling.
//
// SlotFill is the same primitive Gutenberg uses for block-toolbar plugins, and
// it carries each editor's live state for free: a Fill is just a React element
// the editor renders, so its onClick / isActive close over the editor's own
// hooks. A flat id-keyed registry couldn't do that — it would register once at
// module load, with no handle on per-instance state.
// ---------------------------------------------------------------------------
// Guard the primitive: if an older wp.components lacks createSlotFill, degrade
// to no-op Slot/Fill so the editor still loads (the toolbar API just goes
// inert) rather than throwing at module evaluation and blanking the whole app.
const mkToolbarSlotFill = (name) => (typeof WPCreateSlotFill === 'function')
  ? WPCreateSlotFill(name)
  : { Slot: () => null, Fill: () => null };
const { Slot: ToolbarLeftSlot, Fill: ToolbarLeftFill } = mkToolbarSlotFill('CIEditorToolbarLeft');
const { Slot: ToolbarRightSlot, Fill: ToolbarRightFill } = mkToolbarSlotFill('CIEditorToolbarRight');
// Settings inspector slot — the right-hand panel (Gutenberg "Settings sidebar"
// model). Editors render their per-selection settings into `EditorSettings.Fill`
// and the header renders the matching Slot inside the existing settings aside,
// so a leaf editor (e.g. a companion's) gets a native inspector without owning the
// chrome. The gear + aside appear when an editor has contributed fills (or the
// legacy `settings` prop is passed).
const { Slot: SettingsSlot, Fill: SettingsFill } = mkToolbarSlotFill('CIEditorSettingsInspector');
const SETTINGS_SLOT_NAME = 'CIEditorSettingsInspector';

// Declarative toolbar contribution. The common case is an icon button (pass
// `icon` + `label`); pass `children` instead for custom content (a badge, a
// mode-toggle pair, …). `group` chooses the left or right zone (default right,
// alongside the chrome's own settings / Close actions).
function EditorToolbarItem({ group = 'right', icon, label, onClick, isActive = false, disabled = false, showTooltip = true, children }) {
  const Fill = group === 'left' ? ToolbarLeftFill : ToolbarRightFill;
  return h`<${Fill}>
    <${WPToolbarGroup}>
      <${WPToolbarButton}
        icon=${children != null ? undefined : icon}
        label=${label}
        onClick=${onClick}
        isActive=${isActive}
        disabled=${disabled}
        showTooltip=${showTooltip}
      >${children}</${WPToolbarButton}>
    </${WPToolbarGroup}>
  </${Fill}>`;
}

// Shared, prominent title input for editors that render the title IN their
// content flow (title-as-field) rather than in the fixed titlebar. Same look as
// the titlebar input (.os-editor-title), just placed as the first content
// element so it scrolls with the fields / body / table. Published on the
// registry as CIRegistry.EditorTitleField.
function EditorTitleField({ title, setTitle, placeholder, slug, className = '' }) {
  return h`<div className=${`os-editor-titlefield ${className}`.trim()}>
    <input
      value=${title}
      onChange=${(e) => setTitle(e.target.value)}
      placeholder=${placeholder}
      className="os-editor-title w-full min-w-0 font-semibold leading-tight bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground"
    />
    ${slug ? h`<span className="os-editor-slug block font-mono text-muted-foreground truncate" title=${slug}>${slug}</span>` : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// Shared page footer (CIRegistry.PageFooter).
//
// Every page (list, editor, manage, companions) ends with a quiet, gray,
// top-bordered footer under a small "Options" label, holding the secondary
// controls as plain text rows — no icons. Navigation rows (PageFooter.Link)
// get a trailing arrow; in-place toggles (PageFooter.Action) do not.
// ---------------------------------------------------------------------------
function PageFooter({ title = 'Options', children, className = '' }) {
  return h`<footer className=${`os-page-footer pt-4 border-t border-border space-y-2 ${className}`.trim()} style=${{ marginTop: '2.5rem' }}>
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">${title}</div>
    <div className="space-y-1.5 text-sm text-muted-foreground">${children}</div>
  </footer>`;
}
// Navigation row: goes to another screen, so it shows a trailing arrow.
PageFooter.Link = function PageFooterLink({ href, onClick, children }) {
  return h`<div><a
    href=${href || null}
    onClick=${onClick || null}
    className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
  >${children}<span aria-hidden="true"> →</span></a></div>`;
};
// In-place toggle / action: no arrow (it doesn't navigate). `disabled` dims it
// and blocks the click (e.g. an action that needs a saved record first).
PageFooter.Action = function PageFooterAction({ onClick, children, disabled = false }) {
  return h`<div><button
    type="button"
    onClick=${onClick}
    disabled=${disabled}
    style=${disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null}
    className="text-muted-foreground hover:text-foreground hover:underline"
  >${children}</button></div>`;
};

// Shared save-status indicator (CIRegistry.SaveStatus). Amber dot "Unsaved" /
// "Saving…" while busy; a green check "Saved" that fades out ~5s after a save
// completes, then nothing (a clean, idle page shows no status). Used by the
// editor header and the manage page so the behaviour is identical.
function SaveStatus({ dirty, isNew, saving, className = '' }) {
  const [recentlySaved, setRecentlySaved] = useState(false);
  const prevSaving = useRef(false);
  useEffect(() => {
    const wasSaving = prevSaving.current;
    prevSaving.current = saving;
    if (wasSaving && !saving && !dirty && !isNew) {
      setRecentlySaved(true);
      const t = setTimeout(() => setRecentlySaved(false), 5000);
      return () => clearTimeout(t);
    }
  }, [saving, dirty, isNew]);
  const busy = dirty || isNew || saving;
  const show = busy || recentlySaved;
  const text = saving ? 'Saving…' : (busy ? 'Unsaved' : 'Saved');
  return h`<span
    className=${`hidden md:inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${className}`.trim()}
    style=${{ color: busy ? '#b45309' : '#059669', opacity: show ? 1 : 0, transition: 'opacity 0.6s ease', pointerEvents: 'none' }}
    title=${text}
    aria-live="polite"
  >
    ${busy
      ? h`<span aria-hidden="true" style=${{ display: 'inline-block', width: 6, height: 6, borderRadius: 9999, background: '#d97706' }} />`
      : h`<${Icon} name="check" className="w-3.5 h-3.5" />`}
    ${text}
  </span>`;
}

function EditorHeader({ title, setTitle, placeholder, dirty, isNew, saving, onSave, onClose, editorMode, onSetEditorMode, fileLang, slug, canInsert, onInsertClick, onBack, onForward, actions, settings, onExport, saveLabel, hideTitlebar }) {
  const [showSettings, setShowSettings] = useState(false);
  // The settings inspector shows when an editor passed the legacy `settings`
  // render prop, or contributed fills into the EditorSettings slot (leaf
  // editors do the latter). `useSlotFills` re-renders the header
  // as fills register, so the gear appears the moment an editor opts in.
  const inspectorFills = WPUseSlotFills ? WPUseSlotFills(SETTINGS_SLOT_NAME) : null;
  const hasInspector = !!settings || (Array.isArray(inspectorFills) && inspectorFills.length > 0);
  // Editor switcher — a type may declare several editors (meta.editors); the
  // first opens by default and this lets you open the same item in any of the
  // others via the `?ed=` query (read by EditorPage). Only renders when the
  // type has more than one editor. Self-discovers from the route so every
  // editor that uses this shared header gets it for free.
  const { type: hdrType } = useParams();
  const [hdrSp, setHdrSp] = useSearchParams();
  const hdrMeta = typeMeta(hdrType);
  const hdrEditors = (hdrMeta && Array.isArray(hdrMeta.editors) && hdrMeta.editors.length > 1) ? hdrMeta.editors : null;
  const activeEditor = hdrEditors
    ? ((hdrSp.get('ed') && hdrEditors.includes(hdrSp.get('ed'))) ? hdrSp.get('ed') : (hdrMeta.editor || hdrEditors[0]))
    : null;
  const editorSwitcherOptions = hdrEditors
    ? hdrEditors.map((k) => { const c = editorChoices().find((o) => o.key === k); return { key: k, title: c ? c.title : k, description: c ? c.description : '' }; })
    : [];
  const setActiveEditor = (k) => { const next = new URLSearchParams(hdrSp); next.set('ed', k); setHdrSp(next); };
  // For non-markdown files (Python, CSV, JSON, etc.) the canvas view
  // doesn't apply — canvas is for prose flow, not code. Replace the
  // toggle with a single language badge so the user still sees what
  // kind of file they're editing.
  const lang = langInfo(fileLang);
  const showSlug = !!slug;
  // Insert (+) lives on the LEFT (Gutenberg block-inserter position); the
  // mode/preview toggle, Close, and Save sit on the RIGHT.
  const insertGroup = canInsert ? h`<${WPToolbarGroup}>
    <${WPToolbarButton} icon=${iconPlus} label="Insert a snippet" onClick=${onInsertClick} showTooltip=${true} />
  </${WPToolbarGroup}>` : null;
  let modeGroup = null;
  if (fileLang === 'csv' && onSetEditorMode) {
    modeGroup = h`<${WPToolbarGroup}>
      ${[
        { id: 'grid', label: 'Grid (table)', icon: h`<${FaIcon} icon=${faTable} size=${16} />` },
        { id: 'code', label: 'Code (raw CSV)', icon: h`<${FaIcon} icon=${faCode} size=${16} />` },
      ].map((m) => h`<${WPToolbarButton} key=${m.id} isActive=${editorMode === m.id} onClick=${() => onSetEditorMode(m.id)} label=${m.label} showTooltip=${true}>${m.icon}</${WPToolbarButton}>`)}
    </${WPToolbarGroup}>`;
  } else if (lang) {
    modeGroup = h`<${WPToolbarGroup}>
      <${WPToolbarButton} disabled=${true} label=${`Language: ${lang.label}`}>
        <span className="inline-flex items-center gap-1.5"><${FaIcon} icon=${lang.icon} size=${16} /><span className="text-xs font-medium hidden md:inline">${lang.label}</span></span>
      </${WPToolbarButton}>
    </${WPToolbarGroup}>`;
  }
  // The markdown/graph view toggle was removed: prose is the form editor now,
  // and CSV keeps its own grid/code toggle above. The CSV editor will move to
  // its own plugin later.
  // Gutenberg/UI-Playground-style chrome: icon toolbar (insert / history /
  // view) on the LEFT, a centred title "pill" in the MIDDLE, and status /
  // export / settings-gear / Close / Save on the RIGHT. `settings` (a render
  // slot) opens a right-hand panel via the gear (like UI Playground's SETTINGS).
  return h`<${Fragment}>
    <header
      className="os-editor-header fixed z-30 h-14 bg-card border-b border-border shadow-sm px-3 md:px-4 flex items-center gap-2"
      style=${{ top: 'var(--os-adminbar-h, 32px)', right: 0 }}
    >
      <${MobileMenuButton} />
      ${onClose ? h`<button
        type="button"
        onClick=${onClose}
        aria-label="Back"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
      ><span aria-hidden="true">←</span> ${hdrMeta?.label || 'Back'}</button>` : null}
      ${insertGroup ? h`<${CIToolbar} label="Insert">${insertGroup}</${CIToolbar}>` : null}
      ${onBack || onForward ? h`<${CIToolbar} label="History">
        <${WPToolbarGroup}>
          <${WPToolbarButton} icon=${iconChevronLeft} label="Back" onClick=${onBack} />
          <${WPToolbarButton} icon=${iconChevronRight} label="Forward" onClick=${onForward} />
        </${WPToolbarGroup}>
      </${CIToolbar}>` : null}
      ${(hdrEditors && SelectMenu) ? h`<div className="shrink-0 hidden md:flex items-center" style=${{ width: 200 }} title="Editor">
        <${SelectMenu} ariaLabel="Editor" options=${editorSwitcherOptions} value=${activeEditor} onChange=${setActiveEditor} />
      </div>` : null}

      ${/* Left toolbar zone — editor-contributed buttons portal in here. */''}
      <div className="os-editor-toolbar shrink-0 flex items-center">
        <${ToolbarLeftSlot} bubblesVirtually=${true} className="flex items-center" />
      </div>

      <div className="flex-1 min-w-0"></div>

      ${modeGroup ? h`<${CIToolbar} label="View">${modeGroup}</${CIToolbar}>` : null}

      <${SaveStatus} dirty=${dirty} isNew=${isNew} saving=${saving} />

      ${onExport ? h`<${Button} size="sm" variant="ghost" className="!px-3 !h-9 !border-0 !shadow-none" onClick=${onExport}>Export</${Button}>` : null}

      ${/* One cohesive Gutenberg-style icon group: editor-contributed buttons
          (right slot), then the legacy `actions` slot, the Settings gear, and
          Close-as-icon. Save stays a separate primary button (WP-native). */''}
      <div className="os-editor-toolbar shrink-0 flex items-center">
        <${ToolbarRightSlot} bubblesVirtually=${true} className="flex items-center" />
        ${actions ? h`<div className="os-editor-actions flex items-center">${actions}</div>` : null}
        ${hasInspector ? h`<${WPToolbarGroup}>
          <${WPToolbarButton} isActive=${showSettings} onClick=${() => setShowSettings((v) => !v)} label="Settings" showTooltip=${true}>
            <${Icon} name="sidebar-flip" className="w-4 h-4" />
          </${WPToolbarButton}>
        </${WPToolbarGroup}>` : null}
      </div>

      <${Button}
        size="sm"
        variant=${(dirty || isNew) ? 'primary' : 'ghost'}
        className="!px-4 !h-9 !border-0 !shadow-none"
        onClick=${onSave}
        disabled=${saving || (!dirty && !isNew)}
      >${saving ? h`<${Spinner} />` : (saveLabel || 'Save')}</${Button}>
    </header>
    ${hideTitlebar ? null : h`<div className="os-editor-titlebar shrink-0 bg-card border-b border-border">
      <input
        value=${title}
        onChange=${(e) => setTitle(e.target.value)}
        placeholder=${placeholder}
        className="os-editor-title w-full min-w-0 font-semibold leading-tight bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground"
      />
      ${showSlug ? h`<span className="os-editor-slug block font-mono text-muted-foreground truncate" title=${slug}>${slug}</span>` : null}
    </div>`}
    ${hasInspector && showSettings ? h`<aside
      className="os-editor-settings fixed bg-card border-l border-border shadow-2xl flex flex-col"
      style=${{ top: 'var(--os-adminbar-h, 32px)', right: 0, bottom: 0, width: '300px', maxWidth: '90vw', zIndex: 29 }}
    >
      <div className="h-14 px-4 flex items-center justify-between border-b border-border shrink-0">
        <span className="text-sm font-semibold">Settings</span>
        <button onClick=${() => setShowSettings(false)} aria-label="Close settings"
          className="text-muted-foreground hover:text-foreground text-xl leading-none w-7 h-7 flex items-center justify-center">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 os-wpds-fields">
        ${settings}
        <${SettingsSlot} bubblesVirtually=${true} />
      </div>
    </aside>` : null}
  </${Fragment}>`;
}

// App-page header — the same fixed top bar as EditorHeader, for non-editor
// destinations (Apps, Media, Files, …) that have no save/back-to-list. A static
// title on the left, the page's own actions on the right. Reuses the
// `os-editor-header` class so it inherits the sidebar-width left offset, and
// pairs with a `pt-14` content wrapper exactly like the editors.
function AppHeader({ title, icon, iconSvg, actions, onBack, backLabel }) {
  return h`<header
    className="os-editor-header fixed z-30 h-14 bg-card border-b border-border shadow-sm px-3 md:px-4 flex items-center gap-2"
    style=${{ top: 'var(--os-adminbar-h, 32px)', right: 0 }}
  >
    <${MobileMenuButton} />
    ${onBack ? h`<button type="button" onClick=${onBack} aria-label="Back"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
    ><span aria-hidden="true">←</span> ${backLabel || 'Back'}</button>` : null}
    ${(icon || iconSvg) ? h`<${CptIcon} icon=${icon} iconSvg=${iconSvg} fallback=${icon || 'folder'} className="w-5 h-5 text-muted-foreground shrink-0" />` : null}
    <span className="font-semibold text-foreground truncate">${title}</span>
    <div className="flex-1 min-w-0"></div>
    ${actions ? h`<div className="flex items-center gap-2 shrink-0">${actions}</div>` : null}
  </header>`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------


// Publish the shared editor chrome to the registry (every editor — cpt,
// wizard, code, csv — reads EditorHeader + MarkdownInsertPopover from here).
CIRegistry.EditorHeader = EditorHeader;
CIRegistry.AppHeader = AppHeader;
CIRegistry.MarkdownInsertPopover = MarkdownInsertPopover;
// Editor toolbar API — editors (core or companion) contribute header toolbar
// buttons via `CIRegistry.EditorToolbar.Item` (the common icon-button case) or
// the raw `LeftFill` / `RightFill` for custom content. See the Slot/Fill block
// above EditorHeader.
CIRegistry.EditorToolbar = { Item: EditorToolbarItem, LeftFill: ToolbarLeftFill, RightFill: ToolbarRightFill };
// Editor settings inspector API — editors render per-selection settings into
// `CIRegistry.EditorSettings.Fill`; the header shows the gear + right aside (the
// Slot) whenever any fills are present. The Gutenberg "Settings sidebar" model
// for leaf editors that don't own the chrome.
CIRegistry.EditorSettings = { Fill: SettingsFill, Slot: SettingsSlot };
// Title-as-field input + the shared page footer (Options group). Editors render
// the title in their content flow (with hideTitlebar on EditorHeader) and end
// the page with a PageFooter for secondary controls. See [[the footer block]].
CIRegistry.EditorTitleField = EditorTitleField;
CIRegistry.PageFooter = PageFooter;
CIRegistry.SaveStatus = SaveStatus;
// Block-mode CPTs redirect to the native wp-admin editor (BlockEditorRedirect
// lives here). Selectable as an editor choice.
registerEditor('block', ({ meta, id, isNew }) => h`<${BlockEditorRedirect} meta=${meta} id=${id} isNew=${isNew} />`, {
  selectable: true, title: 'Block editor (Gutenberg)', description: 'Native WordPress block editor (opens the post in wp-admin).',
});
