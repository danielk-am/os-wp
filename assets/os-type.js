/**
 * Context Type layer — the nav/list/editor spine (the largest module).
 *
 * The folder tree + drag-drop, the unified nav tree, DataViews list + ListView,
 * TypeLayout (shell chrome), NewFileButton, the Meta/Term editors, and the CPT
 * management surfaces (ContentTypesPage / StructureEditorPage / CptEditorPage +
 * the registration panels). Everything every typed route renders. It SETS the
 * shared chrome on the registry (TypeLayout / NewFileButton / MobileMenuButton /
 * starterTemplateFor) that the leaf-app editors consume, self-registers the
 * meta/term/cpt editors + the content-types/structure routes, and exports
 * ListView + EditorPage for the App router.
 *
 * No build step — native ES module; bare specifiers resolve via the importmap.
 */
import { createElement, cloneElement, Children, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } from 'react';
import { createPortal } from 'react-dom/client';
import { useParams, useNavigate, useLocation, useSearchParams, Link, Navigate } from 'react-router-dom';
import {
  Button as WPButton, Spinner as WPSpinner, Notice as WPNotice,
  Card as WPCard, CardBody as WPCardBody,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton,
  Dropdown as WPDropdown, ColorPalette as WPColorPalette, ColorIndicator as WPColorIndicator,
  TextControl as WPTextControl, TextareaControl as WPTextareaControl,
  FormTokenField as WPFormTokenField, RangeControl as WPRangeControl,
  CheckboxControl as WPCheckboxControl, ToggleControl as WPToggleControl, SearchControl as WPSearchControl,
  TreeGrid as WPTreeGrid, TreeGridRow as WPTreeGridRow, TreeGridCell as WPTreeGridCell,
  ItemGroup as WPItemGroup, Item as WPItem, MenuItem as WPMenuItem,
  TabPanel as WPTabPanel, SlotFillProvider as WPSlotFillProvider,
} from '@wordpress/components';
import { h, BOOT, REST_BASE, rest, restWithHeaders, restAllPages, decodeEntities, CIRegistry, registerEditor, registerRoute, editorChoices, typeKeys, typeMeta, typeKind, isTermType, isNativeReplace, treeKind, applyTemplate, listUrl, normalizeItem, buildParentTree, buildPathTree, rankSearch, dataViewsSearchFields } from 'os/core';
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, CI_ICONS, PICKABLE_ICONS, SelectCheckbox, CptIcon, SegmentedToggle, PageHeading, Toolbar as CIToolbar, SelectMenu } from 'os/ui';
import { useToast, useDialog } from 'os/shell';
import { GutenbergComposer, CodeEditor, useEditorFullWidth, fullWidthIcon, convertMarkdownToBlocks, looksConvertibleToBlocks, collectCanvasStyles, EDITOR_ICONS } from 'os/editors';
import { BlockEditorProvider, BlockTools, BlockCanvas, BlockInspector, InspectorControls, useBlockProps, BlockToolbar as WPBlockToolbar, InnerBlocks, ListView as WPListView, BlockLibrary } from '@wordpress/block-editor';
import { registerBlockType, createBlock, registerBlockVariation, unregisterBlockVariation } from '@wordpress/blocks';
import { useDispatch as useWPDispatch } from '@wordpress/data';
import { CI_BLUEPRINTS } from 'os/blueprints';
import { FG_FIELD_TYPES, FG_PRESENTATIONAL, FG_WIDTHS, fgCols, fgWithId, fgStrip, FG_COND_OPS, evalConditional, fgCptOptions, RelationshipField, TaxonomyField } from 'os/engine';
import { DataViews as WPDataViews, filterSortAndPaginate } from '@wordpress/dataviews';

// Editors a CUSTOM content type may use (mirrors the server whitelist in
// OS_Settings::rest_add_cpt). The full editor registry also
// includes built-in-only editors (code, reminder, …) that the
// server drops for custom CPTs, so the picker only offers these generic ones.
const CPT_EDITOR_KEYS = ['markdown', 'block', 'cpt', 'wizard'];
const cptEditorChoices = () => editorChoices().filter((o) => CPT_EDITOR_KEYS.includes(o.key));
// Render the selected editors as chips, first marked as the default. Surfaces a
// multi-editor selection clearly below the picker.
function EditorChips({ keys }) {
  const list = Array.isArray(keys) ? keys.filter((k) => CPT_EDITOR_KEYS.includes(k)) : [];
  if (!list.length) return null;
  return h`<div className="flex flex-wrap items-center gap-1.5 mt-2">
    ${list.map((k, i) => {
      const title = (editorChoices().find((o) => o.key === k) || {}).title || k;
      return h`<span key=${k} className=${`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${i === 0 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
        ${title}${i === 0 ? h`<span className="opacity-70">· default</span>` : null}
      </span>`;
    })}
  </div>`;
}

// Visually-hidden inline style (no dependency on a compiled `.sr-only`
// utility) for accessible-but-unseen control labels.
const SR_ONLY = { position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

// Chrome glyphs (FA-backed Icon elements).
const iconPlus = h`<${Icon} name="plus" />`;
const iconUndo = h`<${Icon} name="undo" />`;
const iconRedo = h`<${Icon} name="redo" />`;
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

function SettingsCustomCpts({ data, reload, toast, dialog }) {
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [plural, setPlural] = useState('');
  const [hierarchical, setHierarchical] = useState(false);
  const [editors, setEditors] = useState(['cpt']);
  const [busy, setBusy] = useState(false);
  const cpts = data.custom_cpts || [];
  const editorOpts = cptEditorChoices();
  const add = async (e) => {
    e?.preventDefault?.();
    if (!slug.trim() || !label.trim()) { toast.error('Need both slug and label'); return; }
    setBusy(true);
    try {
      await rest('/activity/v1/settings/custom-cpts', {
        method: 'POST',
        body: JSON.stringify({ slug: slug.trim(), label: label.trim(), plural: plural.trim(), hierarchical, editors, editor: editors[0], editor_mode: (editors[0] === 'block' ? 'block' : 'md') }),
      });
      toast.success(`Registered ci_${ slug.trim().replace(/^ci_/, '') }`);
      setSlug(''); setLabel(''); setPlural(''); setHierarchical(false); setEditors(['cpt']);
      await reload();
    } catch (e) { toast.error('Add failed', e.message); }
    finally { setBusy(false); }
  };
  const remove = async (cptSlug) => {
    const ok = await dialog.confirm(
      `Unregister ${ cptSlug }?`,
      'Existing posts of this type stay in the database but the CPT stops registering on the next page load. Re-add it later to bring them back. This does not delete any posts.',
      { confirmLabel: 'Unregister', danger: true }
    );
    if (!ok) return;
    try {
      await rest(`/activity/v1/settings/custom-cpts?slug=${ encodeURIComponent( cptSlug ) }`, { method: 'DELETE' });
      toast.success(`Unregistered ${ cptSlug }`);
      await reload();
    } catch (e) { toast.error('Remove failed', e.message); }
  };
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom post types</h2>
    <${Card} className="p-5 space-y-4">
      <p className="text-sm text-muted-foreground">
        Built-in: <code className="font-mono bg-muted px-1 rounded">os_skill</code>, <code className="font-mono bg-muted px-1 rounded">os_wiki</code>.
        Add more for journals, recipes, meetings, etc. Each gets its own list view, editor, REST endpoints, and the same <code className="font-mono bg-muted px-1 rounded">${'os/<type>-*'}</code> MCP tools.
      </p>
      ${cpts.length === 0
        ? h`<div className="text-sm text-muted-foreground italic">No custom CPTs registered yet.</div>`
        : h`<ul className="divide-y divide-border border border-border rounded">
            ${cpts.map((c) => h`<li key=${c.slug} className="flex items-center gap-3 px-3 py-2 text-sm">
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${c.slug}</code>
              <span className="text-foreground">${c.label}</span>
              <span className="text-xs text-muted-foreground">${c.plural || (c.label + 's')}</span>
              ${c.hierarchical ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">hierarchical</span>` : null}
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">${(c.editor_mode || 'md') === 'block' ? 'Block editor' : 'Markdown'}</span>
              <button type="button" onClick=${() => remove(c.slug)} className="ml-auto text-xs text-muted-foreground hover:text-red-600">Unregister</button>
            </li>`)}
          </ul>`}
      <form onSubmit=${add} className="space-y-4 pt-4 border-t border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <${WPTextControl} label="Slug" value=${slug} onChange=${setSlug} placeholder="journal" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
          <${WPTextControl} label="Singular label" value=${label} onChange=${setLabel} placeholder="Journal entry" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
          <${WPTextControl} label="Plural label" value=${plural} onChange=${setPlural} placeholder="Journal entries" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Editor</label>
          <${SelectMenu} ariaLabel="Editor" multiple options=${editorOpts} value=${editors} onChange=${setEditors} />
          <${EditorChips} keys=${editors} />
          <p className="text-xs text-muted-foreground">${editorOpts.find((o) => o.key === editors[0])?.description || 'How posts of this type are edited. Editors are pluggable — each registers itself, so this list grows as apps are added.'} ${editors.length > 1 ? 'The first is the default; switch per item from the editor header.' : ''}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <${WPCheckboxControl}
            __nextHasNoMarginBottom=${true}
            label="Hierarchical (allow parent/child nesting)"
            checked=${hierarchical}
            onChange=${setHierarchical}
          />
          <button
            type="submit"
            disabled=${busy}
            className="h-9 px-5 rounded-md border border-primary bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >Register CPT</button>
        </div>
        <p className="text-xs text-muted-foreground">
          becomes <code className="font-mono bg-muted px-1 rounded">ci_${ slug.replace(/^ci_/, '') || 'name' }</code> — appears under Context in the sidebar and the CI tree once registered.
        </p>
      </form>
    </${Card}>
  </section>`;
}

// Adopt third-party CPTs (registered by other plugins/themes) into the
// Context editor. Opt-in per CPT; once managed, the type appears in the
// Context sidebar and opens in the generic fields+taxonomy editor. Its
// fields can be relabelled/reordered via the Schemas editor below.
// Reusable FA-icon picker — a WPDS Dropdown whose content is a grid of the
// PICKABLE_ICONS palette. Used for per-CPT sidebar icons (Settings → Content
// types) and available for any future "pick an icon" surface.
// Client-side preview of a path-structure template (the server does the real
// resolution in class-path-template.php). Mirrors its Obsidian moment-format
// tokens: {{date:FMT}}, {{slug}}, {{title}}, {{type}}.
const _PT_ML = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _PT_MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _PT_DL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _PT_DS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function resolvePathPreview(tpl, ctx = {}) {
  const slug = ctx.slug || 'my-entry';
  const t = String(tpl || '').trim();
  if (!t) return slug; // flat → entry sits at the root
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const map = {
    YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(-2),
    MMMM: _PT_ML[d.getMonth()], MMM: _PT_MS[d.getMonth()], MM: p2(d.getMonth() + 1), M: String(d.getMonth() + 1),
    DD: p2(d.getDate()), D: String(d.getDate()),
    dddd: _PT_DL[d.getDay()], ddd: _PT_DS[d.getDay()],
    HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()),
  };
  let out = t.replace(/\{\{\s*date:([^}]+?)\s*\}\}/g, (_m, fmt) =>
    fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/g, (tok) => map[tok]));
  out = out.replace(/\{\{\s*slug\s*\}\}/gi, slug).replace(/\{\{\s*title\s*\}\}/gi, slug).replace(/\{\{\s*type\s*\}\}/gi, ctx.type || 'type');
  out = out.split('/').map((s) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/');
  if (!/\{\{\s*slug\s*\}\}/i.test(t)) out = (out ? out + '/' : '') + slug;
  return out;
}

// The "New-entry path" (permalink-like) control on the CPT General tab.
function PathStructureField({ value, onChange }) {
  const presets = [
    { label: 'Flat (root)', tpl: '' },
    { label: 'Year', tpl: '{{date:YYYY}}/{{slug}}' },
    { label: 'Year / Month', tpl: '{{date:YYYY/MM}}/{{slug}}' },
    { label: 'Year / Month / Day', tpl: '{{date:YYYY/MM/DD}}/{{slug}}' },
  ];
  const example = resolvePathPreview(value, { slug: 'my-entry', type: 'entry' });
  return h`<div className="space-y-2">
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">New-entry path</label>
    <div className="flex flex-wrap gap-1.5">
      ${presets.map((p) => h`<button
        key=${p.label}
        type="button"
        onClick=${() => onChange(p.tpl)}
        className=${'px-2 h-7 text-xs rounded border ' + ((value || '') === p.tpl ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-foreground hover:bg-muted')}
      >${p.label}</button>`)}
    </div>
    <${WPTextControl}
      value=${value || ''}
      onChange=${onChange}
      placeholder="{{date:YYYY/MM/DD}}/{{slug}}"
      spellCheck=${false}
      __nextHasNoMarginBottom=${true}
      __next40pxDefaultSize=${true}
    />
    <p className="text-xs text-muted-foreground">New entries land at <code className="font-mono bg-muted px-1 rounded">${example || '(root)'}</code>. Tokens: <code className="font-mono">{{date:YYYY/MM/DD}}</code> (moment-format), <code className="font-mono">{{slug}}</code>, <code className="font-mono">{{title}}</code>, <code className="font-mono">{{type}}</code>. Applies to new entries; existing ones aren't moved.</p>
  </div>`;
}

// Subsequence fuzzy match: every char of the query appears, in order, in name.
function iconFuzzy(name, query) {
  if (!query) return true;
  const n = name.toLowerCase();
  let i = 0;
  for (const ch of query.toLowerCase()) {
    i = n.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

// IconPicker — choose a content-type icon. Two modes:
//   • FontAwesome — searchable (fuzzy) grid of curated FA glyphs.
//   • Custom SVG  — paste markup or upload a .svg; live preview; auto-rendered.
// onChange(iconName, iconSvg) always sends the complete pair so switching
// modes clears the other (render prefers iconSvg). iconSvg is sanitised
// server-side before storage.
function IconPicker({ value, valueSvg, onChange, disabled }) {
  const current = value && CI_ICONS[value] ? value : 'folder';
  // Only show names that actually resolve to a glyph (guards against drift
  // between PICKABLE_ICONS and the loaded FA set).
  const allIcons = useMemo(() => PICKABLE_ICONS.filter((n) => CI_ICONS[n]), []);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState(valueSvg ? 'svg' : 'fa');
  const [svgDraft, setSvgDraft] = useState(valueSvg || '');
  const fileRef = useRef(null);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setSvgDraft(String(r.result || '').trim());
    r.readAsText(f);
    e.target.value = '';
  };

  const tabBtn = (key, label) => h`<button
    type="button"
    onClick=${() => setMode(key)}
    className=${'flex-1 h-7 text-xs rounded ' + (mode === key ? 'bg-card font-medium border border-border text-foreground' : 'text-muted-foreground')}
  >${label}</button>`;

  return h`<${WPDropdown}
    popoverProps=${{ placement: 'bottom-start' }}
    onClose=${() => setQ('')}
    renderToggle=${({ isOpen, onToggle }) => h`<button
      type="button"
      disabled=${disabled}
      onClick=${onToggle}
      aria-expanded=${isOpen}
      aria-label="Choose icon"
      className=${'inline-flex items-center gap-1.5 h-8 px-2 rounded border border-border bg-card ' + (disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted')}
    >
      <${CptIcon} icon=${current} iconSvg=${valueSvg} className="w-4 h-4 text-foreground" />
      <${Icon} name="chevron-down" className="w-3 h-3 text-muted-foreground" />
    </button>`}
    renderContent=${({ onClose }) => h`<div className="p-2" style=${{ width: '20rem' }}>
      <div className="flex gap-1 mb-2 p-0.5 rounded bg-muted">
        ${tabBtn('fa', 'FontAwesome')}
        ${tabBtn('svg', 'Custom SVG')}
      </div>
      ${mode === 'fa'
        ? (() => {
            const matches = allIcons.filter((n) => iconFuzzy(n, q));
            return h`<${Fragment}>
              <${WPSearchControl}
                __nextHasNoMarginBottom=${true}
                value=${q}
                onChange=${setQ}
                placeholder="Search icons…"
              />
              <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px', maxHeight: '14rem', overflowY: 'auto' }}>
                ${matches.length === 0
                  ? h`<div className="text-xs text-muted-foreground py-3 text-center" style=${{ gridColumn: '1 / -1' }}>No icons match “${q}”.</div>`
                  : matches.map((name) => h`<button
                      key=${name}
                      type="button"
                      title=${name}
                      onClick=${() => { onChange(name, ''); onClose(); }}
                      className=${'inline-flex items-center justify-center rounded hover:bg-muted ' + (value === name && !valueSvg ? 'bg-accent text-accent-foreground ring-1 ring-ring' : 'text-foreground')}
                      style=${{ width: '2rem', height: '2rem' }}
                    ><${Icon} name=${name} className="w-4 h-4" /></button>`)}
              </div>
            </${Fragment}>`;
          })()
        : h`<div className="space-y-2">
            <p className="text-xs text-muted-foreground">Paste SVG markup or upload a <code className="font-mono">.svg</code>. Scripts and unsafe attributes are stripped on save.</p>
            <${WPTextareaControl}
              value=${svgDraft}
              onChange=${setSvgDraft}
              rows=${5}
              spellCheck=${false}
              placeholder=${'<svg viewBox="0 0 24 24">…</svg>'}
              __nextHasNoMarginBottom=${true}
            />
            <div className="flex items-center gap-2">
              ${svgDraft.trim()
                ? h`<span className="os-cpt-svg rounded border border-border text-foreground" style=${{ width: '2rem', height: '2rem' }} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: svgDraft }} />`
                : h`<span className="inline-flex items-center justify-center rounded border border-border" style=${{ width: '2rem', height: '2rem' }}><span className="text-[9px] text-muted-foreground">prev</span></span>`}
              <input ref=${fileRef} type="file" accept=".svg,image/svg+xml" style=${{ display: 'none' }} onChange=${onFile} />
              <${Button} variant="secondary" size="sm" onClick=${() => fileRef.current && fileRef.current.click()}>Upload .svg</${Button}>
              <div className="ml-auto flex items-center gap-2">
                ${svgDraft ? h`<button type="button" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2" onClick=${() => setSvgDraft('')}>Clear</button>` : null}
                <${Button} variant="primary" size="sm" disabled=${!svgDraft.trim()} onClick=${() => { onChange('', svgDraft.trim()); onClose(); }}>Use SVG</${Button}>
              </div>
            </div>
          </div>`}
    </div>`}
  />`;
}

// Image field control: stores a WordPress attachment ID, uploads straight to
// /wp/v2/media (same path as the Media app), and shows a thumbnail. `value` is
// the attachment id (0 = none); `onChange(id)` reports the new id.
function FieldImage({ field, value, onChange }) {
  const id = Number(value) || 0;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  // Resolve the thumbnail for an existing attachment.
  useEffect(() => {
    if (!id) { setUrl(''); return undefined; }
    let alive = true;
    (async () => {
      try {
        const m = await rest(`/wp/v2/media/${id}?_fields=source_url,media_details`);
        if (!alive) return;
        const sizes = (m && m.media_details && m.media_details.sizes) || {};
        setUrl((sizes.thumbnail && sizes.thumbnail.source_url) || (sizes.medium && sizes.medium.source_url) || m.source_url || '');
      } catch { if (alive) setUrl(''); }
    })();
    return () => { alive = false; };
  }, [id]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      // FormData lets the browser set the multipart boundary — don't set
      // Content-Type manually. Mirrors the Media app's upload.
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name);
      const res = await fetch(`${REST_BASE}/wp/v2/media`, { method: 'POST', headers: { 'X-WP-Nonce': BOOT.nonce, Accept: 'application/json' }, credentials: 'include', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      const sizes = (created && created.media_details && created.media_details.sizes) || {};
      setUrl((sizes.thumbnail && sizes.thumbnail.source_url) || created.source_url || '');
      onChange(created.id);
    } catch (e) { console.error('[core-index] image upload failed:', e); }
    finally { setBusy(false); }
  };

  return h`<div className="os-wpds-fields space-y-2">
    ${field.label ? h`<label className="block text-[11px] font-medium text-muted-foreground">${field.label}</label>` : null}
    <div className="flex items-center gap-3">
      ${id && url
        ? h`<img src=${url} alt="" className="w-16 h-16 rounded border border-border object-cover bg-muted" />`
        : h`<div className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><${Icon} name="image" className="w-5 h-5" /></div>`}
      <div className="flex items-center gap-2">
        <${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => fileRef.current && fileRef.current.click()}>${busy ? 'Uploading…' : (id ? 'Replace' : 'Upload image')}</${Button}>
        ${id ? h`<button type="button" className="text-xs text-muted-foreground hover:text-red-600" onClick=${() => { onChange(0); setUrl(''); }}>Remove</button>` : null}
      </div>
      <input ref=${fileRef} type="file" accept="image/*" style=${{ display: 'none' }} onChange=${(e) => { upload(e.target.files && e.target.files[0]); e.target.value = ''; }} />
    </div>
    ${field.description ? h`<p className="text-xs text-muted-foreground">${field.description}</p>` : null}
  </div>`;
}

// Human label for a CPT owner descriptor from the server.
function cptOwnerLabel(o) {
  if (!o || !o.type || o.type === 'unknown') return null;
  if (o.type === 'core') return 'WordPress core';
  if (o.type === 'theme') return `${o.name} (theme)`;
  if (o.type === 'mu-plugin') return `${o.name} (mu-plugin)`;
  return o.name; // plugin
}

function SettingsAdoptedCpts({ data, reload, toast, dialog }) {
  const candidates = data.cpt_candidates || [];
  const adopted = data.adopted_cpts || {};
  const orphans = data.cpt_orphans || [];
  const [busy, setBusy] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);

  const setAdopt = async (slug, patch) => {
    const cur = adopted[slug] || {};
    const next = {
      slug,
      managed: patch.managed !== undefined ? patch.managed : !!cur.managed,
      hide_menu: patch.hide_menu !== undefined ? patch.hide_menu : !!cur.hide_menu,
      ignored: patch.ignored !== undefined ? patch.ignored : !!cur.ignored,
      icon: patch.icon !== undefined ? patch.icon : (cur.icon || ''),
      icon_svg: patch.icon_svg !== undefined ? patch.icon_svg : (cur.icon_svg || ''),
      placement: patch.placement !== undefined ? patch.placement : (cur.placement || 'unified'),
    };
    setBusy(slug);
    try {
      if (!next.managed && !next.hide_menu && !next.ignored) {
        // Nothing flagged → DELETE so the option stays tidy.
        await rest(`/activity/v1/settings/adopted-cpts?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      } else {
        await rest('/activity/v1/settings/adopted-cpts', { method: 'POST', body: JSON.stringify(next) });
      }
      await reload();
      // Icon + placement live in the server-rendered BOOT.types, so the
      // sidebar only reflects them after a full page load.
      if (patch.icon !== undefined || patch.placement !== undefined) {
        toast.success('Saved', 'Reload the page to update the sidebar.');
      }
    } catch (e) { toast.error('Update failed', e.message); }
    finally { setBusy(''); }
  };

  const deregister = async (o) => {
    const ok = await dialog.confirm(
      `Deregister "${o.slug}"?`,
      `This post type isn't registered by any active plugin or theme, but ${o.count} ${o.count === 1 ? 'post is' : 'posts are'} still in the database. They'll be moved to Trash (recoverable). Continue?`,
      { confirmLabel: `Trash ${o.count} ${o.count === 1 ? 'post' : 'posts'}`, danger: true }
    );
    if (!ok) return;
    setBusy(o.slug);
    try {
      const res = await rest('/activity/v1/settings/deregister-cpt', { method: 'POST', body: JSON.stringify({ slug: o.slug }) });
      toast.success('Deregistered', `Moved ${res.trashed} ${res.trashed === 1 ? 'post' : 'posts'} to Trash.`);
      await reload();
    } catch (e) { toast.error('Deregister failed', e.message); }
    finally { setBusy(''); }
  };

  // Triage partition.
  const managedList = candidates.filter((c) => !!(adopted[c.slug] || {}).managed);
  const ignoredList = candidates.filter((c) => { const cfg = adopted[c.slug] || {}; return !cfg.managed && !!cfg.ignored; });
  const availableList = candidates.filter((c) => { const cfg = adopted[c.slug] || {}; return !cfg.managed && !cfg.ignored; });

  const ownerBadge = (c) => {
    const label = cptOwnerLabel(c.owner);
    return label ? h`<span className="text-xs text-muted-foreground">by ${label}</span>` : null;
  };
  const rowHead = (c) => h`<${Fragment}>
    <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${c.slug}</code>
    <span className="text-foreground font-medium">${c.label}</span>
    ${ownerBadge(c)}
    ${c.taxonomies?.length ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">${c.taxonomies.length} ${c.taxonomies.length === 1 ? 'taxonomy' : 'taxonomies'}</span>` : null}
    ${c.rest_editable ? null : h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground" title="Not REST-editable">no REST</span>`}
  </${Fragment}>`;

  // --- Available: untriaged types — import (Manage) or Ignore. ---
  const renderAvailable = () => h`<div className="space-y-3">
    ${availableList.length === 0
      ? h`<div className="text-sm text-muted-foreground italic px-1 py-2">Nothing left to triage — every detected type is managed or ignored.</div>`
      : h`<ul className="divide-y divide-border border border-border rounded">
          ${availableList.map((c) => {
            const isBusy = busy === c.slug;
            return h`<li key=${c.slug} className="flex items-center gap-3 px-3 py-2.5 text-sm flex-wrap">
              ${rowHead(c)}
              <div className="ml-auto flex items-center gap-3">
                <${Button} variant="secondary" size="small" disabled=${!c.rest_editable || isBusy} onClick=${() => setAdopt(c.slug, { managed: true })}>Manage in Context</${Button}>
                <button type="button" disabled=${isBusy} onClick=${() => setAdopt(c.slug, { ignored: true })} className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Ignore</button>
              </div>
              ${c.rest_editable ? null : h`<div className="w-full text-xs text-muted-foreground">Not REST-enabled — ask the registering plugin to set <code className="font-mono bg-muted px-1 rounded">show_in_rest</code> before it can be edited in Context.</div>`}
            </li>`;
          })}
        </ul>`}
    ${ignoredList.length > 0 ? h`<div className="text-xs text-muted-foreground">
      ${ignoredList.length} ignored ·
      <button type="button" className="underline underline-offset-2 hover:text-foreground ml-1" onClick=${() => setShowIgnored((v) => !v)}>${showIgnored ? 'hide' : 'show'}</button>
      ${showIgnored ? h`<ul className="mt-2 divide-y divide-border border border-border rounded">
        ${ignoredList.map((c) => h`<li key=${c.slug} className="flex items-center gap-3 px-3 py-2 text-sm flex-wrap">
          ${rowHead(c)}
          <button type="button" disabled=${busy === c.slug} onClick=${() => setAdopt(c.slug, { ignored: false })} className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Restore</button>
        </li>`)}
      </ul>` : null}
    </div>` : null}
  </div>`;

  // --- Managed: full controls (hide menu, icon, sidebar placement). ---
  const renderManaged = () => (managedList.length === 0
    ? h`<div className="text-sm text-muted-foreground italic px-1 py-2">No post types are managed in Context yet. Import one from the <strong>Available</strong> tab.</div>`
    : h`<ul className="divide-y divide-border border border-border rounded">
        ${managedList.map((c) => {
          const cfg = adopted[c.slug] || {};
          const isBusy = busy === c.slug;
          return h`<li key=${c.slug} className="flex items-center gap-3 px-3 py-2.5 text-sm flex-wrap">
            ${rowHead(c)}
            <div className="ml-auto flex items-center gap-4">
              <${WPCheckboxControl}
                __nextHasNoMarginBottom=${true}
                label="Hide wp-admin menu"
                disabled=${isBusy}
                checked=${!!cfg.hide_menu}
                onChange=${(v) => setAdopt(c.slug, { hide_menu: v })}
              />
              <button type="button" disabled=${isBusy} onClick=${() => setAdopt(c.slug, { managed: false })} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Stop managing</button>
            </div>
            <div className="w-full flex items-center gap-5 flex-wrap pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <span className="uppercase tracking-wider">Icon</span>
                <${IconPicker} value=${cfg.icon} valueSvg=${cfg.icon_svg} disabled=${isBusy} onChange=${(name, svg) => setAdopt(c.slug, { icon: name, icon_svg: svg })} />
              </label>
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <span className="uppercase tracking-wider">Sidebar</span>
                <${SelectMenu}
                  label="Sidebar placement"
                  hideLabelFromVision=${true}
                  disabled=${isBusy}
                  value=${cfg.placement || 'unified'}
                  onChange=${(v) => setAdopt(c.slug, { placement: v })}
                  options=${cptPlacementOptions(c.slug).map((o) => ({ label: o.label, value: o.value }))}
                  __nextHasNoMarginBottom=${true}
                />
              </div>
            </div>
          </li>`;
        })}
      </ul>`);

  // --- Orphaned: DB rows with no active registrant — trash to clean up. ---
  const renderOrphaned = () => h`<div className="space-y-3">
    <p className="text-sm text-muted-foreground">Post types with data in the database that no active plugin or theme registers anymore — usually left behind by a deactivated/deleted plugin. Deregistering moves their posts to Trash (recoverable).</p>
    ${orphans.length === 0
      ? h`<div className="text-sm text-muted-foreground italic px-1 py-2">No orphaned post types — nothing to clean up. 🎉</div>`
      : h`<ul className="divide-y divide-border border border-border rounded">
          ${orphans.map((o) => {
            const isBusy = busy === o.slug;
            return h`<li key=${o.slug} className="flex items-center gap-3 px-3 py-2.5 text-sm flex-wrap">
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${o.slug}</code>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">no active registrant</span>
              <span className="text-xs text-muted-foreground">${o.count} ${o.count === 1 ? 'post' : 'posts'} in DB</span>
              <${Button} variant="secondary" size="small" isDestructive=${true} disabled=${isBusy} onClick=${() => deregister(o)} className="ml-auto">Deregister…</${Button}>
            </li>`;
          })}
        </ul>`}
  </div>`;

  const tabs = [
    { name: 'available', title: `Available${availableList.length ? ` (${availableList.length})` : ''}` },
    { name: 'managed', title: `Managed${managedList.length ? ` (${managedList.length})` : ''}` },
    { name: 'orphaned', title: `Orphaned${orphans.length ? ` (${orphans.length})` : ''}` },
  ];

  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Existing post types</h2>
    <${Card} className="p-5 space-y-4">
      <p className="text-sm text-muted-foreground">
        Post types registered by other plugins or your theme. <span className="font-medium text-foreground">Manage in Context</span> imports one for editing here with auto-generated fields + taxonomy pickers (relabel or reorder its fields in <span className="font-medium text-foreground">Schemas</span> below). <span className="font-medium text-foreground">Ignore</span> the ones you don't care about so they stop showing up.
      </p>
      ${candidates.length === 0 && orphans.length === 0
        ? h`<div className="text-sm text-muted-foreground italic">No third-party post types detected.</div>`
        : h`<${WPTabPanel} tabs=${tabs} className="os-cpt-tabs">
            ${(tab) => (tab.name === 'managed' ? renderManaged() : tab.name === 'orphaned' ? renderOrphaned() : renderAvailable())}
          </${WPTabPanel}>`}
    </${Card}>
  </section>`;
}

// Per-CPT JSON Schema editor, rendered on each type's Schema tab (the global
// Content Types → Schemas tab it once lived on is retired). Surfaces
// inc/schemas/<cpt>.schema.json as read-only context and lets admins POST a
// per-site override stored in the ci_schema_overrides option. Empty/blank
// textarea + Reset = fall back to the file schema; non-empty + Save =
// override active.
function SettingsSchemaOne({ cpt, fileSchema, effectiveSchema, override, reload, toast, dialog }) {
  const [value, setValue] = useState(override);
  const [busy, setBusy] = useState(false);
  const [showFile, setShowFile] = useState(false);
  // Sync local state if the underlying override changes (e.g. after a
  // sibling save reloads parent state).
  useEffect(() => { setValue(override); }, [override]);

  const hasOverride = (override || '').trim() !== '';
  const dirty = value.trim() !== (override || '').trim();
  const filePretty = fileSchema ? JSON.stringify(fileSchema, null, 2) : '(no file schema)';

  const save = async () => {
    if (!value.trim()) {
      toast.error('Cannot save', 'Override is empty — use Reset to fall back to the file schema.');
      return;
    }
    try { JSON.parse(value); }
    catch (e) { toast.error('Invalid JSON', e.message); return; }
    setBusy(true);
    try {
      await rest('/activity/v1/settings/schema-override', {
        method: 'POST',
        body: JSON.stringify({ cpt, json: value }),
      });
      toast.success(`Override saved for ${cpt}`);
      await reload();
    } catch (e) {
      toast.error('Save failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (hasOverride) {
      const ok = await dialog.confirm(
        `Clear override for ${cpt}?`,
        'The CPT will fall back to the plugin\'s file schema on the next read.',
        { confirmLabel: 'Clear override' }
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await rest(`/activity/v1/settings/schema-override?cpt=${encodeURIComponent(cpt)}`, { method: 'DELETE' });
      toast.success(`Override cleared for ${cpt}`);
      await reload();
    } catch (e) {
      toast.error('Reset failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = () => {
    setValue(filePretty);
  };

  return h`<div className="border border-border rounded-md overflow-hidden">
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
      <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${cpt}</code>
      ${hasOverride
        ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">override active</span>`
        : h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">file schema</span>`}
      <span className="text-xs text-muted-foreground ml-auto">
        ${effectiveSchema?.title || ''}
      </span>
    </div>
    <textarea
      value=${value}
      onChange=${(e) => setValue(e.target.value)}
      placeholder=${'{ "type": "object", "required": [...], "properties": {...} }'}
      spellCheck=${false}
      className="block w-full h-48 px-3 py-2 font-mono text-xs bg-card border-0 outline-none resize-y"
    />
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border bg-muted/20">
      <${Button} variant="ghost" disabled=${busy || !dirty} onClick=${save} className="!h-8 !text-xs">${hasOverride ? 'Update' : 'Save'} override</${Button}>
      <${Button} variant="ghost" disabled=${busy || !hasOverride} onClick=${reset} className="!h-8 !text-xs">Reset to file</${Button}>
      <${Button} variant="ghost" disabled=${busy} onClick=${loadFile} className="!h-8 !text-xs">Load file into editor</${Button}>
      <button type="button" onClick=${() => setShowFile(!showFile)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
        ${showFile ? 'Hide' : 'Show'} file schema
      </button>
    </div>
    ${showFile ? h`<pre className="px-3 py-2 text-[11px] font-mono bg-muted/40 border-t border-border max-h-64 overflow-auto">${filePretty}</pre>` : null}
  </div>`;
}


// Per-CPT AGENTS.md (agent orientation) editor, rendered on each type's
// AGENTS.md tab. The file doc ships with the type at
// inc/schemas/<cpt>.agents.md (read-only context); admins POST a per-site
// override stored in the ci_agents_overrides option. Empty + Reset = fall
// back to the file doc; non-empty + Save = override active. Mirrors
// SettingsSchemaOne, but freeform markdown (no JSON gate).
function SettingsAgentsOne({ cpt, fileDoc, override, reload, toast, dialog }) {
  const [value, setValue] = useState(override);
  const [busy, setBusy] = useState(false);
  const [showFile, setShowFile] = useState(false);
  // Sync local state if the underlying override changes (e.g. after a save
  // reloads parent state).
  useEffect(() => { setValue(override); }, [override]);

  const hasOverride = (override || '').trim() !== '';

  const save = async () => {
    if (!value.trim()) {
      toast.error('Cannot save', 'Doc is empty — use Reset to fall back to the file doc.');
      return;
    }
    setBusy(true);
    try {
      await rest('/activity/v1/settings/agents-override', {
        method: 'POST',
        body: JSON.stringify({ cpt, md: value }),
      });
      toast.success(`Orientation saved for ${cpt}`);
      await reload();
    } catch (e) {
      toast.error('Save failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (hasOverride) {
      const ok = await dialog.confirm(
        `Clear orientation override for ${cpt}?`,
        'The type falls back to the doc shipped with the plugin (if any) on the next read.',
        { confirmLabel: 'Clear override' }
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await rest(`/activity/v1/settings/agents-override?cpt=${encodeURIComponent(cpt)}`, { method: 'DELETE' });
      toast.success(`Orientation override cleared for ${cpt}`);
      await reload();
    } catch (e) {
      toast.error('Reset failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  return h`<div className="border border-border rounded-md overflow-hidden">
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
      <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${cpt}</code>
      ${hasOverride
        ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">override active</span>`
        : (fileDoc
          ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">file doc</span>`
          : h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">none yet</span>`)}
      ${fileDoc ? h`<button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline ml-auto" onClick=${() => setShowFile((v) => !v)}>${showFile ? 'Hide file doc' : 'View file doc'}</button>` : null}
    </div>
    ${showFile && fileDoc ? h`<pre className="px-3 py-2 font-mono text-xs bg-muted/30 border-b border-border whitespace-pre-wrap max-h-64 overflow-y-auto">${fileDoc}</pre>` : null}
    <textarea
      value=${value}
      onChange=${(e) => setValue(e.target.value)}
      placeholder=${'What this type is for, when to create vs update, field conventions, lifecycle rules…'}
      spellCheck=${false}
      className="block w-full h-48 px-3 py-2 font-mono text-xs bg-card border-0 outline-none resize-y"
    />
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-t border-border">
      <${WPButton} variant="primary" size="small" onClick=${save} isBusy=${busy} disabled=${busy || !value.trim()}>Save override</${WPButton}>
      <${WPButton} variant="tertiary" size="small" onClick=${reset} disabled=${busy}>Reset</${WPButton}>
      ${fileDoc && !value.trim() ? h`<button type="button" className="text-xs text-muted-foreground hover:underline" onClick=${() => setValue(fileDoc)}>Start from file doc</button>` : null}
    </div>
  </div>`;
}

function subtreeCount(node) {
  return node.items.length + node.children.reduce((acc, c) => acc + subtreeCount(c), 0);
}

// Vertical guide rails so children visibly connect to their parent.
// One <div> per ancestor depth, absolutely positioned at the right x offset.
function IndentGuides({ depth }) {
  if (depth <= 0) return null;
  const guides = [];
  for (let i = 0; i < depth; i++) {
    guides.push(h`<span
      key=${i}
      aria-hidden="true"
      className="absolute top-0 bottom-0 w-px bg-accent"
      style=${{ left: `${i * 20 + 18}px` }} />`);
  }
  return h`<${Fragment}>${guides}</${Fragment}>`;
}

// --- drag-and-drop helpers ----------------------------------------------
// The tree allows dragging a leaf (file) onto a folder (or the root area)
// to move it. Move = rewrite the `<!-- ci:path=... -->` content
// marker. Folders themselves aren't draggable in v1 (would mass-rename all
// children — non-trivial UX).
const DRAG_MIME = 'application/x-os-tree-item';

function parseDragData(e) {
  try { return JSON.parse(e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain') || '{}'); }
  catch { return {}; }
}

// Drop target shell for the tree's root background. Only fires when the
// cursor is on this element's own area, not over a nested TreeFolder (those
// stopPropagation). Dropping here = move dragged file/folder to the root.
// onDrop receives the parsed payload `{ kind, ... }`.
function TreeDropArea({ onDrop, className = '', children, ...rest }) {
  const [hover, setHover] = useState(false);
  return h`<div
    className=${`${className} ${hover ? 'bg-muted ring-1 ring-ring ring-inset' : ''} transition-colors`}
    onDragOver=${(e) => {
      const types = e.dataTransfer.types;
      if (!types || (!types.includes(DRAG_MIME) && !types.includes('text/plain'))) return;
      if (e.target !== e.currentTarget) { if (hover) setHover(false); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!hover) setHover(true);
    }}
    onDragLeave=${(e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setHover(false);
    }}
    onDrop=${(e) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      setHover(false);
      const data = parseDragData(e);
      if (!data || !data.kind) return;
      onDrop(data);
    }}
    ...${rest}>${children}</div>`;
}

function TreeFolder({ node, type, depth, activeId, movingId, onDrop, onSelect, selectedIds, onSelectChange, onFolderToggle, onEmptyTrash }) {
  // Open the first level by default so the tree is immediately useful;
  // deeper levels start closed so the page isn't a wall of text.
  // `.trash` starts closed too — it's a meta surface, not part of the
  // active workspace.
  const isTrash = !!node.__isTrash || node.fullPath === '.trash';
  const [open, setOpen] = useState(depth === 0 && !isTrash);
  const [dragOver, setDragOver] = useState(false);
  const count = subtreeCount(node);
  const paddingLeft = depth * 20 + 12;
  const isOrphans = node.fullPath === '__orphans__';
  const isMovingThis = movingId === `folder:${node.fullPath}`;

  // Folder-level selection: checked when every leaf in subtree is selected,
  // indeterminate when some-but-not-all are. The "(unrouted)" branch isn't
  // a real folder so we don't expose its checkbox.
  const subIds = useMemo(() => subtreeItemIds(node), [node]);
  const selectedCount = selectedIds
    ? subIds.reduce((n, id) => n + (selectedIds.has(id) ? 1 : 0), 0)
    : 0;
  const folderChecked = subIds.length > 0 && selectedCount === subIds.length;
  const folderIndeterminate = selectedCount > 0 && !folderChecked;
  const showFolderCheckbox = onSelectChange && onFolderToggle && !isOrphans && subIds.length > 0;

  return h`<div className=${`relative ${isMovingThis ? 'opacity-50' : ''}`}>
    <${IndentGuides} depth=${depth} />
    <div
      draggable=${!isOrphans}
      onDragStart=${isOrphans ? undefined : (e) => {
        const payload = JSON.stringify({ kind: 'folder', path: node.fullPath });
        e.dataTransfer.setData(DRAG_MIME, payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      }}
      onDragOver=${(e) => {
        const types = e.dataTransfer.types;
        if (!types || (!types.includes(DRAG_MIME) && !types.includes('text/plain'))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave=${(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
      }}
      onDrop=${(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const data = parseDragData(e);
        if (!data || !data.kind) return;
        onDrop(data, node.fullPath);
      }}
      onClick=${() => setOpen((o) => !o)}
      role="treeitem"
      aria-expanded=${open}
      aria-label=${node.name}
      className=${`relative w-full flex items-center gap-1.5 h-8 pr-3 text-sm text-foreground text-left transition-colors cursor-pointer group rounded-[2px] ${
        dragOver ? 'bg-accent ring-1 ring-ring ring-inset' : 'hover:bg-muted'
      }`}
      style=${{ paddingLeft }}>
      ${showFolderCheckbox ? h`<${SelectCheckbox}
        checked=${folderChecked}
        indeterminate=${folderIndeterminate}
        onChange=${() => onFolderToggle(node)}
        ariaLabel=${`Select all in ${node.name}`}
      />` : null}
      <${WPGlyph} icon=${open ? iconChevronDown : iconChevronRight} size=${12} className=${`shrink-0 -ml-0.5 ${dragOver ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
      <${Icon} name=${open ? 'folder-open' : 'folder'} className=${`w-4 h-4 shrink-0 ${dragOver ? 'text-foreground' : isTrash ? 'text-destructive' : 'text-muted-foreground'}`} />
      <span className=${`font-medium truncate ${isOrphans ? 'italic text-muted-foreground' : ''} ${isTrash ? 'text-muted-foreground' : ''}`}>${node.name}</span>
      <span className="ml-auto text-[11px] text-muted-foreground font-medium">${count}</span>
      ${isTrash && onEmptyTrash && node.items.length > 0 ? h`<button
        type="button"
        onClick=${(e) => { e.stopPropagation(); onEmptyTrash( node.items.map( (it) => it.id ) ); }}
        title="Permanently delete all items in trash"
        className="ml-1 text-[10px] uppercase tracking-wider text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded"
      >Empty</button>` : null}
    </div>
    ${open ? h`<div role="group">
      ${node.items.map((it) => h`<${TreeLeaf} key=${it.id} item=${it} type=${type} depth=${depth + 1} activeId=${activeId} movingId=${movingId} onSelect=${onSelect} selectedIds=${selectedIds} onSelectChange=${onSelectChange} />`)}
      ${node.children.map((child) => h`<${TreeFolder} key=${child.fullPath} node=${child} type=${type} depth=${depth + 1} activeId=${activeId} movingId=${movingId} onDrop=${onDrop} onSelect=${onSelect} selectedIds=${selectedIds} onSelectChange=${onSelectChange} onFolderToggle=${onFolderToggle} onEmptyTrash=${onEmptyTrash} />`)}
    </div>` : null}
  </div>`;
}

/**
 * Kebab-menu button (⋯) that opens a small popover with action items —
 * mirrors the wp-admin row actions (Edit | View | Trash) but always visible
 * instead of hover-revealed, so it works on touch.
 *
 * `actions` is `[{ label, href?, onClick?, danger?, target? }]`. href and
 * onClick are mutually exclusive per item; href opens a link, onClick fires
 * a callback.
 */
function RowMenu({ actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return h`<div ref=${ref} className="relative shrink-0">
    <button
      type="button"
      onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      className=${`w-7 h-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted ${open ? 'bg-muted text-foreground' : ''}`}
      aria-label="Actions"
      aria-haspopup="menu"
      aria-expanded=${open}>
      <span className="text-base leading-none">⋮</span>
    </button>
    ${open ? h`<div
      role="menu"
      className="absolute right-0 top-full mt-1 z-50 min-w-[140px] max-w-[240px] bg-card border border-border rounded-md shadow-lg py-2 text-sm"
      onClick=${(e) => e.stopPropagation()}>
      ${actions.map((a, i) => {
        const className = `block w-full text-left px-4 py-2 hover:bg-muted ${a.danger ? 'text-red-600 hover:text-red-700' : 'text-foreground'}`;
        if (a.href) {
          return h`<a
            key=${i}
            href=${a.href}
            target=${a.target || ''}
            rel=${a.target === '_blank' ? 'noopener' : ''}
            onClick=${() => setOpen(false)}
            className=${className}
            role="menuitem">${a.label}</a>`;
        }
        return h`<button
          key=${i}
          type="button"
          onClick=${(e) => { e.preventDefault(); setOpen(false); a.onClick && a.onClick(); }}
          className=${className}
          role="menuitem">${a.label}</button>`;
      })}
    </div>` : null}
  </div>`;
}

/**
 * Selection checkbox shown to the left of each tree row when multi-select is
 * available. Visible at all times when checked or indeterminate, otherwise
 * revealed on row hover (the parent row carries `.group`).
 *
 * Three states: unchecked, indeterminate (some-but-not-all children selected
 * — used by folders), checked (all selected). Click toggles. Shift+click
 * selects range from the anchor (parent reads `e.shiftKey`).
 */
/**
 * Flatten a buildPathTree() node into the list of leaf item IDs in its
 * subtree. Used to bulk-toggle a folder's children.
 */
function subtreeItemIds(node) {
  const out = [];
  const walk = (n) => {
    for (const it of n.items || []) out.push(it.id);
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

/**
 * Flatten a tree (from buildPathTree, buildParentTree, or the flat-list
 * synthesized object) into item IDs in the exact order they're rendered.
 * Used by shift-click range select so the "from..to" matches what the user
 * sees, not the REST response's modified-desc order.
 *
 * - buildPathTree node shape: { items: [...], children: [...] } — items
 *   render first, then each child folder recursively.
 * - buildParentTree node shape: each child IS an item (node.item) and may
 *   recurse via children.
 * - flat list: tree.items only.
 */
function flatTreeIds(tree) {
  const out = [];
  const walk = (n) => {
    if (n.item) out.push(n.item.id);              // parent-tree node
    for (const it of n.items || []) out.push(it.id); // os_path leaves
    for (const c of n.children || []) walk(c);
  };
  walk(tree);
  return out;
}

/**
 * Compute the contiguous ID range between two anchors in the given ID
 * sequence. Used by shift-click range select; pass the IDs in the same
 * order the user sees them in the tree (use `flatTreeIds(tree)`).
 */
function computeRange(orderedIds, fromId, toId) {
  if (fromId == null) return [toId];
  const a = orderedIds.findIndex((id) => Number(id) === Number(fromId));
  const b = orderedIds.findIndex((id) => Number(id) === Number(toId));
  if (a < 0 || b < 0) return [toId];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return orderedIds.slice(lo, hi + 1);
}

/**
 * Sticky footer in the sidebar that appears whenever a selection exists.
 * Shows the count and a row of bulk actions chosen by `meta`. Calls
 * `onMove(targetPath)`, `onTrash()`, `onSetStatus(status)`; the parent
 * implements the actual REST loops.
 *
 * Type awareness:
 *   - Move: only os_path types (Skills/Memory/Artifacts/Wiki/Canvas)
 *   - Status: only post-kind native_replace types (Posts/Pages)
 *   - Trash/Delete: every type
 */
/**
 * Resolve a list of tag names to term IDs, creating any that don't exist.
 * Mirrors WP's "add tags by name" semantics from the classic Bulk Edit form.
 *
 * /wp/v2/tags create returns 400 with code `term_exists` if a tag with the
 * same slug exists already — the body carries the existing term's ID under
 * `data.term_id`, so we capture that case as a hit instead of a failure.
 */
async function resolveTagNames(names) {
  const out = [];
  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name) continue;
    try {
      const t = await rest('/wp/v2/tags', { method: 'POST', body: JSON.stringify({ name }) });
      if (t && t.id) out.push(t.id);
    } catch (e) {
      // Error message format: `HTTP 400: {"code":"term_exists",...,"data":{"term_id":N,...}}`.
      const m = String(e.message || '').match(/"term_id"\s*:\s*(\d+)/);
      if (m) out.push(Number(m[1]));
      // Otherwise drop silently — the apply loop reports partial failure.
    }
  }
  return Array.from(new Set(out));
}

/**
 * Modal that mirrors WP's classic Bulk Edit form. Posts get the full set
 * (categories, tags, author, comments, sticky, format); Pages get a subset
 * (author, comments) since the rest are post-only.
 *
 * Semantics:
 *   - Categories: ADD (union with each post's existing terms) — matches WP.
 *   - Tags: ADD by name (resolves to IDs, creates missing ones).
 *   - Author / Comments / Sticky / Format: REPLACE per-post when set.
 *   - Any field left at its initial "— No change —" value is omitted.
 *
 * Parent supplies `onApply(fields)` which does the per-item REST loop.
 */
function BulkEditDialog({ meta, count, onClose, onApply, busy }) {
  const [cats, setCats] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCats, setSelectedCats] = useState(() => new Set());
  const [tagsText, setTagsText] = useState('');
  const [author, setAuthor] = useState('');
  const [comments, setComments] = useState('');
  const [sticky, setSticky] = useState('');
  const [format, setFormat] = useState('');

  const isPost = meta?.cpt === 'post';

  useEffect(() => {
    (async () => {
      try {
        if (isPost) {
          const c = await restAllPages('/wp/v2/categories?per_page=100&_fields=id,name,slug,parent');
          setCats(c);
        }
        const u = await rest('/wp/v2/users?per_page=100&context=edit&_fields=id,name,slug');
        setUsers(Array.isArray(u) ? u : []);
      } catch (e) { /* non-fatal — dialog still usable */ }
    })();
  }, [isPost]);

  function apply() {
    const fields = {};
    if (selectedCats.size > 0) fields.addCategories = Array.from(selectedCats);
    if (tagsText.trim()) fields.addTagNames = tagsText.split(',').map((s) => s.trim()).filter(Boolean);
    if (author !== '') fields.author = Number(author);
    if (comments !== '') fields.comment_status = comments;
    if (sticky !== '') fields.sticky = sticky === 'true';
    if (format !== '') fields.format = format;
    if (Object.keys(fields).length === 0) { onClose(); return; }
    onApply(fields);
  }

  const FORMATS = ['standard', 'aside', 'chat', 'gallery', 'link', 'image', 'quote', 'status', 'video', 'audio'];

  return h`<div className="fixed inset-0 z-[100000] flex items-start justify-center p-4 md:p-12" onClick=${onClose}>
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
    <div className="relative w-full max-w-lg bg-card rounded-xl shadow-2xl border border-border overflow-hidden" onClick=${(e) => e.stopPropagation()}>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="font-semibold text-foreground">Bulk edit</div>
          <div className="text-xs text-muted-foreground">${count} ${meta.label.toLowerCase()} selected</div>
        </div>
        <button onClick=${onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none w-7 h-7 flex items-center justify-center" aria-label="Close">×</button>
      </div>

      <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-4">
        ${isPost ? h`<div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Add categories</label>
          <div className="max-h-32 overflow-y-auto border border-border rounded p-2 space-y-1">
            ${cats.length === 0 ? h`<div className="text-xs text-muted-foreground">No categories yet.</div>` :
              cats.map((c) => h`<${WPCheckboxControl}
                key=${c.id}
                checked=${selectedCats.has(c.id)}
                onChange=${() => setSelectedCats((prev) => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                label=${c.name}
                __nextHasNoMarginBottom=${true}
              />`)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">Selected categories are added to each post (existing ones are kept).</div>
        </div>` : null}

        ${isPost ? h`<div>
          <${WPTextControl}
            label=${'Add tags'}
            value=${tagsText}
            onChange=${setTagsText}
            placeholder="comma, separated, tags"
            __nextHasNoMarginBottom=${true}
            __next40pxDefaultSize=${true}
          />
          <div className="text-[11px] text-muted-foreground mt-1">New tags are created if they don't exist.</div>
        </div>` : null}

        <div>
          <${SelectMenu}
            label=${'Author'}
            value=${author}
            onChange=${setAuthor}
            options=${[{ label: '— No change —', value: '' }, ...users.map((u) => ({ label: `${u.name} (${u.slug})`, value: String(u.id) }))]}
            __nextHasNoMarginBottom=${true}
            __next40pxDefaultSize=${true}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <${SelectMenu}
              label=${'Comments'}
              value=${comments}
              onChange=${setComments}
              options=${[{ label: '— No change —', value: '' }, { label: 'Allow', value: 'open' }, { label: 'Do not allow', value: 'closed' }]}
              __nextHasNoMarginBottom=${true}
              __next40pxDefaultSize=${true}
            />
          </div>
          ${isPost ? h`<div>
            <${SelectMenu}
              label=${'Sticky'}
              value=${sticky}
              onChange=${setSticky}
              options=${[{ label: '— No change —', value: '' }, { label: 'Sticky', value: 'true' }, { label: 'Not sticky', value: 'false' }]}
              __nextHasNoMarginBottom=${true}
              __next40pxDefaultSize=${true}
            />
          </div>` : null}
        </div>

        ${isPost ? h`<div>
          <${SelectMenu}
            label=${'Format'}
            value=${format}
            onChange=${setFormat}
            options=${[{ label: '— No change —', value: '' }, ...FORMATS.map((f) => ({ label: f, value: f }))]}
            __nextHasNoMarginBottom=${true}
            __next40pxDefaultSize=${true}
          />
        </div>` : null}
      </div>

      <div className="px-5 py-3 border-t border-border bg-sidebar flex items-center justify-end gap-2">
        <${Button} size="sm" variant="ghost" onClick=${onClose}>Cancel</${Button}>
        <${Button} size="sm" variant="primary" onClick=${apply} disabled=${busy}>
          ${busy ? 'Applying…' : `Apply to ${count}`}
        </${Button}>
      </div>
    </div>
  </div>`;
}

function BulkActionBar({ meta, items, selectedIds, onClear, onMove, onTrash, onSetStatus, onBulkEdit, busy }) {
  // All hook calls run unconditionally and in stable order, even when the
  // bar is hidden. An early `if (count===0) return null` BEFORE a useMemo
  // changes the hook count between renders → React #310 ("rendered more
  // hooks than during the previous render").
  const [showMove, setShowMove] = useState(false);
  const [movePath, setMovePath] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const count = selectedIds.size;
  const tk = treeKind(meta);
  const canMove = tk === 'os_path';
  const isTerm = isTermType(meta);
  const canStatus = !isTerm && isNativeReplace(meta);
  const trashLabel = isTerm ? 'Delete' : 'Trash';

  // Existing folder paths from the loaded items — populate the move <datalist>.
  const folderPaths = useMemo(() => {
    if (!canMove) return [];
    const set = new Set();
    for (const it of items) {
      const p = it.meta?.os_path || '';
      if (!p) continue;
      const parts = p.split('/').filter(Boolean);
      parts.slice(0, -1).reduce((acc, seg) => {
        const next = acc ? `${acc}/${seg}` : seg;
        set.add(next);
        return next;
      }, '');
    }
    return Array.from(set).sort();
  }, [items, canMove]);

  if (count === 0) return null;

  return h`<div className="border-t border-border bg-sidebar/95 backdrop-blur px-2 py-2 shrink-0 space-y-2">
    <div className="flex items-center gap-2 text-xs">
      <span className="font-semibold text-foreground">${count} selected</span>
      <button onClick=${onClear} className="text-muted-foreground hover:text-foreground ml-auto">Clear</button>
    </div>
    ${showMove ? h`<div className="space-y-2">
      <${WPTextControl}
        list=${`os-folders-${meta.cpt || meta.rest_base}`}
        value=${movePath}
        onChange=${setMovePath}
        placeholder="Target folder (empty = root)"
        autoFocus=${true}
        __nextHasNoMarginBottom=${true}
        __next40pxDefaultSize=${true}
        onKeyDown=${(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onMove(movePath.trim().replace(/^\/+|\/+$/g, '')); setShowMove(false); setMovePath(''); }
          else if (e.key === 'Escape') { setShowMove(false); setMovePath(''); }
        }}
      />
      <datalist id=${`os-folders-${meta.cpt || meta.rest_base}`}>
        ${folderPaths.map((p) => h`<option key=${p} value=${p} />`)}
      </datalist>
      <div className="flex gap-2 justify-end">
        <${Button} size="sm" variant="ghost" onClick=${() => { setShowMove(false); setMovePath(''); }}>Cancel</${Button}>
        <${Button} size="sm" variant="primary" disabled=${busy} onClick=${() => { onMove(movePath.trim().replace(/^\/+|\/+$/g, '')); setShowMove(false); setMovePath(''); }}>Move ${count}</${Button}>
      </div>
    </div>` : showStatus ? h`<div className="space-y-2">
      ${['publish', 'draft', 'pending', 'private'].map((s) => h`<button
        key=${s}
        disabled=${busy}
        onClick=${() => { onSetStatus(s); setShowStatus(false); }}
        className="block w-full text-left text-xs px-2 py-1.5 hover:bg-muted rounded">Set status: <span className="font-medium">${s}</span></button>`)}
      <button className="block w-full text-left text-xs px-2 py-1.5 text-muted-foreground hover:bg-muted rounded" onClick=${() => setShowStatus(false)}>Cancel</button>
    </div>` : h`<div className="flex flex-wrap gap-1">
      ${canMove ? h`<button disabled=${busy} className="text-xs px-2 py-1 hover:bg-muted rounded" onClick=${() => setShowMove(true)}>Move…</button>` : null}
      ${canStatus ? h`<button disabled=${busy} className="text-xs px-2 py-1 hover:bg-muted rounded" onClick=${() => setShowStatus(true)}>Status…</button>` : null}
      ${onBulkEdit && canStatus ? h`<button disabled=${busy} className="text-xs px-2 py-1 hover:bg-muted rounded" onClick=${onBulkEdit}>Edit…</button>` : null}
      <button disabled=${busy} className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded ml-auto" onClick=${onTrash}>${trashLabel}</button>
    </div>`}
  </div>`;
}

/**
 * Tree node for `tree: 'parent'` types (Pages, Categories). Each item is BOTH
 * a clickable leaf (links to its own editor) AND an expandable folder when
 * other items reference it as parent. No drag/drop — reparenting is a
 * separate concern and not part of the V1 scope.
 *
 * `href`+`actions` (optional) replace the in-app Link with a plain anchor and
 * surface a kebab menu — used by native_replace types so the click lands in
 * Gutenberg / term editor instead of the React MetaEditor.
 *
 * `selectedIds`+`onSelectChange` enable the checkbox column for multi-select.
 */
function ParentTreeNode({ node, type, depth, activeId, onSelect, hrefFor, actionsFor, selectedIds, onSelectChange }) {
  const [open, setOpen] = useState(depth === 0);
  const paddingLeft = depth * 20 + 12;
  const hasChildren = node.children && node.children.length > 0;
  const itemId = node.item?.id;
  const isActive = activeId && itemId && Number(activeId) === Number(itemId);
  const isSelected = !!(selectedIds && itemId && selectedIds.has(itemId));
  // Progress rollup for "collectible" parents (e.g. a stamp rally): when the
  // children carry a `collected` meta, show how many are collected vs the
  // parent's `goal` (falling back to the child count). Convention-based, so it
  // lights up for any hierarchical type using those keys and is invisible
  // otherwise.
  const kids = node.children || [];
  const collectible = kids.length > 0 && kids.some((c) => c.item && c.item.meta && 'collected' in c.item.meta);
  const collected = collectible ? kids.filter((c) => !!(c.item && c.item.meta && c.item.meta.collected)).length : 0;
  const goalNum = Number(node.item && node.item.meta && node.item.meta.goal) || 0;
  const goal = goalNum > 0 ? goalNum : kids.length;
  const complete = collectible && goal > 0 && collected >= goal;
  return h`<div className="relative">
    <${IndentGuides} depth=${depth} />
    <div className=${`relative flex items-center gap-2 h-8 pr-3 text-sm transition-colors group ${
      isSelected ? 'bg-muted text-foreground' : isActive ? 'bg-accent text-foreground font-medium' : 'text-foreground hover:bg-muted'
    }`} style=${{ paddingLeft }}>
      ${onSelectChange && itemId ? h`<${SelectCheckbox} checked=${isSelected} onChange=${(e) => onSelectChange(itemId, e)} ariaLabel=${`Select ${node.name}`} />` : null}
      ${hasChildren ? h`<button
        type="button"
        onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="shrink-0 w-4 h-4 -mr-1 flex items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label=${open ? 'Collapse' : 'Expand'}>
        <span className=${`inline-block transition-transform text-xs ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>` : null}
      ${(() => {
        const titleInner = h`<${Fragment}>
          <${Icon}
            name=${isActive ? 'file-pen' : (hasChildren ? 'folder' : 'file')}
            className=${`w-4 h-4 shrink-0 ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
          />
          <span className="truncate">${node.name || '(untitled)'}</span>
        </${Fragment}>`;
        const href = node.item && hrefFor ? hrefFor(node.item) : null;
        return href
          ? h`<a href=${href} onClick=${onSelect} className="flex-1 min-w-0 flex items-center gap-2">${titleInner}</a>`
          : h`<${Link} to=${`/t/${type}/${itemId}`} onClick=${onSelect} className="flex-1 min-w-0 flex items-center gap-2">${titleInner}</${Link}>`;
      })()}
      ${hasChildren ? (collectible
        ? h`<span className=${`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${complete ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`} title=${`${collected} of ${goal} collected`}>${complete ? '✓ ' : ''}${collected}/${goal}</span>`
        : h`<span className="text-[11px] text-muted-foreground font-medium shrink-0">${node.children.length}</span>`) : null}
      ${node.item && actionsFor ? h`<${RowMenu} actions=${actionsFor(node.item)} />` : null}
    </div>
    ${open && hasChildren ? h`<div>
      ${node.children.map((child) => h`<${ParentTreeNode} key=${child.fullPath} node=${child} type=${type} depth=${depth + 1} activeId=${activeId} onSelect=${onSelect} hrefFor=${hrefFor} actionsFor=${actionsFor} selectedIds=${selectedIds} onSelectChange=${onSelectChange} />`)}
    </div>` : null}
  </div>`;
}

function TreeLeaf({ item, type, depth, activeId, movingId, onSelect, hrefFor, actionsFor, selectedIds, onSelectChange }) {
  const paddingLeft = depth * 20 + 12;
  const isActive = activeId && Number(activeId) === Number(item.id);
  const isMoving = movingId === `item:${item.id}`;
  const isSelected = !!(selectedIds && selectedIds.has(item.id));
  // For native_replace types (Posts, Pages, …) the click must open the real
  // Gutenberg editor (post.php), not the in-app meta scaffold. When a parent
  // tree doesn't pass hrefFor (e.g. the unified multi-type tree), derive the
  // native edit URL here so those leaves still link straight to Gutenberg.
  const leafMeta = typeMeta(type);
  const href = hrefFor
    ? hrefFor(item)
    : (isNativeReplace(leafMeta) && leafMeta?.edit_url ? applyTemplate(leafMeta.edit_url, { id: item.id }) : null);
  const actions = actionsFor ? actionsFor(item) : null;
  const draggable = !href; // native_replace types don't participate in os_path drag/move.
  const dragHandlers = draggable ? {
    draggable: true,
    onDragStart: (e) => {
      const payload = JSON.stringify({
        kind: 'file',
        id: item.id,
        path: item.meta?.os_path || '',
        slug: item.slug || '',
      });
      e.dataTransfer.setData(DRAG_MIME, payload);
      // Fallback for browsers that strip custom MIME on cross-document drops.
      e.dataTransfer.setData('text/plain', payload);
      // 'copyMove' allows BOTH move-into-folder (in tree) AND copy-onto-canvas
      // (the canvas creates a file-node referencing the leaf). Browsers reject
      // the drop if effectAllowed (here) and dropEffect (target) don't intersect.
      e.dataTransfer.effectAllowed = 'copyMove';
      e.stopPropagation();
    },
  } : {};
  // `items-start` + `py-1.5` so two-line rows (title + slug) read as a
  // proper stack: file icon aligns with the title's baseline (not
  // centred between the two lines), and the row breathes vertically.
  // Single-line rows (no slug) end up the same height as before since
  // py-1.5 with text-sm collapses to ~32px.
  const rowClassName = `relative flex items-start gap-2 py-1.5 pr-3 text-sm transition-colors group rounded-[2px] ${
    isSelected ? 'bg-muted text-foreground' : isActive ? 'bg-accent text-foreground font-medium' : 'text-foreground hover:bg-muted'
  } ${isMoving ? 'opacity-50' : ''}`;
  // Surface the slug alongside the title — the agent-facing identity
  // is the slug, not the human title, so authors need to see it at a
  // glance. Hide when the title IS the slug (common for CI posts).
  // Both fields auto-sync with the post's frontmatter on save: changing
  // `name:` in the body updates the WP slug (and this leaf), and
  // renaming the title updates the displayed title here.
  const titleText = item.title?.rendered || item.slug || '(untitled)';
  const slugText  = item.slug || '';
  const showSlug  = slugText && slugText.toLowerCase() !== String( titleText ).toLowerCase();
  const titleInner = h`<${Fragment}>
    <${WPGlyph}
      icon=${iconPage}
      size=${20}
      className=${`shrink-0 mt-px ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
    />
    <span className="flex-1 min-w-0 flex flex-col gap-1">
      <span className="truncate leading-tight" title=${titleText}>${titleText}</span>
      ${showSlug ? h`<span
        className="text-[10px] font-mono text-muted-foreground/70 truncate leading-none"
        title=${slugText}
      >${slugText}</span>` : null}
    </span>
  </${Fragment}>`;
  const checkbox = onSelectChange
    ? h`<${SelectCheckbox} checked=${isSelected} onChange=${(e) => onSelectChange(item.id, e)} ariaLabel=${`Select ${item.title?.rendered || item.slug}`} />`
    : null;

  // External href + RowMenu shape (native_replace): wrap title in <a> and add
  // a kebab. Standalone Link shape (os_path/markdown): unchanged.
  // The inner Link / <a> uses `items-start` so the icon stays aligned
  // with the title's first line on two-line rows (icon mt-0.5 nudges
  // the optical baseline to match the title's cap height).
  if (href) {
    return h`<div className=${rowClassName} style=${{ paddingLeft }} role="treeitem" aria-label=${titleText}>
      <${IndentGuides} depth=${depth} />
      ${checkbox}
      <a href=${href} onClick=${onSelect} className="flex-1 min-w-0 flex items-start gap-2">${titleInner}</a>
      ${actions ? h`<${RowMenu} actions=${actions} />` : null}
    </div>`;
  }
  // Wrap Link in a row div so the checkbox is a sibling rather than nested
  // inside the <a> — otherwise checkbox click navigates even with
  // stopPropagation (React events vs. browser default for <a>).
  return h`<div className=${rowClassName} style=${{ paddingLeft }} role="treeitem" aria-label=${titleText}>
    <${IndentGuides} depth=${depth} />
    ${checkbox}
    <${Link}
      to=${`/t/${type}/${item.id}`}
      onClick=${onSelect}
      ...${dragHandlers}
      className="flex-1 min-w-0 flex items-start gap-2">
      ${titleInner}
    </${Link}>
  </div>`;
}

// ---------------------------------------------------------------------------
// TreeGrid-based path tree (genuinely Gutenberg-native nav).
//
// The block editor's ListView is built on @wordpress/components TreeGrid: a
// <table role="treegrid"> with roving tabindex + arrow-key navigation
// (up/down to move, right to expand, left to collapse). TreeGrid wants a
// FLAT list of rows carrying aria level/posinset/setsize, so we flatten the
// buildPathTree() structure (respecting open/closed folders) and render each
// visible node as a TreeGridRow. Drag-and-drop stays on the inner content
// div (unchanged from the legacy TreeFolder/TreeLeaf), so the table layer
// adds keyboard a11y + WP row chrome without touching DnD.
// ---------------------------------------------------------------------------

// Flatten a buildPathTree node into ordered visible rows. Items render
// before child folders at each level; a folder's children are emitted only
// when its path is in `openSet`. posInSet/setSize are per parent group.
function flattenPathTree(tree, openSet) {
  const rows = [];
  const walk = (items, children, level) => {
    const setSize = (items?.length || 0) + (children?.length || 0);
    let pos = 0;
    for (const it of items || []) {
      pos++;
      rows.push({ key: 'l' + it.id, kind: 'leaf', item: it, level, posInSet: pos, setSize });
    }
    for (const node of children || []) {
      pos++;
      const isOpen = openSet.has(node.fullPath);
      rows.push({ key: 'f' + node.fullPath, kind: 'folder', node, level, posInSet: pos, setSize, isExpanded: isOpen });
      if (isOpen) walk(node.items || [], node.children || [], level + 1);
    }
  };
  walk(tree.items || [], tree.children || [], 1);
  return rows;
}

// Folder row inside the TreeGrid. cellRef/tabIndex/onFocus come from
// TreeGridCell and wire the row's primary focusable (the toggle button) into
// TreeGrid's roving-focus model.
function GridFolderRow({ node, level, movingId, onDrop, selectedIds, onSelectChange, onFolderToggle, onEmptyTrash, isOpen, onToggle, cellRef, tabIndex, onFocus }) {
  const depth = level - 1;
  const paddingLeft = depth * 20 + 12;
  const isTrash = !!node.__isTrash || node.fullPath === '.trash';
  const isOrphans = node.fullPath === '__orphans__';
  const isMovingThis = movingId === `folder:${node.fullPath}`;
  const count = subtreeCount(node);
  const [dragOver, setDragOver] = useState(false);
  const subIds = subtreeItemIds(node);
  const selectedCount = selectedIds ? subIds.reduce((n, id) => n + (selectedIds.has(id) ? 1 : 0), 0) : 0;
  const folderChecked = subIds.length > 0 && selectedCount === subIds.length;
  const folderIndeterminate = selectedCount > 0 && !folderChecked;
  const showFolderCheckbox = onSelectChange && onFolderToggle && !isOrphans && subIds.length > 0;
  return h`<div
    data-folder-path=${node.fullPath}
    draggable=${!isOrphans}
    onDragStart=${isOrphans ? undefined : (e) => {
      const payload = JSON.stringify({ kind: 'folder', path: node.fullPath });
      e.dataTransfer.setData(DRAG_MIME, payload);
      e.dataTransfer.setData('text/plain', payload);
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    }}
    onDragOver=${(e) => {
      const types = e.dataTransfer.types;
      if (!types || (!types.includes(DRAG_MIME) && !types.includes('text/plain'))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragOver) setDragOver(true);
    }}
    onDragLeave=${(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); }}
    onDrop=${(e) => {
      e.preventDefault(); e.stopPropagation(); setDragOver(false);
      const data = parseDragData(e);
      if (!data || !data.kind) return;
      onDrop(data, node.fullPath);
    }}
    className=${`relative w-full flex items-center gap-1.5 h-8 pr-3 text-sm text-foreground transition-colors group rounded-[2px] ${isMovingThis ? 'opacity-50 ' : ''}${dragOver ? 'bg-accent ring-1 ring-ring ring-inset' : 'hover:bg-muted'}`}
    style=${{ paddingLeft }}>
    <${IndentGuides} depth=${depth} />
    <button
      ref=${cellRef}
      tabIndex=${tabIndex}
      onFocus=${onFocus}
      onClick=${onToggle}
      className="order-2 flex-1 min-w-0 flex items-center gap-1.5 text-left bg-transparent">
      <${WPGlyph} icon=${isOpen ? iconChevronDown : iconChevronRight} size=${12} className=${`shrink-0 -ml-0.5 ${dragOver ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
      <${Icon} name=${isOpen ? 'folder-open' : 'folder'} className=${`w-4 h-4 shrink-0 ${dragOver ? 'text-foreground' : isTrash ? 'text-destructive' : 'text-muted-foreground'}`} />
      <span className=${`font-medium truncate ${isOrphans ? 'italic text-muted-foreground' : ''} ${isTrash ? 'text-muted-foreground' : ''}`}>${node.name}</span>
      <span className="ml-auto text-[11px] text-muted-foreground font-medium">${count}</span>
    </button>
    ${showFolderCheckbox ? h`<span className="order-1 flex items-center">
      <${SelectCheckbox}
        checked=${folderChecked}
        indeterminate=${folderIndeterminate}
        onChange=${() => onFolderToggle(node)}
        ariaLabel=${`Select all in ${node.name}`}
      />
    </span>` : null}
    ${isTrash && onEmptyTrash && node.items.length > 0 ? h`<button
      type="button"
      onClick=${(e) => { e.stopPropagation(); onEmptyTrash(node.items.map((it) => it.id)); }}
      title="Permanently delete all items in trash"
      className="order-3 ml-1 text-[10px] uppercase tracking-wider text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded"
    >Empty</button>` : null}
  </div>`;
}

// Leaf row inside the TreeGrid — mirrors TreeLeaf, with the focusable
// link/anchor wired into TreeGrid's roving focus via cellRef/tabIndex/onFocus.
function GridLeafRow({ item, level, type, activeId, movingId, onSelect, hrefFor, actionsFor, selectedIds, onSelectChange, cellRef, tabIndex, onFocus }) {
  const depth = level - 1;
  const paddingLeft = depth * 20 + 12;
  const isActive = activeId && Number(activeId) === Number(item.id);
  const isMoving = movingId === `item:${item.id}`;
  const isSelected = !!(selectedIds && selectedIds.has(item.id));
  const leafMeta = typeMeta(type);
  const href = hrefFor
    ? hrefFor(item)
    : (isNativeReplace(leafMeta) && leafMeta?.edit_url ? applyTemplate(leafMeta.edit_url, { id: item.id }) : null);
  const actions = actionsFor ? actionsFor(item) : null;
  const draggable = !href;
  const dragHandlers = draggable ? {
    draggable: true,
    onDragStart: (e) => {
      const payload = JSON.stringify({ kind: 'file', id: item.id, path: item.meta?.os_path || '', slug: item.slug || '' });
      e.dataTransfer.setData(DRAG_MIME, payload);
      e.dataTransfer.setData('text/plain', payload);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.stopPropagation();
    },
  } : {};
  const titleText = item.title?.rendered || item.slug || '(untitled)';
  const slugText = item.slug || '';
  const showSlug = slugText && slugText.toLowerCase() !== String(titleText).toLowerCase();
  const titleInner = h`<${Fragment}>
    <${WPGlyph} icon=${iconPage} size=${20} className=${`shrink-0 mt-px ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
    <span className="flex-1 min-w-0 flex flex-col gap-1">
      <span className="truncate leading-tight" title=${titleText}>${titleText}</span>
      ${showSlug ? h`<span className="text-[10px] font-mono text-muted-foreground/70 truncate leading-none" title=${slugText}>${slugText}</span>` : null}
    </span>
  </${Fragment}>`;
  // Checkbox is rendered AFTER the primary link in the DOM (visually moved
  // back left via `order-1`) so TreeGrid's roving focus lands on the link —
  // the row's primary action — not the checkbox. Enter then opens the item.
  const checkbox = onSelectChange
    ? h`<span className="order-1 flex items-start">
        <${SelectCheckbox} checked=${isSelected} onChange=${(e) => onSelectChange(item.id, e)} ariaLabel=${`Select ${item.title?.rendered || item.slug}`} />
      </span>`
    : null;
  const rowClassName = `relative flex items-start gap-2 py-1.5 pr-3 text-sm transition-colors group rounded-[2px] ${
    isSelected ? 'bg-muted text-foreground' : isActive ? 'bg-accent text-foreground font-medium' : 'text-foreground hover:bg-muted'
  } ${isMoving ? 'opacity-50' : ''}`;
  if (href) {
    return h`<div className=${rowClassName} style=${{ paddingLeft }} aria-label=${titleText}>
      <${IndentGuides} depth=${depth} />
      <a href=${href} ref=${cellRef} tabIndex=${tabIndex} onFocus=${onFocus} onClick=${onSelect} className="order-2 flex-1 min-w-0 flex items-start gap-2">${titleInner}</a>
      ${checkbox}
      ${actions ? h`<span className="order-3"><${RowMenu} actions=${actions} /></span>` : null}
    </div>`;
  }
  return h`<div className=${rowClassName} style=${{ paddingLeft }} aria-label=${titleText}>
    <${IndentGuides} depth=${depth} />
    <${Link}
      to=${`/t/${type}/${item.id}`}
      ref=${cellRef}
      tabIndex=${tabIndex}
      onFocus=${onFocus}
      onClick=${onSelect}
      ...${dragHandlers}
      className="order-2 flex-1 min-w-0 flex items-start gap-2">
      ${titleInner}
    </${Link}>
    ${checkbox}
  </div>`;
}

// The TreeGrid wrapper: owns folder open/closed state (lifted out of the
// rows so the tree can be flattened) and maps the flat rows to TreeGridRow /
// TreeGridCell. Drop-in replacement for the recursive TreeFolder/TreeLeaf
// render used by the unified sidebar.
function PathTreeGrid({ tree, type, activeId, movingId, onDrop, onSelect, selectedIds, onSelectChange, onFolderToggle, onEmptyTrash, hrefFor, actionsFor }) {
  // Seed: top-level folders open (matching the legacy depth-0 default),
  // except .trash. Seeded once; later tree changes don't clobber the user's
  // manual toggles, and new folders appear collapsed.
  const [openSet, setOpenSet] = useState(() => {
    const s = new Set();
    for (const c of tree.children || []) {
      const isTrash = !!c.__isTrash || c.fullPath === '.trash';
      if (!isTrash) s.add(c.fullPath);
    }
    return s;
  });
  const setOpen = (path, open) => setOpenSet((prev) => {
    if (open === prev.has(path)) return prev;
    const n = new Set(prev);
    if (open) n.add(path); else n.delete(path);
    return n;
  });
  const toggle = (path) => setOpenSet((prev) => {
    const n = new Set(prev);
    if (n.has(path)) n.delete(path); else n.add(path);
    return n;
  });

  const rows = useMemo(() => flattenPathTree(tree, openSet), [tree, openSet]);

  // Arrow-key expand/collapse: TreeGrid hands us the <tr>; read the folder
  // path off the row content's data attribute.
  const pathOfRow = (rowEl) => rowEl?.querySelector?.('[data-folder-path]')?.getAttribute('data-folder-path');
  const onExpandRow = (rowEl) => { const p = pathOfRow(rowEl); if (p) setOpen(p, true); };
  const onCollapseRow = (rowEl) => { const p = pathOfRow(rowEl); if (p) setOpen(p, false); };

  return h`<${WPTreeGrid} className="os-treegrid px-1" onExpandRow=${onExpandRow} onCollapseRow=${onCollapseRow}>
    ${rows.map((r) => h`<${WPTreeGridRow}
      key=${r.key}
      level=${r.level}
      positionInSet=${r.posInSet}
      setSize=${r.setSize}
      isExpanded=${r.kind === 'folder' ? !!r.isExpanded : undefined}
    >
      <${WPTreeGridCell}>
        ${({ ref, tabIndex, onFocus }) => r.kind === 'folder'
          ? h`<${GridFolderRow}
              node=${r.node} level=${r.level} type=${type} movingId=${movingId}
              onDrop=${onDrop} selectedIds=${selectedIds} onSelectChange=${onSelectChange}
              onFolderToggle=${onFolderToggle} onEmptyTrash=${onEmptyTrash}
              isOpen=${r.isExpanded} onToggle=${() => toggle(r.node.fullPath)}
              cellRef=${ref} tabIndex=${tabIndex} onFocus=${onFocus} />`
          : h`<${GridLeafRow}
              item=${r.item} level=${r.level} type=${type} activeId=${activeId} movingId=${movingId}
              onSelect=${onSelect} hrefFor=${hrefFor} actionsFor=${actionsFor}
              selectedIds=${selectedIds} onSelectChange=${onSelectChange}
              cellRef=${ref} tabIndex=${tabIndex} onFocus=${onFocus} />`}
      </${WPTreeGridCell}>
    </${WPTreeGridRow}>`)}
  </${WPTreeGrid}>`;
}

/**
 * Secondary nav: in-app sidebar with the current type's path tree.
 *
 * Responsive: inline column on desktop (≥ md), hidden by default on mobile
 * and revealed as a drawer overlay when `mobileOpen` is true.
 */
function TreePanel({ type, activeId, mobileOpen, onMobileClose }) {
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [movingId, setMovingId] = useState(null);
  // Multi-select state. selectedIds is a Set<number>. lastClickedId is the
  // anchor for shift-click range. Reset whenever the type changes.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  useEffect(() => { setSelectedIds(new Set()); setLastClickedId(null); setBulkEditOpen(false); }, [type]);

  // User-created empty folders, persisted per-type in localStorage. They show
  // in the tree even when no files live inside, so the user can drop files
  // into them. Once a file exists at that path, the folder is "real" from the
  // server's perspective too.
  const extraFoldersKey = `os-folders-${type}`;
  const [extraFolders, setExtraFolders] = useState([]);
  useEffect(() => {
    try { setExtraFolders(JSON.parse(localStorage.getItem(`os-folders-${type}`) || '[]')); }
    catch { setExtraFolders([]); }
  }, [type]);
  useEffect(() => {
    try { localStorage.setItem(extraFoldersKey, JSON.stringify(extraFolders)); } catch {}
  }, [extraFolders, extraFoldersKey]);

  const refresh = useCallback(async () => {
    if (!meta) return;
    try {
      const raw = await restAllPages(listUrl(meta));
      setItems(raw.map((it) => normalizeItem(meta, it)));
    } catch (e) { console.error(e); }
  }, [meta]);

  useEffect(() => {
    if (!meta) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [type]);

  // Low-level move helper — fetches, rewrites the path marker, saves. No
  // toast, no refresh. Used by both moveItem (single file) and moveFolder
  // (which loops over many items).
  const moveItemRaw = useCallback(async (itemId, newPath) => {
    const full = await rest(`/wp/v2/${meta.rest_base}/${itemId}?context=edit&_fields=content,status`);
    const oldText = full.content?.raw || '';
    const marker = /<!--\s*(?:ci|intelligence):path=[^\s>]+\s*-->/;
    let newText;
    if (marker.test(oldText)) {
      newText = newPath ? oldText.replace(marker, `<!-- ci:path=${newPath} -->`)
                        : oldText.replace(marker, '').replace(/^\n+/, '');
    } else {
      newText = newPath ? `<!-- ci:path=${newPath} -->\n${oldText}` : oldText;
    }
    await rest(`/wp/v2/${meta.rest_base}/${itemId}`, {
      method: 'POST',
      body: JSON.stringify({ content: newText, status: full.status || 'publish' }),
    });
  }, [meta]);

  const moveItem = useCallback(async (itemId, newPath) => {
    const item = items.find((i) => Number(i.id) === Number(itemId));
    if (!item) return;
    const oldPath = item.meta?.os_path || '';
    if (oldPath === newPath) return;
    setMovingId(`item:${itemId}`);
    try {
      await moveItemRaw(itemId, newPath);
      toast?.success?.(newPath ? `Moved to ${newPath}` : 'Moved to root');
      await refresh();
    } catch (e) {
      toast?.error?.('Move failed', e.message);
    } finally {
      setMovingId(null);
    }
  }, [items, moveItemRaw, refresh, toast]);

  // Folder move = re-prefix every child item's path + rename in extraFolders.
  // newPrefix '' moves the folder to root level (children's first segment
  // becomes the folder's old last segment).
  const moveFolder = useCallback(async (oldPrefix, newPrefix) => {
    if (oldPrefix === newPrefix) return;
    if (newPrefix === oldPrefix || newPrefix.startsWith(oldPrefix + '/')) {
      toast?.error?.('Cannot move a folder into itself');
      return;
    }
    const affected = items.filter((it) => {
      const p = it.meta?.os_path || '';
      return p === oldPrefix || p.startsWith(oldPrefix + '/');
    });
    setMovingId(`folder:${oldPrefix}`);
    try {
      for (const it of affected) {
        const oldP = it.meta.os_path;
        const newP = newPrefix + oldP.slice(oldPrefix.length);
        await moveItemRaw(it.id, newP);
      }
      setExtraFolders((efs) => {
        const renamed = efs.map((f) => {
          if (f === oldPrefix) return newPrefix;
          if (f.startsWith(oldPrefix + '/')) return newPrefix + f.slice(oldPrefix.length);
          return f;
        }).filter(Boolean);
        return Array.from(new Set(renamed));
      });
      toast?.success?.(newPrefix ? `Moved folder → ${newPrefix}` : 'Moved folder to root');
      await refresh();
    } catch (e) {
      toast?.error?.('Folder move failed', e.message);
    } finally {
      setMovingId(null);
    }
  }, [items, moveItemRaw, refresh, toast]);

  // Dispatcher: TreeFolder/TreeDropArea drop handlers call this with the
  // parsed drag payload. We pick file-move vs folder-move based on kind.
  const handleDrop = useCallback((data, targetPath) => {
    if (!data) return;
    if (data.kind === 'folder') {
      const basename = data.path.split('/').pop();
      const newPrefix = targetPath ? `${targetPath}/${basename}` : basename;
      moveFolder(data.path, newPrefix);
    } else if (data.kind === 'file' && data.id) {
      const oldPath = data.path || '';
      const fileBasename = (oldPath.split('/').pop()) || data.slug || '';
      if (!fileBasename) return;
      const newPath = targetPath ? `${targetPath}/${fileBasename}` : fileBasename;
      moveItem(data.id, newPath);
    }
  }, [moveFolder, moveItem]);

  const addFolder = useCallback(async () => {
    const input = await dialog.prompt('New folder', 'Use `/` for nesting, e.g. `ops/playbooks`.', { placeholder: 'folder-name' });
    if (!input) return;
    const trimmed = input.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) return;
    setExtraFolders((efs) => (efs.includes(trimmed) ? efs : [...efs, trimmed]));
  }, [dialog]);

  // Trash/delete for native_replace types. Posts/pages go to trash on plain
  // DELETE; terms have no trash so we always force-delete. Refresh on success.
  const deleteItem = useCallback(async (item) => {
    if (!meta || !isNativeReplace(meta)) return;
    const term = isTermType(meta);
    const verb = term ? 'delete' : 'move to Trash';
    const label = item.title?.rendered || item.slug || `#${item.id}`;
    const ok = await dialog.confirm(
      `${term ? 'Delete' : 'Trash'} "${label}"?`,
      `This will ${verb} the ${meta.singular.toLowerCase()}.`,
      { danger: true, confirmLabel: term ? 'Delete' : 'Trash' }
    );
    if (!ok) return;
    try {
      const qs = term ? '?force=true' : '';
      await rest(`/wp/v2/${meta.rest_base}/${item.id}${qs}`, { method: 'DELETE' });
      toast?.success?.(term ? `Deleted "${label}"` : `Trashed "${label}"`);
      await refresh();
    } catch (e) {
      toast?.error?.(term ? 'Delete failed' : 'Trash failed', e.message);
    }
  }, [meta, toast, refresh, dialog]);

  // Row helpers for native_replace types — title goes straight to Gutenberg
  // (or term.php), and the kebab exposes Edit / View / Trash. These are
  // null-returned for other types so existing TreeLeaf behavior is unchanged.
  const hrefFor = useCallback((item) => {
    return isNativeReplace(meta) && item.edit_url ? item.edit_url : null;
  }, [meta]);
  const actionsFor = useCallback((item) => {
    if (!isNativeReplace(meta)) return null;
    const term = isTermType(meta);
    const acts = [];
    if (item.edit_url) acts.push({ label: 'Edit', href: item.edit_url });
    if (item.link) acts.push({ label: 'View', href: item.link, target: '_blank' });
    acts.push({ label: term ? 'Delete' : 'Trash', onClick: () => deleteItem(item), danger: true });
    return acts;
  }, [meta, deleteItem]);

  // Selection toggle handler. Shift+click extends a range from the last
  // anchored click using the tree-display order (NOT the REST modified-desc
  // order). Plain click toggles one and resets the anchor.
  //
  // `treeRef` instead of closing over `tree` directly because `tree` is a
  // useMemo declared further down — referencing it in the dep array here
  // would hit the const TDZ.
  const treeRef = useRef(null);
  const handleSelectChange = useCallback((id, e) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e && e.shiftKey && lastClickedId != null && treeRef.current) {
        for (const rid of computeRange(flatTreeIds(treeRef.current), lastClickedId, id)) next.add(rid);
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      return next;
    });
    setLastClickedId(id);
  }, [lastClickedId]);

  // Folder checkbox: toggle every leaf under the node. If all are already
  // selected, deselect the whole subtree; otherwise select every leaf.
  const handleFolderToggle = useCallback((node) => {
    const ids = subtreeItemIds(node);
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, []);

  // Bulk operations — implemented as loops over the single-item primitives.
  // Sequential, not parallel: keeps server load predictable and lets us
  // surface a partial-failure toast without an aggregate error swallowing
  // useful info. Refresh once at the end.
  const bulkMove = useCallback(async (targetPath) => {
    if (treeKind(meta) !== 'os_path') return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        const item = items.find((it) => Number(it.id) === Number(id));
        if (!item) { fail++; continue; }
        const slugBase = (item.meta?.os_path || '').split('/').pop() || item.slug || `${id}`;
        const newPath = targetPath ? `${targetPath}/${slugBase}` : slugBase;
        try { await moveItemRaw(id, newPath); ok++; }
        catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `Moved ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
        targetPath ? `→ ${targetPath}` : '→ root',
      );
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [meta, selectedIds, items, moveItemRaw, refresh, toast, clearSelection]);

  const bulkTrash = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const term = isTermType(meta);
    const proceed = await dialog.confirm(
      `${term ? 'Delete' : 'Trash'} ${ids.length} ${meta.label.toLowerCase()}?`,
      term ? 'Terms cannot be recovered.' : 'You can restore items from `.trash` later.',
      { danger: true, confirmLabel: term ? 'Delete' : 'Trash' }
    );
    if (!proceed) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        try {
          // Posts/pages: plain DELETE → trash. Terms: force=true (no trash).
          // os_path post-types: plain DELETE moves the underlying post to
          // trash, which is what users expect for a "Trash" action.
          const qs = term ? '?force=true' : '';
          await rest(`/wp/v2/${meta.rest_base}/${id}${qs}`, { method: 'DELETE' });
          ok++;
        } catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `${term ? 'Deleted' : 'Trashed'} ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
      );
      // If the currently-open editor is one of the trashed items, route
      // away from it so the user doesn't sit on a stale view of deleted
      // content. Without this, the post body keeps rendering after the
      // server has trashed/deleted it underneath.
      if ( activeId && ids.some( (x) => Number( x ) === Number( activeId ) ) ) {
        navigate( `/t/${type}`, { replace: true } );
      }
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [selectedIds, meta, refresh, toast, clearSelection, activeId, navigate, type, dialog]);

  const bulkSetStatus = useCallback(async (status) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        try {
          await rest(`/wp/v2/${meta.rest_base}/${id}`, {
            method: 'POST',
            body: JSON.stringify({ status }),
          });
          ok++;
        } catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `Status set to ${status}: ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
      );
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [selectedIds, meta, refresh, toast, clearSelection]);

  /**
   * Apply WP-style bulk edits from BulkEditDialog. `fields` shape:
   *   - addCategories?: number[]   — union with each post's existing
   *   - addTagNames?:   string[]   — resolved to IDs, union
   *   - author?:        number     — replace
   *   - comment_status?:'open'|'closed'
   *   - sticky?:        boolean
   *   - format?:        string
   * Fields not present are not sent.
   */
  const bulkApplyEdit = useCallback(async (fields) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      // Pre-resolve tag names once so each post can share the resolved IDs.
      let newTagIds = [];
      if (fields.addTagNames?.length) {
        try { newTagIds = await resolveTagNames(fields.addTagNames); }
        catch { newTagIds = []; }
      }
      const needsUnion = (fields.addCategories?.length || newTagIds.length);
      for (const id of ids) {
        try {
          const body = {};
          if (fields.author != null) body.author = fields.author;
          if (fields.comment_status != null) body.comment_status = fields.comment_status;
          if (fields.sticky != null) body.sticky = fields.sticky;
          if (fields.format != null) body.format = fields.format;
          // ADD-mode taxonomies need a per-post read so we don't clobber
          // existing terms when we PATCH the union. Posts only — pages
          // don't have categories/tags.
          if (needsUnion && meta.cpt === 'post') {
            const cur = await rest(`/wp/v2/posts/${id}?context=edit&_fields=categories,tags`);
            if (fields.addCategories?.length) {
              body.categories = Array.from(new Set([...(cur.categories || []), ...fields.addCategories]));
            }
            if (newTagIds.length) {
              body.tags = Array.from(new Set([...(cur.tags || []), ...newTagIds]));
            }
          }
          if (Object.keys(body).length === 0) { ok++; continue; }
          await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(body) });
          ok++;
        } catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `Bulk edit: ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
      );
      setBulkEditOpen(false);
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [selectedIds, meta, refresh, toast, clearSelection]);

  const filtered = q
    ? items.filter((it) => `${it.title?.rendered || ''} ${it.slug || ''} ${it.meta?.os_path || ''}`.toLowerCase().includes(q.toLowerCase()))
    : items;
  // Split trashed posts off so they land in the synthetic `.trash`
  // folder rather than polluting the regular os_path tree.
  const activeItems  = filtered.filter( (it) => it.status !== 'trash' );
  const trashedItems = filtered.filter( (it) => it.status === 'trash' );
  // Empty folders only show when not filtering — search results shouldn't
  // surface empty user folders unless they have a match.
  const tk = treeKind(meta);
  const tree = useMemo(() => {
    if (tk === 'parent') return buildParentTree(activeItems);
    if (tk === 'flat') return { name: '', fullPath: '', children: [], items: activeItems };
    return buildPathTree(activeItems, q ? [] : extraFolders, trashedItems);
  }, [activeItems, trashedItems, extraFolders, q, tk]);

  // Force-delete every item currently in the `.trash` folder. Called
  // from the "Empty" button on the trash folder header.
  const emptyTrash = useCallback(async (ids) => {
    if ( ! ids || ids.length === 0 ) return;
    const ok2 = await dialog.confirm(
      `Empty .trash`,
      `Permanently delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      { danger: true, confirmLabel: 'Delete forever' }
    );
    if (!ok2) return;
    let ok = 0, fail = 0;
    for ( const id of ids ) {
      try { await rest( `/wp/v2/${meta.rest_base}/${id}?force=true`, { method: 'DELETE' } ); ok++; }
      catch { fail++; }
    }
    toast?.[fail ? 'error' : 'success']?.( `Deleted ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}` );
    if ( activeId && ids.some( (x) => Number( x ) === Number( activeId ) ) ) {
      navigate( `/t/${type}`, { replace: true } );
    }
    await refresh();
  }, [meta, refresh, toast, activeId, navigate, type, dialog]);
  // Mirror tree into the ref so handleSelectChange (declared earlier, before
  // TDZ-protected `tree`) can read the live tree at click time without
  // referencing it in its dep array.
  treeRef.current = tree;

  if (!meta) return null;

  // Display logic via responsive classes:
  // - Mobile + closed: hidden (display: none)
  // - Mobile + open: fixed drawer overlay
  // - Desktop (always): absolutely positioned column inside TypeLayout,
  //   `inset-y-0 left-0 w-64` gives concrete height/width without depending
  //   on flex chain.
  const asideClass = `
    bg-sidebar border-r border-border flex-col overflow-hidden
    ${mobileOpen ? 'flex fixed inset-y-0 left-0 z-50 w-72 shadow-xl' : 'hidden'}
    md:flex md:absolute md:inset-y-0 md:left-0 md:shadow-none md:z-auto
  `;
  const { width: sidebarW, isMd: paneMd } = useSidebarWidth();
  const asideStyle = paneMd ? { width: sidebarW } : undefined;

  // When user taps an item inside the drawer, close it automatically.
  const linkInterceptor = mobileOpen ? { onClick: onMobileClose } : {};

  return h`<${Fragment}>
    ${mobileOpen ? h`<div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick=${onMobileClose} />` : null}
    <aside className=${asideClass} style=${asideStyle}>
      <${SidebarResizer} />
      <div className="h-14 px-3 flex items-center gap-2 border-b border-border shrink-0">
        <${Link} to=${`/t/${type}`} className="flex-1 font-semibold text-foreground hover:underline truncate text-sm" ...${linkInterceptor}>${meta.label}</${Link}>
        ${tk === 'os_path' ? h`<${Button} size="sm" variant="ghost" className="!px-2 hover:!bg-muted" onClick=${addFolder} title="New folder">+ Folder</${Button}>` : null}
        ${(() => {
          // For native_replace post/page types, the New button hands off to
          // post-new.php so the user lands directly in Gutenberg. Terms keep
          // the in-app TermEditor (no native add-new page for taxonomies).
          if (isNativeReplace(meta) && !isTermType(meta)) {
            // Same-origin path so the link works on wpcom staging
            // mirrors where BOOT.site_url is the production domain.
            const url = `/wp-admin/post-new.php${meta.cpt && meta.cpt !== 'post' ? `?post_type=${meta.cpt}` : ''}`;
            return h`<a href=${url} className="inline-flex items-center h-8 px-2 rounded text-xs font-medium text-foreground hover:bg-muted" title=${`New ${meta.singular.toLowerCase()}`}>+ ${meta.singular}</a>`;
          }
          const label = isTermType(meta) ? meta.singular : (tk === 'os_path' ? 'File' : 'New');
          // Only os_path markdown CPTs get the language picker; term types
          // (taxonomies) and plain "+ New" buttons stay as direct nav.
          if (tk === 'os_path' && !isTermType(meta)) {
            return h`<${NewFileButton} type=${type} label=${label} className="!px-2 hover:!bg-muted" onMobileClose=${linkInterceptor.onClick} />`;
          }
          return h`<${Button} size="sm" variant="ghost" className="!px-2 hover:!bg-muted" onClick=${() => { window.location.hash = `#/t/${type}/new`; if (linkInterceptor.onClick) linkInterceptor.onClick(); }} title=${`New ${meta.singular.toLowerCase()}`}>+ ${label}</${Button}>`;
        })()}
        ${mobileOpen ? h`<button onClick=${onMobileClose} className="md:hidden ml-1 text-muted-foreground text-xl leading-none w-7 h-7 flex items-center justify-center hover:text-foreground" aria-label="Close menu">×</button>` : null}
      </div>
      <div className="px-2 py-2 border-b border-border shrink-0 os-wpds-fields os-sidebar-search">
        <${WPSearchControl}
          __nextHasNoMarginBottom
          size="compact"
          value=${q}
          onChange=${setQ}
          placeholder="Filter…"
        />
      </div>
      ${tk === 'os_path' ? h`<${TreeDropArea}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1"
        onDrop=${(data) => handleDrop(data, '')}
        style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        ${loading ? h`<div className="p-4 text-center"><${Spinner} /></div>` :
          (filtered.length === 0 && (q || extraFolders.length === 0)) ? h`<div className="p-4 text-center text-xs text-muted-foreground">${items.length === 0 ? `No ${meta.label.toLowerCase()}` : 'No matches'}</div>` :
          h`<${PathTreeGrid}
            tree=${tree}
            type=${type}
            activeId=${activeId}
            movingId=${movingId}
            onDrop=${handleDrop}
            onSelect=${onMobileClose}
            selectedIds=${selectedIds}
            onSelectChange=${handleSelectChange}
            onFolderToggle=${handleFolderToggle}
            onEmptyTrash=${emptyTrash}
          />`}
      </${TreeDropArea}>` : h`<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        ${loading ? h`<div className="p-4 text-center"><${Spinner} /></div>` :
          (filtered.length === 0) ? h`<div className="p-4 text-center text-xs text-muted-foreground">${items.length === 0 ? `No ${meta.label.toLowerCase()}` : 'No matches'}</div>` :
          (tk === 'parent') ? h`<div role="tree" className="px-1">
            ${tree.children.map((child) => h`<${ParentTreeNode} key=${child.fullPath} node=${child} type=${type} depth=${0} activeId=${activeId} onSelect=${onMobileClose} hrefFor=${hrefFor} actionsFor=${actionsFor} selectedIds=${selectedIds} onSelectChange=${handleSelectChange} />`)}
          </div>` :
          h`<${PathTreeGrid}
            tree=${tree}
            type=${type}
            activeId=${activeId}
            movingId=${null}
            onSelect=${onMobileClose}
            selectedIds=${selectedIds}
            onSelectChange=${handleSelectChange}
            hrefFor=${hrefFor}
            actionsFor=${actionsFor}
          />`}
      </div>`}
      <${BulkActionBar}
        meta=${meta}
        items=${items}
        selectedIds=${selectedIds}
        busy=${bulkBusy}
        onClear=${clearSelection}
        onMove=${bulkMove}
        onTrash=${bulkTrash}
        onSetStatus=${bulkSetStatus}
        onBulkEdit=${() => setBulkEditOpen(true)}
      />
    </aside>
    ${bulkEditOpen ? h`<${BulkEditDialog}
      meta=${meta}
      count=${selectedIds.size}
      busy=${bulkBusy}
      onClose=${() => setBulkEditOpen(false)}
      onApply=${bulkApplyEdit}
    />` : null}
  </${Fragment}>`;
}

// ---------------------------------------------------------------------------
// Unified tree — Canvas + Skills + Memory + Artifacts + Wiki shown as
// drag-reorderable top-level folders in one shared sidebar. Each subtree is
// a `TypeFolder` that manages its own items / extra folders / moves.
//
// The non-unified types (post/page/category/tag, taxonomy-only types) keep
// using the older `TreePanel` because their tree-kind isn't `os_path` and
// the data shape is different.
// ---------------------------------------------------------------------------

// Built-in types that share the os_path tree shape. Custom CPTs the
// admin registers via Settings (everything in BOOT.types whose `cpt`
// starts with `ci_` and isn't already covered above) get auto-appended
// so they appear as siblings of Skills / Wiki / etc. instead of each
// rendering its own isolated tree.
const UNIFIED_TYPES_BUILTIN = ['skill', 'memory', 'wiki', 'snippet'];
const UNIFIED_TYPES = (() => {
  const builtinCpts = new Set(['os_skill', 'os_wiki']);
  const customs = Object.entries(BOOT.types || {})
    .filter(([key, m]) => (
      !UNIFIED_TYPES_BUILTIN.includes(key)
      && m && typeof m.cpt === 'string'
      // Custom `ci_*` CPTs from Settings, plus adopted third-party CPTs
      // (editor:'cpt', any placement), all share the os_path tree shape.
      // Placement (unified/own/under:*) is honoured at render time in
      // UnifiedTreePanel — the type set is the same regardless.
      && (m.cpt.startsWith('ci_') || m.editor === 'cpt' || m.unified === true)
      && m.placement !== 'native_replace'
      && !builtinCpts.has(m.cpt)
    ))
    .map(([key]) => key);
  return [...UNIFIED_TYPES_BUILTIN, ...customs];
})();
const TYPE_ORDER_KEY = 'os-type-order';

function TypeFolder({ type, q, collapsed, onToggle, activeType, activeId, onMobileClose, onMoveTypeFolder }) {
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState(null);
  const [hdrDragOver, setHdrDragOver] = useState(false);
  // Multi-select state — scoped to this TypeFolder so each unified subtree
  // (skills / wiki / memory etc.) has its own selection. The bulk action bar
  // appears below this folder's items when its selection is non-empty.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const extraFoldersKey = `os-folders-${type}`;
  const [extraFolders, setExtraFolders] = useState([]);
  useEffect(() => {
    try { setExtraFolders(JSON.parse(localStorage.getItem(extraFoldersKey) || '[]')); }
    catch { setExtraFolders([]); }
  }, [type]);
  useEffect(() => {
    try { localStorage.setItem(extraFoldersKey, JSON.stringify(extraFolders)); } catch {}
  }, [extraFolders, extraFoldersKey]);

  const refresh = useCallback(async () => {
    if (!meta) return;
    try {
      const raw = await restAllPages(listUrl(meta));
      setItems(raw.map((it) => (typeof normalizeItem === 'function' ? normalizeItem(meta, it) : it)));
    } catch (e) { console.error(e); }
  }, [meta]);

  useEffect(() => {
    if (!meta) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [type]);

  const moveItemRaw = useCallback(async (itemId, newPath) => {
    const full = await rest(`/wp/v2/${meta.rest_base}/${itemId}?context=edit&_fields=content,status`);
    const oldText = full.content?.raw || '';
    const marker = /<!--\s*(?:ci|intelligence):path=[^\s>]+\s*-->/;
    let newText;
    if (marker.test(oldText)) {
      newText = newPath ? oldText.replace(marker, `<!-- ci:path=${newPath} -->`)
                        : oldText.replace(marker, '').replace(/^\n+/, '');
    } else {
      newText = newPath ? `<!-- ci:path=${newPath} -->\n${oldText}` : oldText;
    }
    await rest(`/wp/v2/${meta.rest_base}/${itemId}`, {
      method: 'POST',
      body: JSON.stringify({ content: newText, status: full.status || 'publish' }),
    });
  }, [meta]);

  const moveItem = useCallback(async (itemId, newPath) => {
    const item = items.find((i) => Number(i.id) === Number(itemId));
    if (!item) return;
    const oldPath = item.meta?.os_path || '';
    if (oldPath === newPath) return;
    setMovingId(`item:${itemId}`);
    try {
      await moveItemRaw(itemId, newPath);
      toast?.success?.(newPath ? `Moved to ${newPath}` : 'Moved to root');
      await refresh();
    } catch (e) { toast?.error?.('Move failed', e.message); }
    finally { setMovingId(null); }
  }, [items, moveItemRaw, refresh, toast]);

  const moveFolder = useCallback(async (oldPrefix, newPrefix) => {
    if (oldPrefix === newPrefix) return;
    if (newPrefix === oldPrefix || newPrefix.startsWith(oldPrefix + '/')) {
      toast?.error?.('Cannot move a folder into itself');
      return;
    }
    const affected = items.filter((it) => {
      const p = it.meta?.os_path || '';
      return p === oldPrefix || p.startsWith(oldPrefix + '/');
    });
    setMovingId(`folder:${oldPrefix}`);
    try {
      for (const it of affected) {
        const oldP = it.meta.os_path;
        const newP = newPrefix + oldP.slice(oldPrefix.length);
        await moveItemRaw(it.id, newP);
      }
      setExtraFolders((efs) => {
        const renamed = efs.map((f) => {
          if (f === oldPrefix) return newPrefix;
          if (f.startsWith(oldPrefix + '/')) return newPrefix + f.slice(oldPrefix.length);
          return f;
        }).filter(Boolean);
        return Array.from(new Set(renamed));
      });
      toast?.success?.(newPrefix ? `Moved folder → ${newPrefix}` : 'Moved folder to root');
      await refresh();
    } catch (e) { toast?.error?.('Folder move failed', e.message); }
    finally { setMovingId(null); }
  }, [items, moveItemRaw, refresh, toast]);

  const handleDrop = useCallback((data, targetPath) => {
    if (!data) return;
    if (data.kind === 'folder') {
      const basename = data.path.split('/').pop();
      const newPrefix = targetPath ? `${targetPath}/${basename}` : basename;
      moveFolder(data.path, newPrefix);
    } else if (data.kind === 'file' && data.id) {
      const oldPath = data.path || '';
      const fileBasename = (oldPath.split('/').pop()) || data.slug || '';
      if (!fileBasename) return;
      const newPath = targetPath ? `${targetPath}/${fileBasename}` : fileBasename;
      moveItem(data.id, newPath);
    }
  }, [moveFolder, moveItem]);

  const addFolder = useCallback(async () => {
    const input = await dialog.prompt(`New folder in ${meta.label}`, 'Use `/` for nesting, e.g. `ops/playbooks`.', { placeholder: 'folder-name' });
    if (!input) return;
    const trimmed = input.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) return;
    setExtraFolders((efs) => (efs.includes(trimmed) ? efs : [...efs, trimmed]));
  }, [meta, dialog]);

  // Multi-select handlers — mirror of TreePanel's, scoped to this TypeFolder.
  // treeRef threads the live tree into handleSelectChange without dragging
  // a `tree` reference into the dep array (TDZ — tree is declared below).
  const treeRef = useRef(null);
  const handleSelectChange = useCallback((id, e) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e && e.shiftKey && lastClickedId != null && treeRef.current) {
        for (const rid of computeRange(flatTreeIds(treeRef.current), lastClickedId, id)) next.add(rid);
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      return next;
    });
    setLastClickedId(id);
  }, [lastClickedId]);
  const handleFolderToggle = useCallback((node) => {
    const ids = subtreeItemIds(node);
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set()); setLastClickedId(null);
  }, []);

  const bulkMove = useCallback(async (targetPath) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        const item = items.find((it) => Number(it.id) === Number(id));
        if (!item) { fail++; continue; }
        const slugBase = (item.meta?.os_path || '').split('/').pop() || item.slug || `${id}`;
        const newPath = targetPath ? `${targetPath}/${slugBase}` : slugBase;
        try { await moveItemRaw(id, newPath); ok++; }
        catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `Moved ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
        targetPath ? `→ ${targetPath}` : '→ root',
      );
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [selectedIds, items, moveItemRaw, refresh, toast, clearSelection]);

  const bulkTrash = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok2 = await dialog.confirm(
      `Trash ${ids.length} ${meta.label.toLowerCase()}?`,
      'You can restore items from `.trash` later.',
      { danger: true, confirmLabel: 'Trash' }
    );
    if (!ok2) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        try {
          await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'DELETE' });
          ok++;
        } catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(
        `Trashed ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
      );
      // Route away from the editor if its post got trashed underneath.
      // Otherwise the user keeps staring at the body of a now-deleted
      // post and "Save" would silently fail / resurrect.
      if ( activeType === type && activeId && ids.some( (x) => Number( x ) === Number( activeId ) ) ) {
        navigate( `/t/${type}`, { replace: true } );
      }
      clearSelection();
      await refresh();
    } finally { setBulkBusy(false); }
  }, [selectedIds, meta, refresh, toast, clearSelection, activeId, activeType, navigate, type, dialog]);

  const filtered = q
    ? items.filter((it) => `${it.title?.rendered || ''} ${it.slug || ''} ${it.meta?.os_path || ''}`.toLowerCase().includes(q.toLowerCase()))
    : items;
  const activeItems  = filtered.filter( (it) => it.status !== 'trash' );
  const trashedItems = filtered.filter( (it) => it.status === 'trash' );
  const tree = useMemo(
    () => buildPathTree(activeItems, q ? [] : extraFolders, trashedItems),
    [activeItems, trashedItems, extraFolders, q]
  );
  treeRef.current = tree;

  // Force-delete everything in this type's `.trash` folder.
  const emptyTrash = useCallback(async (ids) => {
    if ( ! ids || ids.length === 0 ) return;
    const proceed = await dialog.confirm(
      `Empty .trash`,
      `Permanently delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      { danger: true, confirmLabel: 'Delete forever' }
    );
    if (!proceed) return;
    let ok = 0, fail = 0;
    for ( const id of ids ) {
      try { await rest( `/wp/v2/${meta.rest_base}/${id}?force=true`, { method: 'DELETE' } ); ok++; }
      catch { fail++; }
    }
    toast?.[fail ? 'error' : 'success']?.( `Deleted ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}` );
    if ( activeType === type && activeId && ids.some( (x) => Number( x ) === Number( activeId ) ) ) {
      navigate( `/t/${type}`, { replace: true } );
    }
    await refresh();
  }, [meta, refresh, toast, activeId, activeType, navigate, type, dialog]);

  if (!meta) return null;

  const isActiveType = activeType === type;
  const count = items.length;

  // Type-folder header is itself draggable for reordering, AND a drop target
  // for both reorder (kind='type-folder') and intra-type moves (file/folder).
  return h`<div className="relative">
    <div
      draggable=${true}
      onDragStart=${(e) => {
        const payload = JSON.stringify({ kind: 'type-folder', type });
        e.dataTransfer.setData(DRAG_MIME, payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      }}
      onDragOver=${(e) => {
        const t = e.dataTransfer.types;
        if (!t || (!t.includes(DRAG_MIME) && !t.includes('text/plain'))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!hdrDragOver) setHdrDragOver(true);
      }}
      onDragLeave=${(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setHdrDragOver(false);
      }}
      onDrop=${(e) => {
        e.preventDefault();
        e.stopPropagation();
        setHdrDragOver(false);
        const data = parseDragData(e);
        if (!data) return;
        if (data.kind === 'type-folder' && data.type !== type) {
          onMoveTypeFolder(data.type, type);
        }
        // File/folder drops on the type header itself = move to that type's
        // root. Cross-type moves are out of v1 — only same-type moves work.
        else if ((data.kind === 'file' || data.kind === 'folder')) {
          handleDrop(data, '');
        }
      }}
      onClick=${onToggle}
      role="treeitem"
      aria-expanded=${!collapsed}
      aria-label=${meta.label}
      className=${`group flex items-center gap-1.5 h-9 px-3 cursor-pointer select-none transition-colors ${hdrDragOver ? 'bg-accent ring-1 ring-ring ring-inset' : (isActiveType ? 'bg-accent/40' : 'hover:bg-muted')}`}
    >
      <${WPGlyph} icon=${collapsed ? iconChevronRight : iconChevronDown} size=${12} className="shrink-0 -ml-0.5 text-muted-foreground group-hover:text-foreground" />
      <${CptIcon} icon=${meta.icon} iconSvg=${meta.icon_svg} fallback=${collapsed ? 'folder' : 'folder-open'} className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className=${`flex-1 truncate text-sm font-semibold ${isActiveType ? 'text-foreground' : 'text-foreground'}`}>${meta.label}</span>
      <span className="text-[11px] text-muted-foreground font-medium tabular-nums">${count}</span>
    </div>
    ${!collapsed ? h`<div>
      <div className="px-3 py-1.5 grid grid-cols-3 gap-1.5">
        <${WPButton}
          size="compact"
          variant="secondary"
          href=${`#/t/${type}`}
          onClick=${onMobileClose}
          icon=${h`<${Icon} name="home" className="w-4 h-4" />`}
          label=${`${meta.label} home`}
          showTooltip=${true}
          className="w-full justify-center"
        />
        <${WPButton}
          size="compact"
          variant="secondary"
          onClick=${addFolder}
          icon=${h`<${Icon} name="folder-plus" className="w-4 h-4" />`}
          label=${`New folder in ${meta.label}`}
          showTooltip=${true}
          className="w-full justify-center"
        />
        <${NewFileButton} type=${type} label=${meta.singular} variant="secondary" size="compact" iconOnly=${true} className="w-full justify-center" onMobileClose=${onMobileClose} />
      </div>
      <${TreeDropArea}
        className="overscroll-contain"
        onDrop=${(data) => handleDrop(data, '')}
      >
        ${loading ? h`<div className="p-3 text-center"><${Spinner} /></div>` :
          (filtered.length === 0 && (q || extraFolders.length === 0)) ? h`<div className="px-3 py-2 text-xs text-muted-foreground italic">${items.length === 0 ? 'Empty' : 'No matches'}</div>` :
          h`<${PathTreeGrid}
            tree=${tree}
            type=${type}
            activeId=${activeType === type ? activeId : null}
            movingId=${movingId}
            onDrop=${handleDrop}
            onSelect=${onMobileClose}
            selectedIds=${selectedIds}
            onSelectChange=${handleSelectChange}
            onFolderToggle=${handleFolderToggle}
            onEmptyTrash=${emptyTrash}
          />`}
      </${TreeDropArea}>
      <${BulkActionBar}
        meta=${meta}
        items=${items}
        selectedIds=${selectedIds}
        busy=${bulkBusy}
        onClear=${clearSelection}
        onMove=${bulkMove}
        onTrash=${bulkTrash}
        onSetStatus=${() => {}}
      />
    </div>` : null}
  </div>`;
}

// Standard WordPress types we surface in the unified sidebar as
// view-only navigation rows. They don't share the os_path tree shape,
// so for v1 they're flat clickable rows that bounce to the existing
// list view at /t/<key> — same destination native_replace already
// redirected to from the WP sidebar.
const WP_NAV_TYPES = Object.entries(BOOT.types || {})
  .filter(([, m]) => m && m.placement === 'native_replace')
  .map(([key, meta]) => ({ key, meta }));

function TreeGroupHeader({ label, hint }) {
  return h`<div className="px-3 pt-3 pb-1 select-none">
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">${label}</span>
      ${hint ? h`<span className="text-[10px] text-muted-foreground/70 truncate">${hint}</span>` : null}
    </div>
  </div>`;
}

// MIME used by drag-and-drop within WP-type subtrees (Pages / Posts /
// Products). Distinct from the Context tree's DRAG_MIME so we can
// short-circuit cross-domain drags. The payload is a JSON string
// `{ kind: 'wp-leaf', tkey, id }` so the drop handler knows what to
// update server-side.
const WP_DRAG_MIME = 'application/x-os-wp-leaf';

// Reparent / categorise a WP post by hitting the typed REST endpoint
// directly. Returns the updated item on success, throws on failure.
async function wpUpdatePost(restBase, id, patch) {
  return rest(`/wp/v2/${restBase}/${id}`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

// Folder + page icons shared across all expandable WP/WC subtrees.
// Same visual idiom as the Context tree's TypeFolder so the user
// reads "this is a tree" without having to learn a second pattern.
const TreeFolderIcon = () => h`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>
</svg>`;
const TreePageIcon = () => h`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/>
  <path d="M14 3v5h5"/>
</svg>`;

// Pages-specific expandable subtree. Lazy-loads on first expand, then
// builds a parent/child hierarchy from `parent` / `post_parent`. Each
// row is both a drop target (drop a child page on me → reparent) and
// a drag source. Dropping onto the section header sends `parent=0`
// (top-level). Click → navigate to the existing list-view route so
// the editor surface stays the same.
function ExpandablePagesSection({ tkey, meta, activeType, onMobileClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = not yet loaded
  const [loading, setLoading] = useState(false);
  const [dragOverId, setDragOverId] = useState(null);
  const [rootDragOver, setRootDragOver] = useState(false);

  const restBase = meta.rest_base || 'pages';

  const isTerm = isTermType(meta);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Terms (categories/tags) and posts/pages have different REST shapes.
      // Terms: name (not title), parent for hierarchy, no status/menu_order →
      // order by name and map name→title so renderItem can share one path.
      // Pages: menu_order (parent tree). Posts: title (no menu_order → 400).
      let data;
      if (isTerm) {
        const url = `/wp/v2/${restBase}?per_page=100&orderby=name&order=asc&_fields=id,name,parent,slug,count`;
        const raw = await restAllPages(url);
        data = (raw || []).map((t) => ({ id: t.id, title: { rendered: t.name }, parent: t.parent || 0, slug: t.slug, count: t.count }));
      } else {
        const orderby = meta.hierarchical ? 'menu_order' : 'title';
        const url = `/wp/v2/${restBase}?per_page=100&orderby=${orderby}&order=asc&status=any&context=edit&_fields=id,title,parent,menu_order,slug,status`;
        data = await restAllPages(url);
      }
      setItems(data);
    } catch (e) {
      toast?.error?.('Load failed', e.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [restBase]);

  useEffect(() => {
    if (open && items === null) refresh();
  }, [open, items, refresh]);

  // Build parent → children map.
  const childrenByParent = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(items)) return map;
    for (const it of items) {
      const p = it.parent || 0;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(it);
    }
    return map;
  }, [items]);

  const moveItem = useCallback(async (id, newParent) => {
    if (!Array.isArray(items)) return;
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if ((item.parent || 0) === (newParent || 0)) return;
    if (id === newParent) return; // can't parent to self
    // Cycle check: walk up newParent's ancestry — if id is in the
    // chain, the drop would create a loop. WP rejects this server-
    // side too, but bailing here avoids the round-trip.
    let cur = newParent;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur === id) {
        toast?.error?.('Can’t move a page under one of its own descendants');
        return;
      }
      const parentItem = items.find((i) => i.id === cur);
      cur = parentItem?.parent || 0;
    }
    // Optimistic update.
    const prev = items;
    setItems((cur) => cur.map((it) => it.id === id ? { ...it, parent: newParent } : it));
    try {
      await wpUpdatePost(restBase, id, { parent: newParent });
      toast?.success?.(newParent ? 'Page reparented' : 'Page moved to top level');
    } catch (e) {
      setItems(prev);
      toast?.error?.('Reparent failed', e.message);
    }
  }, [items, restBase, toast]);

  const onRowDragStart = (e, id, item) => {
    e.dataTransfer.setData(WP_DRAG_MIME, JSON.stringify({ kind: 'wp-leaf', tkey, id }));
    // text/plain is what drops into the markdown editor (CodeMirror
    // reads this MIME natively). Emit a canvas-compatible File ref
    // — `<File ref="slug" />` — so dragging a page into the body
    // becomes a usable reference both in the markdown view AND
    // re-renders as a File node when the user flips to canvas.
    // Title goes into an HTML comment so a human reading the raw
    // markdown still sees what was referenced.
    const slug = item?.slug || ('post-' + id);
    const title = item?.title?.rendered || item?.title || '';
    const inlineComment = title ? ` <!-- ${title.replace(/--+/g, '-')} -->` : '';
    e.dataTransfer.setData('text/plain', `<File ref="${slug}" />${inlineComment}`);
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const onRowDragOver = (e, id) => {
    if (!e.dataTransfer.types.includes(WP_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) setDragOverId(id);
  };
  const onRowDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverId(null);
  };
  const onRowDrop = (e, targetId) => {
    if (!e.dataTransfer.types.includes(WP_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData(WP_DRAG_MIME) || '{}');
      if (payload.tkey !== tkey || !payload.id) return;
      moveItem(payload.id, targetId);
    } catch {}
  };
  const onRootDragOver = (e) => {
    if (!e.dataTransfer.types.includes(WP_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!rootDragOver) setRootDragOver(true);
  };
  const onRootDrop = (e) => {
    if (!e.dataTransfer.types.includes(WP_DRAG_MIME)) return;
    e.preventDefault();
    setRootDragOver(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData(WP_DRAG_MIME) || '{}');
      if (payload.tkey !== tkey || !payload.id) return;
      moveItem(payload.id, 0);
    } catch {}
  };

  const renderItem = (item, depth) => {
    const children = childrenByParent.get(item.id) || [];
    const isDragOver = dragOverId === item.id;
    const title = item.title?.rendered || item.title || '(untitled)';
    const slug = item.slug || ('post-' + item.id);
    const hasChildren = children.length > 0;
    // Vertical guide rails so children visibly hang off their parent
    // — same idiom as a git log graph / VS Code tree. Each depth
    // level gets one rail at a fixed column, and the row gets
    // padded right of the deepest rail. Depth 0 (top-level pages
    // under the Pages folder) still gets one rail to anchor them
    // under the section header above.
    const railColumn = (d) => 18 + d * 18;
    const guides = [];
    for (let i = 0; i <= depth; i++) {
      guides.push(h`<span key=${i} aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-border" style=${{ left: `${ railColumn(i) }px` }} />`);
    }
    return h`<div key=${item.id}>
      <div
        draggable
        onDragStart=${(e) => onRowDragStart(e, item.id, item)}
        onDragOver=${(e) => onRowDragOver(e, item.id)}
        onDragLeave=${onRowDragLeave}
        onDrop=${(e) => onRowDrop(e, item.id)}
        onClick=${() => { navigate(`/t/${tkey}/${item.id}`); onMobileClose?.(); }}
        className=${`relative flex items-center gap-2 pr-2 py-1.5 text-sm cursor-pointer hover:bg-muted ${ isDragOver ? 'bg-accent text-accent-foreground ring-1 ring-ring ring-inset' : '' }`}
        style=${{ paddingLeft: `${ railColumn(depth) + 10 }px` }}
        title=${`${title} — drag into the editor to insert <File ref="${slug}" />`}
      >
        ${guides}
        ${hasChildren
          ? h`<${Icon} name="folder" className="w-4 h-4 shrink-0 text-muted-foreground" />`
          : h`<${WPGlyph} icon=${iconPage} size=${20} className="shrink-0 text-muted-foreground" />`}
        <span className="truncate flex-1">${title}</span>
        ${hasChildren ? h`<span className="text-[10px] text-muted-foreground tabular-nums shrink-0">${children.length}</span>` : null}
      </div>
      ${children.map((c) => renderItem(c, depth + 1))}
    </div>`;
  };

  const roots = childrenByParent.get(0) || [];
  const headerActive = activeType === tkey;

  return h`<div
    onDragOver=${onRootDragOver}
    onDragLeave=${() => setRootDragOver(false)}
    onDrop=${onRootDrop}
    className=${rootDragOver ? 'bg-accent/30' : ''}
  >
    <div
      className=${`group w-full flex items-center gap-1.5 h-9 px-3 text-left text-sm font-semibold hover:bg-muted cursor-pointer ${ headerActive ? 'bg-muted text-foreground' : 'text-foreground' }`}
      onClick=${() => setOpen((v) => !v)}
      role="treeitem"
      aria-expanded=${open}
    >
      <${WPGlyph} icon=${open ? iconChevronDown : iconChevronRight} size=${12} className="shrink-0 -ml-0.5 text-muted-foreground group-hover:text-foreground" />
      <${Icon} name=${open ? 'folder-open' : 'folder'} className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">${meta.label}</span>
      ${loading ? h`<span className="text-[11px] text-muted-foreground">…</span>` : (Array.isArray(items) ? h`<span className="text-[11px] text-muted-foreground font-medium tabular-nums">${items.length}</span>` : null)}
    </div>
    ${open ? (() => {
      const creates = ({
        post: [['+ Post', '#/t/post/new']],
        page: [['+ Page', '#/t/page/new']],
      }[tkey] || [[`+ ${meta.singular}`, `#/t/${tkey}/new`]]);
      return h`<div>
      <div className="px-3 py-1.5" style=${{ display: 'grid', gridTemplateColumns: `repeat(${1 + creates.length}, minmax(0, 1fr))`, gap: '6px' }}>
        <${WPButton}
          size="compact"
          variant="secondary"
          href=${`#/t/${tkey}`}
          onClick=${onMobileClose}
          icon=${h`<${Icon} name="home" className="w-4 h-4" />`}
          label=${`${meta.label} home`}
          showTooltip=${true}
          className="w-full justify-center"
        />
        ${creates.map(([label, href]) => h`<${WPButton}
          key=${href}
          size="compact"
          variant="secondary"
          href=${href}
          icon=${h`<${Icon} name="file-circle-plus" className="w-4 h-4" />`}
          label=${label.replace(/^\+\s*/, 'New ')}
          showTooltip=${true}
          className="w-full justify-center"
        />`)}
      </div>
      ${Array.isArray(items) && items.length === 0 && !loading
        ? h`<div className="px-3 py-1.5 text-xs text-muted-foreground italic">No ${meta.label.toLowerCase()}</div>`
        : roots.map((it) => renderItem(it, 0))}
    </div>`;
    })() : null}
  </div>`;
}

// Generic flat nav row used inside grouped tree sections. Visually
// mirrors a Context TypeFolder header (folder icon + bold label) so
// the unified sidebar reads as one consistent tree, not two stacked
// designs. Accepts either a React route (`to`) — used for WP types
// whose list views live inside the Context shell — or an external
// admin URL (`href`) — used for WooCommerce + extensions which keep
// their own dedicated wp-admin screens.
function TreeNavRow({ label, to, href, activeType, tkey, onMobileClose }) {
  const navigate = useNavigate();
  const active = !!(tkey && activeType === tkey);
  const onClick = (e) => {
    if (to) {
      e.preventDefault();
      navigate(to);
      onMobileClose?.();
    }
  };
  return h`<a
    href=${href || (to ? '#' : '#')}
    onClick=${onClick}
    className=${`group w-full flex items-center gap-1.5 h-9 px-3 text-left text-sm font-semibold no-underline hover:bg-muted ${ active ? 'bg-muted text-foreground' : 'text-foreground' }`}
  >
    <span className="w-5 shrink-0" aria-hidden="true" />
    <${Icon} name="folder" className="w-4 h-4 shrink-0 text-muted-foreground" />
    <span className="flex-1 truncate">${label}</span>
  </a>`;
}

// App-contributed nav destination (CIRegistry.navRows). Mirrors the
// flush-left, caret-less markup of Calendar / Content Types so registered
// rows sit alongside the built-ins without the type layer knowing about them.
function RegistryNavRow({ row, onMobileClose }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const active = typeof row.match === 'function'
    ? !!row.match(loc.pathname)
    : (loc.pathname === row.path || loc.pathname.indexOf(row.path + '/') === 0);
  return h`<a
    href=${'#' + row.path}
    onClick=${(e) => { e.preventDefault(); navigate(row.path); onMobileClose?.(); }}
    className=${`group w-full flex items-center gap-1.5 h-9 px-3 text-left text-sm font-semibold no-underline hover:bg-muted ${ active ? 'bg-muted text-foreground' : 'text-foreground' }`}
  >
    <${Icon} name=${row.icon || 'folder'} className="w-4 h-4 shrink-0 text-muted-foreground" />
    <span className="flex-1 truncate">${row.label || row.key}</span>
    ${row.badge ? h`<span style=${{ minWidth: '1.25rem' }} className="ml-auto shrink-0 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-semibold">${row.badge}</span>` : null}
  </a>`;
}

// WooCommerce rows shown when BOOT.woocommerce.active is true.
// Mirrors the home-page WC tiles but flattened: each entry is one
// click. Extension rows only appear when their detection flag is set.
function buildWcNavRows() {
  const wc = BOOT.woocommerce || { active: false, extensions: {} };
  if (!wc.active) return [];
  const rows = [
    { key: 'wc-products', label: 'Products', href: '/wp-admin/edit.php?post_type=product' },
    { key: 'wc-orders',   label: 'Orders',   href: '/wp-admin/admin.php?page=wc-orders' },
    { key: 'wc-coupons',  label: 'Coupons',  href: '/wp-admin/edit.php?post_type=shop_coupon' },
  ];
  const ext = wc.extensions || {};
  if (ext.payments)      rows.push({ key: 'wc-payments',      label: 'Payments',      href: '/wp-admin/admin.php?page=wc-admin&path=%2Fpayments%2Ftransactions' });
  if (ext.analytics)     rows.push({ key: 'wc-analytics',     label: 'Analytics',     href: '/wp-admin/admin.php?page=wc-admin&path=%2Fanalytics%2Foverview' });
  if (ext.mailpoet)      rows.push({ key: 'wc-mailpoet',      label: 'MailPoet',      href: '/wp-admin/admin.php?page=mailpoet-newsletters' });
  if (ext.subscriptions) rows.push({ key: 'wc-subscriptions', label: 'Subscriptions', href: '/wp-admin/edit.php?post_type=shop_subscription' });
  if (ext.bookings)      rows.push({ key: 'wc-bookings',      label: 'Bookings',      href: '/wp-admin/edit.php?post_type=wc_booking' });
  if (ext.automatewoo)   rows.push({ key: 'wc-automatewoo',   label: 'AutomateWoo',   href: '/wp-admin/admin.php?page=automatewoo-workflows' });
  return rows;
}
const WC_NAV_ROWS = buildWcNavRows();

// Sidebar-placement options for an adopted CPT: its own group, the shared
// Context section, nested under another Context type, or under the WordPress
// / WooCommerce groups. Shared by Settings → Content types and the per-CPT
// General tab in the manage view.
function cptPlacementOptions(slug) {
  return [
    { value: 'own', label: 'Its own group' },
    { value: 'unified', label: 'Context section' },
    ...UNIFIED_TYPES
      .filter((tk) => tk !== slug)
      .map((tk) => ({ value: `under:${tk}`, label: `Under ${typeMeta(tk)?.label || tk}` })),
    { value: 'under:wordpress', label: 'Under WordPress' },
    ...(WC_NAV_ROWS.length ? [{ value: 'under:woocommerce', label: 'Under WooCommerce' }] : []),
  ];
}

function UnifiedTreePanel({ activeType, activeId, mobileOpen, onMobileClose }) {
  const [q, setQ] = useState('');

  // Re-render when a nav-row badge changes (setNavBadge dispatches the event).
  const [, bumpBadges] = useState(0);
  useEffect(() => {
    const h2 = () => bumpBadges((n) => n + 1);
    window.addEventListener('ci:nav-badges', h2);
    return () => window.removeEventListener('ci:nav-badges', h2);
  }, []);

  // Persisted top-level order. Reconcile with UNIFIED_TYPES so newly-added
  // types (or removed ones) don't break the existing user ordering.
  const [typeOrder, setTypeOrder] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(TYPE_ORDER_KEY) || 'null');
      if (Array.isArray(stored) && stored.length) return stored;
    } catch {}
    return UNIFIED_TYPES.slice();
  });
  const orderedTypes = useMemo(() => {
    const inOrder = typeOrder.filter((t) => UNIFIED_TYPES.includes(t));
    const missing = UNIFIED_TYPES.filter((t) => !inOrder.includes(t));
    return [...inOrder, ...missing];
  }, [typeOrder]);
  useEffect(() => {
    try { localStorage.setItem(TYPE_ORDER_KEY, JSON.stringify(orderedTypes)); } catch {}
  }, [orderedTypes]);

  // Per-type collapse — default: active type expanded, all others collapsed.
  const [collapsed, setCollapsed] = useState(() => {
    const init = {};
    for (const t of UNIFIED_TYPES) init[t] = (t !== activeType);
    return init;
  });
  useEffect(() => {
    if (activeType && UNIFIED_TYPES.includes(activeType)) {
      setCollapsed((c) => ({ ...c, [activeType]: false }));
    }
  }, [activeType]);
  const toggleCollapsed = (t) => setCollapsed((c) => ({ ...c, [t]: !c[t] }));

  // Partition the unified type set by configured sidebar placement:
  //   'unified' (default) → the shared Context section
  //   'own'               → its own nav group (header = the type's label)
  //   'under:<key>'       → nested (indented) beneath that group/type key
  const placementOf = (t) => (typeMeta(t)?.placement || 'unified');
  const ctxTypes = orderedTypes.filter((t) => placementOf(t) === 'unified');
  const ownTypes = orderedTypes.filter((t) => placementOf(t) === 'own');
  const underByParent = {};
  for (const t of orderedTypes) {
    const p = placementOf(t);
    if (p.indexOf('under:') === 0) {
      const par = p.slice(6);
      (underByParent[par] = underByParent[par] || []).push(t);
    }
  }
  // Orphans: under:<key> whose parent isn't a rendered anchor → show in Context.
  const handledParents = new Set([...ctxTypes, ...ownTypes, 'wordpress', 'woocommerce']);
  const orphanUnder = Object.keys(underByParent)
    .filter((par) => !handledParents.has(par))
    .flatMap((par) => underByParent[par]);

  // Render one TypeFolder (optionally indented for `under:` nesting).
  const folderEl = (t, indent) => h`<div key=${t} className=${indent ? 'pl-3' : ''}>
    <${TypeFolder}
      type=${t}
      q=${q}
      collapsed=${collapsed[t]}
      onToggle=${() => toggleCollapsed(t)}
      activeType=${activeType}
      activeId=${activeId}
      onMobileClose=${onMobileClose}
      onMoveTypeFolder=${onMoveTypeFolder}
    />
  </div>`;

  const onMoveTypeFolder = useCallback((sourceType, targetType) => {
    setTypeOrder((order) => {
      const out = order.filter((t) => t !== sourceType);
      const idx = out.indexOf(targetType);
      if (idx === -1) return [...out, sourceType];
      out.splice(idx, 0, sourceType);
      return out;
    });
  }, []);

  // Tree mode: 'unified' (all sections) or 'focused' (only the active type's
  // own tree). Toggled from the footer; persisted per browser.
  // v2 key: the default flipped from 'unified' to 'focused' (the WP admin
  // sidebar now owns cross-section navigation, so the in-app tree defaults to
  // just the current type). Bumping the key lets the new default take effect
  // once even where an old 'unified' choice was persisted; the toggle still
  // saves the user's preference to the v2 key thereafter.
  const TREE_MODE_KEY = 'os-tree-mode-v2';
  const [treeMode, setTreeMode] = useState(() => {
    try { return localStorage.getItem(TREE_MODE_KEY) || 'focused'; } catch { return 'focused'; }
  });
  const setTreeModePersist = (m) => { setTreeMode(m); try { localStorage.setItem(TREE_MODE_KEY, m); } catch {} };
  // Only focus when we actually have an active type CI can render standalone.
  const canFocus = !!activeType && (UNIFIED_TYPES.includes(activeType) || WP_NAV_TYPES.some((t) => t.key === activeType));
  const focusedType = (treeMode === 'focused' && canFocus) ? activeType : null;

  const asideClass = `
    bg-sidebar border-r border-border flex-col overflow-hidden
    ${mobileOpen ? 'flex fixed inset-y-0 left-0 z-50 w-72 shadow-xl' : 'hidden'}
    md:flex md:absolute md:inset-y-0 md:left-0 md:shadow-none md:z-auto
  `;
  const { width: sidebarW2, isMd: paneMd2 } = useSidebarWidth();
  const asideStyle = paneMd2 ? { width: sidebarW2 } : undefined;

  return h`<${Fragment}>
    ${mobileOpen ? h`<div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick=${onMobileClose} />` : null}
    <aside className=${asideClass} style=${asideStyle}>
      <${SidebarResizer} />
      <div className="min-h-14 px-3 py-2 flex items-center gap-2 border-b border-border shrink-0">
        <div className="flex-1 min-w-0 flex flex-col justify-center leading-tight">
          <span className="font-semibold text-foreground text-sm truncate" title=${BOOT.site_name || 'Context'}>${BOOT.site_name || 'Context'}</span>
          ${BOOT.site_description ? h`<span className="text-[11px] text-muted-foreground truncate" title=${BOOT.site_description}>${BOOT.site_description}</span>` : null}
        </div>
        ${mobileOpen ? h`<button onClick=${onMobileClose} className="md:hidden ml-1 text-muted-foreground text-xl leading-none w-7 h-7 flex items-center justify-center hover:text-foreground" aria-label="Close menu">×</button>` : null}
      </div>
      <div className="px-2 py-2 border-b border-border shrink-0 os-wpds-fields os-sidebar-search">
        <${WPSearchControl}
          __nextHasNoMarginBottom
          size="compact"
          value=${q}
          onChange=${setQ}
          placeholder="Filter all…"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        ${/* Built-in destinations (Calendar, Activity, Tracker, …) live in the
            wp-admin sidebar; rows flagged adminMenu skip the panel so it
            starts at the content. Sideloaded apps' rows still render. */ ''}
        ${CIRegistry.navRows.slice().filter((row) => !row.adminMenu).sort((a, b) => (a.order || 0) - (b.order || 0)).map((row) => h`<${RegistryNavRow} key=${row.key} row=${row} onMobileClose=${onMobileClose} />`)}
        ${focusedType ? (() => {
          // Focused mode — render only the active type's own tree.
          const wp = WP_NAV_TYPES.find((t) => t.key === focusedType);
          if (wp) {
            const isTermLike = new Set(['category', 'tag']).has(focusedType);
            return h`<${Fragment}>
              <${TreeGroupHeader} label="WordPress" />
              ${(focusedType === 'media' || (!isTermLike && wp.meta.kind === 'attachment'))
                ? h`<${TreeNavRow} tkey=${wp.key} label=${wp.meta.label} to=${`/t/${wp.key}`} activeType=${activeType} onMobileClose=${onMobileClose} />`
                : h`<${ExpandablePagesSection} tkey=${wp.key} meta=${wp.meta} activeType=${activeType} onMobileClose=${onMobileClose} />`}
            </${Fragment}>`;
          }
          return h`<${Fragment}>
            <${TreeGroupHeader} label="Context" />
            <${TypeFolder} type=${focusedType} q=${q} collapsed=${false} onToggle=${() => {}} activeType=${activeType} activeId=${activeId} onMobileClose=${onMobileClose} onMoveTypeFolder=${onMoveTypeFolder} />
          </${Fragment}>`;
        })() : h`<${Fragment}>
        <${TreeGroupHeader} label="WordPress" />
        ${(() => {
          // Posts + Pages (and Categories/Tags) get the expandable tree +
          // action row treatment. Categories/Tags are nested (indented)
          // under Posts since they classify posts. Media stays a flat row.
          const byKey = Object.fromEntries(WP_NAV_TYPES.map((t) => [t.key, t]));
          const known = new Set(['post', 'page', 'category', 'tag', 'media']);
          const sec = (t, indent) => h`<div key=${t.key} className=${indent ? 'pl-4' : ''}>
            <${ExpandablePagesSection} tkey=${t.key} meta=${t.meta} activeType=${activeType} onMobileClose=${onMobileClose} />
          </div>`;
          const nav = (t) => h`<${TreeNavRow} key=${t.key} tkey=${t.key} label=${t.meta.label} to=${`/t/${t.key}`} activeType=${activeType} onMobileClose=${onMobileClose} />`;
          const out = [];
          if (byKey.post) {
            out.push(sec(byKey.post));
            if (byKey.category) out.push(sec(byKey.category, true));
            if (byKey.tag) out.push(sec(byKey.tag, true));
          }
          if (byKey.page) out.push(sec(byKey.page));
          if (byKey.media) out.push(nav(byKey.media));
          for (const t of WP_NAV_TYPES) if (!known.has(t.key)) out.push(nav(t));
          return out;
        })()}
        ${(underByParent.wordpress || []).map((u) => folderEl(u, true))}
        ${(WC_NAV_ROWS.length || (underByParent.woocommerce || []).length) ? h`<${Fragment}>
          <${TreeGroupHeader} label="WooCommerce" />
          ${WC_NAV_ROWS.map((r) => h`<${TreeNavRow}
            key=${r.key}
            label=${r.label}
            href=${r.href}
            activeType=${activeType}
            onMobileClose=${onMobileClose}
          />`)}
          ${(underByParent.woocommerce || []).map((u) => folderEl(u, true))}
        </${Fragment}>` : null}
        <${TreeGroupHeader} label="Context" />
        ${ctxTypes.map((t) => h`<${Fragment} key=${`ctx-${t}`}>
          ${folderEl(t)}
          ${(underByParent[t] || []).map((u) => folderEl(u, true))}
        </${Fragment}>`)}
        ${orphanUnder.map((u) => folderEl(u))}
        ${ownTypes.map((t) => h`<${Fragment} key=${`own-${t}`}>
          <${TreeGroupHeader} label=${typeMeta(t)?.label || t} />
          ${folderEl(t)}
          ${(underByParent[t] || []).map((u) => folderEl(u, true))}
        </${Fragment}>`)}
        </${Fragment}>`}
      </div>
      <div className="shrink-0 border-t border-border px-2 py-1.5 flex items-center gap-1" role="group" aria-label="Tree view mode">
        ${[['focused', 'Focused'], ['unified', 'All']].map(([mode, label]) => h`<button
          key=${mode}
          type="button"
          aria-pressed=${treeMode === mode}
          onClick=${() => setTreeModePersist(mode)}
          className=${`text-[11px] px-2 py-0.5 rounded ${treeMode === mode ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
        >${label}</button>`)}
      </div>
    </aside>
  </${Fragment}>`;
}

/**
 * Layout used by all typed routes (/t/:type and /t/:type/:id).
 * TreePanel on the left for navigation; main content on the right.
 * Locks the document scroll via the os-typed-route body class.
 */
// Context that exposes the mobile drawer's open action to descendants —
// lets the EditorPage title bar host the menu button as a flex sibling
// of the title input (rather than a floating overlay).
const MenuCtx = createContext(null);
const useOpenMenu = () => useContext(MenuCtx)?.openMenu;


// Shared mobile menu trigger. Visually matches our other utility buttons:
// gray border, no border-radius, transparent fill, hover flips to black.
// Renders nothing when there's no MenuCtx in scope (e.g. top-level pages
// without a tree drawer).
function MobileMenuButton({ className = '' }) {
  const openMenu = useOpenMenu();
  if (!openMenu) return null;
  return h`<button
    type="button"
    onClick=${openMenu}
    aria-label="Open menu"
    className=${`md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 border border-border bg-transparent text-foreground hover:bg-foreground hover:text-background hover:border-foreground transition-colors ${className}`}
    style=${{ borderRadius: 0 }}
  >
    <${Icon} name="sidebar" className="w-5 h-5" />
  </button>`;
}

// Drag handle on the CI tree panel's right edge — sets `--os-tree-w`
// on :root while the user drags, persists the final value to
// localStorage. Hidden under the md breakpoint (mobile drawer has
// its own w-72 / max-md:w-64 sizing). Clamped to [180px, 640px] to
// keep both panes usable.
//
// IMPORTANT: this is `--os-tree-w`, NOT `--os-sidebar-w`. The latter
// is already used by context-app-shell.{js,css} to offset #os-app-root by
// the WP admin menu width. Reusing the same name would drag the
// entire app mount-point around alongside the tree.
function SidebarResizer() {
  const onPointerDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const root = document.documentElement;
    // Read the live width — falls back to 16rem (256px) when the var
    // hasn't been set yet. Use the rendered aside's width as the
    // truthful starting point (CSS-var may be empty on first drag).
    const aside = e.currentTarget.parentElement;
    const startW = aside?.getBoundingClientRect?.().width || 256;
    const node = e.currentTarget;
    node.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const next = Math.max(180, Math.min(640, startW + dx));
      root.style.setProperty('--os-tree-w', next + 'px');
      // Inline styles read this on every render via useSidebarWidth;
      // dispatch a custom event so the consumer re-renders mid-drag.
      window.dispatchEvent(new CustomEvent('os-tree-w-change'));
    };
    const onUp = () => {
      node.classList.remove('dragging');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        const val = root.style.getPropertyValue('--os-tree-w');
        if (val) localStorage.setItem('ci:tree-w', val);
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // Keyboard fallback — Left/Right arrows nudge the var by 16px so
  // resize is usable without a mouse.
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const root = document.documentElement;
    const cur = parseFloat(getComputedStyle(root).getPropertyValue('--os-tree-w')) || 256;
    const next = Math.max(180, Math.min(640, cur + (e.key === 'ArrowRight' ? 16 : -16)));
    root.style.setProperty('--os-tree-w', next + 'px');
    window.dispatchEvent(new CustomEvent('os-tree-w-change'));
    try { localStorage.setItem('ci:tree-w', next + 'px'); } catch {}
  };
  return h`<div
    className="os-sidebar-resizer"
    onMouseDown=${onPointerDown}
    onKeyDown=${onKeyDown}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    tabIndex=${0}
  />`;
}

// Live-tracked sidebar width. The CSS var on :root is the canonical
// source, but a stylesheet rule like `.os-main-md { left: var(...) }`
// ties on specificity with Tailwind's `left-0` and the winner depends
// on stylesheet load order — which proved non-deterministic in
// practice. Inline styles win unconditionally, so we read the var on
// every render and pass it through `style.left` / `style.width`.
function useSidebarWidth() {
  const read = () => {
    if (typeof window === 'undefined') return '16rem';
    const v = getComputedStyle(document.documentElement).getPropertyValue('--os-tree-w').trim();
    return v || '16rem';
  };
  const isMd = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  const [width, setWidth] = useState(read);
  const [md, setMd] = useState(isMd);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onMq = () => setMd(mq.matches);
    mq.addEventListener('change', onMq);
    // Poll-watch the var since CSS-property changes don't fire events.
    // The resizer drags it 60x/sec while held; RAF keeps us in step
    // without burning a setInterval forever (only runs while
    // SidebarResizer dispatches drag events).
    const onResize = () => setWidth(read());
    window.addEventListener('os-tree-w-change', onResize);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('os-tree-w-change', onResize);
    };
  }, []);
  return { width, isMd: md };
}

function TypeLayout({ type, activeId, mainClassName = 'absolute inset-y-0 right-0 left-0 overflow-y-auto', children }) {
  // The sidebar tree was removed: content fills the whole pane. Type-switching is
  // the header selector; every other destination lives in the Command Palette.
  // `type` / `activeId` stay in the signature for call-site compatibility.
  return h`<div className="absolute inset-0">
    <div className=${mainClassName}>
      ${children}
    </div>
  </div>`;
}

/**
 * /t/:type — TreePanel does the navigation; main pane shows a welcome
 * splash with the recent items for this type so the user doesn't see
 * an empty rectangle while they pick something from the tree.
 */
// One-shot import: every JS built-in template with a `template` string
// gets POSTed as a os_snippet post (frontmatter header + body), tagged
// via `os_builtin_id` meta so the Add menu can dedup. Skips templates
// that already have a corresponding snippet, so re-running adds only
// what's new (useful when we ship more templates in a later release).
// Returns `{ created, skipped }`.
async function seedBuiltinSnippetsFromJs() {
  let existing = [];
  try {
    existing = await restAllPages('/wp/v2/os_snippet?per_page=100&_fields=id,meta');
  } catch { /* fall through; treat as empty */ }
  const haveIds = new Set(
    (existing || []).map((p) => (p?.meta?.os_builtin_id || '').trim()).filter(Boolean)
  );
  let created = 0;
  let skipped = 0;
  for (const it of MARKDOWN_INSERT_TEMPLATES) {
    if (haveIds.has(it.id)) { skipped++; continue; }
    const fmLines = ['---'];
    fmLines.push(`section: ${it.section || 'Custom'}`);
    fmLines.push(`label: ${it.label}`);
    if (it.tip) fmLines.push(`tip: "${String(it.tip).replace(/"/g, '\\"')}"`);
    if (it.cursorOffset) fmLines.push(`cursoroffset: ${it.cursorOffset}`);
    fmLines.push('---', '');
    const content = fmLines.join('\n') + it.template;
    try {
      await rest('/wp/v2/os_snippet', {
        method: 'POST',
        body: JSON.stringify({
          title: it.label,
          content,
          status: 'publish',
          excerpt: it.tip || '',
          meta: {
            os_section: it.section || 'Custom',
            os_tip: it.tip || '',
            os_builtin_id: it.id,
          },
        }),
      });
      created++;
    } catch (e) {
      // Don't abort the loop on a single failure — log and keep going so
      // the user gets as many templates as we could create. The next
      // run picks up the rest.
      console.warn('Failed to seed snippet:', it.label, e?.message || e);
    }
  }
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// DataViewsIndex — a lightweight, DataViews-style index for CPT lists.
//
// Mirrors the @wordpress/dataviews "with card" story's UX (search + a
// list/grid layout toggle + sort + pagination) without vendoring the real
// package (it can't reuse our bridged @wordpress/components — private-apis
// lock). Built entirely on the WPDS components we already bridge so it
// shares the app's component context and design language.
//
// `items` are normalizeItem()-shaped: { id, title:{rendered}, slug,
// modified, meta:{os_path}, count?, edit_url? }. `native` routes the row
// to the real editor (edit_url); otherwise it Links to the in-app editor.
// ---------------------------------------------------------------------------
const INDEX_PAGE_SIZE = 24;
const INDEX_SORTS = [
  { value: 'recent',  label: 'Recently edited' },
  { value: 'oldest',  label: 'Oldest first' },
  { value: 'az',      label: 'Title A–Z' },
  { value: 'za',      label: 'Title Z–A' },
];

// Multi-select filter control for the adopted-CPT index bar. Acts like a
// dropdown: the toggle shows the picked values as removable chips (or an
// "All …" placeholder), and the choices live in a floating Popover checkbox
// list so they never collide with neighbouring filters the way an inline
// token-field suggestion list does. value/onChange are arrays of strings.
// `open`/`onOpenChange` lift the menu's open state to the parent so only one
// filter is ever open — opening a second closes the first instead of letting
// the portaled popovers overlap. Falls back to uncontrolled if omitted.
function FilterDropdown({ label, options, value, onChange, open, onOpenChange }) {
  const selected = Array.isArray(value) ? value : [];
  const [q, setQ] = useState('');
  const toggle = (item) => onChange(selected.includes(item) ? selected.filter((x) => x !== item) : [...selected, item]);
  const showSearch = options.length > 8;
  const ql = q.trim().toLowerCase();
  const visible = ql ? options.filter((o) => o.toLowerCase().includes(ql)) : options;
  // Closing externally (a sibling opening) skips WPDropdown's onClose, so clear
  // the search box here whenever the menu is not open.
  useEffect(() => { if (!open) setQ(''); }, [open]);
  return h`<div className="os-filter">
    <div className="os-filter-label">${label}</div>
    <${WPDropdown}
      className="os-filter-dd"
      popoverProps=${{ placement: 'bottom-start' }}
      open=${open}
      onToggle=${(next) => onOpenChange && onOpenChange(next)}
      onClose=${() => setQ('')}
      renderToggle=${({ isOpen, onToggle }) => h`<div
          className=${`os-filter-toggle${isOpen ? ' is-open' : ''}`}
          role="button" tabIndex=${0} aria-haspopup="listbox" aria-expanded=${isOpen}
          onClick=${onToggle}
          onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); onToggle(); } }}
        >
          <div className="os-filter-chips">
            ${selected.length === 0
              ? h`<span className="os-filter-placeholder">All ${label.toLowerCase()}</span>`
              : selected.map((v) => h`<span key=${v} className="os-filter-chip">
                  <span className="os-filter-chip-label">${v}</span>
                  <button type="button" className="os-filter-chip-x" aria-label=${`Remove ${v}`}
                    onClick=${(e) => { e.stopPropagation(); toggle(v); }}>
                    <${WPGlyph} icon=${iconClose} size=${8} />
                  </button>
                </span>`)}
          </div>
          <${WPGlyph} icon=${iconChevronDown} size=${12} className="os-filter-caret" />
        </div>`}
      renderContent=${() => h`<div className="os-filter-menu">
        ${showSearch ? h`<div className="os-filter-menu-search">
          <${WPSearchControl} __nextHasNoMarginBottom value=${q} onChange=${setQ} placeholder=${`Filter ${label.toLowerCase()}…`} />
        </div>` : null}
        <div className="os-filter-menu-list">
          ${visible.length === 0
            ? h`<div className="os-filter-menu-empty">No matches</div>`
            : visible.map((o) => h`<${WPMenuItem}
                key=${o}
                role="menuitemcheckbox"
                isSelected=${selected.includes(o)}
                icon=${selected.includes(o) ? iconCheck : undefined}
                onClick=${() => toggle(o)}
              >${o}</${WPMenuItem}>`)}
        </div>
        ${selected.length ? h`<div className="os-filter-menu-foot">
          <${WPButton} variant="link" onClick=${() => onChange([])}>Clear</${WPButton}>
        </div>` : null}
      </div>`}
    />
    ${/* Per-column clear, in a reserved-height slot so toggling it never shifts
        the row (replaces the row-level "Clear filters" link that did). */''}
    <div className="os-filter-clear" style=${{ minHeight: '1.125rem', marginTop: '0.375rem' }}>
      ${selected.length ? h`<button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick=${() => onChange([])}>Clear</button>` : null}
    </div>
  </div>`;
}

function DataViewsIndex({ type, meta, items, loading, native, isTerm, descriptor }) {
  const layoutKey = `os-index-layout-${type}`;
  const [layout, setLayout] = useState(() => {
    try { return localStorage.getItem(layoutKey) || 'list'; } catch { return 'list'; }
  });
  const setLayoutPersist = (l) => { setLayout(l); try { localStorage.setItem(layoutKey, l); } catch {} };
  const display = descriptor?.display || {};
  const showFilter = (key) => !Array.isArray(display.filters) || display.filters.includes(key);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(display.sort || 'recent');
  const [page, setPage] = useState(1);
  // Field/taxonomy-driven filters (adopted CPTs). Key form: `tax:<slug>` and
  // `meta:<key>`; '' = no filter.
  const [filters, setFilters] = useState({});
  // Which filter dropdown is open (its key, or null) — single source of truth so
  // the portaled popovers never overlap.
  const [openFilter, setOpenFilter] = useState(null);
  useEffect(() => { setPage(1); }, [search, sort, type, filters]);
  useEffect(() => { setFilters({}); }, [type]);

  const dTaxes = (descriptor?.taxonomies || []);
  const dFields = (descriptor?.fields || []);
  // Filter options come from each taxonomy's full term list (not just terms
  // present in the loaded page), so a filter lists every choice even when no
  // item on the page uses it yet.
  const [taxTerms, setTaxTerms] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const t of dTaxes) {
        const base = t.rest_base || t.slug;
        try {
          const rows = await restAllPages(`/wp/v2/${base}?per_page=100&hide_empty=false&orderby=name&order=asc&_fields=name`);
          out[t.slug] = (rows || []).map((r) => decodeEntities(r.name)).filter(Boolean);
        } catch { out[t.slug] = []; }
      }
      if (alive) setTaxTerms(out);
    })();
    return () => { alive = false; };
  }, [type, dTaxes.map((t) => t.slug).join(',')]);
  const enumFields = dFields.filter((f) => f.type === 'enum');
  const boolFields = dFields.filter((f) => f.type === 'boolean');
  const hasFilters = dTaxes.some((t) => showFilter(`tax:${t.slug}`)) || enumFields.some((f) => showFilter(`meta:${f.key}`)) || boolFields.some((f) => showFilter(`meta:${f.key}`));
  const termsOf = (it, tax) => (Array.isArray(it[tax.field]) ? it[tax.field] : []);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const titleOf = (it) => it.title?.rendered || it.slug || '(untitled)';
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let arr = items;
    if (q) arr = arr.filter((it) => (titleOf(it) + ' ' + (it.slug || '') + ' ' + (it.meta?.os_path || '')).toLowerCase().includes(q));
    for (const t of dTaxes) {
      // Multi-select: an item matches if it carries ANY of the picked terms
      // (OR within a field); fields still AND across each other.
      const want = filters[`tax:${t.slug}`];
      if (Array.isArray(want) && want.length) arr = arr.filter((it) => want.some((w) => termsOf(it, t).includes(w)));
    }
    for (const f of enumFields) {
      const want = filters[`meta:${f.key}`];
      if (Array.isArray(want) && want.length) arr = arr.filter((it) => want.includes(String(it.meta?.[f.key] ?? '')));
    }
    for (const f of boolFields) {
      const want = filters[`meta:${f.key}`];
      if (want) arr = arr.filter((it) => (!!it.meta?.[f.key]) === (want === 'yes'));
    }
    const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b));
    const byDate = (a, b) => String(b.modified || '').localeCompare(String(a.modified || ''));
    arr = arr.slice().sort(
      sort === 'az' ? byTitle :
      sort === 'za' ? (a, b) => byTitle(b, a) :
      sort === 'oldest' ? (a, b) => -byDate(a, b) :
      byDate
    );
    return arr;
  }, [items, q, sort, filters, descriptor]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / INDEX_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * INDEX_PAGE_SIZE;
  const shown = filtered.slice(start, start + INDEX_PAGE_SIZE);

  const metaLine = (it) => isTerm
    ? (typeof it.count === 'number' ? `${it.count} post${it.count === 1 ? '' : 's'}` : '')
    : (it.modified ? new Date(it.modified).toLocaleDateString() : '');

  // Wrap a card/row in the right link element: native → real editor href,
  // otherwise the in-app Link. Block-level so the whole card is clickable.
  const linkWrap = (it, className, children) => (native && it.edit_url)
    ? h`<a key=${it.id} href=${it.edit_url} className=${className}>${children}</a>`
    : h`<${Link} key=${it.id} to=${`/t/${type}/${it.id}`} className=${className}>${children}</${Link}>`;

  // Columns shown on each list row. display.columns (keys `tax:<slug>` /
  // `meta:<key>`) overrides the default (taxonomies as chips).
  const columnFields = (() => {
    // Presentational layout blocks + rich text never make sensible columns.
    const fs = dFields.filter((f) => !FG_PRESENTATIONAL.has(f.type) && f.type !== 'richtext');
    if (Array.isArray(display.columns)) {
      return fs.filter((f) => display.columns.includes(f.type === 'taxonomy' ? `tax:${f.taxonomy}` : `meta:${f.key}`));
    }
    return fs.filter((f) => f.type === 'taxonomy');
  })();
  const colValues = (it, f) => {
    if (f.type === 'taxonomy') return Array.isArray(it[f.field]) ? it[f.field] : [];
    const v = it.meta ? it.meta[f.key] : undefined;
    if (Array.isArray(v)) return v;
    return (v === '' || v === null || v === undefined || v === false) ? [] : [String(v)];
  };
  const rowCols = (it) => {
    if (!columnFields.length) return null;
    const chips = columnFields.flatMap((f) => colValues(it, f).slice(0, 5).map((v, i) => ({ key: f.key + '-' + i, label: decodeEntities(String(v)) })));
    if (!chips.length) return null;
    return h`<div className="flex flex-wrap gap-1 mt-1">
      ${chips.slice(0, 8).map((c) => h`<span key=${c.key} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">${c.label}</span>`)}
    </div>`;
  };

  const card = (it) => linkWrap(it, 'no-underline text-foreground', h`<${WPCard} size="small" isRounded=${true} className="h-full os-card-hover">
    <${WPCardBody}>
      <div className="flex items-start gap-2">
        <${WPGlyph} icon=${iconPage} size=${24} className="shrink-0 text-muted-foreground mt-px" />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate leading-snug" title=${titleOf(it)}>${titleOf(it)}</div>
          ${it.slug ? h`<div className="text-[11px] font-mono text-muted-foreground/70 truncate mt-0.5">${it.slug}</div>` : null}
          ${rowCols(it)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-3">${metaLine(it)}</div>
    </${WPCardBody}>
  </${WPCard}>`);

  const row = (it) => linkWrap(it, 'block px-4 py-3 hover:bg-muted no-underline text-foreground', h`<div className="flex items-center justify-between gap-3">
    <div className="min-w-0 flex items-center gap-2">
      <${WPGlyph} icon=${iconPage} size=${20} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-medium truncate">${titleOf(it)}</div>
        ${it.slug ? h`<div className="text-[11px] font-mono text-muted-foreground/70 truncate">${it.slug}</div>` : null}
        ${rowCols(it)}
      </div>
    </div>
    <div className="text-xs text-muted-foreground shrink-0">${metaLine(it)}</div>
  </div>`);

  const layoutBtn = (id, icon, label) => h`<${WPButton}
    size="small"
    icon=${icon}
    isPressed=${layout === id}
    onClick=${() => setLayoutPersist(id)}
    label=${label}
    showTooltip=${true}
  />`;

  return h`<div>
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="flex-1 min-w-[180px] os-wpds-fields os-index-search">
        <${WPSearchControl}
          __nextHasNoMarginBottom
          value=${search}
          onChange=${setSearch}
          placeholder=${`Search ${meta.label.toLowerCase()}…`}
        />
      </div>
      <div className="os-wpds-fields">
        <${SelectMenu}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          value=${sort}
          onChange=${setSort}
          options=${INDEX_SORTS}
          aria-label="Sort"
        />
      </div>
      <div className="flex items-center gap-0.5 border border-border rounded-[2px] p-0.5">
        ${layoutBtn('list', iconListView, 'List view')}
        ${layoutBtn('grid', iconGrid, 'Grid view')}
      </div>
    </div>

    ${hasFilters ? h`<div className="flex flex-wrap items-start gap-2 mb-4 os-wpds-fields">
      ${dTaxes.filter((t) => showFilter(`tax:${t.slug}`)).map((t) => {
        const all = (taxTerms[t.slug] && taxTerms[t.slug].length)
          ? taxTerms[t.slug]
          : [...new Set(items.flatMap((it) => termsOf(it, t)))].sort();
        const fk = `tax:${t.slug}`;
        return h`<${FilterDropdown}
          key=${'tax-' + t.slug}
          label=${t.label}
          options=${all}
          value=${filters[fk] || []}
          onChange=${(next) => setFilter(fk, next)}
          open=${openFilter === fk}
          onOpenChange=${(o) => setOpenFilter(o ? fk : null)}
        />`;
      })}
      ${enumFields.filter((f) => showFilter(`meta:${f.key}`)).map((f) => {
        const fk = `meta:${f.key}`;
        return h`<${FilterDropdown}
          key=${'en-' + f.key}
          label=${f.label}
          options=${(f.enum || []).filter(Boolean)}
          value=${filters[fk] || []}
          onChange=${(next) => setFilter(fk, next)}
          open=${openFilter === fk}
          onOpenChange=${(o) => setOpenFilter(o ? fk : null)}
        />`;
      })}
      ${boolFields.filter((f) => showFilter(`meta:${f.key}`)).map((f) => h`<div key=${'bl-' + f.key} className="os-filter">
          <div className="os-filter-label">${f.label}</div>
          <${SelectMenu}
            __nextHasNoMarginBottom __next40pxDefaultSize
            value=${filters[`meta:${f.key}`] || ''}
            onChange=${(v) => setFilter(`meta:${f.key}`, v)}
            options=${[{ label: 'Any', value: '' }, { label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]}
          />
        </div>`)}
    </div>` : null}

    ${loading ? h`<${WPCard} size="small"><div className="p-6 text-center"><${WPSpinner} /></div></${WPCard}>` :
      items.length === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No ${meta.label.toLowerCase()} yet — click “+ ${meta.singular}” above to create the first one.</div></${WPCard}>` :
      total === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No matches for “${search}”.</div></${WPCard}>` :
      layout === 'grid'
        ? h`<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">${shown.map(card)}</div>`
        : h`<${WPCard}><div className="divide-y divide-border">${shown.map(row)}</div></${WPCard}>`}

    ${total > INDEX_PAGE_SIZE ? h`<div className="flex items-center justify-between gap-3 mt-4">
      <span className="text-xs text-muted-foreground">${start + 1}–${Math.min(start + INDEX_PAGE_SIZE, total)} of ${total}</span>
      <div className="flex items-center gap-1">
        <${WPButton} size="small" icon=${iconChevronLeft} disabled=${safePage <= 1} onClick=${() => setPage((p) => Math.max(1, p - 1))} label="Previous page" showTooltip=${true} />
        <span className="text-xs text-muted-foreground tabular-nums px-1">${safePage} / ${pageCount}</span>
        <${WPButton} size="small" icon=${iconChevronRight} disabled=${safePage >= pageCount} onClick=${() => setPage((p) => Math.min(pageCount, p + 1))} label="Next page" showTooltip=${true} />
      </div>
    </div>` : null}
  </div>`;
}

// --- Inline-edit cells for the type listing's Edit mode --------------------
// The listing header carries a View / Edit toggle. In Edit mode each editable
// column renders a live control instead of static text; committing auto-saves
// that single field to the row's post via `onSaveField` (one row = one post),
// so the list works like a lightweight admin-columns / spreadsheet view.
// @wordpress/dataviews has no native cell editor, so the field `render` owns it.
// Every editable cell uses the same pop-out card (CellEditPopover) rather than
// an in-place overlay input, so text, enum, boolean, and list all edit the same
// way (consistency with the long-form text editor).
const CELL_WRAP = { position: 'relative', width: '100%', minHeight: '24px', display: 'flex', alignItems: 'center' };
const CHIP_WRAP = { display: 'flex', flexWrap: 'wrap', gap: '4px' };
const CHIP_STYLE = { fontSize: '11px', background: 'var(--wp-components-color-gray-100,#f0f0f0)', color: 'var(--wp-components-color-gray-700,#757575)', padding: '1px 8px', borderRadius: '10px' };
function chipRow(arr) {
  return h`<div style=${CHIP_WRAP}>${(arr || []).map((v, i) => h`<span key=${i} style=${CHIP_STYLE}>${decodeEntities(String(v))}</span>`)}</div>`;
}

// Hover "edit" affordance shared by every editable cell, so editing is
// discoverable (the double-click still works). Reveals on cell hover via the
// parent's `group` class. onActivate receives the pencil's bounding rect so
// popover editors can anchor to it; in-place editors ignore it.
function CellPencil({ onActivate, label = 'Edit' }) {
  return h`<button type="button" tabIndex=${-1} title=${label}
    onMouseDown=${(e) => e.stopPropagation()}
    onClick=${(e) => { e.stopPropagation(); onActivate(e.currentTarget.getBoundingClientRect()); }}
    className="os-cell-pencil shrink-0 ml-1 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
  ><${Icon} name="file-pen" className="w-4 h-4" /></button>`;
}

// Shared overlay for every in-table editor (field popovers + the content
// editor): a dimmed backdrop confined to the #os-app-root app region (so the WP
// chrome stays clear) with the card centred inside it. Portaled into #os-app-root
// so the theme vars + #os-app-root-scoped utilities apply and the card escapes the
// table cell's overflow. `children` is the card; it should stopPropagation.
function CiCenteredOverlay({ onClose, children }) {
  const overlayStyle = {
    top: 'var(--os-adminbar-h, 32px)',
    left: 'var(--os-sidebar-w, 160px)',
    right: 0,
    bottom: 0,
  };
  const host = (typeof document !== 'undefined' && document.getElementById('os-app-root')) || (typeof document !== 'undefined' ? document.body : null);
  const tree = h`<div className="fixed z-[100000] flex items-center justify-center p-4" style=${overlayStyle} onClick=${onClose}>
    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
    ${children}
  </div>`;
  return host ? createPortal(tree, host) : tree;
}

// Shared preview cell: the resting state of every editable cell. Shows the
// value (`display`) plus a hover pencil; double-click, Enter, Space, or the
// pencil all call onActivate to open the editor popover. `children` is the
// popover itself (portaled out via CiCenteredOverlay) when open.
function EditableCell({ display, onActivate, cursor = 'pointer', children }) {
  return h`<div
    className="group"
    tabIndex=${0}
    onDoubleClick=${(e) => { e.stopPropagation(); onActivate(); }}
    onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
    title="Double-click or press Enter to edit"
    style=${{ ...CELL_WRAP, cursor }}
  >
    ${display}
    <${CellPencil} onActivate=${onActivate} />
    ${children}
  </div>`;
}

// Shared pop-out card for every in-table cell editor: a centred overlay over the
// #os-app-root app region with a titled card, the control as `children`, and a
// Cancel / Save footer. Esc closes; each control wires its own Enter-to-save.
// This is the single edit surface so text, enum, boolean, and list all edit the
// same way (it generalises the former TextPopover).
function CellEditPopover({ title, onClose, onSave, hint, saveLabel = 'Save', children }) {
  return h`<${CiCenteredOverlay} onClose=${onClose}>
    <div
      className="relative w-full max-w-md bg-card rounded-xl shadow-2xl border border-border overflow-hidden"
      onClick=${(e) => e.stopPropagation()}
      onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground truncate">${title || 'Edit'}</div>
        <${Button} variant="ghost" size="sm" onClick=${onClose} aria-label="Close"><${Icon} name="close" className="w-4 h-4" /></${Button}>
      </div>
      <div className="p-3">
        ${children}
        ${hint ? h`<div className="text-[11px] text-muted-foreground mt-2">${hint}</div>` : null}
      </div>
      <div className="px-4 py-2.5 border-t border-border bg-sidebar flex items-center justify-end gap-2">
        <${Button} variant="ghost" size="sm" onClick=${onClose}>Cancel</${Button}>
        <${Button} variant="primary" size="sm" onClick=${onSave}>${saveLabel}</${Button}>
      </div>
    </div>
  </${CiCenteredOverlay}>`;
}

// Text / textarea editor body (mounts when the popover opens, so the draft
// initialises from the current value). `multi` is the comma-separated chips
// editor (taxonomy terms / list fields); `roomy` uses a tall textarea for long
// or multi-line prose; otherwise a single-line TextControl.
function CellTextEditor({ title, value, type = 'text', multi = false, roomy = false, onClose, onCommit }) {
  const toStr = (v) => multi ? (Array.isArray(v) ? v.join(', ') : (v ?? '')) : (v ?? '');
  const [draft, setDraft] = useState(toStr(value));
  const save = () => {
    onClose();
    if (multi) {
      const arr = [...new Set(String(draft).split(',').map((s) => s.trim()).filter(Boolean))];
      const cur = Array.isArray(value) ? value : [];
      if (arr.join('') !== cur.join('')) onCommit(arr);
    } else if (String(draft) !== String(value ?? '')) onCommit(draft);
  };
  const useTextarea = roomy || multi;
  const body = useTextarea
    ? h`<${WPTextareaControl}
        label=${title} hideLabelFromVision=${true}
        value=${draft} onChange=${setDraft}
        rows=${multi ? 4 : 8} autoFocus=${true} __nextHasNoMarginBottom=${true}
        onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } }}
      />`
    : h`<${WPTextControl}
        label=${title} hideLabelFromVision=${true} type=${type}
        value=${draft} onChange=${setDraft}
        autoFocus=${true} __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
      />`;
  const hint = useTextarea ? '⌘/Ctrl + Enter to save, Esc to cancel.' : 'Enter to save, Esc to cancel.';
  return h`<${CellEditPopover} title=${title} onClose=${onClose} onSave=${save} hint=${hint}>${body}</${CellEditPopover}>`;
}

// Free-text / multi-value cell: preview (text or chips) + pop-out editor. `multi`
// is the comma-separated chips editor; `roomy` opens a tall textarea (decided by
// the caller via wantsTextPopover off the descriptor type), otherwise a
// single-line field. `type` is the HTML input type (text/number/date/url).
function EditCellText({ value, onCommit, type = 'text', multi = false, roomy = false, label = 'Edit' }) {
  const [open, setOpen] = useState(false);
  const display = multi
    ? ((Array.isArray(value) && value.length) ? chipRow(value) : h`<span>${' '}</span>`)
    : h`<span className="os-cell-text">${String(value ?? '') || ' '}</span>`;
  return h`<${EditableCell} display=${display} cursor=${multi ? 'pointer' : 'text'} onActivate=${() => setOpen(true)}>
    ${open ? h`<${CellTextEditor} title=${label} value=${value} type=${type} multi=${multi} roomy=${roomy}
        onClose=${() => setOpen(false)} onCommit=${onCommit} />` : null}
  </${EditableCell}>`;
}

// Enum cell: preview + pop-out SelectControl. Keeps the stored value selectable
// even if it predates the enum (legacy / hand-typed) so editing never drops it.
function EditCellSelect({ value, options, onCommit, label = 'Edit' }) {
  const [open, setOpen] = useState(false);
  const base = (Array.isArray(options) ? options : []).filter(Boolean);
  const cur = value == null ? '' : String(value);
  const opts = (cur && !base.includes(cur)) ? [cur, ...base] : base;
  const display = h`<span className="os-cell-text">${value ? decodeEntities(String(value)) : ' '}</span>`;
  return h`<${EditableCell} display=${display} onActivate=${() => setOpen(true)}>
    ${open ? h`<${CellSelectEditor} title=${label} value=${cur} options=${opts}
        onClose=${() => setOpen(false)} onCommit=${onCommit} />` : null}
  </${EditableCell}>`;
}
function CellSelectEditor({ title, value, options, onClose, onCommit }) {
  const [draft, setDraft] = useState(value);
  const save = () => { onClose(); if (draft !== value) onCommit(draft); };
  const opts = [{ label: '(none)', value: '' }, ...options.map((o) => ({ label: String(o), value: String(o) }))];
  return h`<${CellEditPopover} title=${title} onClose=${onClose} onSave=${save}>
    <${SelectMenu} label=${title} hideLabelFromVision=${true} value=${draft} onChange=${setDraft}
      options=${opts} __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
  </${CellEditPopover}>`;
}

// Boolean cell: preview + pop-out ToggleControl (Save commits), so a two-state
// field edits with the same confirm step as every other cell.
function EditCellBool({ value, onCommit, label = 'Edit' }) {
  const [open, setOpen] = useState(false);
  const display = h`<span>${value ? 'Yes' : 'No'}</span>`;
  return h`<${EditableCell} display=${display} onActivate=${() => setOpen(true)}>
    ${open ? h`<${CellBoolEditor} title=${label} value=${!!value}
        onClose=${() => setOpen(false)} onCommit=${onCommit} />` : null}
  </${EditableCell}>`;
}
function CellBoolEditor({ title, value, onClose, onCommit }) {
  const [draft, setDraft] = useState(!!value);
  const save = () => { onClose(); if (draft !== !!value) onCommit(draft); };
  return h`<${CellEditPopover} title=${title} onClose=${onClose} onSave=${save}>
    <${WPToggleControl} label=${draft ? 'Yes' : 'No'} checked=${draft} onChange=${setDraft} __nextHasNoMarginBottom=${true} />
  </${CellEditPopover}>`;
}

// Multi-value cell (taxonomy terms or a `list` field): the text cell in `multi`
// mode (chips display, comma-separated pop-out editor).
function EditCellList({ value, onCommit, label = 'Edit' }) {
  return h`<${EditCellText} value=${value} onCommit=${onCommit} multi=${true} label=${label} />`;
}

// Descriptor field types that map to a simple inline text-like editor. Enum,
// boolean, taxonomy, and list get their own controls (above). Relationship,
// richtext, and layout blocks (tab / notice / heading) are NOT inline-editable
// yet: relationship needs a post picker, and richtext is a poor fit for a table
// cell (use the row's Open action / full editor instead).
const EDITABLE_TEXT_TYPES = ['string', 'text', 'url', 'number', 'date'];
// A free-text cell opens the roomy popover instead of the in-place editor when
// its value is long or multi-line. Built-in CPTs introspect their meta as plain
// `string` (no textarea type), so a long Tip and a short Kind look identical by
// type; routing on the value keeps short fields inline and only the genuinely
// long ones pop a comfortable editor (same column, decided per row).
const POPOVER_TEXT_THRESHOLD = 60;
const wantsTextPopover = (type, value) => {
  if (type === 'text') return true; // declared textarea — always roomy
  if (type !== 'string') return false; // url / number / date stay in place
  const s = String(value ?? '');
  return s.length > POPOVER_TEXT_THRESHOLD || s.includes('\n');
};
function editInputType(t) {
  if (t === 'number') return 'number';
  if (t === 'date') return 'date';
  if (t === 'url') return 'url';
  return 'text';
}

// ---------------------------------------------------------------------------
// PathTreeIndex — the list rendered as its os_path folder tree.
//
// Chosen by the TYPE (display.layout === 'tree' in Manage <type>), never by a
// per-visit toggle. The always-on sidebar tree was removed on purpose
// (TypeLayout's comment); this brings back the one thing the palette does not
// do well — SEEING the folder structure — for exactly the types that want it.
// Same items the table renders, grouped client-side with buildPathTree: no
// extra endpoint, and Edit mode keeps the table (inline editing needs cells).
function PathTreeIndex({ type, tree, searching, loading }) {
  // Rows only: the search box and the filter row (Tags, enum fields) are the
  // DataViews index's own — this renders inside it, so View <-> Edit shares
  // one chrome. Closed-set, not open-set: folders default to visible, so the
  // common case (scan the whole map) needs zero clicks. A live search
  // overrides it — the matches must be visible wherever they sit.
  const [closed, setClosed] = useState(() => new Set());
  const toggle = (p) => setClosed((prev) => {
    const n = new Set(prev);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });

  const rows = [];
  const walk = (node, depth) => {
    for (const c of node.children) {
      const isOpen = searching || !closed.has(c.fullPath);
      const n = subtreeItemIds(c).length;
      rows.push(h`<button
        type="button"
        key=${'d:' + c.fullPath}
        onClick=${() => toggle(c.fullPath)}
        className="os-tree-row w-full flex items-center gap-2 pr-3 text-sm hover:bg-muted/50 text-left"
        style=${{ paddingLeft: `${12 + depth * 22}px`, height: '44px' }}
      >
        <${Icon} name=${isOpen ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 os-tree-muted shrink-0" />
        <${Icon} name=${isOpen ? 'folder-open' : 'folder'} className="w-4 h-4 os-tree-muted shrink-0" />
        <span className="font-medium truncate">${c.name}</span>
        <span className="text-xs os-tree-muted shrink-0">${n}</span>
      </button>`);
      if (isOpen) walk(c, depth + 1);
    }
    for (const it of node.items) {
      rows.push(h`<a
        key=${'f:' + it.id}
        href=${`#/t/${type}/${it.id}`}
        className="os-tree-row flex items-center gap-2 pr-3 text-sm hover:bg-muted/50 no-underline"
        style=${{ paddingLeft: `${12 + depth * 22 + 22}px`, height: '44px', color: 'inherit' }}
      >
        <${Icon} name="file" className="w-3.5 h-3.5 os-tree-muted shrink-0" />
        <span className="truncate" style=${{ fontWeight: 500 }}>${decodeEntities(it.title?.rendered || it.slug || '(untitled)')}</span>
        ${it.status && it.status !== 'publish' ? h`<${Badge} variant="secondary">${it.status}</${Badge}>` : null}
        <span className="ml-auto text-xs shrink-0" style=${{ color: 'var(--wp-components-color-gray-700,#757575)' }}>${it.modified ? new Date(it.modified).toLocaleDateString() : ''}</span>
      </a>`);
    }
  };
  walk(tree, 0);

  return h`<div>
    ${loading
      ? h`<div className="py-10 flex justify-center"><${Spinner} /></div>`
      : !rows.length
      ? h`<div className="py-10 text-center text-sm text-muted-foreground">${searching ? 'No matches.' : 'Nothing here yet.'}</div>`
      : h`<div className="os-tree">
          <div className="os-tree-head flex items-center pr-3 h-9 text-[11px] font-medium uppercase tracking-wide os-tree-muted" style=${{ paddingLeft: '12px' }}>
            <span>Title</span>
            <span className="ml-auto">Updated</span>
          </div>
          ${rows}
        </div>`}
  </div>`;
}

// Real @wordpress/dataviews index (vendored bundle, assets/vendor/wp-dataviews.js).
// Same contract as the legacy DataViewsIndex, but renders the genuine native
// DataViews (search / sort / filters / table+grid+list / pagination) so the
// content lists match WordPress exactly. Title cell links to the editor
// (native edit_url or the in-app route); taxonomy/enum/bool fields become
// native filters + columns.
function DataViewsIndexReal({ type, meta, items, loading, native, isTerm, descriptor, editMode = 'view', onSaveField, onSaveContent, onDeleteRow, resetSignal = 0 }) {
  const navigate = useNavigate();
  // Row whose post body is open in the full content editor (Edit mode only), and
  // the row open in the lighter inline quick-edit card.
  const [contentItem, setContentItem] = useState(null);
  const [inlineItem, setInlineItem] = useState(null);
  const layoutKey = `os-index-layout-${type}`;
  // Built-in types have no cpt-schema descriptor; fall back to the taxonomy
  // filters published on the type's BOOT meta (e.g. the universal os_tag).
  const dTaxes = descriptor?.taxonomies || meta?.taxonomies || [];
  const dFields = descriptor?.fields || [];
  const display = descriptor?.display || {};

  const titleOf = (it) => decodeEntities(it.title?.rendered || it.slug || '(untitled)');
  const termsOf = (it, tax) => (Array.isArray(it[tax.field]) ? it[tax.field] : []);
  const dateStr = (it) => isTerm
    ? (typeof it.count === 'number' ? `${it.count} post${it.count === 1 ? '' : 's'}` : '')
    : (it.modified ? new Date(it.modified).toLocaleDateString() : '');

  function chips(arr) {
    if (!arr || !arr.length) return '';
    return h`<div style=${{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      ${arr.slice(0, 6).map((v, i) => h`<span key=${i} style=${{ fontSize: '11px', background: 'var(--wp-components-color-gray-100,#f0f0f0)', color: 'var(--wp-components-color-gray-700,#757575)', padding: '1px 8px', borderRadius: '10px' }}>${decodeEntities(String(v))}</span>`)}
    </div>`;
  }

  const [taxTerms, setTaxTerms] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const t of dTaxes) {
        const base = t.rest_base || t.slug;
        try {
          const rows = await restAllPages(`/wp/v2/${base}?per_page=100&hide_empty=false&orderby=name&order=asc&_fields=name`);
          out[t.slug] = (rows || []).map((r) => decodeEntities(r.name)).filter(Boolean);
        } catch { out[t.slug] = []; }
      }
      if (alive) setTaxTerms(out);
    })();
    return () => { alive = false; };
  }, [type, dTaxes.map((t) => t.slug).join(',')]);

  const openItem = useCallback((it) => {
    if (!it) return;
    if (native && it.edit_url) window.location.assign(it.edit_url);
    else navigate(`/t/${type}/${it.id}`);
  }, [native, type, navigate]);

  const fields = useMemo(() => {
    const fs = [];
    fs.push({
      id: 'title', label: 'Title', enableHiding: false, enableGlobalSearch: true,
      getValue: ({ item }) => titleOf(item),
      render: ({ item }) => (editMode === 'edit')
        ? h`<${EditCellText} value=${titleOf(item)} label="Title" onCommit=${(v) => onSaveField && onSaveField(item, 'title', null, v)} />`
        : (native && item.edit_url)
        ? h`<a href=${item.edit_url} className="no-underline" style=${{ fontWeight: 500, color: 'inherit' }}>${titleOf(item)}</a>`
        : h`<${Link} to=${`/t/${type}/${item.id}`} className="no-underline" style=${{ fontWeight: 500, color: 'inherit' }}>${titleOf(item)}</${Link}>`,
    });
    fs.push({
      id: 'slug', label: 'Slug', enableGlobalSearch: true,
      getValue: ({ item }) => item.slug || '',
      render: ({ item }) => item.slug ? h`<span style=${{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--wp-components-color-gray-700,#757575)' }}>${item.slug}</span>` : '',
    });
    fs.push(isTerm
      ? { id: 'count', label: 'Posts', enableSorting: true, getValue: ({ item }) => (typeof item.count === 'number' ? item.count : 0) }
      : { id: 'modified', label: 'Updated', enableSorting: true, getValue: ({ item }) => item.modified || '', render: ({ item }) => h`<span style=${{ color: 'var(--wp-components-color-gray-700,#757575)' }}>${dateStr(item)}</span>` });
    // NB: no `elements`/`filterBy` here on purpose — we render our OWN filter
    // popovers (FilterDropdown) above the list and pre-filter the data, instead
    // of DataViews' native filter widget. These stay as display columns only.
    for (const t of dTaxes) {
      fs.push({
        id: `tax:${t.slug}`, label: t.label, getValue: ({ item }) => termsOf(item, t),
        render: ({ item }) => (editMode === 'edit')
          ? h`<${EditCellList} value=${termsOf(item, t)} label=${t.label} onCommit=${(arr) => onSaveField && onSaveField(item, 'tax', t.field, arr)} />`
          : chips(termsOf(item, t)),
      });
    }
    for (const f of dFields.filter((x) => x.type === 'enum')) {
      fs.push({
        id: `meta:${f.key}`, label: f.label, getValue: ({ item }) => String(item.meta?.[f.key] ?? ''),
        render: ({ item }) => {
          if (editMode === 'edit') return h`<${EditCellSelect} value=${item.meta?.[f.key] ?? ''} options=${f.enum || []} label=${f.label} onCommit=${(v) => onSaveField && onSaveField(item, 'meta', f.key, v)} />`;
          const v = item.meta?.[f.key]; return (v === '' || v == null) ? '' : h`<span className="os-cell-text">${decodeEntities(String(v))}</span>`;
        },
      });
    }
    for (const f of dFields.filter((x) => x.type === 'boolean')) {
      fs.push({
        id: `meta:${f.key}`, label: f.label, getValue: ({ item }) => (item.meta?.[f.key] ? 'yes' : 'no'),
        render: ({ item }) => (editMode === 'edit')
          ? h`<${EditCellBool} value=${!!item.meta?.[f.key]} label=${f.label} onCommit=${(v) => onSaveField && onSaveField(item, 'meta', f.key, v)} />`
          : h`<span>${item.meta?.[f.key] ? 'Yes' : 'No'}</span>`,
      });
    }
    // Scalar text-like fields (string / textarea / number / url / date). Hidden
    // by default in View mode (added to the column picker), shown + editable in
    // Edit mode. Enum + boolean are handled above, so they're excluded here.
    for (const f of dFields.filter((x) => EDITABLE_TEXT_TYPES.includes(x.type))) {
      fs.push({
        id: `meta:${f.key}`, label: f.label, enableSorting: true, enableGlobalSearch: true,
        getValue: ({ item }) => String(item.meta?.[f.key] ?? ''),
        render: ({ item }) => {
          if (editMode === 'edit') {
            // One pop-out editor for every free-text cell. EditCellText decides
            // the control internally (see wantsTextPopover): long or multi-line
            // values get a roomy textarea, short ones (and url/number/date) a
            // single-line field. Built-in CPTs type every free-text meta as
            // plain `string`, so the choice is per row off the value.
            const val = item.meta?.[f.key] ?? '';
            const onCommit = (v) => onSaveField && onSaveField(item, 'meta', f.key, v);
            return h`<${EditCellText} type=${editInputType(f.type)} roomy=${wantsTextPopover(f.type, val)} value=${val} label=${f.label} onCommit=${onCommit} />`;
          }
          const v = item.meta?.[f.key]; return (v === '' || v == null) ? '' : h`<span className="os-cell-text">${decodeEntities(String(v))}</span>`;
        },
      });
    }
    // List fields (array of scalars, e.g. a skill's triggers / allowed_tools).
    // Read mode shows chips; Edit mode reuses the comma-separated multi-value cell.
    for (const f of dFields.filter((x) => x.type === 'list')) {
      fs.push({
        id: `meta:${f.key}`, label: f.label, enableGlobalSearch: true,
        getValue: ({ item }) => (Array.isArray(item.meta?.[f.key]) ? item.meta[f.key].join(', ') : String(item.meta?.[f.key] ?? '')),
        render: ({ item }) => {
          const v = item.meta?.[f.key]; const arr = Array.isArray(v) ? v : (v ? [v] : []);
          return (editMode === 'edit')
            ? h`<${EditCellList} value=${arr} label=${f.label} onCommit=${(next) => onSaveField && onSaveField(item, 'meta', f.key, next)} />`
            : chips(arr);
        },
      });
    }
    // Post body (post_content). It can't be an inline cell — the full
    // Visual/Code/Diagram editor needs room — so the cell shows an excerpt
    // preview and opens a modal. Only for types whose CPT supports the editor.
    if (descriptor?.supports_editor) {
      const previewOf = (it) => decodeEntities(String(it.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim());
      fs.push({
        id: 'content', label: 'Content', enableGlobalSearch: true,
        getValue: ({ item }) => previewOf(item),
        render: ({ item }) => {
          const preview = previewOf(item);
          // View mode: a read-only preview that opens the record (like the title
          // link), no edit affordances. Empty bodies show nothing, matching the
          // other read cells.
          if (editMode !== 'edit') {
            if (!preview) return '';
            const cls = 'os-cell-text no-underline text-sm text-muted-foreground hover:text-foreground';
            return (native && item.edit_url)
              ? h`<a href=${item.edit_url} className=${cls} title=${preview}>${preview}</a>`
              : h`<${Link} to=${`/t/${type}/${item.id}`} className=${cls} title=${preview}>${preview}</${Link}>`;
          }
          // Edit mode: preview text plus two affordances — a pencil for the inline
          // quick-edit popover and a window glyph for the full Visual/Code/Diagram
          // modal. Clicking the text opens the modal too.
          return h`<div className="group flex items-center gap-1">
            <button type="button" onClick=${(e) => { e.stopPropagation(); setContentItem(item); }}
              className="os-cell-text min-w-0 flex-1 text-left text-sm text-muted-foreground hover:text-foreground"
              title=${preview || 'Edit content'}>${preview || h`<span className="italic opacity-70">Add content…</span>`}</button>
            <button type="button" title="Quick edit (inline)"
              onClick=${(e) => { e.stopPropagation(); setInlineItem(item); }}
              className="shrink-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"><${Icon} name="file-pen" /></button>
            <button type="button" title="Open full editor"
              onClick=${(e) => { e.stopPropagation(); setContentItem(item); }}
              className="shrink-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"><${Icon} name="square-horizontal" /></button>
          </div>`;
        },
      });
    }
    return fs;
  }, [type, items, taxTerms, descriptor, native, isTerm, editMode, onSaveField]);

  const defaultVisible = useMemo(() => {
    // Title is the view's `titleField` (rendered in the title slot), so it must
    // NOT also be in `fields` or the list shows an empty title band + the title
    // duplicated in the description row.
    const cols = [isTerm ? 'count' : 'modified'];
    for (const t of dTaxes) cols.push(`tax:${t.slug}`);
    // Show the body preview in View mode too (read-only), for types with an
    // editor — so the column is useful without switching to Edit.
    if (descriptor?.supports_editor && !isTerm) cols.push('content');
    if (Array.isArray(display.columns)) {
      for (const f of dFields) {
        const key = f.type === 'taxonomy' ? `tax:${f.taxonomy}` : `meta:${f.key}`;
        if (display.columns.includes(key) && !cols.includes(key)) cols.push(key);
      }
    }
    return cols;
  }, [type, descriptor, isTerm]);

  // Edit mode forces a table layout and surfaces title + every editable field
  // as a column (title becomes a normal editable cell, so titleField is dropped
  // — DataViews renders the title slot specially and would swallow cell input).
  const editColumns = useMemo(() => {
    const cols = ['title'];
    for (const t of dTaxes) cols.push(`tax:${t.slug}`);
    for (const f of dFields) {
      if (f.type === 'enum' || f.type === 'boolean' || f.type === 'list' || EDITABLE_TEXT_TYPES.includes(f.type)) cols.push(`meta:${f.key}`);
    }
    if (descriptor?.supports_editor) cols.push('content');
    cols.push(isTerm ? 'count' : 'modified');
    return cols;
  }, [descriptor, isTerm]);

  const [view, setView] = useState(() => {
    let t = 'table'; try { t = localStorage.getItem(layoutKey) || 'table'; } catch {}
    return { type: t, search: '', page: 1, perPage: INDEX_PAGE_SIZE, sort: { field: isTerm ? 'count' : 'modified', direction: 'desc' }, fields: defaultVisible, filters: [], layout: {}, titleField: 'title' };
  });
  // Sync visible columns to the active mode: Edit shows the editable set with no
  // titleField; View restores the default columns + the title slot.
  useEffect(() => {
    if (editMode === 'edit') setView((v) => ({ ...v, type: 'table', titleField: undefined, fields: editColumns }));
    else setView((v) => ({ ...v, titleField: 'title', fields: defaultVisible }));
  }, [editMode, editColumns.join(','), defaultVisible.join(',')]);

  const onChangeView = useCallback((next) => {
    setView(next);
    try { localStorage.setItem(layoutKey, next.type); } catch {}
  }, [layoutKey]);
  // A new query re-ranks from scratch, so jump back to the first (best) page —
  // otherwise a stale view.page could point past the shorter result set.
  useEffect(() => { setView((v) => (v.page === 1 ? v : { ...v, page: 1 })); }, [view.search]);

  // Custom filters (our FilterDropdown popovers) — pre-filter the data before
  // handing it to DataViews (which still does search / sort / layout / paging).
  const showFilter = (key) => !Array.isArray(display.filters) || display.filters.includes(key);
  const enumFields = dFields.filter((f) => f.type === 'enum');
  const boolFields = dFields.filter((f) => f.type === 'boolean');
  const hasFilters = dTaxes.some((t) => showFilter(`tax:${t.slug}`)) || enumFields.some((f) => showFilter(`meta:${f.key}`)) || boolFields.some((f) => showFilter(`meta:${f.key}`));
  const [filters, setFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  useEffect(() => { setFilters({}); }, [type]);
  // Reveal a freshly added row: clear filters + sort newest-first + first page,
  // so the new entry is unmistakably at the top (bumped by ListView's Add row).
  useEffect(() => {
    if (!resetSignal) return;
    setFilters({});
    setView((v) => ({ ...v, sort: { field: isTerm ? 'count' : 'modified', direction: 'desc' }, page: 1 }));
  }, [resetSignal]);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const prefiltered = useMemo(() => {
    let arr = items;
    for (const t of dTaxes) { const want = filters[`tax:${t.slug}`]; if (Array.isArray(want) && want.length) arr = arr.filter((it) => want.some((w) => termsOf(it, t).includes(w))); }
    for (const f of enumFields) { const want = filters[`meta:${f.key}`]; if (Array.isArray(want) && want.length) arr = arr.filter((it) => want.includes(String(it.meta?.[f.key] ?? ''))); }
    for (const f of boolFields) { const want = filters[`meta:${f.key}`]; if (want) arr = arr.filter((it) => (!!it.meta?.[f.key]) === (want === 'yes')); }
    return arr;
  }, [items, filters, descriptor]);

  // Weighted search fields for this type, derived from its OWN field set (title
  // + slug + content + every searchable descriptor field). Recomputed when the
  // columns change (edit mode toggles the set).
  const searchFields = useMemo(() => dataViewsSearchFields(fields), [fields]);
  const { data: shown, paginationInfo } = useMemo(() => {
    const q = (view.search || '').trim();
    // When there's a query, RANK by relevance instead of letting DataViews do a
    // flat substring filter and then sort by date — an exact title hit should
    // top the list, not sink under whatever was edited most recently. We slice
    // the ranked set ourselves (WPDataViews just renders the page we hand it).
    if (q) {
      const ranked = rankSearch(prefiltered, q, {
        fields: searchFields,
        recency: (it) => (isTerm ? (it.count || 0) : (it.modified || '')),
      });
      const perPage = view.perPage || INDEX_PAGE_SIZE;
      const totalItems = ranked.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
      const page = Math.min(view.page || 1, totalPages);
      const startIdx = (page - 1) * perPage;
      return { data: ranked.slice(startIdx, startIdx + perPage), paginationInfo: { totalItems, totalPages } };
    }
    try { return filterSortAndPaginate(prefiltered, view, fields); }
    catch (e) { return { data: prefiltered, paginationInfo: { totalItems: prefiltered.length, totalPages: 1 } }; }
  }, [prefiltered, view, fields, searchFields, isTerm]);

  const actions = useMemo(() => {
    const a = [{
      id: 'open', label: 'Open', isPrimary: true,
      icon: h`<${Icon} name="chevron-right" />`,
      callback: (its) => openItem(its && its[0]),
    }];
    // Inline delete is an Edit-mode row action only, so View stays read-only.
    if (editMode === 'edit' && onDeleteRow) {
      a.push({
        id: 'delete', label: 'Delete', isDestructive: true,
        icon: h`<${Icon} name="trash" />`,
        callback: (its) => onDeleteRow(its && its[0]),
      });
    }
    return a;
  }, [openItem, editMode, onDeleteRow]);

  // Edit mode is table-only (cells are editable there), so offer just the table
  // layout — that hides the table/grid/list switcher whose grid/list views do
  // not support inline editing. View mode keeps all three.
  const defaultLayouts = useMemo(() => editMode === 'edit'
    ? { table: {} }
    : {
        table: { layout: { primaryField: 'title' } },
        grid: { layout: { primaryField: 'title', columnFields: [isTerm ? 'count' : 'modified'], badgeFields: dTaxes.map((t) => `tax:${t.slug}`) } },
        list: { layout: { primaryField: 'title' } },
      }, [type, isTerm, editMode]);

  // Hierarchical types render a grouped parent/child tree (children nested under
  // their parent) in View mode. Edit mode keeps the flat table for bulk inline
  // editing. The tree reuses the filtered set so taxonomy/field filters apply.
  const isParentTree = treeKind(meta) === 'parent';
  const parentTree = (isParentTree && editMode !== 'edit') ? buildParentTree(prefiltered) : null;

  // Types whose List layout setting is 'tree' render the os_path folder tree
  // in View mode, INSIDE this component rather than instead of it, so the
  // filter row (Tags, enum fields) and the search chrome are the very same
  // ones the table shows — Daniel, 2026-07-16: "How about search bar and
  // tags?". Search filters the items and force-expands the folders.
  const isPathTree = descriptor?.display?.layout === 'tree' && treeKind(meta) === 'os_path' && editMode !== 'edit';
  const [treeQ, setTreeQ] = useState('');
  const pathTree = useMemo(() => {
    if (!isPathTree) return null;
    const alive = prefiltered.filter((it) => it.status !== 'trash');
    // Same ranker as the flat list — tokenized + field-weighted — so a tree
    // search matches "wp content" against a "wp-content" path and keeps the
    // best hits. buildPathTree re-groups by folder, so the ranked ORDER isn't
    // what surfaces here; the win is the tokenized MATCH (which rows survive).
    const found = treeQ.trim()
      ? rankSearch(alive, treeQ, { fields: [
          { weight: 10, get: (it) => it.title?.rendered || '' },
          { weight: 6, get: (it) => it.slug || '' },
          { weight: 5, get: (it) => it.meta?.os_path || '' },
        ] })
      : alive;
    return buildPathTree(found);
  }, [isPathTree, prefiltered, treeQ]);

  return h`<div className="os-dataviews">
    ${hasFilters ? h`<div className="flex flex-wrap items-start gap-2 mb-3 os-wpds-fields">
      ${dTaxes.filter((t) => showFilter(`tax:${t.slug}`)).map((t) => {
        const all = (taxTerms[t.slug] && taxTerms[t.slug].length) ? taxTerms[t.slug] : [...new Set(items.flatMap((it) => termsOf(it, t)))].sort();
        const fk = `tax:${t.slug}`;
        return h`<${FilterDropdown} key=${'tx-' + t.slug} label=${t.label} options=${all}
          value=${filters[fk] || []} onChange=${(n) => setFilter(fk, n)}
          open=${openFilter === fk} onOpenChange=${(o) => setOpenFilter(o ? fk : null)} />`;
      })}
      ${enumFields.filter((f) => showFilter(`meta:${f.key}`)).map((f) => {
        const fk = `meta:${f.key}`;
        return h`<${FilterDropdown} key=${'en-' + f.key} label=${f.label} options=${(f.enum || []).filter(Boolean)}
          value=${filters[fk] || []} onChange=${(n) => setFilter(fk, n)}
          open=${openFilter === fk} onOpenChange=${(o) => setOpenFilter(o ? fk : null)} />`;
      })}
      ${boolFields.filter((f) => showFilter(`meta:${f.key}`)).map((f) => h`<div key=${'bl-' + f.key} className="os-filter">
        <div className="os-filter-label">${f.label}</div>
        <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize value=${filters[`meta:${f.key}`] || ''}
          onChange=${(v) => setFilter(`meta:${f.key}`, v)}
          options=${[{ label: 'Any', value: '' }, { label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]} />
      </div>`)}
    </div>` : null}
    ${pathTree
      ? h`<div>
          ${/* Hand-rolled to the vendored table search's MEASURED spec (32px
              box filled gray-100, 13px input padded 0 4px 0 8px, a 28px
              suffix holding the 24px `search` glyph, close glyph while a
              query is live). The bridge's SearchControl is a different
              component generation — white fill, icon in a LEFT prefix, other
              paddings, mirrored glyph — and CSS could not close all of that.
              Styles: .os-tree-search in os-dataviews-skin.css. */''}
          <div className="dataviews__view-actions"><div className="dataviews__search">
            <div className="os-tree-search" role="search">
              <input
                type="search"
                className="os-tree-search__input"
                value=${treeQ}
                onChange=${(e) => setTreeQ(e.target.value)}
                placeholder=${`Search ${meta.label.toLowerCase()}…`}
                aria-label=${`Search ${meta.label.toLowerCase()}`}
              />
              ${treeQ
                ? h`<button type="button" className="os-tree-search__btn" aria-label="Clear search" onClick=${() => setTreeQ('')}>
                    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 13.06l3.712 3.713 1.061-1.06L13.061 12l3.712-3.712-1.06-1.06L12 10.938 8.288 7.227l-1.061 1.06L10.939 12l-3.712 3.712 1.06 1.061L12 13.061z" /></svg>
                  </button>`
                : h`<span className="os-tree-search__btn" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false"><path d="M13 5c-3.3 0-6 2.7-6 6 0 1.4.5 2.7 1.3 3.7l-3.8 3.8 1.1 1.1 3.8-3.8c1 .8 2.3 1.3 3.7 1.3 3.3 0 6-2.7 6-6S16.3 5 13 5zm0 10.5c-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5 4.5 2 4.5 4.5-2 4.5-4.5 4.5z" /></svg>
                  </span>`}
            </div>
          </div></div>
          <${PathTreeIndex} type=${type} tree=${pathTree} searching=${!!treeQ.trim()} loading=${loading} />
        </div>`
      : parentTree
      ? (prefiltered.length === 0
          ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No ${meta.label.toLowerCase()} yet — click “+ ${meta.singular}” above to create the first one.</div></${WPCard}>`
          : h`<${WPCard}><div role="tree" className="py-1">${parentTree.children.map((child) => h`<${ParentTreeNode} key=${child.fullPath} node=${child} type=${type} depth=${0} />`)}</div></${WPCard}>`)
      : h`<${WPDataViews}
      data=${shown}
      fields=${fields}
      view=${view}
      onChangeView=${onChangeView}
      paginationInfo=${paginationInfo}
      getItemId=${(it) => String(it.id)}
      defaultLayouts=${defaultLayouts}
      actions=${actions}
      search=${true}
      searchLabel=${`Search ${meta.label.toLowerCase()}…`}
      isLoading=${loading}
    />`}
    ${contentItem ? h`<${ContentEditModal} meta=${meta} item=${contentItem}
      onClose=${() => setContentItem(null)} onSave=${onSaveContent} />` : null}
    ${inlineItem ? h`<${ContentInlinePopover} meta=${meta} item=${inlineItem}
      onClose=${() => setInlineItem(null)} onSave=${onSaveContent} />` : null}
  </div>`;
}

function ListView() {
  const { type } = useParams();
  const meta = typeMeta(type);

  // A registered list view (media folder grid, reminders dashboard,
  // automations list, …) takes over from the generic DataViews list.
  // Dispatch BEFORE any hook calls so the hook count stays stable across
  // route changes (React rules of hooks).
  const listView = CIRegistry.listViews[meta?.editor];
  if (listView) return listView({ type, meta });

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [descriptor, setDescriptor] = useState(null);
  const [seeding, setSeeding] = useState(false);
  // Bumped after Add row so the index clears filters + sorts newest-first and
  // the fresh row is unmistakably at the top. justAddedRef holds the new draft's
  // id so its FIRST inline edit promotes it from draft to publish (and only it,
  // never an intentional draft edited elsewhere).
  const [addedNonce, setAddedNonce] = useState(0);
  const justAddedRef = useRef(null);
  // How many JS built-ins still don't have a corresponding os_snippet
  // post (matched by os_builtin_id meta). The Import callout is only
  // shown when > 0, so the callout disappears after a successful run
  // and re-appears later if we ship new built-ins.
  const [pendingBuiltins, setPendingBuiltins] = useState(0);
  const toast = useToast();
  const dialog = useDialog();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  // Count how many built-in templates aren't seeded yet. Fetches the
  // existing os_builtin_id meta values and subtracts from the JS list.
  // Only meaningful for the Snippets type; skipped otherwise.
  const refreshPendingBuiltins = async () => {
    if (type !== 'snippet') return;
    try {
      const seeded = await restAllPages('/wp/v2/os_snippet?per_page=100&_fields=id,meta');
      const seededIds = new Set(
        (seeded || []).map((p) => (p?.meta?.os_builtin_id || '').trim()).filter(Boolean)
      );
      const pending = MARKDOWN_INSERT_TEMPLATES.filter((t) => !seededIds.has(t.id)).length;
      setPendingBuiltins(pending);
    } catch {
      // Don't surface the callout if we can't determine state — better
      // to err on the side of not nagging than show a stale prompt.
      setPendingBuiltins(0);
    }
  };

  useEffect(() => {
    if (!meta) return;
    setLoading(true);
    (async () => {
      let desc = null;
      // Adopted/managed CPTs carry a field+taxonomy descriptor that powers
      // the DataViews filter bar and column chips. `manageable` covers custom
      // CPTs on any editor (markdown/block), not just the generic 'cpt' one.
      if (meta.manageable || meta.editor === 'cpt') {
        try { desc = await rest(`/activity/v1/cpt-schema/${meta.cpt}`); } catch {}
      }
      setDescriptor(desc);
      try {
        const taxFields = (desc?.taxonomies || meta.taxonomies || []).map((t) => t.field).filter(Boolean);
        const raw = await restAllPages(listUrl(meta, '', taxFields));
        setItems(raw.map((it) => normalizeItem(meta, it)));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
    refreshPendingBuiltins();
  }, [type]);

  // Re-fetch the list (after an Add row, or a save that needs a server value).
  const reload = useCallback(async () => {
    try {
      const taxFields = (descriptor?.taxonomies || meta?.taxonomies || []).map((t) => t.field).filter(Boolean);
      const raw = await restAllPages(listUrl(meta, '', taxFields));
      setItems(raw.map((it) => normalizeItem(meta, it)));
    } catch (e) { console.error(e); }
  }, [meta, descriptor]);

  // Inline-edit save: optimistically patch the row, then persist the single
  // field to its post via REST (POST = partial update). Revert + toast on error.
  const saveField = useCallback(async (item, kind, key, value) => {
    // The Add row placeholder is a draft; its first edit promotes it to publish.
    const promote = item.id === justAddedRef.current && item.status === 'draft';
    setItems((arr) => arr.map((it) => {
      if (it.id !== item.id) return it;
      let next;
      if (kind === 'title') next = { ...it, title: { ...(it.title || {}), rendered: value, raw: value } };
      else if (kind === 'tax') next = { ...it, [key]: value };
      else next = { ...it, meta: { ...(it.meta || {}), [key]: value } };
      return promote ? { ...next, status: 'publish' } : next;
    }));
    try {
      const body = kind === 'title' ? { title: value } : kind === 'tax' ? { [key]: value } : { meta: { [key]: value } };
      if (promote) { body.status = 'publish'; justAddedRef.current = null; }
      await rest(`/wp/v2/${meta.rest_base}/${item.id}`, { method: 'POST', body: JSON.stringify(body) });
    } catch (e) {
      setItems((arr) => arr.map((it) => (it.id === item.id ? item : it)));
      toast?.error('Save failed', String(e.message || e));
    }
  }, [meta, toast]);

  // Save a row's post body from the content modal. Mirrors saveField's
  // draft-promotion (first edit of an Add-row draft publishes it), then reloads
  // so the excerpt preview reflects the new body. Returns success so the modal
  // can close only on a clean save.
  const saveContent = useCallback(async (item, value) => {
    const promote = item.id === justAddedRef.current && item.status === 'draft';
    try {
      const body = { content: value };
      if (promote) { body.status = 'publish'; justAddedRef.current = null; }
      await rest(`/wp/v2/${meta.rest_base}/${item.id}`, { method: 'POST', body: JSON.stringify(body) });
      await reload();
      toast?.success('Saved');
      return true;
    } catch (e) {
      toast?.error('Save failed', String(e.message || e));
      return false;
    }
  }, [meta, reload, toast]);

  // "Add row" creates a new entry of this type and refreshes the list. The user
  // fills it in inline; the full editor stays one click away (the Open action).
  const addRow = useCallback(async () => {
    try {
      // Created as a draft so a stray click leaves no published entry; the first
      // inline edit promotes it (see saveField). status=any lists include drafts.
      const body = { title: `Untitled ${meta.singular.toLowerCase()}`, status: 'draft' };
      // Term-scoped types (Skill / Memory / Artifact share the os_skill CPT,
      // split by a os_skill_type term) filter the list by that term. Tag the new
      // post so it lands in THIS view; without the term it is created but
      // invisible here. Standalone types have term_id 0, so this is a no-op.
      if (meta.term_id && meta.taxonomy) body[meta.taxonomy] = [meta.term_id];
      const created = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(body) });
      justAddedRef.current = created?.id || null;
      toast?.success('Added', `Draft ${meta.singular.toLowerCase()} added. Edit a field to publish it.`);
      await reload();
      setAddedNonce((n) => n + 1); // reveal: clear filters + newest-first
    } catch (e) { toast?.error('Add failed', String(e.message || e)); }
  }, [meta, reload, toast]);

  // Delete a row inline (Edit mode). Confirms, then trashes the post (DELETE
  // without force) so it is recoverable from wp-admin; optimistically removes
  // it from the list and reverts on error.
  const deleteRow = useCallback(async (item) => {
    if (!item) return;
    const ok = await dialog.confirm(
      `Delete this ${meta.singular.toLowerCase()}?`,
      `"${decodeEntities(item.title?.rendered || '(untitled)')}" will be moved to trash. You can restore it from wp-admin.`,
      { confirmLabel: 'Delete', isDestructive: true }
    );
    if (!ok) return;
    const before = items;
    setItems((arr) => arr.filter((it) => it.id !== item.id));
    try {
      await rest(`/wp/v2/${meta.rest_base}/${item.id}`, { method: 'DELETE' });
      toast?.success('Deleted', `${meta.singular} moved to trash.`);
    } catch (e) {
      setItems(before);
      toast?.error('Delete failed', String(e.message || e));
    }
  }, [items, meta, dialog, toast]);

  const runSeeder = async () => {
    const ok = await dialog.confirm(
      'Import built-in templates?',
      'Creates a Snippets post for each built-in template (Structure / Flow / Patterns / Skills / Prompt / Agent SDK / MCP). Existing snippets are kept; re-running only adds what\'s new. You can edit, rename, or delete any of them afterwards.',
      { confirmLabel: 'Import' }
    );
    if (!ok) return;
    setSeeding(true);
    try {
      const { created, skipped } = await seedBuiltinSnippetsFromJs();
      toast?.success?.(
        'Templates imported',
        `${created} created, ${skipped} already present.`
      );
      // Re-fetch list + pending count so the new snippets show up
      // immediately AND the Import callout disappears.
      try {
        const raw = await restAllPages(listUrl(meta));
        setItems(raw.map((it) => normalizeItem(meta, it)));
      } catch {}
      await refreshPendingBuiltins();
    } catch (e) {
      toast?.error?.('Seeding failed', String(e?.message || e));
    } finally {
      setSeeding(false);
    }
  };

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type: ${type}</div></${TypeLayout}>`;

  const isTerm = isTermType(meta);
  const native = isNativeReplace(meta);
  // Inline editing applies to CI-managed content types only — not native WP
  // posts/pages or taxonomy terms (those keep their existing create flows) —
  // and not types the descriptor marks as not REST-editable (their writes would
  // 403, so we never show the Edit toggle / Add row for them). Capability is
  // already enforced upstream: the Context admin menu requires edit_posts, and
  // REST writes are permission-checked server-side as a backstop.
  const editable = !native && !isTerm && descriptor?.rest_editable !== false;
  // Edit is a ROUTE (#/t/<type>/edit), not ephemeral component state, so the
  // mode is linkable, survives reload, and the back button leaves it
  // (Daniel, 2026-07-16: "Should the edit tab lead to #/t/skill/edit?").
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const editMode = /\/edit\/?$/.test(pathname) ? 'edit' : 'view';
  const setEditMode = (m) => navigate(m === 'edit' ? `/t/${type}/edit` : `/t/${type}`);

  // Snippets-only affordance: "Import built-in templates" lifts every JS
  // built-in (Structure / Flow / Patterns / Skills / Prompt / Agent SDK
  // / MCP) into editable os_snippet posts. Most useful on a fresh
  // install — the Add menu's built-ins keep working either way; this
  // just makes them visible AND editable in the Snippets tree.
  const isSnippetsType = type === 'snippet';
  const AppHeader = CIRegistry.AppHeader;
  // The list's add action(s) live in the header bar's right side, matching the
  // editors and app pages. Native types get per-type add rows; everything else
  // gets the "+ <Singular>" file button.
  const addActions = native
    ? ({
          post:     [['+ Category', '#/t/category/new', 'secondary'], ['+ Post', '#/t/post/new', 'primary']],
          page:     [['+ Page', '#/t/page/new', 'primary']],
          category: [['+ Category', '#/t/category/new', 'primary']],
          tag:      [['+ Tag', '#/t/tag/new', 'primary']],
          media:    [['Upload', '/wp-admin/media-new.php', 'primary']],
        }[type] || [[`+ ${meta.singular}`, `#/t/${type}/new`, 'primary']]
      ).map(([label, href, variant]) => h`<${Button} key=${href} variant=${variant} size="default" href=${href}>${label}</${Button}>`)
    : h`<${NewFileButton} type=${type} label=${meta.singular} variant="primary" size="default" />`;

  // CI-managed types get a View / Edit toggle. In Edit mode the create action
  // becomes "Add row" (inline create); in View mode the usual "+ New" shows.
  const headerActions = editable
    ? h`<div className="flex items-center gap-2">
        <${SegmentedToggle} value=${editMode} onChange=${setEditMode}
          options=${[{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }]} ariaLabel="List mode" />
        ${editMode === 'edit'
          ? h`<${Button} variant="primary" size="default" onClick=${addRow}>Add row</${Button}>`
          : addActions}
      </div>`
    : addActions;

  return h`<${TypeLayout} type=${type}>
   <div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title=${meta.label} icon=${meta.icon} iconSvg=${meta.icon_svg} actions=${headerActions} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-4 md:p-10 mx-auto w-full ' + ((fullWidth || editMode === 'edit') ? 'max-w-none' : 'max-w-3xl')}>
      <${PageHeading} icon=${meta.icon} iconSvg=${meta.icon_svg} title=${meta.label}
        description=${`Pick a ${meta.singular.toLowerCase()} from the list below to edit, or start a new one.`} />

      ${isSnippetsType && pendingBuiltins > 0 ? h`<div className="mb-6 p-3 border border-border bg-muted/30 flex items-start justify-between gap-3">
        <div className="text-xs leading-snug">
          <div className="font-medium text-foreground mb-0.5">${pendingBuiltins} built-in template${pendingBuiltins === 1 ? '' : 's'} available to import</div>
          <div className="text-muted-foreground">Materialise the JS-defined templates (Structure / Flow / Patterns / Skills / Prompt / Agent SDK / MCP) as editable posts in this Snippets tree. Existing entries are kept; this callout disappears once everything is imported.</div>
        </div>
        <button
          type="button"
          onClick=${runSeeder}
          disabled=${seeding}
          className="inline-flex items-center px-3 h-8 text-xs font-medium bg-foreground text-background hover:opacity-90 shrink-0 disabled:opacity-50"
          style=${{ borderRadius: 0 }}
        >${seeding ? 'Importing…' : 'Import'}</button>
      </div>` : null}

      ${/* The type's List layout setting (Manage <type>) picks table or
          os_path tree; DataViewsIndexReal owns both, so the filter row and
          search are one chrome. Edit mode keeps the table (inline cells). */''}
      <${DataViewsIndexReal}
        type=${type}
        meta=${meta}
        items=${items}
        loading=${loading}
        native=${native}
        isTerm=${isTerm}
        descriptor=${descriptor}
        editMode=${editable ? editMode : 'view'}
        onSaveField=${saveField}
        onSaveContent=${saveContent}
        onDeleteRow=${deleteRow}
        resetSignal=${addedNonce}
      />

      ${/* Page footer: the shared, gray, top-bordered "Options" group. */''}
      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        ${(meta.manageable || meta.editor === 'cpt') ? h`<${CIRegistry.PageFooter.Link} href=${`#/structure/${type}`}>Manage content type</${CIRegistry.PageFooter.Link}>` : null}
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}


// ---------------------------------------------------------------------------

// "+ New" button. Every type creates its item directly in its default editor.
// The old new-file picker (per-language for code, shape for skills) is gone: it
// had no consumer left once code snippets moved to the os-code companion and
// skills moved to the Fields editor, and nothing read the language or shape it
// stashed in sessionStorage.
function NewFileButton({ type, label, className, onMobileClose, size, variant, iconOnly }) {
  const location = useLocation();
  const toast = useToast();
  // Label/desc come from the app registry, keyed by the type's `editor` (a
  // function form lets adopted CPTs build a label from their own singular noun);
  // a type with no registered def falls back to its singular noun.
  const _nfMeta = typeMeta(type);
  const _nfDef = CIRegistry.newFile[_nfMeta?.editor];
  const singleNew = (typeof _nfDef === 'function' ? _nfDef(_nfMeta) : _nfDef)
    || { label: `New ${String(_nfMeta?.singular || label || 'item').toLowerCase()}` };
  // Clicking "+ New" while already on the /new route is a no-op: react-router
  // doesn't re-fire useEffect on identical paths, so the editor keeps the
  // in-progress draft. Catch it up front and tell the user to save (or hit
  // Escape) first, without this they think the button is broken.
  const isOnNewRoute = /^\/t\/[^/]+\/new(\?|$)/.test(location.pathname + (location.search || ''));
  const go = () => {
    if (isOnNewRoute) {
      toast?.error?.(
        'You have an unsaved draft open',
        'Save or close the current new file before starting another.'
      );
      return;
    }
    window.location.hash = `#/t/${type}/new`;
    if (onMobileClose) onMobileClose();
  };
  // Parent always passes "File" as the label; the singular noun on the button
  // has to match the type, so derive it from the registry def.
  const singularButtonLabel = singleNew.label.replace(/^New\s+/, '').replace(/^./, c => c.toUpperCase());
  if (iconOnly) {
    return h`<${WPButton}
      size=${size || 'compact'}
      variant=${variant || 'secondary'}
      className=${className}
      onClick=${go}
      icon=${h`<${Icon} name="file-circle-plus" className="w-4 h-4" />`}
      label=${singleNew.label}
      showTooltip=${true}
    />`;
  }
  return h`<${Button}
    size=${size || 'sm'}
    variant=${variant || 'ghost'}
    className=${className}
    onClick=${go}
    title=${singleNew.label}
  >+ ${singularButtonLabel}</${Button}>`;
}

// Split a markdown document into YAML frontmatter (preserved verbatim)
// and body. The canvas only consumes the body — frontmatter passes
// through unchanged so the round-trip is byte-stable for the header.
// Starter markdown for a freshly-created os_skill / os_wiki post.
// Gives authors the expected frontmatter shape (ci:path
// marker + name + description) plus a stub H1 they can edit. The
// React app's splitFrontmatter knows to preserve everything up to
// the first `## ` as preamble, so the template survives canvas
// round-trips unchanged.
function starterTemplateFor(type, lang, shape) {
  // Non-Markdown new-file flow: the file body is the RAW code, with no
  // YAML frontmatter / markdown wrapper around it. A Python file is
  // valid Python, a CSV file is valid CSV — that's the only way the
  // file is useful to the underlying tooling (linters, csv readers,
  // json parsers). The language is persisted as `os_language` post
  // meta instead of in the body, so reloading a saved file still
  // surfaces the correct editor without re-parsing the body.
  if (lang) {
    return (
      lang === 'csv'        ? 'name,age,role\nAlice,30,Engineer\nBob,25,Designer\n'
      : lang === 'json'       ? '{\n  "name": "example",\n  "items": []\n}\n'
      : lang === 'yaml'       ? 'name: example\nitems:\n  - first\n  - second\n'
      : lang === 'python'     ? 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n'
      : lang === 'javascript' ? 'function main() {\n}\n\nmain();\n'
      : lang === 'typescript' ? 'function main(): void {\n}\n\nmain();\n'
      : lang === 'bash'       ? '#!/usr/bin/env bash\nset -euo pipefail\n\necho "hello"\n'
      : lang === 'php'        ? '<?php\n\nfunction main(): void {\n}\n\nmain();\n'
      : ''
    );
  }
  // Per-type frontmatter — only the fields an agent actually needs to
  // make sense of the content. All four share `name` + `description`
  // (the agent's first line of signal); the rest is what makes each
  // type distinct.
  //
  // - **skill**: trigger phrases + auto-trigger conditions tell the
  //   agent WHEN to invoke this skill. Tags are coarser routing.
  // - **memory**: type discriminator (fact / decision / preference /
  //   profile) so the agent knows how to use the stored content;
  //   `updated` so stale memories are recognisable.
  // - **wiki**: human-friendly title + tags for cross-referencing.
  if (type === 'wiki') {
    return [
      '---',
      'title: "Article title"',
      'description: "One-line summary the agent sees first."',
      'tags: []   # comma-separated topics for cross-referencing',
      '---',
      '',
      '# Title',
      '',
    ].join('\n');
  }
  if (type === 'memory') {
    return [
      '<!-- ci:path=your-slug -->',
      '---',
      'name: your-slug',
      'description: "What this memory captures — one sentence."',
      'type: fact            # fact | decision | preference | profile',
      'updated: ' + new Date().toISOString().slice(0, 10),
      '---',
      '',
      '# Title',
      '',
    ].join('\n');
  }
  // Skill — three canonical shapes:
  //   workflow (default) → DEAL scaffold, for step-by-step skills
  //   routing            → parent that delegates to child skills
  //   reference          → static lookup data, no flow
  // The `<Triggers>` block + `name`/`description` frontmatter are common
  // across all three; only the body differs. `description` is the SHORT
  // activation signal surfaced in skill-search results; the body-level
  // `<Triggers>` carries the richer activation contract.
  const skillHead = [
    '<!-- ci:path=your-slug -->',
    '---',
    'name: your-slug',
    'description: "One-sentence summary the agent sees in skill-search results — what this skill does and when to use it."',
    'tags: []              # optional — coarse topics for grouping',
    '---',
    '',
    '# Title',
    '',
    '<Triggers>',
    '## When to invoke',
    '',
    '- Explicit: `/your-skill`, `--your-skill`',
    '- Auto: when the user [describe situation]',
    '- Contexts: [code review, debugging, …]',
    '- Avoid when: [counter-cases the agent should NOT pick this skill]',
    '',
    '</Triggers>',
    '',
  ];
  if (shape === 'routing') {
    // Routing skill — a parent that picks the right child skill. The body
    // is a list of children with one-line trigger summaries; the agent
    // reads it and dispatches via <File> or <Skill slug="…"/>. Modelled
    // on engineering-code/SKILL.md.
    return skillHead.concat([
      '<Section id="children">',
      '## Children',
      '> One-line description of each child skill — the agent matches the user\'s request against this list and invokes the right one directly.',
      '',
      '- **child-skill-a** ([[skills/child-skill-a]]) — [when to pick this child]',
      '- **child-skill-b** ([[skills/child-skill-b]]) — [when to pick this child]',
      '- **child-skill-c** ([[skills/child-skill-c]]) — [when to pick this child]',
      '',
      '</Section>',
      '',
      '<Section id="routing-rules">',
      '## Routing rules',
      '> Tie-breakers when multiple children could apply.',
      '',
      '- Prefer the MORE SPECIFIC child over the more general one.',
      '- If [X], pick [child]. If [Y], pick [child].',
      '- Out-of-scope: [things this namespace does NOT cover — escalate / decline]',
      '',
      '</Section>',
      '',
    ]).join('\n');
  }
  if (shape === 'reference') {
    // Reference skill — static lookup data. No flow, no DEAL. The body
    // is structured information the agent retrieves on demand (think:
    // glossary, decision table, parameter reference). Marked by a single
    // <Section id="reference"> so it still shows up on the graph as one
    // box (rather than feeling completely shape-less).
    return skillHead.concat([
      '<Section id="reference">',
      '## Reference data',
      '> Structured lookup the agent reads verbatim. No flow — just facts.',
      '',
      '| Field        | Value                                  |',
      '| ------------ | -------------------------------------- |',
      '| key-a        | [value or description]                 |',
      '| key-b        | [value or description]                 |',
      '| key-c        | [value or description]                 |',
      '',
      '### Notes',
      '',
      '- [Inline note or constraint the agent must apply]',
      '- [Edge cases worth calling out]',
      '',
      '</Section>',
      '',
    ]).join('\n');
  }
  // workflow (default) — DEAL scaffold. DEAL IS the canonical structure
  // of a CI workflow skill — the Graph view draws Define → Empathy →
  // Action → Lead on first open.
  return skillHead.concat([
    '<Define id="define-objectives">',
    '## Objectives',
    '> What is this skill trying to achieve?',
    '',
    'Prime objective:    [one sentence — the single most important outcome]',
    'Sub-objectives:     [2–4 supporting outcomes]',
    'Done when:          [a testable condition]',
    '',
    '<Goto ref="empathy-gap" />',
    '</Define>',
    '',
    '<Empathy id="empathy-gap">',
    '## Gap analysis',
    '> What did they expect, what actually happens, and why does it matter? Use SPIN.',
    '',
    'Why:',
    '  - Situation:   [context]',
    '  - Problem:     [the specific failure]',
    '  - Implication: [what happens if unsolved]',
    '  - Need-payoff: [outcome they\'re after]',
    '',
    '<Goto ref="action-workflow" />',
    '</Empathy>',
    '',
    '<Action id="action-workflow">',
    '## Workflow',
    '> What are the concrete steps that close the gap?',
    '',
    'First action: [the single next thing]',
    'Milestones:',
    '  - [checkpoint 1]',
    '  - [checkpoint 2]',
    '',
    '<Goto ref="lead-output" />',
    '</Action>',
    '',
    '<Lead id="lead-output">',
    '## Output',
    '> Who owns what comes next?',
    '',
    'Owner:    [me / end-user / agent]',
    'Solution: [the primary recommended path]',
    'Action:   [what they need to do first]',
    '',
    '</Lead>',
    '',
  ]).join('\n');
}


/**
 * Metadata editor for standard WP posts/pages. Title, slug, excerpt, status,
 * and parent (hierarchical only). Body editing is intentionally NOT here —
 * "Open in Gutenberg" opens wp-admin's block editor in a new tab. This keeps
 * the panel responsibility narrow (the tree + frontmatter) without us having
 * to embed Gutenberg or maintain a parallel block editor.
 */
function MetaEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  const [post, setPost] = useState(isNew ? { status: 'draft' } : null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) {
      setTitle(''); setContent(''); setDirty(false);
      return;
    }
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        setPost(p);
        setTitle(p.title?.raw || '');
        setContent(p.content?.raw || '');
        setDirty(false);
      } catch (e) { toast.error('Failed to load', e.message); }
    })();
  }, [type, id]);

  async function save() {
    setSaving(true);
    try {
      // Edit the post body inline via the embedded Gutenberg editor. Status
      // is carried through from the loaded post (or 'draft' for new) so
      // saving here never changes the publish state.
      const body = { title, content, status: post?.status || 'draft' };
      let p;
      if (isNew) {
        p = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(body) });
        toast.success(`${meta.singular} created`);
        navigate(`/t/${type}/${p.id}`, { replace: true });
      } else {
        p = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(body) });
        setPost(p);
        toast.success('Saved');
      }
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, title, content]);

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type: ${type}</div></${TypeLayout}>`;
  if (!isNew && !post) return h`<${TypeLayout} type=${type} activeId=${id}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  const fieldChange = (setter) => (e) => { setter(e.target.value); setDirty(true); };

  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-y-auto bg-background">
    <div className="flex flex-col min-h-full">
      <header className="bg-card border-b border-border h-14 pl-14 pr-3 md:px-6 flex items-center gap-3 shrink-0 sticky top-0 z-10">
        <input
          value=${title}
          onChange=${fieldChange(setTitle)}
          placeholder=${`${meta.singular} title…`}
          className="flex-1 min-w-0 text-base font-semibold bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium" style=${{ color: (dirty || isNew || saving) ? '#b45309' : '#059669' }}>
            ${(dirty || isNew || saving)
              ? h`<span aria-hidden="true" style=${{ display: 'inline-block', width: 6, height: 6, borderRadius: 9999, background: '#d97706' }} />`
              : h`<${Icon} name="check" className="w-3.5 h-3.5" />`}
            ${saving ? 'Saving…' : ((dirty || isNew) ? 'Unsaved' : 'Saved')}
          </span>
          <div className="os-editor-toolbar flex items-center">
            <${WPToolbarGroup}>
              <${WPToolbarButton} isActive=${fullWidth} onClick=${toggleFullWidth} label=${fullWidth ? 'Use readable width' : 'Expand to full width'} showTooltip=${true}>
                ${fullWidthIcon(fullWidth)}
              </${WPToolbarButton}>
            </${WPToolbarGroup}>
          </div>
          <${Button}
            size="sm"
            variant=${(dirty || isNew) ? 'primary' : 'ghost'}
            className="!px-4 !border-0 !shadow-none"
            onClick=${save}
            disabled=${saving || (!dirty && !isNew)}
          >${saving ? h`<${Spinner} />` : 'Save'}</${Button}>
        </div>
      </header>

      <div className=${'flex-1 p-4 md:p-6 mx-auto w-full ' + (fullWidth ? 'max-w-none' : 'max-w-4xl')}>
        <${GutenbergComposer}
          value=${content}
          onChange=${(next) => { setContent(next); setDirty(true); }}
          placeholder=${`Write the ${meta.singular.toLowerCase()} body…`}
        />
      </div>
    </div>
  </${TypeLayout}>`;
}

/**
 * Term editor for categories/tags. V1 scope is name + slug only — description
 * and parent reparenting are intentionally out of scope.
 */
function TermEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();

  const [term, setTerm] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) { setTerm({}); setName(''); setSlug(''); setDirty(false); return; }
    (async () => {
      try {
        const t = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        setTerm(t);
        setName(t.name || '');
        setSlug(t.slug || '');
        setDirty(false);
      } catch (e) { toast.error('Failed to load', e.message); }
    })();
  }, [type, id]);

  async function save() {
    setSaving(true);
    try {
      const body = { name, slug };
      let t;
      if (isNew) {
        t = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(body) });
        toast.success(`${meta.singular} created`);
        navigate(`/t/${type}/${t.id}`, { replace: true });
      } else {
        t = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(body) });
        setTerm(t);
        toast.success('Saved');
      }
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, name, slug]);

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type: ${type}</div></${TypeLayout}>`;
  if (!isNew && !term) return h`<${TypeLayout} type=${type} activeId=${id}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  const count = term?.count;

  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-y-auto bg-background">
    <div className="flex flex-col min-h-full">
      <header className="bg-card border-b border-border h-14 pl-14 pr-3 md:px-6 flex items-center gap-3 shrink-0 sticky top-0 z-10">
        <input
          value=${name}
          onChange=${(e) => { setName(e.target.value); setDirty(true); }}
          placeholder=${`${meta.singular} name…`}
          className="flex-1 min-w-0 text-base font-semibold bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 shrink-0">
          ${dirty ? h`<${Badge} className="bg-amber-100 text-amber-700">Unsaved</${Badge}>` : null}
          <${Button}
            size="sm"
            variant=${(dirty || isNew) ? 'primary' : 'ghost'}
            className="!px-4 !border-0 !shadow-none"
            onClick=${save}
            disabled=${saving || (!dirty && !isNew)}
          >${saving ? h`<${Spinner} />` : 'Save'}</${Button}>
        </div>
      </header>

      <div className="flex-1 p-6 md:p-8 mx-auto w-full max-w-2xl space-y-5">
        <${Card} className="space-y-4 os-wpds-fields">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Slug"
            value=${slug}
            onChange=${(v) => { setSlug(v); setDirty(true); }}
            placeholder="auto-generated-from-name"
          />
          ${typeof count === 'number' ? h`<div className="text-xs text-muted-foreground">${count} post${count === 1 ? '' : 's'} use this ${meta.singular.toLowerCase()}.</div>` : null}
        </${Card}>
      </div>
    </div>
  </${TypeLayout}>`;
}


// Markdown snippet library for the Insert popover, sourced from the
// shared CANVAS_ADD_ITEMS registry in ci/core — items with a
// `template` participate. `cursorOffset` is where the caret lands
// after insertion (chars after the snippet's start); 0 = before the
// snippet. -1 = at end.
function FgTermManager({ slug }) {
  const toast = useToast();
  const [terms, setTerms] = useState(null);
  const [name, setName] = useState('');
  const load = useCallback(async () => {
    try { setTerms(await restAllPages(`/wp/v2/${slug}?per_page=100&hide_empty=false&_fields=id,name,count`)); }
    catch { setTerms([]); }
  }, [slug]);
  useEffect(() => { load(); }, [slug]);
  const add = async () => {
    if (!name.trim()) return;
    try { await rest(`/wp/v2/${slug}`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) }); setName(''); await load(); }
    catch (e) { toast.error('Add term failed', e.message); }
  };
  const del = async (id) => {
    try { await rest(`/wp/v2/${slug}/${id}?force=true`, { method: 'DELETE' }); await load(); }
    catch (e) { toast.error('Delete term failed', e.message); }
  };
  return h`<div className="space-y-2">
    ${terms === null ? h`<${Spinner} />` : (terms.length === 0
      ? h`<div className="text-xs text-muted-foreground italic">No terms yet.</div>`
      : h`<div className="flex flex-wrap gap-1.5">
          ${terms.map((t) => h`<span key=${t.id} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
            ${t.name}
            <button type="button" onClick=${() => del(t.id)} className="text-muted-foreground hover:text-red-600" title="Delete term">✕</button>
          </span>`)}
        </div>`)}
    <div className="flex items-center gap-2">
      <div className="flex-1"><${WPTextControl} label="New term" hideLabelFromVision=${true} value=${name} onChange=${setName} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="New term…" __nextHasNoMarginBottom=${true} /></div>
      <${WPButton} variant="secondary" size="small" onClick=${add}>Add</${WPButton}>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Content Types — a first-class destination (own nav item + #/content-types
// route) decoupled from Settings. Lists every manageable CPT (click → manage
// its registration + structure) and hosts the registration panels (create
// custom, adopt third-party, schema overrides). layer: type.
// ---------------------------------------------------------------------------
// Blueprints — one-click presets that scaffold a new content type (its fields +
// chosen editor) with no code. Each `fields` entry is a field-group definition
// (the same shape the Structure builder saves); the server validates + seeds
// the field group when the CPT is created (see rest_add_cpt). Editors that need
// bespoke runtime (Automation/Reminders' cron/channels) still ship as code leaf
// apps — these cover the "structured-data editor" cases no-code.
// CI_BLUEPRINTS now lives in the ci/blueprints data module (the os-type split);
// imported at the top of this file.

// Cross-tab progress bus: one shared BroadcastChannel for all editor instances,
// so a stamp collected in one visible tab updates a rally's progress bar in
// another tab that never gains focus. Lazily created; null where unsupported.
let _ciProgressBus;
function ciProgressBus() {
  if (_ciProgressBus !== undefined) return _ciProgressBus;
  try { _ciProgressBus = ('BroadcastChannel' in window) ? new BroadcastChannel('os-progress') : null; }
  catch { _ciProgressBus = null; }
  return _ciProgressBus;
}

// Normalise a label/slug into a valid custom-CPT key: lowercase, digits, and
// underscores only (the server prepends `ci_`). Spaces and dashes collapse to
// underscores so "Daily habit" → "daily_habit".
function slugifyCpt(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^ci_/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

// A labelled subsection card — the shared building block for the create + manage
// screens, so both group their controls under the same Identity / Appearance /
// Behaviour headings instead of one undifferentiated form. Keeps the manager
// legible (the "better sections" the manage UI was missing).
function ManageSection({ title, description, children }) {
  return h`<section className="space-y-3">
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">${title}</h2>
      ${description ? h`<p className="text-xs text-muted-foreground mt-0.5">${description}</p>` : null}
    </div>
    <${Card} className="p-5 space-y-4 os-wpds-fields">${children}</${Card}>
  </section>`;
}

// Create-type screen (/structure/new?bp=<blueprint>). Replaces the bare slug
// prompt with a full page that mirrors the manage screen: it carries CI's
// AppHeader, groups identity/appearance/behaviour into sections, and previews
// the blueprint's starter fields. Seeded from a blueprint (label/plural/icon/
// fields) but every value stays editable before commit. On success it forces a
// real reload into the new type's manage view — the CPT only enters the
// server-rendered BOOT.types on a fresh load (same reason as the bug fix).
function CreateTypePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const AppHeader = CIRegistry.AppHeader;
  const bp = CI_BLUEPRINTS.find((b) => b.id === params.get('bp')) || {};

  const [label, setLabel] = useState(bp.label || '');
  const [plural, setPlural] = useState(bp.plural || '');
  const [slug, setSlug] = useState(bp.id || slugifyCpt(bp.label || ''));
  // Once the user edits the slug by hand, stop deriving it from the label.
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState(bp.icon || 'folder');
  const [iconSvg, setIconSvg] = useState('');
  const [editors, setEditors] = useState([bp.editor || 'cpt']);
  const [hierarchical, setHierarchical] = useState(!!bp.hierarchical);
  const [busy, setBusy] = useState(false);

  const onLabel = (v) => {
    setLabel(v);
    if (!slugTouched) setSlug(slugifyCpt(v));
  };
  const onSlug = (v) => { setSlugTouched(true); setSlug(slugifyCpt(v)); };

  const finalSlug = slugifyCpt(slug);
  const canCreate = !!finalSlug && !!label.trim() && !busy;
  // The seeded fields the blueprint contributes (excluding presentational rows
  // like tabs), shown as a read-only preview so the user knows what they'll get.
  const starterFields = (bp.fields || []).filter((f) => f.key && !FG_PRESENTATIONAL.has(f.type));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!finalSlug) { toast.error('Invalid slug', 'Use lowercase letters, digits, or underscores.'); return; }
    if (!label.trim()) { toast.error('Need a singular label'); return; }
    setBusy(true);
    try {
      await rest('/activity/v1/settings/custom-cpts', {
        method: 'POST',
        body: JSON.stringify({
          slug: finalSlug,
          label: label.trim(),
          plural: plural.trim() || `${label.trim()}s`,
          editors,
          editor: editors[0],
          editor_mode: (editors[0] === 'block' ? 'block' : 'md'),
          hierarchical,
          icon: iconSvg ? '' : icon,
          icon_svg: iconSvg || '',
          fields: bp.fields || [],
          field_display: bp.display || {},
        }),
      });
      // Seed the type's JSON Schema (status enum + x-os-lifecycle state
      // machine + x-os-relations edge map) as a schema override, so
      // os-schema-get orients agents to the legal transitions and the type
      // graph. Best-effort — a schema failure must not block the create.
      if (bp.schema && typeof bp.schema === 'object') {
        try {
          await rest('/activity/v1/settings/schema-override', {
            method: 'POST',
            body: JSON.stringify({ cpt: `ci_${finalSlug}`, json: JSON.stringify(bp.schema) }),
          });
        } catch (_) { /* type exists; schema can be (re)added from the Schema tab */ }
      }
      toast.success(`Created “${label.trim()}”`, 'Opening it…');
      // Force a real reload so the freshly registered CPT lands in BOOT.types.
      window.location.hash = `#/structure/${finalSlug}`;
      window.location.reload();
    } catch (err) {
      toast.error('Create failed', err.message);
      setBusy(false);
    }
  };

  const headerActions = h`<${WPButton} __next40pxDefaultSize variant="primary" onClick=${submit} isBusy=${busy} disabled=${!canCreate}>${busy ? 'Creating…' : 'Create type'}</${WPButton}>`;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title=${bp.label ? `New ${bp.label}` : 'New content type'} icon="cube" onBack=${() => navigate('/content-types')} backLabel="Content Types" actions=${headerActions} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
      <form onSubmit=${submit} className="p-6 md:p-10 mx-auto w-full max-w-3xl space-y-8 pb-32">
        <${PageHeading} icon=${CI_ICONS[icon] ? icon : 'cube'} title=${bp.label ? `New ${bp.label}` : 'New content type'} description=${bp.description || 'Register a custom post type. Define its fields and taxonomies after creating it.'} />

        <${ManageSection} title="Identity" description="Names and the slug used for storage and URLs.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <${WPTextControl} label="Singular label" value=${label} onChange=${onLabel} placeholder="Habit" __nextHasNoMarginBottom __next40pxDefaultSize />
            <${WPTextControl} label="Plural label" value=${plural} onChange=${setPlural} placeholder="Habits" __nextHasNoMarginBottom __next40pxDefaultSize />
          </div>
          <${WPTextControl}
            label="Slug"
            value=${slug}
            onChange=${onSlug}
            placeholder="habit"
            help=${h`Becomes <code className="font-mono">ci_${finalSlug || 'name'}</code>. Lowercase letters, digits, and underscores.`}
            __nextHasNoMarginBottom __next40pxDefaultSize
          />
        </${ManageSection}>

        <${ManageSection} title="Appearance" description="How this type shows up in the sidebar and lists.">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-12">Icon</span>
            <${IconPicker} value=${icon} valueSvg=${iconSvg} disabled=${busy} onChange=${(name, svg) => { setIcon(name || 'folder'); setIconSvg(svg || ''); }} />
          </div>
        </${ManageSection}>

        <${ManageSection} title="Behaviour" description="How items are edited and organised.">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Editor</label>
            <${SelectMenu} ariaLabel="Editor" multiple options=${cptEditorChoices()} value=${editors} onChange=${(v) => setEditors(v.length ? v : ['cpt'])} />
            <${EditorChips} keys=${editors} />
            <p className="text-xs text-muted-foreground">${editorChoices().find((o) => o.key === editors[0])?.description || 'How items of this type are edited.'} ${editors.length > 1 ? 'The first is the default; switch per item from the editor header.' : ''}</p>
          </div>
          <${WPToggleControl}
            __nextHasNoMarginBottom
            label="Allow sub-items (hierarchical)"
            help=${hierarchical ? 'Items can be nested under a parent — e.g. tasks grouped under a routine.' : 'Items sit in a flat list.'}
            checked=${hierarchical}
            onChange=${setHierarchical}
          />
        </${ManageSection}>

        ${starterFields.length ? h`<${ManageSection} title="Starter fields" description="Seeded from this blueprint. Add, rename, or remove them in the Fields tab after creating.">
          <div className="flex flex-wrap gap-2">
            ${starterFields.map((f) => h`<span key=${f.key} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-muted text-foreground">
              <span className="font-medium">${f.label || f.key}</span>
              <span className="text-muted-foreground">${f.type}</span>
            </span>`)}
          </div>
        </${ManageSection}>` : null}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <${WPButton} variant="tertiary" onClick=${() => navigate('/content-types')} disabled=${busy}>Cancel</${WPButton}>
          <${WPButton} variant="primary" type="submit" __next40pxDefaultSize isBusy=${busy} disabled=${!canCreate}>${busy ? 'Creating…' : 'Create type'}</${WPButton}>
        </div>
      </form>
    </div>
  </div>`;
}

// Kernel-proposal review queue (Content Types → Proposals). Agents propose
// structural changes over MCP (ci/type-register, ci/schema-set,
// ci/type-orient-set); nothing applies until approved here. Approval
// re-dispatches the same REST routes the UI writes through, server-side.
function SettingsProposals({ toast, dialog }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState('');
  const load = useCallback(async () => {
    try { setItems((await rest('/activity/v1/settings/proposals')).proposals || []); }
    catch (e) { toast.error('Load failed', e.message); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const kindLabel = { 'type-register': 'New content type', 'schema-set': 'Schema override', 'type-orient-set': 'Orientation (AGENTS.md)' };
  const subject = (p) => p.kind === 'type-register'
    ? `ci_${String(p.payload?.slug || '').replace(/^ci_/, '')} — ${p.payload?.label || ''}`
    : (p.payload?.cpt || '');

  const decide = async (p, action) => {
    if (action === 'approve') {
      const ok = await dialog.confirm(
        `Approve “${kindLabel[p.kind] || p.kind}” for ${subject(p)}?`,
        'This applies the structural change through the same routes the UI uses. Schema and orientation overrides replace wholesale.',
        { confirmLabel: 'Approve & apply' }
      );
      if (!ok) return;
    }
    setBusy(p.id);
    try {
      await rest('/activity/v1/settings/proposals/decide', { method: 'POST', body: JSON.stringify({ id: p.id, action }) });
      toast.success(action === 'approve' ? 'Approved & applied' : 'Rejected');
      await load();
    } catch (e) {
      toast.error(`${action === 'approve' ? 'Apply' : 'Reject'} failed`, e.message);
    } finally {
      setBusy('');
    }
  };

  if (!items) return h`<${Spinner} />`;
  const pending = items.filter((p) => p.status === 'pending');
  const decided = items.filter((p) => p.status !== 'pending');
  const row = (p) => h`<div key=${p.id} className="border border-border rounded-md">
    <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">${kindLabel[p.kind] || p.kind}</span>
      <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${subject(p)}</code>
      ${p.status !== 'pending' ? h`<span className=${`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${p.status === 'approved' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>${p.status}</span>` : null}
      <button type="button" className="text-xs text-muted-foreground hover:underline ml-auto" onClick=${() => setOpen(open === p.id ? '' : p.id)}>${open === p.id ? 'Hide payload' : 'View payload'}</button>
      ${p.status === 'pending' ? h`<${Fragment}>
        <${WPButton} variant="primary" size="small" isBusy=${busy === p.id} disabled=${!!busy} onClick=${() => decide(p, 'approve')}>Approve</${WPButton}>
        <${WPButton} variant="tertiary" size="small" disabled=${!!busy} onClick=${() => decide(p, 'reject')}>Reject</${WPButton}>
      </${Fragment}>` : null}
    </div>
    ${p.payload?.rationale ? h`<p className="px-3 pb-2 text-sm text-muted-foreground">${p.payload.rationale}</p>` : null}
    ${open === p.id ? h`<pre className="px-3 py-2 font-mono text-xs bg-muted/30 border-t border-border whitespace-pre-wrap max-h-64 overflow-y-auto">${JSON.stringify(p.payload, null, 2)}</pre>` : null}
  </div>`;

  return h`<div className="space-y-6">
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pending</h2>
      ${pending.length === 0
        ? h`<${Card} className="p-5 text-sm text-muted-foreground italic">No pending proposals. Agents queue structural changes here via ci/type-register, ci/schema-set, and ci/type-orient-set.</${Card}>`
        : pending.map(row)}
    </section>
    ${decided.length ? h`<section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Decided</h2>
      ${decided.map(row)}
    </section>` : null}
  </div>`;
}

function ContentTypesPage() {
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const reload = async () => {
    try { setData(await rest('/activity/v1/settings')); }
    catch (e) { toast.error('Load failed', e.message); }
  };
  useEffect(() => { reload(); }, []);

  // Manageable CPTs = user-registered types (adopted + custom) from BOOT.types,
  // on any content editor — `manageable` is set server-side for exactly those,
  // so markdown/block custom CPTs surface here too (not just 'cpt'-editor ones).
  const managed = Object.entries(BOOT.types || {})
    .filter(([, m]) => m && (m.manageable || m.editor === 'cpt'))
    .map(([key, m]) => ({ key, meta: m }));
  const placeLabel = (p) => (!p || p === 'unified') ? 'Context' : (p === 'own' ? 'Own group' : (p.indexOf('under:') === 0 ? `Under ${typeMeta(p.slice(6))?.label || p.slice(6)}` : p));

  const location = useLocation();
  const CT_TABS = [
    { key: 'types', label: 'Types' },
    { key: 'custom', label: 'Custom' },
    { key: 'adopted', label: 'Adopted' },
    { key: 'proposals', label: 'Proposals' },
  ];
  const m = location.pathname.match(/\/content-types\/([^/]+)/);
  const tab = (m && CT_TABS.some((t) => t.key === m[1])) ? m[1] : 'types';
  const AppHeader = CIRegistry.AppHeader;
  const tabsToggle = h`<${SegmentedToggle} value=${tab} ariaLabel="Content Types section"
    onChange=${(t) => navigate(t === 'types' ? '/content-types' : `/content-types/${t}`)}
    options=${CT_TABS.map((t) => ({ key: t.key, label: t.label }))} />`;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Content Types" icon="cube" actions=${tabsToggle} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    <div className="p-6 md:p-10 mx-auto w-full max-w-5xl space-y-8">
      <${PageHeading} icon="cube" title="Content Types" description="Register custom post types, adopt existing ones, and define each type's fields, taxonomies, and layout." />
      ${!data ? h`<${Spinner} />` : tab === 'types' ? h`<${Fragment}>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Start from a blueprint</h2>
          <p className="text-sm text-muted-foreground">One-click scaffold a new type with a ready-made field set + editor. You can rename it and tweak fields afterward in its Structure tab.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${CI_BLUEPRINTS.map((bp) => h`<button
              key=${bp.id}
              type="button"
              onClick=${() => navigate(`/structure/new?bp=${bp.id}`)}
              className="text-left border border-border rounded-lg bg-card p-4 transition-colors hover:border-primary hover:shadow-sm"
            >
              <div className="flex items-center gap-2.5">
                <${Icon} name=${CI_ICONS[bp.icon] ? bp.icon : 'cube'} className="w-5 h-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0 truncate font-semibold">${bp.label}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-snug">${bp.description}</p>
            </button>`)}
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your content types</h2>
          ${managed.length === 0
            ? h`<${Card} className="p-5 text-sm text-muted-foreground italic">No managed content types yet — create or adopt one below.</${Card}>`
            : h`<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${managed.map(({ key, meta }) => h`<button
                  key=${key}
                  type="button"
                  onClick=${() => navigate(`/structure/${key}`)}
                  className="text-left os-ct-card border border-border rounded-lg bg-card p-4 hover:border-primary hover:shadow-sm transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <${CptIcon} icon=${meta.icon} iconSvg=${meta.icon_svg} fallback="cube" className="w-5 h-5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 min-w-0 truncate font-semibold">${meta.label}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">${meta.cpt}</code>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">${placeLabel(meta.placement)}</span>
                  </div>
                </button>`)}
              </div>`}
        </section>
      </${Fragment}>`
      : tab === 'custom' ? h`<${SettingsCustomCpts}  data=${data} reload=${reload} toast=${toast} dialog=${dialog} />`
      : tab === 'adopted' ? h`<${SettingsAdoptedCpts} data=${data} reload=${reload} toast=${toast} dialog=${dialog} />`
      : tab === 'proposals' ? h`<${SettingsProposals} toast=${toast} dialog=${dialog} />`
      : null}
    </div>
    </div>
  </div>`;
}

// Structures saved before layout containers existed are flat lists; loose
// narrow fields sat directly on the root 12-col grid, so their widths
// resolved against the whole canvas. Wrap each consecutive run of sub-12-col
// fields into a Row container (packing to 12 columns, the same line-breaking
// the root grid produced) so every field's width is relative to its row.
// Runs once at load; saving persists the rows. Lists that already contain a
// group were structured by hand and are left untouched.
const fgFullSpan = (f) => f.type === 'group' || f.type === 'richtext' || f.type === 'content'
  || FG_PRESENTATIONAL.has(f.type) || fgCols(f.width) >= 12;
function wrapFlatRows(list) {
  if (list.some((f) => f.type === 'group')) return list;
  const out = [];
  let run = [];
  let cols = 0;
  const flush = () => {
    if (!run.length) return;
    out.push(fgWithId({ type: 'group', layout: 'row', fields: run }));
    run = [];
    cols = 0;
  };
  for (const f of list) {
    if (fgFullSpan(f)) { flush(); out.push(f); continue; }
    const c = fgCols(f.width);
    if (cols + c > 12) flush();
    run.push(f);
    cols += c;
  }
  flush();
  return out;
}

function StructureEditorPage() {
  const { type, tab } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();
  const cpt = meta?.cpt;

  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState([]);
  const [attachedTaxes, setAttachedTaxes] = useState([]); // from descriptor
  const [ciTaxes, setCiTaxes] = useState([]);              // ci_taxonomies (all)
  const [descFields, setDescFields] = useState([]);        // full descriptor.fields (incl. introspected/auto)
  const [display, setDisplay] = useState({});              // { sort, columns:[keys], filters:[keys] }
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ntSlug, setNtSlug] = useState('');
  const [ntLabel, setNtLabel] = useState('');
  const [ntHier, setNtHier] = useState(false);
  // Per-CPT registration ("General" tab): kind + editable identity/placement.
  const [reg, setReg] = useState(null);
  const [regSaving, setRegSaving] = useState(false);
  // Full settings payload (Schema + AGENTS.md tabs read schemas/agents docs
  // + overrides from it; load() already fetches it for field groups).
  const [settingsData, setSettingsData] = useState(null);
  // Comfortable (readable) vs full-width page — shares the persisted editor
  // preference so the layout preview can breathe on wide screens.
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();
  // Fields designer mode: the classic drag grid, or the embedded block-editor
  // canvas (settings in the block inspector). Persisted per user.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        rest('/activity/v1/settings'),
        rest(`/activity/v1/cpt-schema/${cpt}`).catch(() => ({ taxonomies: [] })),
      ]);
      setSettingsData(s);
      const grp = (s.field_groups && s.field_groups[cpt]) || {};
      const rawFields = (grp.fields || []).map(fgWithId);
      const loaded = wrapFlatRows(rawFields);
      // Surface the auto-registered post body as a reorderable structure block
      // so it can be positioned among the meta fields (e.g. above Footnotes)
      // instead of being force-appended after them. Injected once; round-trips.
      if (d.supports_editor && !loaded.some((f) => f.type === 'content')) {
        loaded.push(fgWithId({ type: 'content', key: 'content_body', label: 'Content' }));
      }
      setFields(loaded);
      setDisplay(grp.display || {});
      setCiTaxes(s.taxonomies || []);
      setAttachedTaxes(d.taxonomies || []);
      setDescFields(d.fields || []);
      // Registration: adopted CPTs key by raw slug (=== cpt); custom by bare slug.
      const adopted = (s.adopted_cpts && s.adopted_cpts[cpt]) || null;
      const custom = (s.custom_cpts || []).find((c) => ('ci_' + String(c.slug).replace(/^ci_/, '')) === cpt || c.slug === cpt) || null;
      setReg(adopted
        ? { kind: 'adopted', icon: adopted.icon || '', icon_svg: adopted.icon_svg || '', placement: adopted.placement || 'unified', hide_menu: !!adopted.hide_menu, label: meta?.label || '', singular: meta?.singular || '', path_template: adopted.path_template || '' }
        : (custom
          ? { kind: 'custom', label: custom.label || '', plural: custom.plural || '', icon: custom.icon || '', icon_svg: custom.icon_svg || '', editor_mode: custom.editor_mode || 'md', editor: custom.editor || (custom.editor_mode === 'block' ? 'block' : 'cpt'), editors: (custom.editors && custom.editors.length) ? custom.editors : [custom.editor || (custom.editor_mode === 'block' ? 'block' : 'cpt')], path_template: custom.path_template || '' }
          : { kind: 'builtin' }));
      setSel(0);
      // wrapFlatRows returns the input array untouched when nothing needed
      // wrapping; a new array means this legacy-flat layout was normalized —
      // leave Save armed so the rows can be persisted right away.
      setDirty(loaded !== rawFields);
    } catch (e) { toast.error('Load failed', e.message); }
    finally { setLoading(false); }
  }, [cpt, toast, meta?.label, meta?.singular]);
  useEffect(() => { if (cpt) load(); }, [cpt]);

  // Display (list-view) helpers — per-field column/filter toggles + default
  // sort, surfaced inside the Fields tab (no separate Display tab). Keys:
  // `tax:<slug>` for taxonomies, `meta:<key>` for other fields.
  const colDefaultFor = (t) => t === 'taxonomy';
  const filtDefaultFor = (t) => ['taxonomy', 'enum', 'boolean'].includes(t);
  const dispKey = (f) => (f.type === 'taxonomy' ? `tax:${f.taxonomy}` : `meta:${f.key}`);
  const dispOn = (listName, f, defFor) => (Array.isArray(display[listName]) ? display[listName].includes(dispKey(f)) : defFor(f.type));
  const toggleDisp = (listName, f, on, defPred) => {
    const key = dispKey(f);
    setDisplay((d) => {
      const base = Array.isArray(d[listName])
        ? d[listName]
        : descFields.filter((x) => !FG_PRESENTATIONAL.has(x.type) && defPred(x.type)).map((x) => (x.type === 'taxonomy' ? `tax:${x.taxonomy}` : `meta:${x.key}`));
      const set = new Set(base);
      if (on) set.add(key); else set.delete(key);
      return { ...d, [listName]: [...set] };
    });
    setDirty(true);
  };
  // Editor visibility toggles. `display.hidden` lists identifiers suppressed
  // when editing a post of this type: `meta:<key>` for fields, `tax:<slug>`
  // for taxonomies. Absent === surfaced. (Section/heading/tab/notice blocks
  // carry their own `enabled` flag, toggled from the canvas inspector.)
  const isHidden = (id) => (Array.isArray(display.hidden) ? display.hidden : []).includes(id);
  const setSurfaced = (id, surfaced) => {
    setDisplay((d) => {
      const set = new Set(Array.isArray(d.hidden) ? d.hidden : []);
      if (surfaced) set.delete(id); else set.add(id);
      return { ...d, hidden: [...set] };
    });
    setDirty(true);
  };
  // Structure-editor tab visibility (admin convenience, per CPT). A tab is
  // shown unless explicitly set false in `display.struct_tabs`.
  const structTabVisible = (name) => !(display.struct_tabs && display.struct_tabs[name] === false);
  const setStructTabVisible = (name, on) => {
    setDisplay((d) => ({ ...d, struct_tabs: { ...(d.struct_tabs || {}), [name]: on } }));
    setDirty(true);
  };
  // Collapse state for the structure-page cards (taxonomy cards, detected
  // fields). UI-only — not persisted. `key` is e.g. `tax:<slug>` or `detected`.
  const [collapsedCards, setCollapsedCards] = useState({});
  const cardOpen = (key) => !collapsedCards[key];
  const toggleCard = (key) => setCollapsedCards((c) => ({ ...c, [key]: !c[key] }));
  const cardCaret = (key, label) => h`<button type="button" onClick=${() => toggleCard(key)} aria-expanded=${cardOpen(key)}
    className="flex items-center gap-2 min-w-0 hover:text-primary" title=${cardOpen(key) ? 'Collapse' : 'Expand'}>
    <span className="shrink-0"><${Icon} name=${cardOpen(key) ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 text-muted-foreground" /></span>
    ${label}
  </button>`;
  // Convert a descriptor field (introspected/external) into an editable
  // field-group definition so the user can position + configure it.
  const descToGroup = (df) => {
    const map = { string: 'text', text: 'textarea', number: 'number', boolean: 'checkbox', enum: 'select', date: 'date', url: 'url', list: 'list', relationship: 'relationship' };
    const g = { type: map[df.type] || 'text', key: df.key, label: df.label || df.key };
    if (df.type === 'list') g.integer = df.items === 'integer';
    if (df.type === 'enum') g.options = (df.enum || []).filter(Boolean).map((v) => ({ value: v, label: v }));
    if (df.type === 'relationship') { if (df.target_cpt) g.target_cpt = df.target_cpt; if (df.multiple) g.multiple = true; }
    if (df.type === 'list' && df.target_cpt) g.target_cpt = df.target_cpt;
    return g;
  };
  // Adding a detected field to the layout clears any "hidden" toggle on it, so
  // a placed field is never left suppressed with no way to re-surface it (the
  // detected list — the only place that toggle lives — drops placed keys).
  const clearHidden = (keys) => setDisplay((d) => {
    if (!Array.isArray(d.hidden) || !d.hidden.length) return d;
    const drop = new Set(keys.map((k) => `meta:${k}`));
    return { ...d, hidden: d.hidden.filter((id) => !drop.has(id)) };
  });
  const addDetectedField = (df) => {
    setFields((fs) => { setSel(fs.length); return [...fs, fgWithId(descToGroup(df))]; });
    clearHidden([df.key]);
    setDirty(true);
  };
  const addAllDetected = (list) => {
    setFields((fs) => [...fs, ...list.map((df) => fgWithId(descToGroup(df)))]);
    clearHidden(list.map((df) => df.key));
    setDirty(true);
  };

  const saveFields = useCallback(async () => {
    setSaving(true);
    try {
      await rest('/activity/v1/settings/field-groups', { method: 'POST', body: JSON.stringify({ cpt, fields: fields.map(fgStrip), display }) });
      toast.success('Saved');
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }, [cpt, fields, display, toast]);

  useEffect(() => {
    function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !saving) saveFields(); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, saveFields]);

  const addTax = async () => {
    if (!ntSlug.trim() || !ntLabel.trim()) { toast.error('Need slug and label'); return; }
    try {
      await rest('/activity/v1/settings/taxonomies', { method: 'POST', body: JSON.stringify({ slug: ntSlug.trim(), label: ntLabel.trim(), hierarchical: ntHier, cpts: [cpt] }) });
      setNtSlug(''); setNtLabel(''); setNtHier(false);
      toast.success('Taxonomy added'); await load();
    } catch (e) { toast.error('Add failed', e.message); }
  };
  const detachTax = async (slug) => {
    const row = ciTaxes.find((t) => t.slug === slug);
    if (!row) return;
    const cpts = (row.cpts || []).filter((c) => c !== cpt);
    try {
      if (cpts.length === 0) await rest(`/activity/v1/settings/taxonomies?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      else await rest('/activity/v1/settings/taxonomies', { method: 'POST', body: JSON.stringify({ slug, label: row.label, singular: row.singular || row.label, hierarchical: !!row.hierarchical, cpts }) });
      await load();
    } catch (e) { toast.error('Detach failed', e.message); }
  };

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type</div></${TypeLayout}>`;
  if (loading) return h`<${TypeLayout} type=${type}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  // List-view column/filter helpers, threaded into the canvas inspector.
  const disp = { dispOn, toggleDisp, colDefaultFor, filtDefaultFor };

  // The designer is the block-editor canvas, full stop (the grid builder
  // retired in favour of it): the inserter carries the field types, the
  // layout containers, and one variation per attached taxonomy.
  const renderFields = () => h`<div className="space-y-4">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">Add fields with the + inserter; click a block to edit its settings (incl. width) in the side panel; reorder with the block toolbar. Group | Stack | Row lay fields out.</p>
      <div className="os-wpds-fields w-40">
        <${SelectMenu}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Default sort"
          hideLabelFromVision=${true}
          value=${display.sort || 'recent'}
          onChange=${(v) => { setDisplay((d) => ({ ...d, sort: v })); setDirty(true); }}
          options=${INDEX_SORTS}
          aria-label="Default sort"
        />
      </div>
      ${/* List layout is a TYPE setting, not a per-visit toggle: the list
          renders as a plain table or as the os_path folder tree. */''}
      <div className="os-wpds-fields w-40">
        <${SelectMenu}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="List layout"
          hideLabelFromVision=${true}
          value=${display.layout || 'table'}
          onChange=${(v) => { setDisplay((d) => ({ ...d, layout: v })); setDirty(true); }}
          options=${[{ label: 'List: table', value: 'table' }, { label: 'List: folder tree', value: 'tree' }]}
          aria-label="List layout"
        />
      </div>
    </div>
    <${FieldsCanvas} fields=${fields} onFieldsChange=${(fs) => { setFields(fs); setDirty(true); }} disp=${disp} attachedTaxes=${attachedTaxes} />
    ${(() => {
      // Fields detected on this post type (registered by another plugin or
      // auto-surfaced) that aren't yet placed in the layout. "Add to layout"
      // adopts one into the field group so it can be positioned + configured.
      // Placed = anywhere in the layout, containers included. A top-level
      // scan re-listed every contained field as "detected", and Add all then
      // duplicated already-managed keys instead of adopting them. Containers
      // themselves are also placed keys (the descriptor echoes them back) and
      // are never adoptable fields.
      const placedKeys = new Set();
      (function collect(list) { for (const f of list || []) { placedKeys.add(f.key); if (f.type === 'group') collect(f.fields); } })(fields);
      const detected = descFields.filter((f) => f.type !== 'heading' && f.type !== 'taxonomy' && f.type !== 'group' && !placedKeys.has(f.key));
      if (!detected.length) return null;
      const detOpen = cardOpen('detected');
      return h`<${Card} className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          ${cardCaret('detected', h`<span className="text-sm font-semibold">Detected fields <span className="font-normal text-muted-foreground">(${detected.length})</span></span>`)}
          <${WPButton} variant="link" onClick=${() => addAllDetected(detected)}>Add all</${WPButton}>
        </div>
        ${!detOpen ? null : h`<${Fragment}>
        <p className="text-xs text-muted-foreground">These are registered by another plugin or auto-surfaced. They show in the editor by default — switch one off to hide it, or add it to the layout to position, resize, relabel, or (for ID lists) make it a relationship.</p>
        <ul className="divide-y divide-border border border-border rounded">
          ${detected.map((f) => { const surfaced = !isHidden(`meta:${f.key}`); return h`<li key=${f.key} className=${'flex items-center gap-3 px-3 py-2 text-sm' + (surfaced ? '' : ' opacity-60')}>
            <${WPToggleControl} __nextHasNoMarginBottom checked=${surfaced} onChange=${(on) => setSurfaced(`meta:${f.key}`, on)} label=${h`<span style=${SR_ONLY}>Surface ${f.label || f.key} in editor</span>`} />
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${f.key}</code>
            <span className="text-foreground">${f.label || f.key}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">${f.type}${f.type === 'list' && f.items ? ` ${f.items}` : ''}</span>
            <${WPButton} variant="secondary" size="small" className="ml-auto" disabled=${!surfaced} onClick=${() => addDetectedField(f)}>Add to layout</${WPButton}>
          </li>`; })}
        </ul>
        </${Fragment}>`}
      </${Card}>`;
    })()}
  </div>`;

  const renderTaxonomies = () => {
    const managed = new Set(ciTaxes.map((t) => t.slug));
    return h`<div className="space-y-6">
      ${attachedTaxes.length === 0
        ? h`<div className="text-sm text-muted-foreground italic">No taxonomies attached yet.</div>`
        : attachedTaxes.map((t) => { const surfaced = !isHidden(`tax:${t.slug}`); const open = cardOpen(`tax:${t.slug}`); return h`<${Card} key=${t.slug} className=${'p-4 space-y-3' + (surfaced ? '' : ' opacity-60')}>
            <div className="flex items-center gap-2 flex-wrap">
              ${cardCaret(`tax:${t.slug}`, h`<span className="font-medium">${t.label}</span>`)}
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${t.slug}</code>
              <span className=${'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ' + (managed.has(t.slug) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>${managed.has(t.slug) ? 'CI' : 'external'}</span>
              <div className="ml-auto flex items-center gap-3">
                <${WPToggleControl} __nextHasNoMarginBottom checked=${surfaced} onChange=${(on) => setSurfaced(`tax:${t.slug}`, on)} label=${h`<span className="text-xs text-muted-foreground">${surfaced ? 'In editor' : 'Hidden'}</span>`} />
                ${managed.has(t.slug) ? h`<button type="button" className="text-xs text-muted-foreground hover:text-red-600" onClick=${() => detachTax(t.slug)}>Detach</button>` : null}
              </div>
            </div>
            ${open ? h`<${FgTermManager} slug=${t.slug} />` : null}
          </${Card}>`; })}
      <${Card} className="p-4 space-y-3">
        <div className="text-sm font-semibold">Add a taxonomy</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <${WPTextControl} label="Taxonomy slug" hideLabelFromVision=${true} value=${ntSlug} onChange=${setNtSlug} placeholder="slug (e.g. region)" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
          <${WPTextControl} label="Taxonomy label" hideLabelFromVision=${true} value=${ntLabel} onChange=${setNtLabel} placeholder="Label (e.g. Regions)" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <${WPCheckboxControl}
            __nextHasNoMarginBottom=${true}
            label="Hierarchical (parent/child)"
            checked=${ntHier}
            onChange=${setNtHier}
          />
          <${WPButton} variant="primary" onClick=${addTax}>Add taxonomy</${WPButton}>
        </div>
      </${Card}>
    </div>`;
  };

  // Persist per-CPT registration (the General tab). Adopted CPTs round-trip
  // icon/placement/hide_menu/label/singular via the adopted-cpts route; custom
  // CPTs re-register label/plural/editor via the custom-cpts route.
  const saveReg = async () => {
    if (!reg) return;
    setRegSaving(true);
    try {
      if (reg.kind === 'adopted') {
        await rest('/activity/v1/settings/adopted-cpts', {
          method: 'POST',
          body: JSON.stringify({ slug: cpt, managed: true, hide_menu: !!reg.hide_menu, icon: reg.icon || '', icon_svg: reg.icon_svg || '', placement: reg.placement || 'unified', label: reg.label || '', singular: reg.singular || '', path_template: reg.path_template || '' }),
        });
      } else if (reg.kind === 'custom') {
        await rest('/activity/v1/settings/custom-cpts', {
          method: 'POST',
          body: JSON.stringify({ slug: cpt.replace(/^ci_/, ''), label: reg.label || '', plural: reg.plural || '', icon: reg.icon || '', icon_svg: reg.icon_svg || '', editors: reg.editors, editor: reg.editors[0], editor_mode: (reg.editors[0] === 'block' ? 'block' : 'md'), update: true, path_template: reg.path_template || '' }),
        });
      }
      toast.success('Saved', 'Reload the page to apply nav/label changes.');
      await load();
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setRegSaving(false); }
  };

  const renderGeneral = () => {
    if (!reg) return h`<${Spinner} />`;
    const kindBadge = { adopted: 'Adopted (third-party)', custom: 'Custom (CI)', builtin: 'Built-in' }[reg.kind] || reg.kind;
    const setReg2 = (patch) => setReg((r) => ({ ...r, ...patch }));
    return h`<div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">${cpt}</code>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">${kindBadge}</span>
      </div>
      ${reg.kind === 'adopted' ? h`<${Fragment}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 os-wpds-fields">
          <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label (plural)" value=${reg.label || ''} onChange=${(v) => setReg2({ label: v })} />
          <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Singular" value=${reg.singular || ''} onChange=${(v) => setReg2({ singular: v })} />
        </div>
        <div className="flex flex-col items-start gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wider w-16">Icon</span>
            <${IconPicker} value=${reg.icon} valueSvg=${reg.icon_svg} onChange=${(name, svg) => setReg2({ icon: name, icon_svg: svg })} />
          </label>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wider w-16">Sidebar</span>
            <${SelectMenu}
              label="Sidebar placement"
              hideLabelFromVision=${true}
              value=${reg.placement || 'unified'}
              onChange=${(v) => setReg2({ placement: v })}
              options=${cptPlacementOptions(cpt).map((o) => ({ label: o.label, value: o.value }))}
              __nextHasNoMarginBottom=${true}
            />
          </div>
          <${WPCheckboxControl}
            __nextHasNoMarginBottom=${true}
            label="Hide wp-admin menu"
            checked=${!!reg.hide_menu}
            onChange=${(v) => setReg2({ hide_menu: v })}
          />
        </div>
        <${PathStructureField} value=${reg.path_template} onChange=${(v) => setReg2({ path_template: v })} />
        <div><${WPButton} __next40pxDefaultSize variant="primary" onClick=${saveReg} isBusy=${regSaving}>${regSaving ? 'Saving…' : 'Save registration'}</${WPButton}></div>
        <p className="text-xs text-muted-foreground">Icon + sidebar placement reflect after a page reload. JSON-schema overrides live in <${Link} to="/content-types" className="text-primary">Content Types</${Link}>.</p>
      </${Fragment}>` : (reg.kind === 'custom' ? h`<${Fragment}>
        <${ManageSection} title="Identity" description="Names shown in the sidebar and lists.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Singular label" value=${reg.label || ''} onChange=${(v) => setReg2({ label: v })} />
            <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Plural label" value=${reg.plural || ''} onChange=${(v) => setReg2({ plural: v })} />
          </div>
        </${ManageSection}>
        <${ManageSection} title="Appearance">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-12">Icon</span>
            <${IconPicker} value=${reg.icon} valueSvg=${reg.icon_svg} onChange=${(name, svg) => setReg2({ icon: name, icon_svg: svg })} />
          </div>
        </${ManageSection}>
        <${ManageSection} title="Behaviour" description="How items are edited and where new ones are stored.">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Editor</label>
            <${SelectMenu} ariaLabel="Editor" multiple options=${cptEditorChoices()} value=${reg.editors || [reg.editor || 'cpt']} onChange=${(v) => setReg2({ editors: v, editor: v[0] })} />
            <${EditorChips} keys=${reg.editors || [reg.editor || 'cpt']} />
            <p className="text-xs text-muted-foreground">${editorChoices().find((o) => o.key === ((reg.editors && reg.editors[0]) || reg.editor || 'cpt'))?.description || 'How posts of this type are edited.'} ${(reg.editors && reg.editors.length > 1) ? 'The first is the default; switch per item from the editor header. ' : ''}Changing applies after a page reload.</p>
          </div>
          <${PathStructureField} value=${reg.path_template} onChange=${(v) => setReg2({ path_template: v })} />
        </${ManageSection}>
        <div className="flex items-center gap-3"><${WPButton} __next40pxDefaultSize variant="primary" onClick=${saveReg} isBusy=${regSaving}>${regSaving ? 'Saving…' : 'Save registration'}</${WPButton}></div>
        <p className="text-xs text-muted-foreground">Deletion is managed in <${Link} to="/content-types" className="text-primary">Content Types</${Link}>.</p>
      </${Fragment}>` : h`<p className="text-sm text-muted-foreground">This is a built-in Context type — its registration isn't editable here. Define its fields + taxonomies in the tabs.</p>`)}
    </div>`;
  };

  // Per-type Schema tab — the same per-CPT editor that used to live on the
  // global Content Types → Schemas tab, scoped to this type. For blueprint
  // types the override IS the schema (seeded on create).
  const renderSchema = () => h`<div className="space-y-3">
    <p className="text-sm text-muted-foreground">JSON Schema drives frontmatter validation on save and orients agents via <code className="font-mono bg-muted px-1 rounded">os-schema-get</code> (including the <code className="font-mono bg-muted px-1 rounded">x-os-lifecycle</code> state machine and <code className="font-mono bg-muted px-1 rounded">x-os-relations</code> edges). Edit the override to customise per site; clear it to fall back to the plugin's file schema.</p>
    <${SettingsSchemaOne} cpt=${cpt} fileSchema=${settingsData?.schemas?.[cpt]?.file ?? null} effectiveSchema=${settingsData?.schemas?.[cpt]?.effective ?? null} override=${settingsData?.schema_overrides?.[cpt] || ''} reload=${load} toast=${toast} dialog=${dialog} />
  </div>`;
  // Per-type AGENTS.md tab — the agent orientation doc served over MCP via
  // ci/type-orient and folded into os-schema-get output. File docs ship with
  // the type (inc/schemas/<cpt>.agents.md); the override is site-authored.
  const renderAgents = () => h`<div className="space-y-3">
    <p className="text-sm text-muted-foreground">The AGENTS.md for this type: what it's for, when to create vs update, field conventions, and lifecycle rules. Agents read it over MCP (<code className="font-mono bg-muted px-1 rounded">ci/type-orient</code>) before working with ${meta.label}.</p>
    <${SettingsAgentsOne} cpt=${cpt} fileDoc=${settingsData?.agents_docs?.[cpt]?.file ?? null} override=${settingsData?.agents_overrides?.[cpt] || ''} reload=${load} toast=${toast} dialog=${dialog} />
  </div>`;

  // Tabs: General (registration) · Fields · Taxonomies · Schema · AGENTS.md.
  // General is hidden for built-in types (nothing editable there). Each tab
  // can additionally be toggled off per CPT via the header "Sections" control
  // (display.struct_tabs); if that would hide everything we fall back to
  // showing all of them. The active tab is URL-driven (/structure/:type/:tab)
  // so every tab is deep-linkable.
  const allStructTabs = [
    ...(reg && reg.kind !== 'builtin' ? [{ name: 'general', title: 'General' }] : []),
    { name: 'fields', title: 'Fields' },
    { name: 'taxonomies', title: 'Taxonomies' },
    { name: 'schema', title: 'Schema' },
    { name: 'agents', title: 'AGENTS.md' },
  ];
  const visibleStructTabs = allStructTabs.filter((t) => structTabVisible(t.name));
  const structTabs = visibleStructTabs.length ? visibleStructTabs : allStructTabs;
  const activeTab = (tab && structTabs.some((t) => t.name === tab)) ? tab : structTabs[0].name;
  const AppHeader = CIRegistry.AppHeader;
  // Shared CI chrome (AppHeader) instead of a bespoke in-page header, so the
  // manage screen reads as part of CI rather than a separate app. Save state +
  // the primary Save action live in the header's actions slot.
  const headerActions = h`<${Fragment}>
    ${CIRegistry.SaveStatus ? h`<${CIRegistry.SaveStatus} dirty=${dirty} saving=${saving} />` : null}
    <${WPButton} __next40pxDefaultSize variant="primary" onClick=${saveFields} isBusy=${saving} disabled=${saving || !dirty}>${saving ? 'Saving…' : 'Save fields'}</${WPButton}>
  </${Fragment}>`;
  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title=${meta.label} icon=${meta.icon} iconSvg=${meta.icon_svg} onBack=${() => navigate(`/t/${type}`)} backLabel=${`All ${meta.label}`} actions=${headerActions} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-card" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    ${/* The Fields tab is the block-editor canvas — always full width so it
        breathes like the Site Editor; the other tabs honour the footer's
        Comfortable / Full width preference. */''}
    <div className=${'p-6 md:p-10 mx-auto w-full space-y-6 pb-32 ' + ((fullWidth || activeTab === 'fields') ? 'max-w-none' : 'max-w-4xl')}>
      <${PageHeading} icon=${meta.icon && CI_ICONS[meta.icon] ? meta.icon : 'cube'} title=${`Manage ${meta.label}`} description=${h`<span>Register, then define fields and taxonomies for ${meta.label}. Fields become real post meta (REST + <code className="font-mono text-xs bg-muted px-1 rounded">get_post_meta</code>); taxonomies are queryable terms. Changes apply on the next page load.</span>`} />
      <${WPTabPanel} key=${activeTab} className="os-settings-tabs" initialTabName=${activeTab} tabs=${structTabs}
        onSelect=${(name) => { if (name !== activeTab) navigate(`/structure/${type}/${name}`); }}>
        ${(t) => h`<div className="pt-6">${
          t.name === 'general' ? renderGeneral()
          : t.name === 'fields' ? renderFields()
          : t.name === 'taxonomies' ? renderTaxonomies()
          : t.name === 'schema' ? renderSchema()
          : renderAgents()
        }</div>`}
      </${WPTabPanel}>

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <div>
          <${WPDropdown}
            popoverProps=${{ placement: 'bottom-start' }}
            renderToggle=${({ isOpen, onToggle }) => h`<button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick=${onToggle} aria-expanded=${isOpen}>Sections</button>`}
            renderContent=${() => h`<div className="p-3 space-y-3 os-wpds-fields" style=${{ minWidth: '200px' }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show tabs</div>
              ${allStructTabs.map((t) => h`<${WPToggleControl} key=${t.name} __nextHasNoMarginBottom label=${t.title} checked=${structTabVisible(t.name)} onChange=${(on) => setStructTabVisible(t.name, on)} />`)}
              <p className="text-xs text-muted-foreground pt-1">Hidden tabs reappear here. Save fields to persist.</p>
            </div>`}
          />
        </div>
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use comfortable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
        <${CIRegistry.PageFooter.Link} href="#/content-types">All types</${CIRegistry.PageFooter.Link}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Field designer — shared pieces used by BOTH the grid builder (Structure →
// Fields) and the block-editor canvas mode below. FieldConfigBody is the full
// per-type settings panel: grid mode renders it inline under the block grid,
// canvas mode renders it in the block inspector (InspectorControls). `patch(p)`
// merges into the field, `remove()` deletes it, `fields` is the whole layout
// (sibling pickers for conditional logic), `disp` carries the page's list-view
// column/filter helpers.
// Flatten group containers to their leaf fields (meta owners). Group nodes
// themselves store no data; walks that seed/load/save values use this.
function fgFlatten(fields) {
  const out = [];
  for (const f of fields || []) {
    if (f.type === 'group') { out.push(...fgFlatten(f.fields)); continue; }
    out.push(f);
  }
  return out;
}

// WYSIWYG preview of a field as the entity editor will render it. Inert —
// callers wrap it in a pointer-events-none/inert container, so every input is
// a controlled no-op; clicking anywhere selects the block instead.
const fpNoop = () => {};
function fauxCanvas(label, note) {
  return h`<div>
    ${label ? h`<div className="text-sm font-medium text-muted-foreground mb-2">${label}</div>` : null}
    <div className="border border-border rounded-md bg-background px-4 py-3 space-y-2">
      <div className="h-2.5 rounded bg-muted w-3/4"></div>
      <div className="h-2.5 rounded bg-muted w-full"></div>
      <div className="h-2.5 rounded bg-muted w-1/2"></div>
      ${note ? h`<div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">${note}</div>` : null}
    </div>
  </div>`;
}
function fieldPreview(f) {
  const label = f.label || f.key || '(unnamed)';
  const common = { __nextHasNoMarginBottom: true, __next40pxDefaultSize: true, label, help: f.help };
  // Designer type → entity editor rendering (mirrors renderField in the
  // entity editor: designer `text` saves as a single-line string control,
  // `textarea` as the 4-row long-text control).
  if (f.type === 'textarea') return h`<${WPTextareaControl} __nextHasNoMarginBottom label=${label} help=${f.help} rows=${4} value="" onChange=${fpNoop} />`;
  if (f.type === 'checkbox') return h`<${WPCheckboxControl} __nextHasNoMarginBottom label=${label} help=${f.help} checked=${false} onChange=${fpNoop} />`;
  if (f.type === 'select') return h`<${SelectMenu} ...${common} value="" onChange=${fpNoop}
    options=${[{ label: '—', value: '' }, ...(f.options || []).map((o) => ({ label: o.label || o.value, value: o.value }))]} />`;
  if (f.type === 'relationship' || f.type === 'list' || f.type === 'taxonomy') {
    return h`<${WPFormTokenField} __nextHasNoMarginBottom __next40pxDefaultSize label=${f.type === 'taxonomy' ? (f.label || f.taxonomy) : label} value=${[]} suggestions=${[]} onChange=${fpNoop} />`;
  }
  if (f.type === 'image') return h`<div>
    <div className="text-sm font-medium mb-1">${label}</div>
    <div className="border border-dashed border-border rounded-md h-20 flex items-center justify-center gap-2 text-xs text-muted-foreground"><${Icon} name="image" className="w-4 h-4" /> Select image</div>
  </div>`;
  if (f.type === 'repeater') {
    const subs = f.subfields || [];
    return h`<div>
      <div className="text-sm font-medium mb-1">${label}</div>
      <div className="border border-border rounded-md divide-y divide-border">
        <div className="flex gap-4 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          ${subs.length ? subs.map((sf, si) => h`<span key=${si}>${sf.label || sf.key || '…'}</span>`) : h`<span className="italic normal-case font-normal">No row fields yet</span>`}
        </div>
        <div className="px-3 py-2 text-xs text-muted-foreground">+ Add row</div>
      </div>
    </div>`;
  }
  if (f.type === 'richtext') return fauxCanvas(label, 'Rich text');
  if (f.type === 'content') return fauxCanvas(f.label || 'Content', f.format ? `Body · ${f.format}` : 'Body editor');
  if (f.type === 'heading') return h`<div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border pb-1 pt-2">
    <${Icon} name="chevron-down" className="w-3 h-3 text-muted-foreground" />
    <span>${f.label || 'Section'}</span>
  </div>`;
  if (f.type === 'tab') return h`<div className="flex items-end gap-4 border-b border-border text-sm">
    <span className="pb-2 -mb-px border-b-2 border-primary font-medium text-foreground">${f.label || 'Tab'}</span>
    <span className="pb-2 text-muted-foreground">…</span>
  </div>`;
  if (f.type === 'notice') return h`<${WPNotice} status=${f.status || 'info'} isDismissible=${false}>${f.text || f.label || 'Notice'}</${WPNotice}>`;
  if (f.type === 'progress') return h`<div className="space-y-1.5">
    <div className="flex items-baseline justify-between"><span className="text-sm font-medium">${f.label || 'Progress'}</span><span className="text-xs text-muted-foreground">3 / 8</span></div>
    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style=${{ width: '38%' }}></div></div>
  </div>`;
  const inputType = f.type === 'number' ? 'number'
    : f.type === 'date' ? 'date'
    : f.type === 'datetime' ? 'datetime-local'
    : f.type === 'url' ? 'url'
    : 'text';
  return h`<${WPTextControl} ...${common} type=${inputType} value="" onChange=${fpNoop} />`;
}

function FieldConfigBody({ f, patch, remove, fields, disp }) {
  const renderSelectOptions = (f) => {
    const opts = f.options || [];
    return h`<div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Options</div>
      ${opts.map((o, oi) => h`<div key=${oi} className="flex items-center gap-2">
        <div className="flex-1"><${WPTextControl} label="Option value" hideLabelFromVision=${true} value=${o.value || ''} onChange=${(v) => { const n = opts.slice(); n[oi] = { ...n[oi], value: v }; patch({ options: n }); }} placeholder="value" __nextHasNoMarginBottom=${true} /></div>
        <div className="flex-1"><${WPTextControl} label="Option label" hideLabelFromVision=${true} value=${o.label || ''} onChange=${(v) => { const n = opts.slice(); n[oi] = { ...n[oi], label: v }; patch({ options: n }); }} placeholder="label" __nextHasNoMarginBottom=${true} /></div>
        <button type="button" onClick=${() => patch({ options: opts.filter((_, x) => x !== oi) })} className="text-muted-foreground hover:text-red-600" title="Remove option">✕</button>
      </div>`)}
      <${WPButton} variant="link" onClick=${() => patch({ options: [...opts, { value: '', label: '' }] })}>+ Add option</${WPButton}>
    </div>`;
  };

  const setCond = (p) => { const cur = f.conditional || { logic: 'and', rules: [] }; patch({ conditional: { ...cur, ...p } }); };
  const setRule = (ri, p) => { const rules = (f.conditional?.rules || []).slice(); rules[ri] = { ...rules[ri], ...p }; setCond({ rules }); };

  const renderConditional = (f) => {
    const cond = f.conditional;
    // Rule targets are leaf fields wherever they sit — a container's children
    // are valid conditions (and containers themselves, which carry no value,
    // are not).
    const siblings = fgFlatten(fields).filter((s) => s.key && s.__id !== f.__id);
    return h`<div className="pt-3 border-t border-border space-y-3">
      <${WPCheckboxControl}
        __nextHasNoMarginBottom
        label="Show this field conditionally"
        checked=${!!cond}
        onChange=${(on) => patch({ conditional: on ? { logic: 'and', rules: [{ field: '', op: 'equals', value: '' }] } : undefined })}
      />
      ${cond ? h`<div className="space-y-2 pl-1 border-l-2 border-border">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show when</span>
          <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize value=${cond.logic || 'and'} onChange=${(v) => setCond({ logic: v })} options=${[{ label: 'all', value: 'and' }, { label: 'any', value: 'or' }]} />
          <span className="text-muted-foreground">of these match:</span>
        </div>
        ${(cond.rules || []).map((r, ri) => h`<div key=${ri} className="flex items-center gap-2 flex-wrap">
          <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize value=${r.field || ''} onChange=${(v) => setRule(ri, { field: v })} options=${[{ label: 'field…', value: '' }, ...siblings.map((s) => ({ label: s.label || s.key, value: s.key }))]} />
          <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize value=${r.op || 'equals'} onChange=${(v) => setRule(ri, { op: v })} options=${FG_COND_OPS.map(([id, l]) => ({ label: l, value: id }))} />
          ${(r.op === 'empty' || r.op === 'not_empty') ? null : h`<div className="flex-1 min-w-[100px]"><${WPTextControl} value=${r.value || ''} onChange=${(v) => setRule(ri, { value: v })} placeholder="value" __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true} /></div>`}
          <button type="button" onClick=${() => setCond({ rules: (cond.rules || []).filter((_, x) => x !== ri) })} className="text-muted-foreground hover:text-red-600" title="Remove rule">✕</button>
        </div>`)}
        <${WPButton} variant="link" onClick=${() => setCond({ rules: [...(cond.rules || []), { field: '', op: 'equals', value: '' }] })}>+ Add rule</${WPButton}>
      </div>` : null}
    </div>`;
  };

  // Repeater sub-fields: the columns every row of the repeater carries.
  // Select options are edited as comma-separated values (value doubles as
  // label) to keep the panel small; the server stores canonical
  // {value,label} pairs either way.
  const renderSubfields = (f) => {
    const subs = f.subfields || [];
    const patchSub = (si, patch) => {
      const n = subs.map((s, x) => (x === si ? { ...s, ...patch } : s));
      patch({ subfields: n });
    };
    return h`<div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Row fields</div>
      ${subs.map((sf, si) => h`<div key=${si} className="flex items-center gap-2 flex-wrap">
        <div className="w-32"><${WPTextControl} label="Key" hideLabelFromVision=${true} value=${sf.key || ''} onChange=${(v) => patchSub(si, { key: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="key" __nextHasNoMarginBottom=${true} /></div>
        <div className="flex-1 min-w-[8rem]"><${WPTextControl} label="Label" hideLabelFromVision=${true} value=${sf.label || ''} onChange=${(v) => patchSub(si, { label: v })} placeholder="Label" __nextHasNoMarginBottom=${true} /></div>
        <div className="w-28"><${SelectMenu} label="Type" hideLabelFromVision=${true} __nextHasNoMarginBottom=${true} value=${sf.type || 'text'} onChange=${(v) => patchSub(si, { type: v })} options=${[
          { label: 'Text', value: 'text' }, { label: 'Number', value: 'number' }, { label: 'Date', value: 'date' }, { label: 'Checkbox', value: 'checkbox' }, { label: 'Select', value: 'select' },
        ]} /></div>
        ${sf.type === 'select' ? h`<div className="flex-1 min-w-[8rem]"><${WPTextControl} label="Options" hideLabelFromVision=${true} value=${(sf.options || []).map((o) => o.value).join(', ')} onChange=${(v) => patchSub(si, { options: v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ value: s, label: s })) })} placeholder="red, amber, green" __nextHasNoMarginBottom=${true} /></div>` : null}
        <button type="button" onClick=${() => patch({ subfields: subs.filter((_, x) => x !== si) })} className="text-muted-foreground hover:text-red-600" title="Remove row field">✕</button>
      </div>`)}
      <${WPButton} variant="link" onClick=${() => patch({ subfields: [...subs, { key: '', label: '', type: 'text' }] })}>+ Add row field</${WPButton}>
    </div>`;
  };

    // Enable/disable toggle for layout blocks: an off block is hidden in the
    // post editor (a tab also hides every field under it). Absent === on.
    const blockEnableToggle = (help) => h`<${WPToggleControl}
      __nextHasNoMarginBottom
      label="Show in editor"
      checked=${f.enabled !== false}
      onChange=${(on) => patch({ enabled: on })}
      help=${help}
    />`;
    if (f.type === 'content') {
      // The auto-registered post body (post_content). Reorderable + relabelable
      // + toggleable, but not deletable (it's the core editor, not a meta field).
      // Body format: what an EMPTY body opens as. A non-empty body always locks
      // to what it actually contains; this only decides the starting editor for
      // new posts of the type. The .llm option exists only while the os-llm
      // companion is active (the registry key is its presence signal).
      const llmAvailable = !!CIRegistry.LlmBodyEditor;
      return h`<div className="space-y-4">
        <${WPNotice} status="info" isDismissible=${false}>This is the post <strong>body</strong> (the main content editor). Drag it to position it among the fields — e.g. above Footnotes.</${WPNotice}>
        <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="Heading shown above the body editor." />
        <${SelectMenu}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Body format"
          value=${f.format || ''}
          onChange=${(v) => patch({ format: v || undefined })}
          options=${[
            { label: 'Auto (decided per post)', value: '' },
            { label: 'Gutenberg blocks', value: 'block' },
            ...(llmAvailable || f.format === 'llm' ? [{ label: '.llm canvas', value: 'llm' }] : []),
          ]}
          help="What a NEW (empty) body opens as. Existing bodies always edit as the format they contain."
        />
        ${blockEnableToggle('Off hides the body editor (the post_content field) from this editor.')}
      </div>`;
    }
    if (f.type === 'progress') {
      return h`<div className="space-y-4">
        <${WPNotice} status="info" isDismissible=${false}>A computed <strong>progress bar</strong> for a parent item: it counts sub-items whose <code className="font-mono">collected</code> checkbox is on against this type's <code className="font-mono">goal</code> number (or the sub-item count). Stores no data.</${WPNotice}>
        <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label (admin only)" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="Shown in this builder; the bar itself has its own heading." />
        ${blockEnableToggle('Off hides the progress bar from the editor.')}
        ${renderConditional(f)}
        <div className="pt-3 border-t border-border">
          <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove progress bar</${WPButton}>
        </div>
      </div>`;
    }
    if (f.type === 'heading') {
      return h`<div className="space-y-4">
        <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Section title" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="A divider/heading in the editor — stores no data." />
        ${blockEnableToggle('Off hides this section heading from the editor.')}
        <${WPToggleControl} __nextHasNoMarginBottom label="Collapsed by default" checked=${!!f.collapsed} onChange=${(on) => patch({ collapsed: on })} help="The section starts folded in the editor; readers expand it with the caret." />
        ${renderConditional(f)}
        <div className="pt-3 border-t border-border">
          <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove section</${WPButton}>
        </div>
      </div>`;
    }
    if (f.type === 'tab') {
      return h`<div className="space-y-4">
        <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Tab label" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="Starts a new tab in the editor. Fields after this block (until the next tab) appear inside it. Stores no data." />
        ${blockEnableToggle('Off hides this tab and every field under it from the editor.')}
        <div className="pt-3 border-t border-border">
          <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove tab</${WPButton}>
        </div>
      </div>`;
    }
    if (f.type === 'notice') {
      return h`<div className="space-y-4">
        <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label (admin only)" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="Shown in this builder; not displayed in the editor." />
        ${blockEnableToggle('Off hides this notice from the editor.')}
        <${WPTextareaControl} __nextHasNoMarginBottom label="Message" rows=${3} value=${f.text || ''} onChange=${(v) => patch({ text: v })} help="The message shown in the editor. Stores no data." />
        <${SelectMenu}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Status"
          value=${f.status || 'info'}
          onChange=${(v) => patch({ status: v })}
          options=${[['info', 'Info'], ['warning', 'Warning'], ['success', 'Success'], ['error', 'Error']].map(([val, lab]) => ({ label: lab, value: val }))}
        />
        <div className="pt-3 border-t border-border">
          <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove notice</${WPButton}>
        </div>
      </div>`;
    }
    if (f.type === 'taxonomy') {
      return h`<div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label" value=${f.label || ''} onChange=${(v) => patch({ label: v })} />
          <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Width" value=${String(f.width || 50)} onChange=${(v) => patch({ width: Number(v) })} options=${FG_WIDTHS.map(([val, lab]) => ({ label: lab, value: val }))} />
        </div>
        <p className="text-xs text-muted-foreground">Taxonomy <code className="font-mono bg-muted px-1 rounded">${f.taxonomy}</code> — its term picker autocompletes existing terms. Manage terms in the <strong>Taxonomies</strong> tab.</p>
        <div className="flex items-center gap-4 flex-wrap pt-3 border-t border-border">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">List view</span>
          <${WPCheckboxControl} __nextHasNoMarginBottom label="Show as column" checked=${disp.dispOn('columns', f, disp.colDefaultFor)} onChange=${(v) => disp.toggleDisp('columns', f, v, disp.colDefaultFor)} />
          <${WPCheckboxControl} __nextHasNoMarginBottom label="Use as filter" checked=${disp.dispOn('filters', f, disp.filtDefaultFor)} onChange=${(v) => disp.toggleDisp('filters', f, v, disp.filtDefaultFor)} />
        </div>
        ${renderConditional(f)}
        <div className="pt-3 border-t border-border">
          <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove from layout</${WPButton}>
        </div>
      </div>`;
    }
    return h`<div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label" value=${f.label || ''} onChange=${(v) => patch({ label: v })} />
      <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Key (meta key)" value=${f.key || ''} onChange=${(v) => patch({ key: v })} help="lowercase letters, digits, underscores" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Help text" value=${f.help || ''} onChange=${(v) => patch({ help: v })} />
      <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Width" value=${String(f.width || 50)} onChange=${(v) => patch({ width: Number(v) })} options=${FG_WIDTHS.map(([val, lab]) => ({ label: lab, value: val }))} />
    </div>
    ${f.type === 'relationship' ? h`<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Related post type" value=${f.target_cpt || ''} onChange=${(v) => patch({ target_cpt: v })} options=${fgCptOptions()} />
    </div>` : null}
    ${(f.type === 'list' && f.integer) ? h`<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Resolve as (optional)" help="Show post titles instead of raw IDs." value=${f.target_cpt || ''} onChange=${(v) => patch({ target_cpt: v })} options=${fgCptOptions()} />
    </div>` : null}
    <div className="flex items-center gap-4 flex-wrap">
      <${WPCheckboxControl} __nextHasNoMarginBottom label="Required" checked=${!!f.required} onChange=${(v) => patch({ required: v })} />
      ${(f.type === 'number' || f.type === 'list') ? h`<${WPCheckboxControl} __nextHasNoMarginBottom label=${f.type === 'list' ? 'Integer values' : 'Integer only'} checked=${!!f.integer} onChange=${(v) => patch({ integer: v })} />` : null}
      ${(f.type === 'select' || f.type === 'relationship') ? h`<${WPCheckboxControl} __nextHasNoMarginBottom label="Allow multiple" checked=${!!f.multiple} onChange=${(v) => patch({ multiple: v })} />` : null}
      ${f.type === 'datetime' ? h`<${WPCheckboxControl} __nextHasNoMarginBottom label="Create a reminder" help="Setting this date adds a linked reminder that the reminder automations fire on." checked=${!!f.reminder} onChange=${(v) => patch({ reminder: v })} />` : null}
    </div>
    <div className="flex items-center gap-4 flex-wrap pt-3 border-t border-border">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">List view</span>
      <${WPCheckboxControl} __nextHasNoMarginBottom label="Show as column" checked=${disp.dispOn('columns', f, disp.colDefaultFor)} onChange=${(v) => disp.toggleDisp('columns', f, v, disp.colDefaultFor)} />
      ${disp.filtDefaultFor(f.type) ? h`<${WPCheckboxControl} __nextHasNoMarginBottom label="Use as filter" checked=${disp.dispOn('filters', f, disp.filtDefaultFor)} onChange=${(v) => disp.toggleDisp('filters', f, v, disp.filtDefaultFor)} />` : null}
    </div>
    ${f.type === 'select' ? renderSelectOptions(f) : null}
    ${f.type === 'repeater' ? renderSubfields(f) : null}
    ${renderConditional(f)}
    <div className="pt-3 border-t border-border">
      <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => remove()}>Remove field</${WPButton}>
    </div>
  </div>`;
}

// Canvas mode — the Fields tab IS an embedded block editor (the UIP-style
// "Site Editor approach"; the old drag-grid builder is retired): one designer
// block per field, previews on the canvas, settings + width in the block
// inspector sidebar, and the real block inserter carrying the field types,
// the Group | Stack | Row layout containers, and one variation per attached
// taxonomy. Blocks are built from the field-group JSON at runtime and mapped
// straight back on change — they are never serialized to post_content, and
// the content editors' inserters exclude os-designer/* explicitly.
const FieldsDesignerCtx = createContext(null);

const DESIGNER_BLOCKS = ['os-designer/field', 'os-designer/group'];

let __designerBlockRegistered = false;
function ensureDesignerBlockRegistered() {
  if (__designerBlockRegistered || !registerBlockType) return;
  __designerBlockRegistered = true;
  registerBlockType('os-designer/field', {
    // apiVersion 3 marks the block iframe-ready; anything lower flips the
    // editor into non-iframe compat mode and BlockCanvas never fades the
    // iframe body in (it stays opacity:0).
    apiVersion: 3,
    title: 'Field',
    category: 'design',
    icon: 'forms',
    description: 'A content-type field in the CI structure designer.',
    supports: { html: false, customClassName: false, className: false, reusable: false },
    attributes: { field: { type: 'object', default: { type: 'text' } } },
    // One inserter entry per field type; isActive keys the badge/inspector
    // title off the stored field type.
    // isDefault on the first variation replaces the bare "Field" inserter
    // entry, so the list reads as field types, not an abstract block.
    variations: FG_FIELD_TYPES.map(([id, label], i) => ({
      name: id,
      title: label,
      isDefault: i === 0,
      attributes: { field: { type: id } },
      isActive: (attrs, vAttrs) => (attrs.field?.type || 'text') === vAttrs.field.type,
      scope: ['inserter', 'transform', 'block'],
    })),
    edit: DesignerFieldEdit,
    save: () => null,
  });
  registerBlockType('os-designer/group', {
    apiVersion: 3,
    title: 'Group',
    category: 'design',
    icon: 'columns',
    description: 'Lay fields out: a bordered group, a vertical stack, or a 12-column row.',
    supports: { html: false, customClassName: false, className: false, reusable: false },
    attributes: { field: { type: 'object', default: { type: 'group', layout: 'group' } } },
    variations: [
      { name: 'group', title: 'Group', isDefault: true, description: 'A bordered, labelled section of fields.', attributes: { field: { type: 'group', layout: 'group' } }, isActive: (a, v) => (a.field?.layout || 'group') === v.field.layout, scope: ['inserter', 'transform', 'block'] },
      { name: 'stack', title: 'Stack', description: 'Fields stacked vertically, full width.', attributes: { field: { type: 'group', layout: 'stack' } }, isActive: (a, v) => (a.field?.layout || 'group') === v.field.layout, scope: ['inserter', 'transform', 'block'] },
      { name: 'row', title: 'Row', description: 'Fields side by side on a 12-column row (each keeps its width).', attributes: { field: { type: 'group', layout: 'row' } }, isActive: (a, v) => (a.field?.layout || 'group') === v.field.layout, scope: ['inserter', 'transform', 'block'] },
    ],
    edit: DesignerGroupEdit,
    save: () => h`<${InnerBlocks.Content} />`,
  });
}

function DesignerFieldEdit({ attributes, setAttributes, clientId }) {
  const f = attributes.field || { type: 'text' };
  const ctx = useContext(FieldsDesignerCtx) || {};
  const disp = ctx.disp || { dispOn: () => false, toggleDisp: () => {}, colDefaultFor: () => false, filtDefaultFor: () => false };
  const fullSpan = FG_PRESENTATIONAL.has(f.type) || f.type === 'richtext' || f.type === 'content';
  const span = fullSpan ? 12 : fgCols(f.width);
  const blockProps = useBlockProps({ style: { gridColumn: 'span ' + span } });
  const patch = (p) => setAttributes({ field: { ...f, ...p } });
  // useDispatch resolves through the registry context — BlockEditorProvider
  // keeps its blocks in a sub-registry, so a global wp.data dispatch would
  // silently hit the wrong (empty) store.
  const { removeBlock } = useWPDispatch('core/block-editor');
  const remove = () => { try { removeBlock(clientId); } catch {} };
  return h`<div ...${blockProps}>
    <div className=${'os-fieldblock border rounded-md bg-card p-3 border-border' + (f.enabled === false ? ' opacity-50 border-dashed' : '')}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground">${!FG_PRESENTATIONAL.has(f.type) && f.type !== 'content' ? (f.key || '(no key)') : ''}</span>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">${f.type === 'taxonomy' ? `tax: ${f.taxonomy}` : f.type}</span>
        ${f.enabled === false ? h`<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground" title="Hidden in the editor">off</span>` : null}
      </div>
      <div className="os-fieldpreview" aria-hidden="true" ref=${(el) => { if (el) el.setAttribute('inert', ''); }}>${fieldPreview(f)}</div>
    </div>
    ${InspectorControls ? h`<${InspectorControls}>
      <div className="p-4 os-wpds-fields">
        <${FieldConfigBody} f=${f} patch=${patch} remove=${remove} fields=${ctx.fields || []} disp=${disp} />
      </div>
    </${InspectorControls}>` : null}
  </div>`;
}

// Group | Stack | Row — a layout container in the designer. Round-trips to a
// `group` field carrying its children in `fields`; the entity editor renders
// the same three layouts (bordered section / vertical stack / 12-column row).
function DesignerGroupEdit({ attributes, setAttributes }) {
  const f = attributes.field || { type: 'group', layout: 'group' };
  const layout = f.layout || 'group';
  const gap = Number(f.gap) || 16;
  const blockProps = useBlockProps({
    className: 'os-designer-' + layout + (layout === 'group' ? ' border border-border rounded-md p-3' : ''),
    style: { '--os-designer-gap': gap + 'px' },
  });
  const patch = (p) => setAttributes({ field: { ...f, ...p } });
  return h`<div ...${blockProps}>
    ${layout === 'group' ? h`<div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">${f.label || 'Group'}</div>` : null}
    <${InnerBlocks} allowedBlocks=${DESIGNER_BLOCKS} />
    ${InspectorControls ? h`<${InspectorControls}>
      <div className="p-4 os-wpds-fields space-y-4">
        <${SelectMenu}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Layout"
          value=${layout}
          onChange=${(v) => patch({ layout: v })}
          options=${[{ label: 'Group (bordered section)', value: 'group' }, { label: 'Stack (vertical)', value: 'stack' }, { label: 'Row (12-column)', value: 'row' }]}
        />
        ${layout === 'group' ? h`<${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label" value=${f.label || ''} onChange=${(v) => patch({ label: v })} help="Heading shown on the bordered section." />` : null}
        <${WPRangeControl}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Block spacing"
          help="Gap between the fields inside, in pixels."
          min=${0} max=${48} step=${4}
          value=${gap}
          onChange=${(v) => patch({ gap: Number(v) })}
        />
        <${WPToggleControl} __nextHasNoMarginBottom label="Show in editor" checked=${f.enabled !== false} onChange=${(on) => patch({ enabled: on })} help="Off hides this container and every field inside it." />
      </div>
    </${InspectorControls}>` : null}
  </div>`;
}

// BlockCanvas iframes the blocks; the app's utility CSS is scoped to #os-app-root,
// which doesn't exist inside the iframe, so re-emit those rules against the
// iframe body. Plus the 12-column layout grid (root + Row containers) and an
// explicit scroll unlock — several snapshotted admin sheets pin overflow.
let _designerCanvasStyles = null;
function designerCanvasStyles() {
  if (_designerCanvasStyles) return _designerCanvasStyles;
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        const t = rule.cssText;
        if (t.includes('#os-app-root')) { css += t.split('#os-app-root').join('body.editor-styles-wrapper') + '\n'; continue; }
        // Skip wp-admin's bare html/body globals: `body, html { height: 100% }`
        // pins the iframe document at the viewport height (cascade layers make
        // it unbeatable, even by inline !important), which kills scrolling.
        // The canvas needs component + utility styles, not admin chrome.
        const sel = rule.selectorText || '';
        if (/(^|,)\s*(html|body)\b/.test(sel)) continue;
        css += t + '\n';
      }
    } catch {}
  }
  // The app shell pins #os-app-root as a fixed-position viewport; re-scoped onto
  // the iframe body that would freeze the document at the iframe height and
  // kill scrolling — force normal flow back, same sheet so the cascade is ours.
  // The iframe never inherits wp-admin's theme-color custom properties, so
  // Gutenberg's selection outline / focus accents fell back to stock WP blue.
  // Pin them to WordPress.com Blueberry inside the canvas document.
  css += ':root,body.editor-styles-wrapper{--wp-admin-theme-color:#3858e9;--wp-admin-theme-color-darker-10:#2145e6;--wp-admin-theme-color-darker-20:#183ad6;--wp-components-color-accent:#3858e9;--wp-components-color-accent-darker-10:#2145e6;--wp-components-color-accent-darker-20:#183ad6;}' +
    'html{overflow-y:auto !important;height:auto !important;}' +
    'body.editor-styles-wrapper{opacity:1 !important;position:static !important;inset:auto !important;overflow:visible !important;height:auto !important;min-height:100%;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.7;color:#1e1e1e;background:#fff;}' +
    '.editor-styles-wrapper .wp-block{max-width:none;}' +
    // 16px canvas gutter = the chrome/rail gutter, so toolbar, library rail,
    // and blocks all sit on one 16px line (Daniel: paddings must match the
    // parent's padding rhythm).
    'body.editor-styles-wrapper .is-root-container{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:1rem;align-items:start;padding:16px;}' +
    'body.editor-styles-wrapper .is-root-container>*{min-width:0;grid-column:span 12;}' +
    'body.editor-styles-wrapper .block-list-appender{grid-column:1 / -1;}' +
    '.os-designer-row > .block-editor-inner-blocks > .block-editor-block-list__layout{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:var(--os-designer-gap,1rem);align-items:start;}' +
    '.os-designer-group > .block-editor-inner-blocks > .block-editor-block-list__layout>*+*,.os-designer-stack > .block-editor-inner-blocks > .block-editor-block-list__layout>*+*{margin-top:var(--os-designer-gap,1rem);}' +
    '.os-designer-row .block-list-appender{grid-column:1 / -1;}' +
    /* WordPress.com Blueberry on the type badges (keys and field labels keep
       their stock colors). */
    '.os-fieldblock .bg-accent{color:#3858e9 !important;}' +
    '@media (max-width:640px){body.editor-styles-wrapper .is-root-container>*,.os-designer-row > .block-editor-inner-blocks > .block-editor-block-list__layout>*{grid-column:1 / -1 !important;}}';
  // Own snapshot only — collectCanvasStyles() would re-add the html/body pins.
  _designerCanvasStyles = [{ css }];
  return _designerCanvasStyles;
}

function FieldsCanvas({ fields, onFieldsChange, disp, attachedTaxes }) {
  ensureDesignerBlockRegistered();
  // The post body isn't a meta field — it can be repositioned but not removed.
  const mkBlock = (f) => {
    if (f.type === 'group') {
      const { fields: kids, ...rest } = f;
      return createBlock('os-designer/group', { field: rest }, (kids || []).map(mkBlock));
    }
    return createBlock('os-designer/field', f.type === 'content'
      ? { field: f, lock: { remove: true, move: false } }
      : { field: f });
  };
  const [blocks, setBlocks] = useState(() => fields.map(mkBlock));
  const lastJsonRef = useRef(JSON.stringify(fields.map(fgStrip)));
  // External edits (Detected → Add to layout, reload) rebuild the canvas;
  // block-editor edits round-trip out via handleChange, which stamps
  // lastJsonRef so the echo doesn't rebuild (and drop selection).
  useEffect(() => {
    const now = JSON.stringify(fields.map(fgStrip));
    if (now === lastJsonRef.current) return;
    lastJsonRef.current = now;
    setBlocks(fields.map(mkBlock));
  }, [fields]);
  const handleChange = (next) => {
    setBlocks(next);
    // Only designer blocks round-trip (a stray pasted core block maps to
    // nothing), and a Duplicate keeps the copy but must not clone the __id —
    // rebuild-by-id and conditional-sibling lookups assume ids are unique.
    const seen = new Set();
    const walk = (list) => (list || [])
      .filter((b) => b && DESIGNER_BLOCKS.includes(b.name))
      .map((b) => {
        let fld = b.attributes?.field || { type: 'text' };
        if (fld.__id && seen.has(fld.__id)) fld = fgStrip(fld);
        const out = fgWithId(fld);
        seen.add(out.__id);
        if (b.name === 'os-designer/group') {
          return { ...out, type: 'group', fields: walk(b.innerBlocks) };
        }
        return out;
      });
    const mapped = walk(next);
    const json = JSON.stringify(mapped.map(fgStrip));
    if (json === lastJsonRef.current) return; // selection churn, no real change
    const hist = historyRef.current;
    hist.past.push(lastJsonRef.current);
    if (hist.past.length > 100) hist.past.shift();
    hist.future = [];
    lastJsonRef.current = json;
    onFieldsChange(mapped);
  };
  // One inserter variation per attached taxonomy (adds its term-picker block);
  // registered while the canvas is mounted, cleaned up after.
  useEffect(() => {
    if (!registerBlockVariation) return undefined;
    const names = [];
    for (const t of attachedTaxes || []) {
      const name = 'tax-' + t.slug;
      try {
        registerBlockVariation('os-designer/field', {
          name,
          title: `Taxonomy: ${t.label}`,
          description: 'Places this taxonomy\u2019s term picker in the layout.',
          attributes: { field: { type: 'taxonomy', taxonomy: t.slug, label: t.label, width: 50 } },
          isActive: (a, v) => a.field?.type === 'taxonomy' && a.field?.taxonomy === v.field.taxonomy,
          scope: ['inserter'],
        });
        names.push(name);
      } catch {}
    }
    return () => { for (const n of names) { try { unregisterBlockVariation('os-designer/field', n); } catch {} } };
  }, [attachedTaxes]);
  // Full-height canvas: fill the viewport below the toolbar (the Site Editor
  // feel), remeasured on resize. The iframe document scrolls internally.
  const wrapRef = useRef(null);
  const [canvasH, setCanvasH] = useState(640);
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      setCanvasH(Math.max(480, Math.round(window.innerHeight - el.getBoundingClientRect().top - 40)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // Scroll unlock. A snapshotted wp-admin sheet carries `body, html
  // { height: 100% }`, and because the canvas styles land in a cascade layer,
  // WP's own `html { height: auto !important }` iframe reset loses to it —
  // the document stays clipped at the iframe height and never scrolls.
  // Inline !important styles outrank every sheet, so stamp them on the iframe
  // document directly (re-stamped on a slow tick — BlockCanvas can recreate
  // the document).
  useEffect(() => {
    let timer = 0;
    const stamp = () => {
      const el = wrapRef.current;
      const ifr = el && el.querySelector('iframe[name="editor-canvas"], iframe');
      const d = ifr && ifr.contentDocument;
      if (d && d.documentElement) {
        d.documentElement.style.setProperty('height', 'auto', 'important');
        d.documentElement.style.setProperty('overflow-y', 'auto', 'important');
        if (d.body) {
          d.body.style.setProperty('position', 'static', 'important');
          d.body.style.setProperty('height', 'auto', 'important');
          d.body.style.setProperty('min-height', '100%', 'important');
          d.body.style.setProperty('overflow', 'visible', 'important');
        }
      }
      timer = window.setTimeout(stamp, 1500);
    };
    stamp();
    return () => window.clearTimeout(timer);
  }, []);
  const [showInspector, setShowInspector] = useState(true);
  // One left slot, wp-admin style: the Block library and List View share it
  // (opening one closes the other); both are sticky user toggles.
  const [leftPanel, setLeftPanel] = useState(null); // null | 'library' | 'list'
  // Undo | Redo — our own history over the round-tripped fields JSON (the
  // plain BlockEditorProvider ships no history store): every committed canvas
  // edit pushes the previous snapshot; undo/redo re-apply a snapshot through
  // onFieldsChange and force a canvas rebuild.
  const historyRef = useRef({ past: [], future: [] });
  // InserterMenu's insert handler dereferences its forwarded ref
  // (ref.current.ownerDocument) when shouldFocusBlock is false — rendering
  // the library without a ref throws on every insert.
  const libraryRef = useRef(null);
  const applySnapshot = (json) => {
    let parsed;
    try { parsed = JSON.parse(json); } catch { return; }
    lastJsonRef.current = ''; // force the fields-prop effect to rebuild blocks
    onFieldsChange(parsed.map(fgWithId));
  };
  const undo = () => {
    const hist = historyRef.current;
    if (!hist.past.length) return;
    hist.future.push(lastJsonRef.current);
    applySnapshot(hist.past.pop());
  };
  const redo = () => {
    const hist = historyRef.current;
    if (!hist.future.length) return;
    hist.past.push(lastJsonRef.current);
    applySnapshot(hist.future.pop());
  };
  return h`<${FieldsDesignerCtx.Provider} value=${{ fields, disp }}>
    <${WPSlotFillProvider}>
      <${BlockEditorProvider} value=${blocks} onInput=${handleChange} onChange=${handleChange}
        settings=${{ hasFixedToolbar: true, codeEditingEnabled: false, allowedBlockTypes: DESIGNER_BLOCKS }}>
        <div className="border border-border rounded-md overflow-hidden bg-card">
          ${/* Same chrome classes as the composer toolbar so the two editors
              share one look (and its polish CSS). Constant height: document
              tools left, contextual block toolbar centre, settings right. */''}
          <div className="os-block-editor-chrome os-fields-chrome flex items-center gap-1 border-b border-border bg-card">
            <${CIToolbar} label="Document tools" className="os-composer-toolbar shrink-0">
              <${WPToolbarGroup}>
                <${WPToolbarButton}
                  icon=${EDITOR_ICONS.plus}
                  label="Block library"
                  className="os-fields-inserter-toggle os-inserter-toggle"
                  isActive=${leftPanel === 'library'}
                  onClick=${() => setLeftPanel((v) => (v === 'library' ? null : 'library'))}
                />
                <${WPToolbarButton} icon=${EDITOR_ICONS.undo} label="Undo" onClick=${undo} />
                <${WPToolbarButton} icon=${EDITOR_ICONS.redo} label="Redo" onClick=${redo} />
                ${WPListView ? h`<${WPToolbarButton}
                  icon=${EDITOR_ICONS.listView}
                  label="List view"
                  isActive=${leftPanel === 'list'}
                  onClick=${() => setLeftPanel((v) => (v === 'list' ? null : 'list'))}
                />` : null}
              </${WPToolbarGroup}>
            </${CIToolbar}>
            ${WPBlockToolbar ? h`<div className="os-composer-blocktoolbar flex-1 min-w-0">
              <${WPBlockToolbar} hideDragHandle=${true} />
            </div>` : null}
            <div className="ml-auto shrink-0">
              <${CIToolbar} label="Settings" className="os-composer-toolbar">
                <${WPToolbarGroup}>
                  <${WPToolbarButton}
                    icon=${EDITOR_ICONS.drawerRight}
                    label=${showInspector ? 'Hide settings' : 'Show settings'}
                    isActive=${showInspector}
                    onClick=${() => setShowInspector((v) => !v)}
                  />
                </${WPToolbarGroup}>
              </${CIToolbar}>
            </div>
          </div>
          <div className="flex items-stretch" ref=${wrapRef}>
            ${leftPanel ? h`<div className="os-fields-leftrail shrink-0 border-r border-border bg-card flex flex-col" style=${{ height: canvasH + 'px' }}>
              <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-2 border-b border-border shrink-0">
                <span className="text-sm font-semibold">${leftPanel === 'library' ? 'Block library' : 'List view'}</span>
                <${WPButton} size="small" icon=${EDITOR_ICONS.close} label="Close panel" onClick=${() => setLeftPanel(null)} />
              </div>
              <div className=${'flex-1 min-h-0 overflow-y-auto overflow-x-hidden' + (leftPanel === 'list' ? ' p-1 text-sm' : '')}>
                ${leftPanel === 'library'
                  ? (BlockLibrary ? h`<${BlockLibrary} ref=${libraryRef} showInserterHelpPanel=${false} shouldFocusBlock=${false} />` : null)
                  : (WPListView ? h`<${WPListView} /> ` : null)}
              </div>
            </div>` : null}
            <div className="flex-1 min-w-0">
              <${BlockTools}>
                <div className="block-editor__container">
                  <${BlockCanvas} height=${canvasH + 'px'} styles=${designerCanvasStyles()} />
                </div>
              </${BlockTools}>
            </div>
            ${(BlockInspector && showInspector) ? h`<div className="w-72 shrink-0 border-l border-border overflow-y-auto os-wpds-fields" style=${{ maxHeight: canvasH + 'px' }}>
              <${BlockInspector} />
            </div>` : null}
          </div>
        </div>
      </${BlockEditorProvider}>
    </${WPSlotFillProvider}>
  </${FieldsDesignerCtx.Provider}>`;
}

// ---------------------------------------------------------------------------
// Adopted third-party CPTs — a generic editor for post types opted in via
// Settings → Content types. Fields are described by the introspection
// endpoint (/activity/v1/cpt-schema/<cpt>): registered REST meta
// (+ any JSON-Schema override) becomes WPDS controls, and each attached
// taxonomy becomes a name-based token field (ci_<tax>_names REST field).
// ---------------------------------------------------------------------------

// The post-body editor with a Gutenberg/Code toggle, like the block editor's
// Visual/Code modes. Both edit the SAME stored string: Visual parses it as
// blocks, Code shows it raw in CodeMirror. The default mode comes from the
// type's content_editor ('code' for snippets, otherwise block).
// Body text is block markup once it carries `<!-- wp: -->` delimiters; anything
// else (a legacy OKF markdown body, with frontmatter / ## headings / tables) is
// raw text the block parser would only show as freeform paragraphs.
const hasBlockMarkup = (s) => /<!--\s*wp:/.test(s || '');

/**
 * RepeaterField — rows of admin-defined sub-fields (descriptor `subfields`),
 * stored as ONE array-of-objects meta. The Habits ask: "add new fields to
 * track each habit" — a log grid on the post, whose columns the type defines.
 * Scalar sub-types only (text / number / date / checkbox / select); numbers
 * coerce on input because the REST schema types the property as number and
 * would reject the string form on save.
 */
function RepeaterField({ field, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const subs = Array.isArray(field.subfields) ? field.subfields : [];
  const patchRow = (ri, k, v) => onChange(rows.map((r, x) => (x === ri ? { ...r, [k]: v } : r)));
  const addRow = () => {
    const blank = {};
    subs.forEach((sf) => { blank[sf.key] = sf.type === 'checkbox' ? false : (sf.type === 'number' ? 0 : ''); });
    onChange([...rows, blank]);
  };
  const cell = (sf, row, ri) => {
    const v = row[sf.key];
    if (sf.type === 'checkbox') {
      // No hideLabelFromVision here — CheckboxControl doesn't know the prop
      // and forwards it to the DOM (React unknown-prop warning).
      return h`<${WPCheckboxControl} __nextHasNoMarginBottom aria-label=${sf.label || sf.key} checked=${!!v} onChange=${(nv) => patchRow(ri, sf.key, nv)} />`;
    }
    if (sf.type === 'select') {
      return h`<${SelectMenu} __nextHasNoMarginBottom label=${sf.label} hideLabelFromVision=${true} value=${v ?? ''} onChange=${(nv) => patchRow(ri, sf.key, nv)}
        options=${[{ label: '—', value: '' }, ...(sf.options || []).map((o) => ({ label: o.label || o.value, value: o.value }))]} />`;
    }
    if (sf.type === 'number') {
      return h`<${WPTextControl} __nextHasNoMarginBottom type="number" label=${sf.label} hideLabelFromVision=${true} value=${String(v ?? '')}
        onChange=${(nv) => { const n = Number(nv); patchRow(ri, sf.key, Number.isFinite(n) ? n : 0); }} />`;
    }
    return h`<${WPTextControl} __nextHasNoMarginBottom type=${sf.type === 'date' ? 'date' : 'text'} label=${sf.label} hideLabelFromVision=${true} value=${v ?? ''} onChange=${(nv) => patchRow(ri, sf.key, nv)} />`;
  };
  return h`<div className="os-wpds-fields">
    ${field.label ? h`<div className="text-sm font-medium text-muted-foreground mb-1">${field.label}</div>` : null}
    ${subs.length === 0
      ? h`<div className="text-xs text-muted-foreground italic">No row fields defined yet — add them in the content type's structure.</div>`
      : h`<div className="border border-border rounded-md overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b border-border bg-muted/40 text-left">
              ${subs.map((sf) => h`<th key=${sf.key} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">${sf.label || sf.key}</th>`)}
              <th className="w-8"></th>
            </tr></thead>
            <tbody>
              ${rows.map((row, ri) => h`<tr key=${ri} className="border-b border-border last:border-b-0 align-top">
                ${subs.map((sf) => h`<td key=${sf.key} className="px-2 py-1.5">${cell(sf, row, ri)}</td>`)}
                <td className="px-2 py-1.5 text-center">
                  <button type="button" onClick=${() => onChange(rows.filter((_, x) => x !== ri))} className="text-muted-foreground hover:text-red-600" title="Remove row">✕</button>
                </td>
              </tr>`)}
              ${rows.length === 0 ? h`<tr><td colSpan=${subs.length + 1} className="px-2 py-3 text-xs text-muted-foreground italic text-center">No rows yet.</td></tr>` : null}
            </tbody>
          </table>
        </div>`}
    ${subs.length ? h`<div className="mt-2"><${Button} variant="secondary" size="sm" onClick=${addRow}>+ Add row</${Button}></div>` : null}
    ${field.description ? h`<div className="text-xs text-muted-foreground mt-1">${field.description}</div>` : null}
  </div>`;
}

function ContentBodyEditor({ value, onChange, placeholder, defaultMode, formatDefault, codeLanguage, title, slug }) {
  // With the os-llm companion present, PROSE bodies collapse to two modes:
  // Blocks | .llm — the .llm surface carries its own source pane and live
  // graph, so the separate Code and Diagram tabs are redundant (Daniel,
  // 2026-07-15). Real code bodies (php/js/css snippets, csv) keep CodeMirror:
  // a PHP file on a flow canvas is nonsense. Without the companion, the
  // original three modes stand — the usual registry degradation.
  const LlmBody = CIRegistry.LlmBodyEditor;
  const prose = !codeLanguage || codeLanguage === 'markdown' || codeLanguage === 'html';
  const llmTwoMode = !!(LlmBody && prose);
  const rawMode = llmTwoMode ? 'llm' : 'code';
  // The two modes are FORMATS, not views, and there is no toggle between
  // them: the type's Body format setting (Content Types -> body block)
  // dictates what an EMPTY body opens as, and a non-empty body always edits
  // as the format it contains — block markup as Blocks, anything else on the
  // canvas. Crossing formats is the explicit Convert action, never a view
  // switch (Daniel, 2026-07-16: "There shouldn't be such toggles moving
  // forward. The type settings dictates which of the two we'll use.").
  const bodyEmpty = !value || !value.trim();
  const bodyIsBlocks = hasBlockMarkup(value);
  // The whole llm-pair mode is DERIVED, never stored: the setting and the
  // content are the two sources of truth, and state would only let the view
  // disagree with them (that disagreement was the old toggle).
  const derivedLlmMode = llmTwoMode
    ? (bodyEmpty ? (formatDefault === 'llm' ? 'llm' : 'block') : (bodyIsBlocks ? 'block' : 'llm'))
    : null;
  // Open each body in the view that matches how it's stored: block markup in
  // Visual, raw markdown in Code (so legacy markdown is editable as-is,
  // not shown as flat paragraphs). New/empty bodies default to Visual for
  // block authoring.
  const initialMode = () => {
    if (defaultMode === 'code') return rawMode;
    if (value && !hasBlockMarkup(value)) return rawMode;
    return 'block';
  };
  const [mode, setMode] = useState(initialMode);
  // The body usually loads AFTER this mounts (async fetch), so the initializer
  // sees an empty value. Pick the matching view once the body arrives, unless
  // the author has already toggled.
  const modePinned = useRef(false);
  useEffect(() => {
    if (modePinned.current || !value) return;
    modePinned.current = true;
    setMode(defaultMode === 'code' ? rawMode : (hasBlockMarkup(value) ? 'block' : rawMode));
  }, [value, defaultMode]);
  const setModeManual = (key) => { modePinned.current = true; setMode(key); };
  // The effective mode: derived wherever the llm pair applies, stateful for
  // the legacy Visual / Code / Diagram views.
  const effMode = derivedLlmMode ?? mode;
  // Diagram is a read-only structure view, available wherever the auto-derived
  // outline renderer is registered (any prose body — skills, wiki, …).
  const hasDiagram = !!CIRegistry.SkillOutline;
  // Gutenberg's own "convert to blocks" drops markdown pipe tables; offer a
  // one-click rebuild that keeps them. Only shown when the body actually has
  // convertible markdown. Explicit and reversible — it updates the in-memory
  // value, nothing is stored until the author hits Save. Never on an .llm
  // body: that format IS markdown by design, so "convert" would only invite
  // moving it off its own canvas (Daniel, 2026-07-17).
  const canConvert = derivedLlmMode !== 'llm' && looksConvertibleToBlocks(value);
  const convert = () => {
    if (!window.confirm('Convert this markdown body to blocks? Tables, headings, and lists become editable blocks. Review the result before saving.')) return;
    try {
      onChange(convertMarkdownToBlocks(value));
      setModeManual('block');
    } catch (e) {
      console.error('[core-index] convert to blocks failed:', e);
    }
  };
  return h`<div>
    <div className="flex items-center justify-end gap-2 mb-1">
      ${canConvert ? h`<button type="button" onClick=${convert}
        className="px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        title="Rebuild this markdown body as Gutenberg blocks, keeping tables">Convert to blocks</button>` : null}
      ${llmTwoMode
        ? null /* no toggle: the type's Body format + the body itself decide */
        : h`<${SegmentedToggle} value=${mode} onChange=${setModeManual} options=${[
            { key: 'block', label: 'Visual' },
            { key: 'code', label: 'Code' },
            hasDiagram && { key: 'diagram', label: 'Diagram' },
          ]} />`}
      ${llmTwoMode && !bodyEmpty ? h`<span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5" title=${bodyIsBlocks ? 'This body is block markup; it edits as Blocks.' : 'This body is .llm / markdown; it edits on the canvas.'}>${bodyIsBlocks ? 'Blocks' : '.llm'}</span>` : null}
    </div>
    ${effMode === 'llm' && LlmBody
      ? h`<${LlmBody} value=${value} onChange=${onChange} title=${title} slug=${slug} />`
      : effMode === 'diagram'
      ? h`<div className="border border-border rounded-md overflow-auto p-4 bg-card" style=${{ minHeight: '240px' }}>
          <${CIRegistry.SkillOutline} content=${value} title=${title} slug=${slug} />
        </div>`
      : effMode === 'code'
      ? h`<div className="os-cm-body border border-border rounded-md overflow-hidden" style=${{ minHeight: '240px' }}>
          <${CodeEditor} value=${value} language=${codeLanguage} onChange=${onChange} wikilinks=${!codeLanguage || codeLanguage === 'markdown' || codeLanguage === 'html'} />
        </div>`
      : h`<${GutenbergComposer} value=${value} onChange=${onChange} placeholder=${placeholder} />`}
  </div>`;
}

// Modal host for a row's post body, so the Visual / Code / Diagram editor is
// reachable straight from the Edit table. The list payload omits the body
// (only an excerpt is fetched for the preview cell), so we load it lazily on
// open and hand saving back to the parent (onSave) — draft-promotion and the
// list refresh stay in one place (ListView.saveContent). Overlay mirrors
// BulkEditDialog.
function ContentEditModal({ meta, item, onClose, onSave }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Share the app-wide width preference so the modal's full-width toggle
  // matches the editor pages (and persists the same way).
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${item.id}?context=edit&_fields=content`);
        if (alive) setContent(p.content?.raw || '');
      } catch (e) {
        if (alive) toast?.error('Failed to load content', String(e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [meta.rest_base, item.id]);

  // Body Code-view language: per-row os_kind, else the type's configured
  // language, else markdown for code-first types and html for block-first ones.
  // Mirrors CptEditorPage's bodyCodeLang so a row opens the way it stores.
  const bodyCodeLang = item.meta?.os_kind || meta?.content_language || (meta?.content_editor === 'code' ? 'markdown' : 'html');

  const doSave = async () => {
    setSaving(true);
    const ok = await onSave(item, content);
    setSaving(false);
    if (ok) onClose();
  };

  // Card is a flex column capped to the #os-app-root region height so the header
  // (top) and footer (bottom) stay on screen and the body scrolls. Full width
  // drops the readable max and widens within the region.
  const cardStyle = {
    display: 'flex', flexDirection: 'column',
    maxHeight: 'calc(100vh - var(--os-adminbar-h, 32px) - 2rem)',
  };
  if (fullWidth) { cardStyle.maxWidth = '1400px'; }

  return h`<${CiCenteredOverlay} onClose=${onClose}>
    <div className=${'relative w-full bg-card rounded-xl shadow-2xl border border-border overflow-hidden ' + (fullWidth ? '' : 'max-w-3xl')}
      style=${cardStyle} onClick=${(e) => e.stopPropagation()}>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <div className="font-semibold text-foreground">Edit content</div>
          <div className="text-xs text-muted-foreground">${decodeEntities(item.title?.rendered || item.slug || '(untitled)')}</div>
        </div>
        <button onClick=${onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none w-7 h-7 flex items-center justify-center" aria-label="Close">×</button>
      </div>
      <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
        ${loading
          ? h`<div className="py-10 flex justify-center"><${Spinner} /></div>`
          : h`<${ContentBodyEditor}
              value=${content}
              onChange=${(next) => { setContent(next); setDirty(true); }}
              placeholder=${`Write the ${meta.singular.toLowerCase()} body…`}
              defaultMode=${meta?.content_editor}
              codeLanguage=${bodyCodeLang}
              title=${decodeEntities(item.title?.rendered || '')}
              slug=${item.slug || ''} />`}
      </div>
      <div className="px-5 py-3 border-t border-border bg-sidebar flex items-center justify-between gap-2 shrink-0">
        <button type="button" onClick=${toggleFullWidth} className="text-xs text-muted-foreground hover:text-foreground">
          ${fullWidth ? 'Use readable width' : 'Switch to full width'}</button>
        <div className="flex items-center gap-2">
          <button onClick=${onClose} className="text-sm px-3 py-1.5 hover:bg-muted rounded">Cancel</button>
          <button onClick=${doSave} disabled=${loading || saving || !dirty} className="text-sm px-3 py-1.5 bg-foreground text-background rounded disabled:opacity-50">
            ${saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  </${CiCenteredOverlay}>`;
}

// Lightweight quick editor for a row's body: a centred card with a raw-text area
// for fast markdown/HTML tweaks (the full editor stays the place for the rich
// Visual/Code/Diagram modes). Same lazy fetch + delegated save as the modal.
function ContentInlinePopover({ meta, item, onClose, onSave }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${item.id}?context=edit&_fields=content`);
        if (alive) setContent(p.content?.raw || '');
      } catch (e) {
        if (alive) toast?.error('Failed to load content', String(e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [meta.rest_base, item.id]);

  const doSave = async () => {
    setSaving(true);
    const ok = await onSave(item, content);
    setSaving(false);
    if (ok) onClose();
  };

  return h`<${CiCenteredOverlay} onClose=${onClose}>
    <div className="relative w-full max-w-xl bg-card rounded-xl shadow-2xl border border-border overflow-hidden" onClick=${(e) => e.stopPropagation()}>
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground truncate">Quick edit · ${decodeEntities(item.title?.rendered || item.slug || '')}</div>
        <button onClick=${onClose} className="shrink-0 text-muted-foreground hover:text-foreground text-lg leading-none w-6 h-6 flex items-center justify-center" aria-label="Close">×</button>
      </div>
      <div className="p-3">
        ${loading
          ? h`<div className="py-8 flex justify-center"><${Spinner} /></div>`
          : h`<${WPTextareaControl}
              value=${content}
              onChange=${(v) => { setContent(v); setDirty(true); }}
              onKeyDown=${(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !saving) doSave(); }
                else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              }}
              style=${{ height: '260px', resize: 'vertical' }}
              spellCheck=${false}
              __nextHasNoMarginBottom=${true}
            />`}
      </div>
      <div className="px-4 py-2.5 border-t border-border bg-sidebar flex items-center justify-end gap-2">
        <${Button} size="sm" variant="ghost" onClick=${onClose}>Cancel</${Button}>
        <${Button} size="sm" variant="primary" onClick=${doSave} disabled=${loading || saving || !dirty}>
          ${saving ? 'Saving…' : 'Save'}</${Button}>
      </div>
    </div>
  </${CiCenteredOverlay}>`;
}

function CptEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  const [descriptor, setDescriptor] = useState(null);
  const [schemaErr, setSchemaErr] = useState('');
  const [post, setPost] = useState(isNew ? { status: 'draft' } : null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [fields, setFields] = useState({});   // { metaKey: value }
  const [terms, setTerms] = useState({});      // { taxSlug: [names] }
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Collapsed editor sections, keyed by heading block key (folded === true).
  const [collapsedSecs, setCollapsedSecs] = useState({});
  // Hierarchical types (tree:'parent') let an item nest under another item of
  // the same type. `parent` is the post_parent (0 = top level); `parentOpts` are
  // the candidate parents. Flat types skip all of this.
  const [sp] = useSearchParams();
  const isHier = treeKind(meta) === 'parent';
  const [parent, setParent] = useState(0);
  const [parentOpts, setParentOpts] = useState([]);
  // Collectible-parent progress (e.g. a stamp rally): { done, total } across the
  // item's children, or null when this isn't a collectible parent with children.
  const [progress, setProgress] = useState(null);

  // Fetch the field descriptor once per type.
  useEffect(() => {
    let alive = true;
    setDescriptor(null);
    setSchemaErr('');
    (async () => {
      try {
        const d = await rest(`/activity/v1/cpt-schema/${meta.cpt}`);
        if (alive) setDescriptor(d);
      } catch (e) {
        if (alive) setSchemaErr(e.message || 'Failed to load field schema');
      }
    })();
    return () => { alive = false; };
  }, [type, meta?.cpt]);

  // Seed collapse state: headings flagged `collapsed` start folded.
  useEffect(() => {
    if (!descriptor) return;
    const init = {};
    for (const f of fgFlatten(descriptor.fields)) { if (f.type === 'heading' && f.collapsed) init[f.key] = true; }
    setCollapsedSecs(init);
  }, [descriptor]);

  // Fetch the post (or seed a new one) once the descriptor is ready, so we
  // can key meta/terms state off the declared fields + taxonomies.
  useEffect(() => {
    if (!descriptor) return;
    if (isNew) {
      setTitle('');
      setContent('');
      const seedFields = {};
      fgFlatten(descriptor.fields).forEach((f) => { seedFields[f.key] = f.type === 'boolean' ? false : (f.type === 'list' ? [] : ''); });
      setFields(seedFields);
      const seedTerms = {};
      descriptor.taxonomies.forEach((t) => { seedTerms[t.slug] = []; });
      setTerms(seedTerms);
      // A new child seeded from the list ("add sub-item") carries ?parent=<id>.
      setParent(Number(sp.get('parent')) || 0);
      setDirty(false);
      return;
    }
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        setPost(p);
        setParent(p.parent || 0);
        setTitle(p.title?.raw || '');
        setContent(p.content?.raw || '');
        const m = p.meta || {};
        const nextFields = {};
        fgFlatten(descriptor.fields).forEach((f) => {
          const v = m[f.key];
          nextFields[f.key] = f.type === 'boolean' ? !!v : (f.type === 'list' ? (Array.isArray(v) ? v : []) : (v ?? ''));
        });
        setFields(nextFields);
        const nextTerms = {};
        descriptor.taxonomies.forEach((t) => {
          const v = p[t.field];
          nextTerms[t.slug] = Array.isArray(v) ? v : [];
        });
        setTerms(nextTerms);
        setDirty(false);
      } catch (e) {
        const is404 = /HTTP 404|rest_post_invalid_id/i.test(e?.message || '');
        if (is404) {
          toast.error(`${meta.singular} not found`, 'It may have been deleted. Returning to the list.');
          navigate(`/t/${type}`, { replace: true });
        } else {
          toast.error('Failed to load', e.message);
        }
      }
    })();
  }, [descriptor, type, id, meta?.rest_base, meta?.singular, isNew, navigate, toast, sp]);

  // Load candidate parents for a hierarchical type — every existing item bar
  // this one. Flat types skip the fetch entirely.
  useEffect(() => {
    if (!isHier || !meta?.rest_base) { setParentOpts([]); return; }
    let alive = true;
    (async () => {
      try {
        const rows = await restAllPages(`/wp/v2/${meta.rest_base}?per_page=100&orderby=title&order=asc&status=any&context=edit&_fields=id,title,parent`);
        if (alive) setParentOpts((rows || []).filter((r) => String(r.id) !== String(id)));
      } catch { if (alive) setParentOpts([]); }
    })();
    return () => { alive = false; };
  }, [isHier, meta?.rest_base, id]);

  // Roll up child completion for a collectible parent (a type with a `collected`
  // field), so the rally editor shows the same X/Y progress as the list. Only
  // runs for an existing item that actually has children. A request token drops
  // stale responses when switching between parents (the route swaps id without
  // remounting this component).
  const collectible = !!(descriptor && fgFlatten(descriptor.fields || []).some((f) => f.key === 'collected'));
  const progressReq = useRef(0);
  const loadProgress = useCallback(async () => {
    if (isNew || !collectible || !meta?.rest_base) { setProgress(null); return; }
    const token = ++progressReq.current;
    try {
      const kids = await restAllPages(`/wp/v2/${meta.rest_base}?parent=${id}&per_page=100&status=any&context=edit&_fields=id,meta`);
      if (token !== progressReq.current) return; // superseded by a newer load
      setProgress((!kids || !kids.length) ? null : { done: kids.filter((k) => k.meta && k.meta.collected).length, total: kids.length });
    } catch { /* keep last known progress on a transient error */ }
  }, [collectible, isNew, meta?.rest_base, id]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  // Live refresh: re-pull progress when the user returns to this tab/window
  // (e.g. after collecting a stamp in another tab or the list) — the no-polling
  // equivalent of react-query's refetchOnWindowFocus.
  useEffect(() => {
    if (isNew || !collectible) return undefined;
    const refresh = () => { if (!document.hidden) loadProgress(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isNew, collectible, loadProgress]);

  // Cross-tab live refresh: when another tab saves a child of THIS item, refetch
  // progress even with no focus change (two tabs visible side by side). Pairs
  // with the postMessage in save(); BroadcastChannel never echoes to the sender.
  useEffect(() => {
    if (isNew || !collectible) return undefined;
    const bus = ciProgressBus();
    if (!bus) return undefined;
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === type && Number(d.parent) === Number(id)) loadProgress();
    };
    bus.addEventListener('message', onMsg);
    return () => bus.removeEventListener('message', onMsg);
  }, [isNew, collectible, type, id, loadProgress]);

  const setField = (key, value) => { setFields((f) => ({ ...f, [key]: value })); setDirty(true); };
  const setTermList = (slug, names) => { setTerms((t) => ({ ...t, [slug]: names })); setDirty(true); };

  // Default code language for the body's Code view: the snippet's `os_kind` when
  // set, else a configured content_language, else markdown for code-first types
  // and html for block-first types (block markup reads as HTML in Code view).
  const bodyCodeLang = fields.os_kind || meta?.content_language || (meta?.content_editor === 'code' ? 'markdown' : 'html');

  const save = useCallback(async () => {
    if (!descriptor) return;
    setSaving(true);
    try {
      // Suppressed identifiers (toggled off in Structure or under a disabled
      // tab) — never written, so toggling a field off can't clobber its stored
      // value with an empty form value. Mirrors the render-time filter above.
      const sHidden = new Set(Array.isArray(descriptor.display?.hidden) ? descriptor.display.hidden : []);
      const sMeta = new Set();
      const sTax = new Set();
      {
        // A disabled group suppresses everything inside it, like a disabled tab.
        const walkSuppress = (fs, offParent) => {
          let skipTab = false;
          for (const f of fs) {
            if (f.type === 'tab') { skipTab = (f.enabled === false); continue; }
            const off = offParent || skipTab || f.enabled === false;
            if (f.type === 'group') { walkSuppress(f.fields || [], off); continue; }
            if (f.type === 'taxonomy') { if (off || sHidden.has(`tax:${f.taxonomy}`)) sTax.add(f.taxonomy); }
            else if (f.type !== 'heading' && f.type !== 'notice' && f.type !== 'content' && f.type !== 'progress') { if (off || sHidden.has(`meta:${f.key}`)) sMeta.add(f.key); }
          }
        };
        walkSuppress(descriptor.fields, false);
      }
      // Build the meta payload, coercing numbers and dropping empty
      // strings so we don't clobber meta with "" on a partial form.
      const metaPayload = {};
      fgFlatten(descriptor.fields).forEach((f) => {
        if (f.type === 'heading' || f.type === 'tab' || f.type === 'notice' || f.type === 'content' || f.type === 'progress') return; // presentational / computed — no meta
        if (sMeta.has(f.key)) return; // toggled off — leave stored value untouched
        let v = fields[f.key];
        if (f.type === 'number') {
          // An empty number field must be OMITTED, not sent as '' — an integer/
          // number REST meta rejects '' with a 400 ("not of type integer"), which
          // otherwise blocks saving any item that leaves a number blank.
          if (v === '' || v === null || v === undefined) return;
          v = Number(v);
        }
        if (f.type === 'image') v = Number(v) || 0; // attachment id (0 = none)
        if (f.type === 'relationship') {
          const arr = (Array.isArray(v) ? v : (v ? [v] : [])).map(Number).filter(Boolean);
          v = f.multiple ? arr : (arr[0] || 0);
        }
        if (f.type === 'list') {
          const arr = Array.isArray(v) ? v : [];
          v = f.items === 'integer' ? arr.map(Number).filter((n) => !Number.isNaN(n)) : arr.map(String);
        }
        metaPayload[f.key] = v;
      });
      const payload = {
        title: title || `(untitled ${meta.singular.toLowerCase()})`,
        status: post?.status || 'draft',
        meta: metaPayload,
      };
      if (descriptor.supports_editor) payload.content = content;
      if (isHier) payload.parent = Number(parent) || 0;
      descriptor.taxonomies.forEach((t) => { if (sTax.has(t.slug)) return; payload[t.field] = terms[t.slug] || []; });
      // Virtual-type discriminator: a CPT split by a taxonomy term into several
      // virtual types. The descriptor hides this taxonomy (it is
      // not a user field), so set it here from the type the post is created
      // under — every save, so older posts get back-tagged when touched. Mirrors
      // the markdown editor. Raw term-id assignment via the taxonomy's rest_base.
      if (meta.taxonomy && meta.term_id) payload[meta.taxonomy] = [meta.term_id];

      let p;
      if (isNew) {
        p = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(payload) });
        toast.success(`${meta.singular} created`);
        navigate(`/t/${type}/${p.id}`, { replace: true });
      } else {
        p = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(payload) });
        setPost(p);
        // Reflect server-canonical term names back (auto-created terms).
        const nextTerms = {};
        descriptor.taxonomies.forEach((t) => {
          const v = p[t.field];
          nextTerms[t.slug] = Array.isArray(v) ? v : (terms[t.slug] || []);
        });
        setTerms(nextTerms);
        toast.success('Saved');
      }
      setDirty(false);
      // Tell other tabs a child changed so a rally's progress bar can refresh
      // live (the parent is this item's parent; rally editors keyed to it react).
      if (isHier) {
        try { ciProgressBus()?.postMessage({ type, parent: Number(parent) || 0, id: p.id }); } catch { /* bus unavailable */ }
      }
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }, [descriptor, fields, terms, title, content, post?.status, isNew, isHier, parent, meta?.rest_base, meta?.singular, id, type, navigate, toast]);

  // Cmd/Ctrl-S to save.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, save]);

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type</div></${TypeLayout}>`;
  if (schemaErr) return h`<${TypeLayout} type=${type} activeId=${id}>
    <div className="p-10"><${WPNotice} status="error" isDismissible=${false}>${schemaErr}</${WPNotice}></div>
  </${TypeLayout}>`;
  if (!descriptor || (!isNew && !post)) return h`<${TypeLayout} type=${type} activeId=${id}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  if (descriptor.rest_editable === false) return h`<${TypeLayout} type=${type} activeId=${id}>
    <div className="p-10"><${WPNotice} status="warning" isDismissible=${false}>${descriptor.notice || 'This post type is not REST-editable.'}</${WPNotice}></div>
  </${TypeLayout}>`;

  const hasProgressField = (descriptor.fields || []).some((f) => f.type === 'progress');
  // Shared progress-bar renderer, used by both the placeable `progress` field
  // and the zero-config auto-bar. Reads the live child rollup in `progress`
  // (children with a truthy `collected` meta) against the parent's `goal`.
  // `placeholder` keeps the field visible (with a hint) before any sub-items.
  const renderProgressBar = ({ placeholder } = {}) => {
    if (!progress || progress.total <= 0) {
      return placeholder ? h`<div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Progress shows here once sub-items with a “Collected” field are added.</div>` : null;
    }
    const goalVal = Number(fields.goal) > 0 ? Number(fields.goal) : progress.total;
    const pct = goalVal > 0 ? Math.min(100, Math.round((progress.done / goalVal) * 100)) : 0;
    const complete = goalVal > 0 && progress.done >= goalVal;
    return h`<div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className=${`font-medium ${complete ? 'text-primary' : 'text-foreground'}`}>${complete ? '✓ Complete' : 'Progress'}</span>
        <span className="text-muted-foreground tabular-nums">${progress.done} / ${goalVal} collected</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow=${progress.done} aria-valuemin=${0} aria-valuemax=${goalVal}>
        <div className=${`h-full rounded-full transition-all ${complete ? 'bg-primary' : 'bg-primary/60'}`} style=${{ width: pct + '%' }} />
      </div>
    </div>`;
  };

  const renderField = (f) => {
    const common = { __nextHasNoMarginBottom: true, __next40pxDefaultSize: true, label: f.label, help: f.description };
    if (f.type === 'group') {
      // Group | Stack | Row from the structure designer. Children apply the
      // same conditional/enabled/hidden filters as top-level fields; layouts:
      // group = bordered labelled section (12-col inside), stack = vertical,
      // row = bare 12-col grid (each child keeps its width).
      const kids = (f.fields || []).filter((k) =>
        evalConditional(k.conditional, fields)
        && k.enabled !== false
        && !(k.type === 'taxonomy'
          ? editorHidden.has(`tax:${k.taxonomy}`)
          : (!['heading', 'notice', 'progress', 'group'].includes(k.type) && editorHidden.has(`meta:${k.key}`))));
      const gap = (Number(f.gap) || 16) + 'px';
      const inner = f.layout === 'stack'
        ? h`<div style=${{ display: 'flex', flexDirection: 'column', gap }}>${kids.map((k) => h`<div key=${k.key}>${renderField(k)}</div>`)}</div>`
        : h`<div style=${{ '--os-fieldgrid-gap': gap }}>${fieldGrid(kids)}</div>`;
      if (f.layout === 'group') {
        return h`<div className="border border-border rounded-md p-4 space-y-3">
          ${f.label ? h`<div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">${f.label}</div>` : null}
          ${inner}
        </div>`;
      }
      return inner;
    }
    if (f.type === 'progress') {
      return renderProgressBar({ placeholder: true });
    }
    if (f.type === 'heading') {
      return h`<div className="text-sm font-semibold text-foreground border-b border-border pb-1 pt-2">${f.label || 'Section'}</div>`;
    }
    if (f.type === 'tab') {
      return null; // layout boundary — consumed by the tab partition below
    }
    if (f.type === 'notice') {
      return h`<${WPNotice} status=${f.status || 'info'} isDismissible=${false}>${f.text || f.label || ''}</${WPNotice}>`;
    }
    if (f.type === 'content') {
      // The auto-registered post body (post_content) — bound to content/setContent,
      // rendered at this block's position in the structure (not force-appended).
      return h`<div className="os-wpds-fields">
        <div className="text-sm font-medium text-muted-foreground mb-2">${f.label || 'Content'}</div>
        <${ContentBodyEditor}
          value=${content}
          onChange=${(next) => { setContent(next); setDirty(true); }}
          placeholder=${`Write the ${meta.singular.toLowerCase()} body…`}
          defaultMode=${meta?.content_editor}
          formatDefault=${f.format}
          codeLanguage=${bodyCodeLang}
          title=${title}
          slug=${post?.slug || ''}
        />
      </div>`;
    }
    if (f.type === 'richtext') {
      return h`<div className="os-wpds-fields">
        ${f.label ? h`<div className="text-sm font-medium text-muted-foreground mb-1">${f.label}</div>` : null}
        <${GutenbergComposer}
          value=${fields[f.key] ?? ''}
          onChange=${(next) => setField(f.key, next)}
          placeholder=${f.description || `Write ${(f.label || 'content').toLowerCase()}…`}
        />
      </div>`;
    }
    if (f.type === 'boolean') {
      return h`<${WPCheckboxControl}
        __nextHasNoMarginBottom
        label=${f.label}
        help=${f.description}
        checked=${!!fields[f.key]}
        onChange=${(v) => setField(f.key, v)}
      />`;
    }
    if (f.type === 'image') {
      return h`<${FieldImage} field=${f} value=${fields[f.key]} onChange=${(v) => setField(f.key, v)} />`;
    }
    if (f.type === 'enum') {
      return h`<${SelectMenu}
        ...${common}
        value=${fields[f.key] ?? ''}
        onChange=${(v) => setField(f.key, v)}
        options=${[{ label: '—', value: '' }, ...(f.enum || []).map((o) => ({ label: o, value: o }))]}
      />`;
    }
    if (f.type === 'text') {
      return h`<${WPTextareaControl}
        __nextHasNoMarginBottom
        label=${f.label}
        help=${f.description}
        rows=${4}
        value=${fields[f.key] ?? ''}
        onChange=${(v) => setField(f.key, v)}
      />`;
    }
    if (f.type === 'relationship') {
      return h`<${RelationshipField} field=${f} value=${fields[f.key]} onChange=${(v) => setField(f.key, v)} />`;
    }
    if (f.type === 'repeater') {
      return h`<${RepeaterField} field=${f} value=${fields[f.key]} onChange=${(v) => setField(f.key, v)} />`;
    }
    if (f.type === 'taxonomy') {
      return h`<${TaxonomyField} field=${f} value=${terms[f.taxonomy] || []} onChange=${(next) => setTermList(f.taxonomy, next)} />`;
    }
    if (f.type === 'list') {
      // Integer list with a resolve-target → render as a title picker.
      if (f.items === 'integer' && f.target_rest_base) {
        return h`<${RelationshipField} field=${{ ...f, multiple: true }} value=${fields[f.key]} onChange=${(v) => setField(f.key, v)} />`;
      }
      const vals = Array.isArray(fields[f.key]) ? fields[f.key].map(String) : [];
      return h`<${WPFormTokenField}
        __nextHasNoMarginBottom
        __next40pxDefaultSize
        label=${f.label}
        help=${f.description || (f.items === 'integer' ? 'List of IDs — set a “Resolve as” post type in Structure for a title picker.' : 'Add values and press Enter.')}
        value=${vals}
        onChange=${(next) => setField(f.key, next)}
        tokenizeOnBlur=${true}
      />`;
    }
    const inputType = f.type === 'number' ? 'number'
      : f.type === 'date' ? 'date'
      : f.type === 'datetime' ? 'datetime-local'
      : f.type === 'url' ? 'url'
      : 'text';
    return h`<${WPTextControl}
      ...${common}
      type=${inputType}
      value=${fields[f.key] ?? ''}
      onChange=${(v) => setField(f.key, v)}
    />`;
  };

  const hasFields = descriptor.fields.length > 0;

  // Layout: presentational + richtext blocks span full width; everything
  // else honours its configured column width.
  const spanOf = (f) => (['heading', 'tab', 'notice', 'richtext', 'content', 'progress', 'group'].includes(f.type) ? 12 : fgCols(f.width));
  const fieldGrid = (fs) => h`<div className="os-fieldgrid os-wpds-fields">
    ${fs.filter((f) => f.type !== 'tab' && f.type !== 'heading').map((f) => h`<div key=${f.key} style=${{ gridColumn: 'span ' + spanOf(f) }}>${renderField(f)}</div>`)}
  </div>`;
  // Group a tab's fields into collapsible sections delimited by `heading`
  // blocks: each heading becomes a caret header that folds the fields beneath
  // it (until the next heading). Fields before the first heading render with no
  // section chrome. Collapsing is purely visual — folded fields stay in state
  // and still save.
  const renderSectioned = (fs) => {
    const nodes = [];
    let lead = [];
    let cur = null; // { heading, fields }
    const flushLead = () => { if (lead.length) { nodes.push(h`<div key=${'lead-' + nodes.length}>${fieldGrid(lead)}</div>`); lead = []; } };
    const flushCur = () => {
      if (!cur) return;
      const hk = cur.heading.key;
      const open = !collapsedSecs[hk];
      nodes.push(h`<div key=${'sec-' + hk} className="space-y-2">
        <button type="button" onClick=${() => setCollapsedSecs((c) => ({ ...c, [hk]: !c[hk] }))} aria-expanded=${open}
          className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground border-b border-border pb-1 pt-2 hover:text-primary">
          <span className="shrink-0"><${Icon} name=${open ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 text-muted-foreground" /></span>
          <span className="flex-1 min-w-0">${cur.heading.label || 'Section'}</span>
        </button>
        ${open ? fieldGrid(cur.fields) : null}
      </div>`);
      cur = null;
    };
    for (const f of fs) {
      if (f.type === 'tab') continue;
      if (f.type === 'heading') { flushLead(); flushCur(); cur = { heading: f, fields: [] }; continue; }
      if (cur) cur.fields.push(f); else lead.push(f);
    }
    flushLead(); flushCur();
    return h`<div className="space-y-4">${nodes}</div>`;
  };

  // Apply per-CPT editor visibility toggles (set in Structure): drop disabled
  // blocks (`enabled === false`), fields/taxonomies toggled off in
  // `display.hidden`, and everything under a disabled tab. Conditional logic is
  // applied first. The same suppression is enforced on save (see `save`) so a
  // hidden field is never written.
  const editorHidden = new Set(Array.isArray(descriptor.display?.hidden) ? descriptor.display.hidden : []);
  const visibleFields = (() => {
    const out = [];
    let skipTab = false;
    for (const f of descriptor.fields) {
      if (!evalConditional(f.conditional, fields)) continue;
      if (f.type === 'tab') {
        skipTab = (f.enabled === false);
        if (!skipTab) out.push(f);
        continue;
      }
      if (skipTab || f.enabled === false) continue;
      if (f.type === 'taxonomy') { if (editorHidden.has(`tax:${f.taxonomy}`)) continue; }
      else if (!['heading', 'notice', 'progress', 'group'].includes(f.type)) { if (editorHidden.has(`meta:${f.key}`)) continue; }
      out.push(f);
    }
    return out;
  })();
  // If the field set declares `tab` blocks, partition fields into tabbed
  // sections (each `tab` starts a new section; its label titles the tab).
  const hasTabs = visibleFields.some((f) => f.type === 'tab');
  const segments = (() => {
    const segs = [];
    let cur = { label: '', fields: [] };
    for (const f of visibleFields) {
      if (f.type === 'tab') {
        if (cur.fields.length || cur.label) segs.push(cur);
        cur = { label: f.label || 'Tab', fields: [] };
      } else {
        cur.fields.push(f);
      }
    }
    if (cur.fields.length || cur.label) segs.push(cur);
    if (segs.length && !segs[0].label) segs[0].label = 'General';
    return segs;
  })();

  const EditorHeader = CIRegistry.EditorHeader;
  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
   <div className="flex flex-col h-full bg-card pt-14">
    <${EditorHeader}
      title=${title} setTitle=${(v) => { setTitle(v); setDirty(true); }}
      placeholder=${`${meta.singular} title…`}
      dirty=${dirty} isNew=${isNew} saving=${saving} onSave=${save}
      onClose=${() => { if (dirty && !confirm('Discard unsaved changes and close?')) return; navigate(`/t/${type}`, { replace: true }); }}
      hideTitlebar=${true}
    />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-6 md:p-10 mx-auto w-full space-y-6 pb-32 mb-24 ' + (fullWidth ? 'max-w-none' : 'max-w-3xl')}>
      ${CIRegistry.EditorTitleField ? h`<${CIRegistry.EditorTitleField}
        title=${title}
        setTitle=${(v) => { setTitle(v); setDirty(true); }}
        placeholder=${`${meta.singular} title…`}
      />` : null}
      ${isHier ? h`<div className="os-wpds-fields max-w-sm">
        <${SelectMenu}
          label="Parent"
          value=${String(parent || 0)}
          onChange=${(v) => { setParent(Number(v) || 0); setDirty(true); }}
          options=${[{ label: '— No parent (top level) —', value: '0' }, ...parentOpts.map((p) => ({ label: decodeEntities(p.title?.rendered || p.title?.raw || `#${p.id}`), value: String(p.id) }))]}
          help=${`Nest this ${meta.singular.toLowerCase()} under another ${meta.singular.toLowerCase()}.`}
          __nextHasNoMarginBottom __next40pxDefaultSize
        />
      </div>` : null}
      ${/* Auto-bar for collectible parents with no explicit Progress field placed
          in the layout. When the type adds a `progress` field, it owns placement. */''}
      ${(!hasProgressField && progress && progress.total > 0) ? renderProgressBar({}) : null}
      ${hasFields ? (hasTabs
        ? h`<div className="os-wpds-fields os-cpt-tabs"><${WPTabPanel}
            tabs=${segments.map((s, i) => ({ name: `seg-${i}`, title: s.label }))}
          >
            ${(tab) => { const i = Number((tab.name || 'seg-0').split('-')[1]) || 0; return h`<div className="pt-4">${renderSectioned(segments[i] ? segments[i].fields : [])}</div>`; }}
          </${WPTabPanel}></div>`
        : renderSectioned(visibleFields)
      ) : null}

      ${(descriptor.supports_editor && !descriptor.fields.some((f) => f.type === 'content')) ? h`<div className="os-wpds-fields">
        <div className="text-sm font-medium text-muted-foreground mb-2">Content</div>
        <${ContentBodyEditor}
          value=${content}
          onChange=${(next) => { setContent(next); setDirty(true); }}
          placeholder=${`Write the ${meta.singular.toLowerCase()} body…`}
          defaultMode=${meta?.content_editor}
          codeLanguage=${bodyCodeLang}
          title=${title}
          slug=${post?.slug || ''}
        />
      </div>` : null}

      ${(!hasFields && !descriptor.supports_editor) ? h`<${WPNotice} status="info" isDismissible=${false}>
        This post type exposes no editable fields yet. Open <strong>Structure</strong> (the gear on the list) to add fields and taxonomies.
      </${WPNotice}>` : null}

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}

// Top-level dispatch for /t/:type/:id. Reads only `useParams` so the hook
// count is identical regardless of which branch we render — switching
// between a canvas type and a markdown type used to land mid-EditorPage
// (early-return before some hooks, full-render after others), which
// tripped React's hook-order rule. Each branch now mounts a fresh
// component instance, so the markdown body's hooks always start clean.
function EditorPage() {
  const { type, id } = useParams();
  const [sp] = useSearchParams();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  // A type may declare several editors (`meta.editors`); the first is the
  // default. `?ed=<key>` (set by the EditorHeader switcher) opens the item in
  // another of the type's editors. Falls back to the single `meta.editor`.
  const editors = (meta?.editors && meta.editors.length) ? meta.editors : [meta?.editor].filter(Boolean);
  const wanted = sp.get('ed');
  const activeEditor = (wanted && editors.includes(wanted)) ? wanted : (meta?.editor || editors[0]);
  // Registered editor for the active key, else the Fields (cpt) form editor
  // (the markdown editor is retired; cpt is always registered from this file).
  const render = CIRegistry.editors[activeEditor] || CIRegistry.editors['cpt'];
  if (render) return render({ type, id, isNew, meta });
  return null;
}

// ---------------------------------------------------------------------------
// Register into the Core registry + publish shared chrome (runs on import).
// ---------------------------------------------------------------------------
registerEditor('meta', () => h`<${MetaEditorPage} />`);
registerEditor('term', () => h`<${TermEditorPage} />`);
registerEditor('cpt', () => h`<${CptEditorPage} />`, {
  selectable: true, title: 'Fields (structured)', description: 'Auto-generated fields + taxonomy pickers from the type\'s structure.',
  newFile: (meta) => ({ label: `New ${(meta?.singular || 'item').toLowerCase()}`, desc: `Edit ${(meta?.singular || 'item').toLowerCase()} fields + taxonomies.` }),
});
registerRoute('/content-types', h`<${ContentTypesPage} />`);
registerRoute('/content-types/:tab', h`<${ContentTypesPage} />`);
// Static `/structure/new` must out-rank `/structure/:type`; React Router v6
// ranks static segments above params, so registration order doesn't matter.
registerRoute('/structure/new', h`<${CreateTypePage} />`);
registerRoute('/structure/:type', h`<${StructureEditorPage} />`);
registerRoute('/structure/:type/:tab', h`<${StructureEditorPage} />`);

// Shared chrome consumed by leaf-app editors (read off the registry at render).
CIRegistry.TypeLayout = TypeLayout;
CIRegistry.NewFileButton = NewFileButton;
CIRegistry.MobileMenuButton = MobileMenuButton;
CIRegistry.starterTemplateFor = starterTemplateFor;

// The App router (in the main bundle) mounts these for /t/:type and /t/:type/:id.
export { ListView, EditorPage };
