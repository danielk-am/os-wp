/**
 * Context App — Reminders + Calendar + Automations (self-contained leaf module).
 *
 * The os_reminder + os_automation surfaces and the month calendar, lifted out
 * of the monolith. Registers the `reminder` + `automation` editors/list views
 * and the /calendar route on import. Imports only ci/* + vendor via the
 * importmap. Shared type/shell chrome (TypeLayout / NewFileButton) is consumed
 * through thin registry-wrapper components below so the carved code is
 * untouched and reads the live registry at render time.
 *
 * No build step — native ES module; bare specifiers resolve via the importmap.
 */
import { createElement, cloneElement, Children, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } from 'react';
import { createPortal } from 'react-dom/client';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
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
} from '@wordpress/components';
import { parse as parseBlocks, serialize as serializeBlocks } from '@wordpress/blocks';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType } from '@xyflow/react';
import { h, BOOT, rest, restAllPages, restWithHeaders, decodeEntities, typeMeta, REST_BASE, CIRegistry, registerEditor, registerRoute } from 'os/core';
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, OS_ICONS, SelectCheckbox, SegmentedToggle, PageHeading, SelectMenu } from 'os/ui';
import { useToast, useDialog } from 'os/shell';
import { GutenbergComposer, useEditorFullWidth } from 'os/editors';

// The automation graph uses React Flow, whose CSS must load for the nodes to
// render. Inject the vendored stylesheet once, resolved relative to this module
// so it works wherever the plugin is installed. Skip if os-canvas already
// injected the same vendored CSS.
( () => {
  try {
    if ( document.querySelector( 'link[data-os-reminders-css]' ) || document.querySelector( 'link[data-os-canvas-css]' ) ) {
      return;
    }
    const link = document.createElement( 'link' );
    link.rel = 'stylesheet';
    link.href = new URL( './vendor/xyflow-react.css', import.meta.url ).href;
    link.setAttribute( 'data-os-reminders-css', '' );
    document.head.appendChild( link );
  } catch ( e ) {}
} )();

// Shared type/shell chrome, consumed via the registry at render time (set by
// the main bundle before mount). Thin wrappers so the carved code is verbatim.
const TypeLayout = ({ children, ...rest }) => h`<${CIRegistry.TypeLayout} ...${rest}>${children}</${CIRegistry.TypeLayout}>`;
const NewFileButton = (props) => h`<${CIRegistry.NewFileButton} ...${props} />`;

// Chrome glyphs (FA-backed Icon elements) used by these surfaces.
const iconChevronDown = h`<${Icon} name="chevron-down" />`;
const iconChevronUp = h`<${Icon} name="chevron-up" />`;
const iconChevronLeft = h`<${Icon} name="chevron-left" />`;
const iconChevronRight = h`<${Icon} name="chevron-right" />`;
const iconCog = h`<${Icon} name="cog" />`;
const iconTrash = h`<${Icon} name="trash" />`;
const iconArchive = h`<${Icon} name="box-archive" />`;

// ---------------------------------------------------------------------------
// --- Reminder task-block helpers ---------------------------------------
// A reminder's due date/time + priority live on the first ci/task block in
// its body. These read/patch that block so the inline editor strip can edit
// the same source of truth the block editor below renders.

// "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" → { date, time }.
function splitDue(v) {
  const parts = String(v || '').trim().split(/\s+/);
  return { date: parts[0] || '', time: parts[1] || '' };
}
function joinDue(date, time) {
  date = (date || '').trim();
  time = (time || '').trim();
  if (!date) return '';
  return time ? `${date} ${time}` : date;
}

// Build an iCalendar (.ics) string for a reminder so it can be added to
// Apple Calendar / Google Calendar / Outlook. A timed reminder becomes a
// 30-min VEVENT with a VALARM at start (the calendar app fires the native
// alert); a date-only reminder becomes an all-day event. Times are floating
// local (no TZID) so they land at the wall-clock time the user picked.
function buildReminderIcs({ title, notes, dueDate, dueTime, id }) {
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const uid = `os-reminder-${id || 'new'}-${now.getTime()}@${(typeof location !== 'undefined' && location.hostname) || 'context'}`;
  const ymd = (dueDate || '').replace(/-/g, '');
  const fmtLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  let dtstart, dtend;
  if (dueTime) {
    const start = new Date(`${dueDate}T${dueTime}:00`);
    const end = new Date(start.getTime() + 30 * 60000);
    dtstart = `DTSTART:${fmtLocal(start)}`;
    dtend = `DTEND:${fmtLocal(end)}`;
  } else {
    dtstart = `DTSTART;VALUE=DATE:${ymd}`;
    dtend = `DTEND;VALUE=DATE:${ymd}`;
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OS Calendar//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dtstamp}`, dtstart, dtend,
    `SUMMARY:${esc(title || 'Reminder')}`,
    notes ? `DESCRIPTION:${esc(notes)}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${dueTime ? 'PT0M' : '-PT9H'}`, `DESCRIPTION:${esc(title || 'Reminder')}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

function downloadIcs(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readReminderTaskAttrs(body) {
  try {
    const blocks = parseBlocks(body || '') || [];
    const find = (list) => {
      for (const b of list) {
        if (b?.name === 'os/task') return b;
        if (b?.innerBlocks?.length) {
          const inner = find(b.innerBlocks);
          if (inner) return inner;
        }
      }
      return null;
    };
    const task = find(blocks);
    return task ? (task.attributes || {}) : {};
  } catch { return {}; }
}

// Merge `patch` into the first ci/task block's attributes (seeding one if
// the body has none) and return the re-serialized body. Empty-string values
// in the patch delete the attribute to keep the markup clean.
function patchReminderTaskAttrs(body, patch) {
  try {
    let blocks = parseBlocks(body || '') || [];
    const apply = (b) => {
      const next = { ...(b.attributes || {}), ...patch };
      Object.keys(patch).forEach((k) => { if (patch[k] === '') delete next[k]; });
      b.attributes = next;
    };
    let found = false;
    const walk = (list) => {
      for (const b of list) {
        if (!found && b?.name === 'os/task') { apply(b); found = true; return; }
        if (b?.innerBlocks?.length) walk(b.innerBlocks);
      }
    };
    walk(blocks);
    if (!found) {
      const seed = parseBlocks('<!-- wp:os/task /-->') || [];
      if (seed[0]) { apply(seed[0]); blocks = seed.concat(blocks); }
    }
    return serializeBlocks(blocks) || '';
  } catch { return body || ''; }
}

// ReminderIndexPage — dashboard for os_reminder.
//
// Replaces the generic "Recently edited" list with status sections
// (Overdue / Today / Upcoming / No date / Done), tag + priority filters,
// an inline done-toggle (flips the first ci/task block's `checked`, so any
// reminder is checkable here, with or without a taskId), and per-row archive
// (soft-delete to Trash) + delete (permanent). Active and Archived are two tabs,
// each its own route/URL; the Archived view lists Trash with Restore + permanent
// Delete. Reads the canonical due/priority/checked from each reminder's ci/task
// block.
// ---------------------------------------------------------------------------
const REMINDER_SECTIONS = [
  ['overdue',  'Overdue'],
  ['today',    'Today'],
  ['upcoming', 'Upcoming'],
  ['nodate',   'No date'],
  ['done',     'Done'],
];
const PRIORITY_DOT = { high: '#dc2626', medium: '#d97706', low: '#2563eb' };

// Shape a /wp/v2/os_reminder row into the list item used by both the active
// and the archived (Trash) views — they differ only in which actions render.
function mapReminder(p) {
  const attrs = readReminderTaskAttrs(p.content?.raw || '');
  return {
    id: p.id,
    title: p.title?.raw || '(untitled)',
    modified: p.modified,
    tags: Array.isArray(p.os_tags) ? p.os_tags : [],
    raw: p.content?.raw || '',
    due: splitDue(attrs.dueDate),
    priority: attrs.priority || '',
    checked: !!attrs.checked,
  };
}

// The Reminders list lives on two routes / tabs: Active (the type list,
// `/t/reminder`) and Archived (`/t/reminder/archived`, registered below). Each
// is its own page so it has its own URL and reloads its data on entry — `view`
// selects which, and `type` falls back to the prop on the archived route, which
// has no `:type` segment.
function ReminderIndexPage({ view = 'active', type: typeProp } = {}) {
  const params = useParams();
  const type = typeProp || params.type;
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();
  const archivedView = view === 'archived';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState('');   // '' = all
  const [activeTags, setActiveTags] = useState([]);            // OR-match
  const [busyId, setBusyId] = useState(0);

  // One fetch per view: Active reads published reminders, Archived reads the
  // Trash (status=trash). Re-runs whenever the view changes, so switching tabs
  // always shows current data — no stale cache, no page reload needed.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusQ = archivedView ? 'status=trash&' : '';
      const raw = await restAllPages(`/wp/v2/os_reminder?${statusQ}per_page=100&context=edit&_fields=id,title,modified,content,os_tags`);
      setItems((raw || []).map(mapReminder));
    } catch (e) { console.error(e); toast.error(archivedView ? 'Failed to load archived' : 'Failed to load reminders', e.message); }
    finally { setLoading(false); }
  }, [archivedView, toast]);

  useEffect(() => { load(); }, [load]);

  const todayStr = (() => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const sectionFor = (it) => {
    if (it.checked) return 'done';
    if (!it.due.date) return 'nodate';
    if (it.due.date < todayStr) return 'overdue';
    if (it.due.date === todayStr) return 'today';
    return 'upcoming';
  };

  const allTags = Array.from(new Set(items.flatMap((it) => it.tags))).sort((a, b) => a.localeCompare(b));

  const filtered = items.filter((it) => {
    if (priorityFilter === 'none' ? it.priority !== '' : (priorityFilter && it.priority !== priorityFilter)) return false;
    if (activeTags.length && !it.tags.some((t) => activeTags.includes(t))) return false;
    return true;
  });

  const grouped = {};
  for (const it of filtered) (grouped[sectionFor(it)] ||= []).push(it);
  // Within a section: by due date asc (no-date last), then title.
  for (const k of Object.keys(grouped)) {
    grouped[k].sort((a, b) => (a.due.date || '9999').localeCompare(b.due.date || '9999') || a.title.localeCompare(b.title));
  }

  // Flip the first ci/task block's `checked` and persist the body — the same
  // path the editor uses (see ReminderEditorPage.save), so every reminder is
  // checkable from the list, even one whose block has no taskId. Saving also
  // re-syncs the ci_task_* meta, which the lighter /task-toggle route skips.
  const toggleDone = async (it) => {
    if (busyId) return;
    const next = !it.checked;
    const nextRaw = patchReminderTaskAttrs(it.raw, { checked: next });
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, checked: next, raw: nextRaw } : x)));   // optimistic
    setBusyId(it.id);
    try {
      await rest(`/wp/v2/os_reminder/${it.id}`, { method: 'POST', body: JSON.stringify({ content: nextRaw }) });
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, checked: !next, raw: it.raw } : x)));   // revert
      toast.error('Could not update', e.message);
    } finally { setBusyId(0); }
  };

  // Archive = soft-delete: a plain DELETE (no force) moves the reminder to
  // Trash, where it stays recoverable. Permanent removal lives on Delete.
  const archive = async (it) => {
    if (busyId) return;
    setBusyId(it.id);
    try {
      await rest(`/wp/v2/os_reminder/${it.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      toast.success('Reminder archived', 'Moved to Trash — see the Archived tab to restore it.');
    } catch (e) { toast.error('Archive failed', e.message); }
    finally { setBusyId(0); }
  };

  // Restore an archived reminder: clearing the trash status (wp_untrash via
  // REST) returns it to the active list, so it leaves this Archived view.
  const restore = async (it) => {
    if (busyId) return;
    setBusyId(it.id);
    try {
      await rest(`/wp/v2/os_reminder/${it.id}`, { method: 'POST', body: JSON.stringify({ status: 'publish' }) });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      toast.success('Reminder restored', 'Back on the Active tab.');
    } catch (e) { toast.error('Restore failed', e.message); }
    finally { setBusyId(0); }
  };

  const remove = async (it) => {
    const ok = await dialog.confirm('Delete reminder?', `“${it.title}” will be permanently deleted.`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setBusyId(it.id);
    try {
      await rest(`/wp/v2/os_reminder/${it.id}?force=true`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      toast.success('Reminder deleted');
    } catch (e) { toast.error('Delete failed', e.message); }
    finally { setBusyId(0); }
  };

  const toggleTag = (t) => setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const chip = (active, label, onClick, key) => h`<${WPButton}
    key=${key ?? label}
    size="small"
    variant=${active ? 'primary' : 'secondary'}
    isPressed=${active}
    onClick=${onClick}
  >${label}</${WPButton}>`;

  const renderRow = (it) => h`<div key=${it.id} className="flex items-center gap-3 px-4 py-3 group">
    <button
      type="button"
      role="checkbox"
      aria-checked=${it.checked}
      disabled=${busyId === it.id}
      onClick=${() => toggleDone(it)}
      title=${it.checked ? 'Mark as not done' : 'Mark as done'}
      className=${'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 ' + (it.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-primary')}
    >
      ${it.checked ? h`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>` : null}
    </button>
    <${Link} to=${`/t/${type}/${it.id}`} className="min-w-0 flex-1 no-underline">
      <div className=${'font-medium truncate ' + (it.checked ? 'line-through text-muted-foreground' : 'text-foreground')}>${it.title}</div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        ${it.due.date ? h`<span className=${'text-xs px-2 py-0.5 rounded ' + (sectionFor(it) === 'overdue' ? 'text-destructive bg-muted' : 'text-muted-foreground bg-muted')}>${it.due.date}${it.due.time ? ' · ' + it.due.time : ''}</span>` : null}
        ${it.priority ? h`<span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
          <span style=${{ width: '8px', height: '8px', borderRadius: '9999px', background: PRIORITY_DOT[it.priority] || '#9ca3af', display: 'inline-block' }}></span>
          ${it.priority}
        </span>` : null}
        ${it.tags.map((t) => h`<span key=${t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">${t}</span>`)}
      </div>
    </${Link}>
    <div className="shrink-0 flex items-center gap-1">
      <${WPButton}
        size="small"
        icon=${iconArchive}
        disabled=${busyId === it.id}
        onClick=${() => archive(it)}
        label="Archive reminder"
        showTooltip=${true}
      />
      <${WPButton}
        size="small"
        icon=${iconTrash}
        isDestructive=${true}
        disabled=${busyId === it.id}
        onClick=${() => remove(it)}
        label="Delete reminder"
        showTooltip=${true}
      />
    </div>
  </div>`;

  // Archived rows are read-only except for Restore and a permanent Delete.
  const renderArchivedRow = (it) => h`<div key=${it.id} className="flex items-center gap-3 px-4 py-3 group">
    <${Link} to=${`/t/${type}/${it.id}`} className="min-w-0 flex-1 no-underline">
      <div className="font-medium truncate text-muted-foreground">${it.title}</div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        ${it.due.date ? h`<span className="text-xs px-2 py-0.5 rounded text-muted-foreground bg-muted">${it.due.date}${it.due.time ? ' · ' + it.due.time : ''}</span>` : null}
        ${it.priority ? h`<span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
          <span style=${{ width: '8px', height: '8px', borderRadius: '9999px', background: PRIORITY_DOT[it.priority] || '#9ca3af', display: 'inline-block' }}></span>
          ${it.priority}
        </span>` : null}
        ${it.tags.map((t) => h`<span key=${t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">${t}</span>`)}
      </div>
    </${Link}>
    <div className="shrink-0 flex items-center gap-1">
      <${WPButton} size="small" variant="secondary" disabled=${busyId === it.id} onClick=${() => restore(it)}>Restore</${WPButton}>
      <${WPButton}
        size="small"
        icon=${iconTrash}
        isDestructive=${true}
        disabled=${busyId === it.id}
        onClick=${() => remove(it)}
        label="Delete permanently"
        showTooltip=${true}
      />
    </div>
  </div>`;

  const anyShown = REMINDER_SECTIONS.some(([key]) => (grouped[key] || []).length);

  const AppHeader = CIRegistry.AppHeader;
  return h`<${TypeLayout} type=${type}>
   <div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title=${meta.label} icon=${meta.icon}
      actions=${h`<${NewFileButton} type=${type} label=${meta.singular} variant="primary" size="default" />`} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-4 md:p-10 mx-auto w-full ' + (fullWidth ? 'max-w-none' : 'max-w-3xl')}>
      <${PageHeading} icon=${meta.icon} title=${meta.label}
        description=${archivedView
          ? `Archived reminders sit in Trash. Restore one to bring it back, or delete it for good.`
          : `Your reminders, grouped by when they're due. Press ⌘. anywhere to add one fast.`} />

      ${/* Active / Archived tabs — each is its own route and URL. */''}
      <div role="tablist" aria-label="Reminder view" className="flex items-center gap-1 border-b border-border mb-5">
        ${[['active', 'Active', `/t/${type}`], ['archived', 'Archived', `/t/${type}/archived`]].map(([key, label, to]) => {
          const on = view === key;
          return h`<${Link}
            key=${key}
            to=${to}
            role="tab"
            aria-selected=${on}
            className=${'-mb-px px-3 py-2 text-sm no-underline border-b-2 ' + (on ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >${label}</${Link}>`;
        })}
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority</span>
          <div className="flex flex-wrap items-center gap-1">
            ${chip(priorityFilter === '', 'All', () => setPriorityFilter(''), 'p-all')}
            ${chip(priorityFilter === 'high', 'High', () => setPriorityFilter('high'), 'p-high')}
            ${chip(priorityFilter === 'medium', 'Medium', () => setPriorityFilter('medium'), 'p-med')}
            ${chip(priorityFilter === 'low', 'Low', () => setPriorityFilter('low'), 'p-low')}
            ${chip(priorityFilter === 'none', 'None', () => setPriorityFilter('none'), 'p-none')}
          </div>
        </div>
        ${allTags.length ? h`<div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tags</span>
          ${allTags.map((t) => chip(activeTags.includes(t), t, () => toggleTag(t), 't-' + t))}
          ${activeTags.length ? h`<${WPButton} variant="link" size="small" onClick=${() => setActiveTags([])}>Clear</${WPButton}>` : null}
        </div>` : null}
      </div>

      ${loading ? h`<${WPCard} size="small"><div className="p-6 text-center"><${WPSpinner} /></div></${WPCard}>` :
        archivedView ? (
          items.length === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No archived reminders. Archiving a reminder moves it to Trash, and it shows up here.</div></${WPCard}>` :
          filtered.length === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No archived reminders match the current filters.</div></${WPCard}>` :
          h`<${WPCard}><div className="divide-y divide-border">${filtered.map(renderArchivedRow)}</div></${WPCard}>`
        ) : (
          items.length === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No reminders yet — click + above or press ⌘. to create one.</div></${WPCard}>` :
          !anyShown ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No reminders match the current filters.</div></${WPCard}>` :
          h`<div className="space-y-6">
            ${REMINDER_SECTIONS.map(([key, label]) => {
              const rows = grouped[key] || [];
              if (!rows.length) return null;
              return h`<div key=${key}>
                <h2 className=${'text-xs font-semibold uppercase tracking-wider mb-2 ' + (key === 'overdue' ? 'text-destructive' : 'text-muted-foreground')}>${label} <span className="font-normal">(${rows.length})</span></h2>
                <${WPCard}><div className="divide-y divide-border">${rows.map(renderRow)}</div></${WPCard}>
              </div>`;
            })}
          </div>`
        )}

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}

// ---------------------------------------------------------------------------
// Calendar — month grid of scheduled posts + reminders, webcal subscription,
// and the reminder → email/webhook automation settings.
// ---------------------------------------------------------------------------

// Absolute webcal/https URLs for the .ics subscription feed. Built from
// BOOT (read token + REST base) so the Subscribe button works without a
// round-trip; the same URLs come back from the automation settings GET.
function reminderFeedUrls() {
  try {
    const abs = new URL(`${REST_BASE}/calendar/v1/reminders.ics`, window.location.origin);
    abs.searchParams.set('key', BOOT.read_token || '');
    const feed = abs.href;
    return { feed, webcal: feed.replace(/^https?:/, 'webcal:') };
  } catch {
    return { feed: '', webcal: '' };
  }
}

// Automation settings hook — GET/POST the ci_reminder_automation option.
function useAutomationSettings() {
  const [conf, setConf] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setConf(await rest('/calendar/v1/reminders/automation')); }
    catch { setConf(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (patch) => {
    const next = await rest('/calendar/v1/reminders/automation', {
      method: 'POST', body: JSON.stringify(patch),
    });
    setConf(next);
    return next;
  }, []);
  return { conf, loading, save };
}

// Model choices come from the automation config route. PHP's
// OS_Reminders::MODELS is the single source of truth for which API
// model each alias maps to. No model id appears in this file. This alias is
// only the pre-load default for a fresh form; pickModel() re-checks it against
// the real list once conf arrives.
const MODEL_FALLBACK = 'sonnet';

// Normalize a stored value onto one of the offered aliases. Automations saved
// before the alias config hold a raw API id ('claude-sonnet-4-6'), which
// matches on the family name it contains.
function pickModel(raw, choices, fallback = MODEL_FALLBACK) {
  const opts = Array.isArray(choices) ? choices : [];
  const v = String(raw || '').trim().toLowerCase();
  if (opts.some((o) => o.value === v)) return v;
  const hit = opts.find((o) => o.value && v.includes(o.value));
  if (hit) return hit.value;
  if (!opts.length || opts.some((o) => o.value === fallback)) return fallback;
  return opts[0].value;
}

const YMD = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarView() {
  const navigate = useNavigate();
  const toast = useToast();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [events, setEvents] = useState({});   // 'YYYY-MM-DD' → [event]
  const [loading, setLoading] = useState(true);
  const [showAutomations, setShowAutomations] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const urls = reminderFeedUrls();
  const sourceCount = (CIRegistry.calendarSources || []).length;

  // 6-week (42-cell) grid starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const gridStart = new Date(cursor.y, cursor.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gridStart = cells[0];
      const gridEnd = new Date(cells[41]);
      gridEnd.setHours(23, 59, 59);
      const after = gridStart.toISOString();
      const before = gridEnd.toISOString();

      const [reminders, posts] = await Promise.all([
        restAllPages('/wp/v2/os_calendar_event?per_page=100&context=edit&_fields=id,title,meta'),
        rest(`/wp/v2/posts?per_page=100&status=publish,future&after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}&_fields=id,title,date,status`),
      ]);

      const map = {};
      const push = (key, ev) => { (map[key] ||= []).push(ev); };

      for (const p of reminders || []) {
        const due = splitDue(p.meta?.calendar_start || '');
        if (!due.date) continue;
        push(due.date, {
          kind: 'reminder',
          id: p.id,
          title: p.title?.raw || '(untitled)',
          time: due.time || '',
          priority: '',
          checked: false,
        });
      }
      for (const p of posts || []) {
        const d = new Date(p.date);
        const p2 = (n) => String(n).padStart(2, '0');
        push(YMD(d), {
          kind: 'post',
          id: p.id,
          title: (p.title?.rendered || '(untitled)').replace(/<[^>]+>/g, ''),
          time: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
          status: p.status,
        });
      }

      // Pluggable event sources — any app module (Bookings, Subscriptions, …)
      // that called CI.registerCalendarSource contributes its events here.
      // Each source is fetched in isolation so one failing never blanks the grid.
      const sources = CIRegistry.calendarSources || [];
      const results = await Promise.all(sources.map(async (s) => {
        try { return { s, evs: await s.fetch({ after, before, start: gridStart, end: gridEnd }) }; }
        catch (e) { console.error(`[calendar] source "${s.key}" failed`, e); return { s, evs: [] }; }
      }));
      for (const { s, evs } of results) {
        for (const ev of (evs || [])) {
          if (!ev || !ev.date) continue;
          push(ev.date, {
            kind: 'source',
            sourceKey: s.key,
            color: ev.color || s.color || '#0ea5e9',
            id: ev.id ?? ev.url ?? ev.title,
            title: ev.title || '(untitled)',
            time: ev.time || '',
            url: ev.url || '',
          });
        }
      }

      // Sort each day's events by time (timed first, by clock; all-day last).
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
      }
      setEvents(map);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load calendar', e.message);
    } finally {
      setLoading(false);
    }
  }, [cells, toast]);

  useEffect(() => { load(); }, [load]);

  const todayKey = YMD(new Date());
  const step = (delta) => setCursor((c) => {
    const d = new Date(c.y, c.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const goToday = () => setCursor({ y: now.getFullYear(), m: now.getMonth() });

  const openEvent = (ev) => {
    if (ev.kind === 'reminder') navigate(`/t/reminder/${ev.id}`);
    else if (ev.kind === 'source') { if (ev.url) window.open(ev.url, '_blank', 'noopener'); }
    else window.open(wpAdminUrl(`post.php?post=${ev.id}&action=edit`), '_blank', 'noopener');
  };

  const subscribe = () => {
    if (urls.webcal) window.location.href = urls.webcal;
  };
  const copyFeed = async () => {
    try { await navigator.clipboard.writeText(urls.feed); toast.success('Feed URL copied'); }
    catch { toast.error('Copy failed', 'Copy the URL manually from the Automations panel.'); }
  };

  const chip = (ev) => {
    const dot = ev.kind === 'reminder'
      ? (PRIORITY_DOT[ev.priority] || '#7c3aed')
      : ev.kind === 'source'
        ? (ev.color || '#0ea5e9')
        : (ev.status === 'future' ? '#d97706' : '#64748b');
    return h`<button
      key=${ev.kind + (ev.sourceKey || '') + ev.id}
      type="button"
      onClick=${() => openEvent(ev)}
      title=${`${ev.title}${ev.time ? ' · ' + ev.time : ''}`}
      className=${'w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left text-[11px] leading-tight truncate hover:bg-muted ' + (ev.checked ? 'line-through text-muted-foreground' : 'text-foreground')}
    >
      <span style=${{ width: '7px', height: '7px', borderRadius: '9999px', background: dot, flexShrink: 0, display: 'inline-block' }}></span>
      ${ev.time ? h`<span className="tabular-nums text-muted-foreground shrink-0">${ev.time}</span>` : null}
      <span className="truncate">${ev.title}</span>
    </button>`;
  };

  const AppHeader = CIRegistry.AppHeader;
  // The Calendar is a read-only aggregate view (reminders, scheduled posts,
  // connected sources). New reminders are created on the Reminders page or via
  // the Cmd+. quick-add, not here — so the bar only carries Subscribe.
  const calActions = h`<${WPButton} variant="secondary" size="default" onClick=${subscribe}>Subscribe</${WPButton}>`;
  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Calendar" icon="calendar" actions=${calActions} />
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-background" style=${{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
    <div className="p-4 md:p-10 mx-auto w-full max-w-6xl" style=${{ paddingBottom: '5rem' }}>
      <${PageHeading} icon="calendar" title="Calendar"
        description=${`Reminders, scheduled posts${sourceCount ? `, and ${sourceCount} connected source${sourceCount === 1 ? '' : 's'}` : ''} on one month grid. Subscribe in Apple/Google Calendar for native alerts, or set up email & webhook automations.`} />

      ${showHelp ? h`<${WPCard} className="mb-6"><${WPCardBody}>
        <h3 className="text-base font-semibold mb-2">Using the Calendar</h3>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
          <li><strong className="text-foreground">What you see.</strong> Each day shows your <span style=${{ color: '#7c3aed' }}>reminders</span> (from the Reminders app) and any <span style=${{ color: '#d97706' }}>scheduled posts</span> queued to publish. Click a chip to open it — reminders open in-app, posts open the WordPress editor.</li>
          <li><strong className="text-foreground">Add fast.</strong> Hit <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">⌘ .</kbd> anywhere in wp-admin to drop a quick reminder, or use the <em>Reminder</em> button above.</li>
          <li><strong className="text-foreground">Native alerts.</strong> <em>Subscribe</em> adds this calendar to Apple/Google Calendar over <code className="font-mono text-xs">webcal</code> so reminders ring on your phone. The feed URL lives under <em>Automations</em>.</li>
          <li><strong className="text-foreground">Notifications.</strong> <em>Automations</em> sends due reminders to email or a webhook on a schedule (optionally filtered by priority/tag).</li>
          ${sourceCount ? h`<li><strong className="text-foreground">Connected sources.</strong> ${sourceCount} plugin source${sourceCount === 1 ? '' : 's'} ${sourceCount === 1 ? 'is' : 'are'} feeding events in — shown with ${sourceCount === 1 ? 'its' : 'their'} own colour in the legend.</li>`
            : h`<li><strong className="text-foreground">Extensible.</strong> Other plugins (e.g. WooCommerce Bookings or Subscriptions) can add their own events here by calling <code className="font-mono text-xs">CI.registerCalendarSource(…)</code> — no Calendar changes needed.</li>`}
        </ul>
      </${WPCardBody}></${WPCard}>` : null}

      ${showAutomations ? h`<div className="mb-6"><${CalendarAutomations} urls=${urls} onCopyFeed=${copyFeed} /></div>` : null}

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1">
          <${WPButton} variant="tertiary" icon=${iconChevronLeft} label="Previous month" showTooltip onClick=${() => step(-1)} />
          <${WPButton} variant="tertiary" icon=${iconChevronRight} label="Next month" showTooltip onClick=${() => step(1)} />
          <${WPButton} variant="secondary" size="small" onClick=${goToday} className="ml-1">Today</${WPButton}>
        </div>
        <h2 className="text-lg font-semibold">${MONTH_NAMES[cursor.m]} ${cursor.y}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span style=${{ width: '8px', height: '8px', borderRadius: '9999px', background: '#7c3aed', display: 'inline-block' }}></span>Reminder</span>
          <span className="inline-flex items-center gap-1"><span style=${{ width: '8px', height: '8px', borderRadius: '9999px', background: '#d97706', display: 'inline-block' }}></span>Scheduled</span>
          ${(CIRegistry.calendarSources || []).map((s) => h`<span key=${s.key} className="inline-flex items-center gap-1"><span style=${{ width: '8px', height: '8px', borderRadius: '9999px', background: s.color || '#0ea5e9', display: 'inline-block' }}></span>${s.label || s.key}</span>`)}
        </div>
      </div>

      <${WPCard}>
        <div className="grid grid-cols-7 border-b border-border">
          ${WEEKDAYS.map((w) => h`<div key=${w} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">${w}</div>`)}
        </div>
        ${loading ? h`<div className="p-10 text-center"><${WPSpinner} /></div>` : h`<div className="grid grid-cols-7">
          ${cells.map((d, i) => {
            const key = YMD(d);
            const inMonth = d.getMonth() === cursor.m;
            const isToday = key === todayKey;
            const dayEvents = events[key] || [];
            const shown = dayEvents.slice(0, 3);
            const extra = dayEvents.length - shown.length;
            return h`<div
              key=${key}
              style=${{ minHeight: '80px' }}
              className=${'border-b border-r border-border p-1 flex flex-col gap-0.5 ' + (inMonth ? 'bg-card' : 'bg-muted') + ((i % 7) === 6 ? ' border-r-0' : '')}
            >
              <div className="flex items-center justify-between px-1">
                <span className=${'text-xs ' + (isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white font-semibold' : (inMonth ? 'text-foreground' : 'text-muted-foreground'))}>${d.getDate()}</span>
              </div>
              ${shown.map(chip)}
              ${extra > 0 ? h`<span className="px-1.5 text-[11px] text-muted-foreground">+${extra} more</span>` : null}
            </div>`;
          })}
        </div>`}
      </${WPCard}>

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <${CIRegistry.PageFooter.Action} onClick=${() => setShowAutomations((v) => !v)}>${showAutomations ? 'Hide automations' : 'Automations'}</${CIRegistry.PageFooter.Action}>
        <${CIRegistry.PageFooter.Action} onClick=${() => setShowHelp((v) => !v)}>${showHelp ? 'Hide help' : 'How it works'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
  </div>`;
}

// Calendar panel: the webcal/feed subscription URLs + a summary of the
// reminder automations (which now live in the os_automation CPT). The
// channels themselves are managed there, so this just surfaces the count
// and a link into the Automations list.
function CalendarAutomations({ urls, onCopyFeed }) {
  const navigate = useNavigate();
  const { conf, loading } = useAutomationSettings();

  return h`<${WPCard}>
    <${WPCardBody}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold mb-1">Reminder automations</h3>
            <p className="text-xs text-muted-foreground">A background job runs every 5 minutes and notifies you when a reminder comes due${loading || !conf ? '' : ` — ${conf.count} active rule${conf.count === 1 ? '' : 's'}`}. Fires once per reminder.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <${WPButton} variant="secondary" onClick=${() => navigate('/t/automation')}>Manage automations →</${WPButton}>
            <${NewFileButton} type="automation" label="Automation" variant="primary" size="default" />
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Calendar subscription</h4>
          <p className="text-xs text-muted-foreground mb-2">Subscribe in Apple/Google Calendar — edits and deletions sync automatically.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs bg-muted rounded px-2 py-1.5 font-mono" title=${urls.feed}>${urls.feed}</code>
            <${WPButton} variant="secondary" size="small" onClick=${onCopyFeed}>Copy</${WPButton}>
            <${WPButton} variant="secondary" size="small" href=${urls.webcal}>Subscribe</${WPButton}>
          </div>
        </div>
      </div>
    </${WPCardBody}>
  </${WPCard}>`;
}

// ReminderEditorPage — focused single-task form for os_reminder.
//
// A reminder is one ci/task block; rather than surface a full block
// editor (overkill for an atomic todo), this is a lightweight form:
// done toggle + title, a due date/time + priority strip, freeform tags,
// and an optional notes field. The form edits the task block's attrs
// (the canonical store) directly; notes live in post meta.
// ---------------------------------------------------------------------------
function ReminderEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  const [post, setPost] = useState(isNew ? { status: 'publish' } : null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) {
      setTitle('');
      // Empty seed; the CPT's `template => [['os/task']]`
      // is the wp-admin/post.php default — for our in-app editor we
      // seed the same single block so the user sees a Task immediately.
      setBody('<!-- wp:os/task /-->');
      setTags([]);
      setNotes('');
      setDirty(true);
      return;
    }
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        setPost(p);
        setTitle(p.title?.raw || '');
        setBody(p.content?.raw || '');
        setTags(Array.isArray(p.os_tags) ? p.os_tags : []);
        setNotes(p.meta?.os_reminder_note || '');
        setDirty(false);
      } catch (e) {
        const is404 = /HTTP 404|rest_post_invalid_id/i.test(e?.message || '');
        if (is404) {
          toast.error('Reminder not found', 'It may have been deleted. Returning to the list.');
          navigate(`/t/${type}`, { replace: true });
        } else {
          toast.error('Failed to load', e.message);
        }
      }
    })();
  }, [type, id, meta?.rest_base, isNew, navigate, toast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // Keep the task block's text in sync with the title so the
      // front-end render + reminders list agree, and persist the note.
      const content = patchReminderTaskAttrs(body, { text: title || 'Reminder' });
      const payload = {
        title: title || 'Reminder',
        content,
        status: post?.status || 'publish',
        os_tags: tags,
        meta: { os_reminder_note: notes },
      };
      let p;
      if (isNew) {
        p = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Reminder created');
        navigate(`/t/${type}/${p.id}`, { replace: true });
      } else {
        p = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(payload) });
        setPost(p);
        setTags(Array.isArray(p.os_tags) ? p.os_tags : tags);
        toast.success('Saved');
      }
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }, [title, body, tags, notes, post?.status, isNew, meta?.rest_base, id, type, navigate, toast]);

  // Auto-save (1.5s after last edit on existing posts, mirroring the
  // wizard composer).
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || isNew) return;
    const t = setTimeout(() => { saveRef.current?.(); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, body, title, tags, notes, saving, isNew]);

  // Due date/time, priority + done-state derive live from the task block in
  // `body` — the canonical store. The form below edits the same block attrs.
  const taskAttrs = readReminderTaskAttrs(body);
  const due = splitDue(taskAttrs.dueDate);
  const priority = taskAttrs.priority || '';
  const checked = !!taskAttrs.checked;
  const patchTask = (patch) => { setBody(patchReminderTaskAttrs(body, patch)); setDirty(true); };
  const setDue = (date, time) => patchTask({ dueDate: joinDue(date, time) });

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type</div></${TypeLayout}>`;
  if (!isNew && !post) return h`<${TypeLayout} type=${type}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  const EditorHeader = CIRegistry.EditorHeader;
  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
   <div className="flex flex-col h-full bg-card pt-14">
    <${EditorHeader}
      title=${title} setTitle=${(v) => { setTitle(v); setDirty(true); }}
      placeholder="Reminder title…"
      dirty=${dirty} isNew=${isNew} saving=${saving} onSave=${save}
      onClose=${() => { if (dirty && !confirm('Discard unsaved changes and close?')) return; navigate(`/t/${type}`, { replace: true }); }}
      hideTitlebar=${true}
    />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-6 md:p-10 mx-auto w-full space-y-6 pb-32 mb-24 ' + (fullWidth ? 'max-w-none' : 'max-w-3xl')}>
      ${/* Title row: done checkbox + the title as a field. */''}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked=${checked}
          onClick=${() => patchTask({ checked: !checked })}
          title=${checked ? 'Mark as not done' : 'Mark as done'}
          className=${'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border-2 ' + (checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-primary')}
        >
          ${checked ? h`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>` : null}
        </button>
        <input
          value=${title}
          onChange=${(e) => { setTitle(e.target.value); setDirty(true); }}
          placeholder="Reminder title…"
          className=${'os-editor-title flex-1 min-w-0 font-semibold leading-tight bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground ' + (checked ? 'line-through text-muted-foreground' : '')}
        />
      </div>

      ${!due.date ? h`<${WPNotice} status="warning" isDismissible=${false}>
        <span className="text-sm">No due date set. Add one below so this reminder shows on the calendar, exports to your subscribed calendar, and can trigger automations.</span>
        ${' '}
        <${WPButton} variant="link" onClick=${() => setDue(YMD(new Date()), due.time)}>Set to today</${WPButton}>
      </${WPNotice}>` : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 os-wpds-fields">
        <${WPTextControl}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          type="date"
          label="Due date"
          value=${due.date}
          onChange=${(value) => setDue(value, due.time)}
        />
        <${WPTextControl}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          type="time"
          label="Due time"
          value=${due.time}
          disabled=${!due.date}
          onChange=${(value) => setDue(due.date, value)}
          help=${!due.date ? 'Set a due date first' : undefined}
        />
        <${SelectMenu}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          label="Priority"
          value=${priority}
          onChange=${(value) => patchTask({ priority: value })}
          options=${[
            { label: '—', value: '' },
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
          ]}
        />
      </div>

      <div className="os-wpds-fields">
        <${WPFormTokenField}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          label="Tags"
          value=${tags}
          onChange=${(next) => { setTags(next); setDirty(true); }}
          placeholder=${tags.length ? 'Add tag…' : 'Add a tag and press Enter…'}
          tokenizeOnBlur=${true}
        />
      </div>

      <div className="os-wpds-fields">
        <${WPTextareaControl}
          __nextHasNoMarginBottom
          label="Notes"
          value=${notes}
          onChange=${(value) => { setNotes(value); setDirty(true); }}
          rows=${5}
          placeholder="Optional details…"
        />
      </div>

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        ${due.date ? h`<${CIRegistry.PageFooter.Action} onClick=${() => downloadIcs(`reminder-${id && id !== 'new' ? id : 'new'}.ics`, buildReminderIcs({ title, notes, dueDate: due.date, dueTime: due.time, id }))}>Add to calendar (.ics)</${CIRegistry.PageFooter.Action}>` : null}
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}

// ---------------------------------------------------------------------------
// Automations — os_automation CPT. Each post is one notification rule
// (email or webhook + optional priority/tag filter) the reminders cron
// fires when a matching reminder comes due.
// ---------------------------------------------------------------------------

const AUTO_PRIORITY_OPTS = [
  { label: 'Any priority', value: '' },
  { label: 'High only', value: 'high' },
  { label: 'Medium only', value: 'medium' },
  { label: 'Low only', value: 'low' },
];

const AUTO_TRIGGER_LABEL = {
  reminder_due: 'When due',
  daily_digest: 'Daily digest',
  post_published: 'Post published',
};

function automationSummary(m) {
  const channel = m.os_auto_channel === 'webhook' ? 'Webhook' : (m.os_auto_channel === 'agent' ? 'Agent' : 'Email');
  const method = (m.os_auto_method || 'POST').toUpperCase();
  const target = m.os_auto_channel === 'agent' ? (m.os_auto_agent || '(no agent)') : (m.os_auto_target || '(no target)');
  const trig = m.os_auto_trigger || 'reminder_due';
  const triggerLabel = AUTO_TRIGGER_LABEL[trig] || 'When due';
  const bits = [];
  if (trig === 'reminder_due') {
    if (m.ci_auto_priority) bits.push(`${m.ci_auto_priority} priority`);
    const tags = (m.os_auto_tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (tags.length) bits.push(`tags: ${tags.join(', ')}`);
    const lead = Number(m.os_auto_lead_minutes) || 0;
    if (lead) bits.push(`${lead} min before`);
    if (!bits.length) bits.push('all reminders');
  } else if (trig === 'daily_digest') {
    bits.push(`at ${m.os_auto_digest_time || '08:00'}`);
  } else if (trig === 'post_published') {
    bits.push('any post');
  }
  return { channel, method, target, triggerLabel, filter: bits.join(' · ') };
}

// Build a layered React Flow graph from the automations + their `then`
// links. Roots (no incoming chain) sit at depth 0; each `then` pushes its
// target one column right (longest-path relaxation), so a chain reads
// left→right just like a Canvas flow.
const AUTO_CH_COLOR = { agent: '#7c3aed', email: '#2563eb', webhook: '#475569' };
function buildChainGraph(items) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const thenOf = (it) => (it.meta.os_auto_then || '').split(',').map((s) => s.trim()).filter((t) => byId.has(t));
  const depth = new Map(items.map((it) => [String(it.id), 0]));
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const it of items) {
      const d = depth.get(String(it.id));
      for (const t of thenOf(it)) if (depth.get(t) < d + 1) { depth.set(t, d + 1); changed = true; }
    }
    if (!changed) break;
  }
  const byDepth = {};
  for (const it of items) (byDepth[depth.get(String(it.id))] ||= []).push(it);
  const nodes = [];
  const edges = [];
  Object.keys(byDepth).forEach((d) => byDepth[d].forEach((it, i) => {
    const ch = it.meta.os_auto_channel || 'email';
    const enabled = it.meta.os_auto_enabled !== false;
    nodes.push({
      id: String(it.id),
      position: { x: Number(d) * 250, y: i * 104 },
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: h`<div style=${{ textAlign: 'left', minWidth: '130px' }}>
        <div style=${{ fontWeight: 600, fontSize: '12px', color: '#0f172a' }}>${it.title}</div>
        <div style=${{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>${AUTO_TRIGGER_LABEL[it.meta.os_auto_trigger || 'reminder_due']} · ${ch}${enabled ? '' : ' · off'}</div>
      </div>` },
      style: { border: `2px solid ${AUTO_CH_COLOR[ch] || '#475569'}`, borderRadius: '8px', padding: '8px 10px', background: '#fff', opacity: enabled ? 1 : 0.5 },
    });
  }));
  for (const it of items) for (const t of thenOf(it)) {
    const dl = Number(byId.get(t).meta.os_auto_delay) || 0;
    edges.push({ id: `${it.id}-${t}`, source: String(it.id), target: t, label: dl ? `+${dl}m` : 'then', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#94a3b8' } });
  }
  return { nodes, edges };
}

function AutomationChainMap({ items, onOpen }) {
  const { nodes, edges } = useMemo(() => buildChainGraph(items), [items]);
  return h`<div className="border border-border rounded-md overflow-hidden bg-card" style=${{ height: '62vh' }}>
    <${ReactFlowProvider}>
      <${ReactFlow}
        nodes=${nodes}
        edges=${edges}
        fitView
        fitViewOptions=${{ padding: 0.2 }}
        nodesConnectable=${false}
        edgesFocusable=${false}
        nodesDraggable=${true}
        onNodeClick=${(e, n) => onOpen(n.id)}
        proOptions=${{ hideAttribution: true }}
      >
        <${Background} gap=${16} color="#e2e8f0" />
        <${Controls} showInteractive=${false} />
      </${ReactFlow}>
    </${ReactFlowProvider}>
  </div>`;
}

// Run log for one automation — newest first, expandable to show the full
// response (the agent's text, or the webhook/email status line).
function AutomationLogs({ id }) {
  const toast = useToast();
  const dialog = useDialog();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setLog(await rest(`/calendar/v1/reminders/automation/${id}/log`)); }
    catch { setLog([]); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id && id !== 'new') load(); else setLoading(false); }, [id, load]);

  if (id === 'new') return h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">Save the automation first — runs appear here once it fires (cron, chain, or “Send test”).</div></${WPCard}>`;
  if (loading) return h`<div className="p-6 text-center"><${WPSpinner} /></div>`;
  if (!log || !log.length) return h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No runs yet. Use <strong>Send test</strong> above, or wait for a matching reminder.</div></${WPCard}>`;

  const toggle = (i) => setOpen((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const clear = async () => {
    if (!(await dialog.confirm('Clear run log?', 'All recorded runs for this automation will be removed.', { confirmLabel: 'Clear', danger: true }))) return;
    try { await rest(`/calendar/v1/reminders/automation/${id}/log`, { method: 'DELETE' }); setLog([]); toast.success('Log cleared'); }
    catch (e) { toast.error('Clear failed', e.message); }
  };
  const when = (t) => { try { return new Date(t * 1000).toLocaleString(); } catch { return ''; } };

  return h`<div className="space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">${log.length} run${log.length === 1 ? '' : 's'} · most recent first</span>
      <div className="flex items-center gap-2">
        <${WPButton} size="small" variant="tertiary" onClick=${load}>Refresh</${WPButton}>
        <${WPButton} size="small" variant="tertiary" isDestructive=${true} onClick=${clear}>Clear</${WPButton}>
      </div>
    </div>
    <${WPCard}><div className="divide-y divide-border">
      ${log.map((e, i) => h`<div key=${i} className="px-4 py-3">
        <button type="button" onClick=${() => e.output && toggle(i)} className=${'w-full flex items-center gap-3 text-left ' + (e.output ? 'cursor-pointer' : 'cursor-default')}>
          <span className=${'shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ' + (e.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-destructive')}>${e.ok ? 'OK' : 'Failed'}</span>
          ${e.test ? h`<span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">test</span>` : null}
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-foreground truncate">${e.task || '(no task)'}</span>
            <span className="block text-xs text-muted-foreground truncate">${e.detail || ''}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">${when(e.t)}</span>
          ${e.output ? h`<${Icon} name=${open.has(i) ? 'chevron-up' : 'chevron-down'} className="w-3 h-3 shrink-0 text-muted-foreground" />` : null}
        </button>
        ${e.output && open.has(i) ? h`<pre className="mt-2 text-xs bg-muted rounded p-3 whitespace-pre-wrap break-words font-mono overflow-auto" style=${{ maxHeight: '20rem' }}>${e.output}</pre>` : null}
      </div>`)}
    </div></${WPCard}>
  </div>`;
}

function AutomationIndexPage() {
  const { type } = useParams();
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(0);
  const [view, setView] = useState('list');   // 'list' | 'map'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await restAllPages('/wp/v2/os_automation?per_page=100&context=edit&_fields=id,title,meta');
      setItems((raw || []).map((p) => ({ id: p.id, title: p.title?.raw || '(untitled)', meta: p.meta || {} })));
    } catch (e) { toast.error('Failed to load automations', e.message); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (it) => {
    if (busyId) return;
    const next = it.meta.os_auto_enabled === false;   // currently off → turn on
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, meta: { ...x.meta, os_auto_enabled: next } } : x));
    setBusyId(it.id);
    try { await rest(`/wp/v2/os_automation/${it.id}`, { method: 'POST', body: JSON.stringify({ meta: { os_auto_enabled: next } }) }); }
    catch (e) { toast.error('Update failed', e.message); load(); }
    finally { setBusyId(0); }
  };

  const remove = async (it) => {
    const ok = await dialog.confirm('Delete automation?', `“${it.title}” will be permanently deleted.`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setBusyId(it.id);
    try { await rest(`/wp/v2/os_automation/${it.id}?force=true`, { method: 'DELETE' }); setItems((prev) => prev.filter((x) => x.id !== it.id)); toast.success('Deleted'); }
    catch (e) { toast.error('Delete failed', e.message); }
    finally { setBusyId(0); }
  };

  const row = (it) => {
    const s = automationSummary(it.meta);
    const enabled = it.meta.os_auto_enabled !== false;
    return h`<div key=${it.id} className="flex items-center gap-3 px-4 py-3 group">
      <span className=${'shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-muted ' + (s.channel === 'Webhook' ? 'text-foreground' : 'text-primary')}>${s.channel === 'Webhook' ? s.method : s.channel}</span>
      <${Link} to=${`/t/${type}/${it.id}`} className="min-w-0 flex-1 no-underline">
        <div className=${'font-medium truncate ' + (enabled ? 'text-foreground' : 'text-muted-foreground')}>${it.title}</div>
        <div className="text-xs text-muted-foreground truncate"><span className="font-medium text-foreground">${s.triggerLabel}</span> · ${s.target}${s.filter ? ' · ' + s.filter : ''}</div>
      </${Link}>
      <${WPButton} size="small" variant=${enabled ? 'primary' : 'secondary'} isPressed=${enabled} disabled=${busyId === it.id} onClick=${() => toggleEnabled(it)}>${enabled ? 'On' : 'Off'}</${WPButton}>
      <${WPButton} size="small" icon=${iconTrash} isDestructive=${true} disabled=${busyId === it.id} onClick=${() => remove(it)} label="Delete automation" showTooltip=${true} />
    </div>`;
  };

  const AppHeader = CIRegistry.AppHeader;
  const autoActions = h`<${Fragment}>
    <${SegmentedToggle} value=${view} onChange=${setView} options=${[
      { key: 'list', label: 'List' },
      { key: 'map', label: 'Map' },
    ]} />
    <${NewFileButton} type=${type} label=${meta.singular} variant="primary" size="default" />
  </${Fragment}>`;
  return h`<${TypeLayout} type=${type}>
   <div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title=${meta.label} icon=${meta.icon} actions=${autoActions} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-4 md:p-10 mx-auto w-full ' + (fullWidth || view === 'map' ? 'max-w-none' : 'max-w-3xl')}>
      <${PageHeading} icon=${meta.icon} title=${meta.label}
        description=${`Rules that notify you when a reminder comes due. The 5-minute cron matches each due reminder against every enabled rule. ${view === 'map' ? 'Arrows show chains (“then run”); click a node to edit.' : ''}`} />
      ${loading ? h`<${WPCard} size="small"><div className="p-6 text-center"><${WPSpinner} /></div></${WPCard}>` :
        items.length === 0 ? h`<${WPCard} size="small"><div className="p-8 text-center text-sm text-muted-foreground">No automations yet — click + above to add an agent, email, or webhook rule.</div></${WPCard}>` :
        view === 'map' ? h`<${AutomationChainMap} items=${items} onOpen=${(aid) => navigate(`/t/${type}/${aid}`)} />` :
        h`<${WPCard}><div className="divide-y divide-border">${items.map(row)}</div></${WPCard}>`}

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}

const AUTO_TRIGGER_OPTS = [
  { label: 'When a reminder is due', value: 'reminder_due' },
  { label: 'Daily digest of what’s due', value: 'daily_digest' },
  { label: 'When a post is published', value: 'post_published' },
];

function AutomationEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  const [post, setPost] = useState(isNew ? { status: 'publish' } : null);
  const [title, setTitle] = useState('');
  const [trigger, setTrigger] = useState('reminder_due');
  const [channel, setChannel] = useState('email');
  const [method, setMethod] = useState('POST');
  const [tgt, setTgt] = useState('');
  const [agentSlug, setAgentSlug] = useState(''); // agent channel: os_agent slug
  const [agentMode, setAgentMode] = useState('local'); // 'local' | 'external'
  const [model, setModel] = useState(MODEL_FALLBACK); // alias, resolved to an API id in PHP
  const { conf: modelConf } = useAutomationSettings(); // supplies conf.models
  const [agents, setAgents] = useState([]);        // os_agent posts for the picker
  const [body, setBody] = useState('');          // email rich message (blocks)
  const [payload, setPayload] = useState('');     // webhook custom body
  const [bodyType, setBodyType] = useState('json'); // json | form | raw
  const [headers, setHeaders] = useState('');     // webhook custom headers
  const [priority, setPriority] = useState('');
  const [tags, setTags] = useState([]);
  const [lead, setLead] = useState('0');
  const [digestTime, setDigestTime] = useState('08:00');
  const [thenIds, setThenIds] = useState([]);     // chain: automations to run after
  const [delay, setDelay] = useState('0');        // chain: delay when run from a chain
  const [enabled, setEnabled] = useState(true);
  const [others, setOthers] = useState([]);       // other automations for the chain picker
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Other automations for the "then run" chain picker.
  useEffect(() => {
    (async () => {
      try {
        const raw = await restAllPages('/wp/v2/os_automation?per_page=100&_fields=id,title');
        setOthers((raw || []).filter((p) => String(p.id) !== String(id)).map((p) => ({ id: p.id, title: p.title?.rendered?.replace(/<[^>]+>/g, '') || `#${p.id}` })));
      } catch {}
    })();
  }, [id]);

  // os_agent posts for the "Run agent" channel picker (custom CPT; may be
  // absent on sites without the agent feature, e.g. pokopia). Only fetch when
  // the agent channel is actually selected, so other sites never hit a 404.
  useEffect(() => {
    if (channel !== 'agent') return;
    (async () => {
      try {
        const raw = await restAllPages('/wp/v2/os_agent?per_page=100&_fields=id,title,slug');
        setAgents((raw || []).map((p) => ({ slug: p.slug, title: p.title?.rendered?.replace(/<[^>]+>/g, '') || p.slug })));
      } catch { setAgents([]); }
    })();
  }, [channel]);

  // Once the real model list arrives, snap whatever is in state onto a valid
  // alias. Covers a legacy raw id loaded from meta and a default that is no
  // longer offered. Uses setModel directly so it does not flag the form dirty;
  // the alias persists on the next real save.
  useEffect(() => {
    if (!modelConf?.models) return;
    setModel((m) => pickModel(m, modelConf.models, modelConf.default_model));
  }, [modelConf]);

  useEffect(() => {
    if (isNew) {
      setTitle(''); setTrigger('reminder_due'); setChannel('email'); setMethod('POST');
      setTgt(''); setAgentSlug(''); setAgentMode('local'); setModel(MODEL_FALLBACK); setBody(''); setPayload(''); setBodyType('json'); setHeaders('');
      setPriority(''); setTags([]); setLead('0'); setDigestTime('08:00');
      setThenIds([]); setDelay('0'); setEnabled(true); setDirty(true);
      return;
    }
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        const m = p.meta || {};
        setPost(p); setTitle(p.title?.raw || '');
        setBody(p.content?.raw || '');
        setTrigger(m.os_auto_trigger || 'reminder_due');
        setChannel(['webhook', 'agent'].includes(m.os_auto_channel) ? m.os_auto_channel : 'email');
        setMethod((m.os_auto_method || 'POST').toUpperCase());
        setTgt(m.os_auto_target || '');
        setAgentSlug(m.os_auto_agent || '');
        setAgentMode(m.os_auto_agent_mode === 'external' ? 'external' : 'local');
        setModel(m.os_auto_model || MODEL_FALLBACK);
        setPayload(m.os_auto_payload || '');
        setBodyType(m.os_auto_body_type || 'json');
        setHeaders(m.os_auto_headers || '');
        setPriority(m.ci_auto_priority || '');
        setTags((m.os_auto_tags || '').split(',').map((s) => s.trim()).filter(Boolean));
        setLead(String(Number(m.os_auto_lead_minutes) || 0));
        setDigestTime(m.os_auto_digest_time || '08:00');
        setThenIds((m.os_auto_then || '').split(',').map((s) => Number(s.trim())).filter(Boolean));
        setDelay(String(Number(m.os_auto_delay) || 0));
        setEnabled(m.os_auto_enabled !== false);
        if (m.os_auto_payload || m.os_auto_headers) setShowAdvanced(true);
        setDirty(false);
      } catch (e) {
        if (/HTTP 404|rest_post_invalid_id/i.test(e?.message || '')) {
          toast.error('Automation not found', 'It may have been deleted.');
          navigate(`/t/${type}`, { replace: true });
        } else { toast.error('Failed to load', e.message); }
      }
    })();
  }, [type, id, meta?.rest_base, isNew, navigate, toast]);

  const mark = (fn) => (v) => { fn(v); setDirty(true); };

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const payloadBody = {
        title: title || 'Automation',
        content: channel === 'email' ? body : '',
        status: post?.status || 'publish',
        meta: {
          os_auto_trigger: trigger,
          os_auto_channel: channel,
          os_auto_method: channel === 'webhook' ? method : 'POST',
          os_auto_target: tgt,
          os_auto_agent: channel === 'agent' ? agentSlug : '',
          os_auto_agent_mode: channel === 'agent' ? agentMode : 'local',
          os_auto_model: channel === 'agent' ? model : '',
          os_auto_payload: channel === 'webhook' ? payload : '',
          os_auto_body_type: channel === 'webhook' ? bodyType : 'json',
          os_auto_headers: channel === 'webhook' || channel === 'agent' ? headers : '',
          ci_auto_priority: trigger === 'reminder_due' ? priority : '',
          os_auto_tags: trigger === 'reminder_due' ? tags.join(', ') : '',
          os_auto_lead_minutes: trigger === 'reminder_due' ? (Number(lead) || 0) : 0,
          os_auto_digest_time: trigger === 'daily_digest' ? digestTime : '08:00',
          os_auto_then: thenIds.join(','),
          os_auto_delay: Number(delay) || 0,
          os_auto_enabled: enabled,
        },
      };
      let p;
      if (isNew) {
        p = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(payloadBody) });
        toast.success('Automation created');
        navigate(`/t/${type}/${p.id}`, { replace: true });
      } else {
        p = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(payloadBody) });
        setPost(p);
        toast.success('Saved');
      }
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }, [title, body, trigger, channel, method, tgt, agentSlug, agentMode, model, payload, bodyType, headers, priority, tags, lead, digestTime, thenIds, delay, enabled, post?.status, isNew, meta?.rest_base, id, type, navigate, toast]);

  const sendTest = async () => {
    if (isNew || dirty) { toast.info('Save first', 'Save the automation before sending a test.'); return; }
    setTesting(true);
    try {
      const r = await rest('/calendar/v1/reminders/automation/test', { method: 'POST', body: JSON.stringify({ id: Number(id) }) });
      toast.success('Test sent', `${r.channel}: ${r.fired ? 'delivered' : 'failed (check target)'}`);
    } catch (e) { toast.error('Test failed', e.message); }
    finally { setTesting(false); }
  };

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type</div></${TypeLayout}>`;
  if (!isNew && !post) return h`<${TypeLayout} type=${type}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  const isWebhook = channel === 'webhook';
  const isAgent = channel === 'agent';
  const toggleThen = (aid) => mark(setThenIds)(thenIds.includes(aid) ? thenIds.filter((x) => x !== aid) : [...thenIds, aid]);
  const sectionHead = (t) => h`<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">${t}</h3>`;

  const EditorHeader = CIRegistry.EditorHeader;
  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
   <div className="flex flex-col h-full bg-card pt-14">
    <${EditorHeader}
      title=${title} setTitle=${mark(setTitle)}
      placeholder="Automation name…"
      dirty=${dirty} isNew=${isNew} saving=${saving} onSave=${save}
      onClose=${() => { if (dirty && !confirm('Discard unsaved changes and close?')) return; navigate(`/t/${type}`, { replace: true }); }}
      hideTitlebar=${true}
    />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-6 md:p-10 mx-auto w-full space-y-6 pb-32 mb-24 ' + (fullWidth ? 'max-w-none' : 'max-w-3xl')}>
      ${CIRegistry.EditorTitleField ? h`<${CIRegistry.EditorTitleField} title=${title} setTitle=${mark(setTitle)} placeholder="Automation name…" />` : null}

      <${WPTabPanel}
        className="os-settings-tabs"
        activeClass="is-active"
        tabs=${[{ name: 'editor', title: 'Editor' }, { name: 'logs', title: 'Logs' }]}
      >${(tab) => tab.name === 'logs'
        ? h`<div className="pt-6"><${AutomationLogs} id=${id} /></div>`
        : h`<div className="pt-6 space-y-6">
      <div className="os-wpds-fields">
        <${WPCheckboxControl}
          __nextHasNoMarginBottom
          label="Enabled"
          help="Only enabled automations are fired by the cron."
          checked=${enabled}
          onChange=${mark(setEnabled)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 os-wpds-fields">
        <${SelectMenu}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          label="Trigger"
          value=${trigger}
          onChange=${mark(setTrigger)}
          options=${AUTO_TRIGGER_OPTS}
        />
        <${SelectMenu}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          label="Channel"
          value=${channel}
          onChange=${mark(setChannel)}
          options=${[{ label: 'Run agent', value: 'agent' }, { label: 'Email', value: 'email' }, { label: 'Webhook (HTTP)', value: 'webhook' }]}
        />
      </div>

      ${isAgent ? h`<div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 os-wpds-fields">
          <${SelectMenu}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Agent"
            value=${agentSlug}
            onChange=${mark(setAgentSlug)}
            options=${agents.length ? [{ label: 'Select an agent…', value: '' }, ...agents.map((a) => ({ label: a.title, value: a.slug }))] : [{ label: 'No agents found — create one first', value: '' }]}
          />
          <${SelectMenu}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Run on"
            value=${agentMode}
            onChange=${mark(setAgentMode)}
            options=${[{ label: 'This site (Anthropic)', value: 'local' }, { label: 'External runner', value: 'external' }]}
          />
        </div>
        ${agentMode === 'local' ? h`<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 os-wpds-fields items-end">
          <${SelectMenu}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            label="Model"
            value=${model}
            onChange=${mark(setModel)}
            options=${modelConf?.models || []}
          />
          <p className="text-xs text-muted-foreground pb-2">Runs server-side with the agent's prompt + the reminder as the task; the result is emailed to you. Needs an ${''}<${Link} to="/settings" className="text-primary">Anthropic API key</${Link}> in Settings.</p>
        </div>` : h`<div className="os-wpds-fields">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            type="url"
            label="Agent runner URL"
            value=${tgt}
            onChange=${mark(setTgt)}
            placeholder="https://…/run-agent (n8n / Make / your service)"
            help="POST endpoint that runs the agent. Receives the agent slug + a token-gated prompt URL it can fetch."
          />
        </div>`}
      </div>` : h`<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 os-wpds-fields">
        <${WPTextControl}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          type=${isWebhook ? 'url' : 'email'}
          label=${isWebhook ? 'Webhook URL' : 'Send to'}
          value=${tgt}
          onChange=${mark(setTgt)}
          placeholder=${isWebhook ? 'https://hooks.example.com/…' : 'you@example.com'}
          help=${isWebhook ? 'POST/PUT/PATCH send a JSON body; GET/DELETE fold data into the query string.' : 'Defaults to the site admin email if left blank.'}
        />
        ${isWebhook ? h`<${SelectMenu}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          label="HTTP method"
          value=${method}
          onChange=${mark(setMethod)}
          options=${['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((mm) => ({ label: mm, value: mm }))}
        />` : null}
      </div>`}

      ${channel === 'email' ? h`<div>
        ${sectionHead('Email message')}
        <p className="text-xs text-muted-foreground mb-2">Optional rich message. Leave empty for the default reminder text. Variables: <code>{{title}}</code> <code>{{due}}</code> <code>{{notes}}</code> <code>{{url}}</code> <code>{{site}}</code>.</p>
        <div className="border border-border rounded-md overflow-hidden">
          <${GutenbergComposer} value=${body} onChange=${mark(setBody)} minHeight=${400} placeholder="Compose the email… (or leave empty for the default)" />
        </div>
      </div>` : isAgent ? h`<div>
        <${WPButton} variant="link" onClick=${() => setShowAdvanced((v) => !v)}>${showAdvanced ? 'Hide' : 'Show'} custom headers</${WPButton}>
        ${showAdvanced ? h`<div className="mt-2 os-wpds-fields">
          <${WPTextareaControl}
            __nextHasNoMarginBottom
            label="Custom headers"
            help="One per line, e.g. Authorization: Bearer xxxxx — for authenticating to your agent runner."
            value=${headers}
            onChange=${mark(setHeaders)}
            rows=${3}
            className="os-mono-field"
            placeholder="Authorization: Bearer …"
          />
        </div>` : null}
      </div>` : h`<div>
        <${WPButton} variant="link" onClick=${() => setShowAdvanced((v) => !v)}>${showAdvanced ? 'Hide' : 'Show'} advanced body + headers</${WPButton}>
        ${showAdvanced ? h`<div className="mt-2 space-y-3 os-wpds-fields">
          <div className="max-w-xs">
            <${SelectMenu}
              __nextHasNoMarginBottom
              __next40pxDefaultSize
              label="Body format"
              value=${bodyType}
              onChange=${mark(setBodyType)}
              options=${[
                { label: 'JSON', value: 'json' },
                { label: 'Form (x-www-form-urlencoded)', value: 'form' },
                { label: 'Raw', value: 'raw' },
              ]}
            />
          </div>
          <${WPTextareaControl}
            __nextHasNoMarginBottom
            label="Custom body"
            help=${bodyType === 'form'
              ? 'Form-encoded, e.g. grant_type=client_credentials&client_id={{id}}&client_secret=… (good for OAuth2 token requests). Variables are URL-encoded.'
              : bodyType === 'raw'
              ? 'Sent verbatim with your Content-Type header. Variables inserted as-is.'
              : 'Leave empty for the default schema. Use variables in strings, e.g. {"text":"{{title}} is due {{due}}"}.'}
            value=${payload}
            onChange=${mark(setPayload)}
            rows=${5}
            className="os-mono-field"
            placeholder=${bodyType === 'form'
              ? 'grant_type=client_credentials&client_id=…&client_secret=…'
              : bodyType === 'raw'
              ? '{{title}} is due {{due}}'
              : '{\n  "text": "{{title}} is due {{due}}"\n}'}
          />
          <${WPTextareaControl}
            __nextHasNoMarginBottom
            label="Custom headers"
            help="One per line, e.g. Authorization: Bearer xxxxx. Sets Content-Type automatically from the body format unless you override it here."
            value=${headers}
            onChange=${mark(setHeaders)}
            rows=${3}
            className="os-mono-field"
            placeholder="Authorization: Bearer …"
          />
        </div>` : null}
      </div>`}

      ${trigger === 'reminder_due' ? h`<${Fragment}>
        <div>
          ${sectionHead('Match filter')}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 os-wpds-fields">
            <${SelectMenu}
              __nextHasNoMarginBottom
              __next40pxDefaultSize
              label="Priority"
              value=${priority}
              onChange=${mark(setPriority)}
              options=${AUTO_PRIORITY_OPTS}
            />
            <div className="sm:col-span-2">
              <${WPFormTokenField}
                __nextHasNoMarginBottom
                __next40pxDefaultSize
                label="Tags (any of)"
                value=${tags}
                onChange=${mark(setTags)}
                placeholder=${tags.length ? 'Add tag…' : 'Leave empty to match every reminder'}
                tokenizeOnBlur=${true}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Leave both empty to notify for every due reminder. Otherwise the reminder must match the priority and have at least one tag.</p>
        </div>
        <div className="max-w-xs os-wpds-fields">
          <${WPTextControl}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            type="number"
            label="Notify ahead (minutes)"
            help="0 = at the due time."
            value=${lead}
            onChange=${mark(setLead)}
          />
        </div>
      </${Fragment}>` : null}

      ${trigger === 'daily_digest' ? h`<div className="max-w-xs os-wpds-fields">
        <${WPTextControl}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          type="time"
          label="Send at"
          help="Sends once a day, listing everything due that day."
          value=${digestTime}
          onChange=${mark(setDigestTime)}
        />
      </div>` : null}

      ${trigger === 'post_published' ? h`<${WPNotice} status="info" isDismissible=${false}>
        <span className="text-sm">Fires whenever a post is published (including scheduled posts going live). The post title / excerpt / link fill the variables.</span>
      </${WPNotice}>` : null}

      <div>
        ${sectionHead('Then run (chain)')}
        ${others.length === 0 ? h`<p className="text-xs text-muted-foreground">No other automations yet. Create more to chain them.</p>` : h`<div className="space-y-1 os-wpds-fields">
          ${others.map((o) => h`<${WPCheckboxControl}
            key=${o.id}
            __nextHasNoMarginBottom
            label=${o.title}
            checked=${thenIds.includes(o.id)}
            onChange=${() => toggleThen(o.id)}
          />`)}
        </div>`}
        <p className="text-xs text-muted-foreground mt-2">After this fires, also run the checked automations (each honours its own chain delay below).</p>
      </div>

      <div className="max-w-xs os-wpds-fields">
        <${WPTextControl}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
          type="number"
          label="Chain delay (minutes)"
          help="When another automation chains to this one, wait this long first. 0 = immediately."
          value=${delay}
          onChange=${mark(setDelay)}
        />
      </div>
      </div>`}</${WPTabPanel}>

      ${CIRegistry.PageFooter ? h`<${CIRegistry.PageFooter}>
        <${CIRegistry.PageFooter.Action} onClick=${sendTest} disabled=${testing || isNew || dirty}>${testing ? 'Sending test…' : 'Send test'}</${CIRegistry.PageFooter.Action}>
        <${CIRegistry.PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${CIRegistry.PageFooter.Action}>
      </${CIRegistry.PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}

// Self-register the reminder + automation editors and the calendar route.
registerEditor('reminder', () => h`<${ReminderEditorPage} />`, { listView: () => h`<${ReminderIndexPage} />`, newFile: { label: 'New reminder', desc: 'Single task with due date + priority.' } });
// Archived reminders get their own route + URL (the Archived tab). The literal
// path outranks the generic `/t/:type/:id` editor route, and `type` is passed
// explicitly since this path has no `:type` segment.
registerRoute('/t/reminder/archived', h`<${ReminderIndexPage} view="archived" type="reminder" />`);
registerRoute('/calendar', h`<${CalendarView} />`);
registerEditor('automation', () => h`<${AutomationEditorPage} />`, { listView: () => h`<${AutomationIndexPage} />`, newFile: { label: 'New automation', desc: 'Email / webhook rule fired when a reminder is due.' } });
