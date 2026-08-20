/**
 * Context App — Media Library (self-contained leaf module).
 *
 * The `attachment`-backed media surface (registered as the `media` editor +
 * list view) lifted out of the monolith. Imports only the published ci/* +
 * vendor modules via the importmap and self-registers on import. Full-page
 * surface (no TypeLayout), so it needs no shared chrome from the registry.
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
import { h, BOOT, rest, restAllPages, restWithHeaders, decodeEntities, typeMeta, CIRegistry, registerEditor } from 'os/core';
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, OS_ICONS, SelectCheckbox, PageHeading, ViewToggle, useViewMode, ResizablePane } from 'os/ui';
import { useToast, useDialog } from 'os/shell';

// Chrome glyphs (FA-backed Icon elements) used by the media surface.
const iconClose = h`<${Icon} name="close" />`;
// Grid/list toggle moved to the shared <ViewToggle> (ci/ui).

// ---------------------------------------------------------------------------
// Media Library
//
// Self-contained surface for the `attachment` post type. Diverges from the
// post/page editor in several ways:
//   - Sidebar tree is the `attachment_folder` taxonomy (filters items)
//     instead of the items themselves — clicking a folder narrows the grid.
//   - Main pane is a thumbnail grid (default) or row list (toggle).
//   - Detail panel slides in on item click for preview + metadata editing.
//   - Drag from desktop into the grid uploads new attachments.
//   - Drag a grid item onto a folder assigns it to that folder.
// ---------------------------------------------------------------------------

const MEDIA_VIEW_KEY = 'os-media-view';

/**
 * Resolve the best thumbnail URL for an attachment. Prefers `medium` size
 * (small enough to load fast, big enough to look decent in a grid card);
 * falls back through smaller sizes, then to the full source_url. Returns
 * empty string if the item isn't an image (caller renders a MIME icon).
 */
function mediaThumb(item) {
  if (!item || (item.media_type && item.media_type !== 'image')) return '';
  const sizes = item.media_details?.sizes || {};
  return sizes.medium?.source_url
    || sizes.thumbnail?.source_url
    || sizes.medium_large?.source_url
    || sizes.large?.source_url
    || item.source_url
    || '';
}

/** Tiny icon byte placeholder when we can't render a thumbnail. */
function MimeIcon({ mime }) {
  const t = (mime || '').split('/')[0] || 'file';
  const labels = { image: 'IMG', audio: 'AUD', video: 'VID', application: 'DOC', text: 'TXT' };
  return h`<div className="flex items-center justify-center w-full h-full bg-muted text-muted-foreground text-xs font-mono">${labels[t] || t.toUpperCase()}</div>`;
}


/**
 * Top-level Media page. Two-pane layout (folder tree | grid+detail) with an
 * optional detail column when an item is open. Handles fetch + filter +
 * upload + bulk in one component to keep state coherent.
 */
function MediaPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const toast = useToast();
  const dialog = useDialog();

  // -1 = All media; 0 = Unfiled (no folder); positive int = specific term id.
  const [folderId, setFolderId] = useState(-1);
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useViewMode(MEDIA_VIEW_KEY, 'grid');

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const uploadRef = useRef(null);
  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setLastClickedId(null); }, []);

  const [uploads, setUploads] = useState([]); // [{ name, progress, error?, doneId? }]
  const [dropActive, setDropActive] = useState(false);
  // Mobile-only: the folder rail collapses into a slide-out drawer.

  const refresh = useCallback(async () => {
    if (!meta) return;
    try {
      // Build the filter URL. `attachment_folder` query var is added by WP's
      // taxonomy registration. Use restAllPages so libraries with 1000s of
      // items still load completely.
      let url = `/wp/v2/media?per_page=100&orderby=date&order=desc&_fields=id,title,slug,date,modified,source_url,media_type,mime_type,media_details,alt_text,caption,description,attachment_folder,link`;
      if (folderId > 0) url += `&attachment_folder=${folderId}`;
      const raw = await restAllPages(url);
      let list = raw;
      // Root (folderId <= 0) is the Files-style top level: show only unfiled
      // items, since the folders themselves render as cards. WP REST has no
      // clean "no term" filter, so we fetch everything and drop filed items here.
      if (folderId <= 0) list = raw.filter((it) => !(it.attachment_folder?.length));
      setItems(list);
    } catch (e) { console.error(e); }
  }, [meta, folderId]);

  const refreshFolders = useCallback(async () => {
    try {
      const list = await restAllPages('/wp/v2/attachment_folder?per_page=100&hide_empty=false&orderby=name&order=asc&_fields=id,name,slug,parent,count');
      setFolders(list);
    } catch (e) { /* fine — folders are optional */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([refresh(), refreshFolders()]).finally(() => setLoading(false));
  }, [folderId]);

  // Selected item for detail panel — pull from items if loaded, otherwise
  // fetch directly so deep-linked URLs (/t/media/123) work cold.
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!id) { setDetail(null); return; }
    const fromList = items.find((it) => Number(it.id) === Number(id));
    if (fromList) { setDetail(fromList); return; }
    (async () => {
      try {
        const it = await rest(`/wp/v2/media/${id}?context=edit&_fields=id,title,slug,date,modified,source_url,media_type,mime_type,media_details,alt_text,caption,description,attachment_folder,link`);
        setDetail(it);
      } catch (e) { toast?.error?.('Failed to load media', e.message); }
    })();
  }, [id, items]);

  // -- Selection -----------------------------------------------------------
  const handleSelectChange = useCallback((itemId, e) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e && e.shiftKey && lastClickedId != null) {
        // Range over items array order (current filtered + sorted).
        const ids = items.map((it) => it.id);
        const a = ids.findIndex((x) => Number(x) === Number(lastClickedId));
        const b = ids.findIndex((x) => Number(x) === Number(itemId));
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (const x of ids.slice(lo, hi + 1)) next.add(x);
        } else { next.add(itemId); }
      } else {
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      }
      return next;
    });
    setLastClickedId(itemId);
  }, [items, lastClickedId]);

  // -- Folder assignment ---------------------------------------------------
  const assignFolder = useCallback(async (ids, targetFolderId) => {
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        try {
          await rest(`/wp/v2/media/${id}`, {
            method: 'POST',
            body: JSON.stringify({ attachment_folder: targetFolderId > 0 ? [targetFolderId] : [] }),
          });
          ok++;
        } catch { fail++; }
      }
      const folder = folders.find((f) => f.id === targetFolderId);
      toast?.[fail ? 'error' : 'success']?.(
        `Moved ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`,
        folder ? `→ ${folder.name}` : '→ Unfiled',
      );
      clearSelection();
      await Promise.all([refresh(), refreshFolders()]);
    } finally { setBulkBusy(false); }
  }, [folders, refresh, refreshFolders, toast, clearSelection]);

  const bulkTrash = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const proceed = await dialog.confirm(
      `Delete ${ids.length} media item${ids.length === 1 ? '' : 's'}?`,
      'Files are permanently deleted from the library.',
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!proceed) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of ids) {
        try { await rest(`/wp/v2/media/${id}?force=true`, { method: 'DELETE' }); ok++; }
        catch { fail++; }
      }
      toast?.[fail ? 'error' : 'success']?.(`Deleted ${ok}/${ids.length}${fail ? ` (${fail} failed)` : ''}`);
      clearSelection();
      await Promise.all([refresh(), refreshFolders()]);
    } finally { setBulkBusy(false); }
  }, [selectedIds, refresh, refreshFolders, toast, clearSelection, dialog]);

  // -- Folder CRUD ---------------------------------------------------------
  const addFolder = useCallback(async () => {
    const name = await dialog.prompt('New folder', 'Folders organise media inside the current parent.', { placeholder: 'folder-name' });
    if (!name || !name.trim()) return;
    try {
      const parent = folderId > 0 ? folderId : 0;
      const t = await rest('/wp/v2/attachment_folder', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), parent }),
      });
      toast?.success?.(`Folder "${t.name}" created`);
      // Stay at the current level so the new folder appears as a card (Files-style),
      // rather than diving into the empty folder.
      await refreshFolders();
    } catch (e) { toast?.error?.('Folder create failed', e.message); }
  }, [folderId, refreshFolders, toast, dialog]);

  // -- Uploads -------------------------------------------------------------
  const uploadFiles = useCallback(async (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    const startIdx = uploads.length;
    setUploads((u) => [...u, ...arr.map((f) => ({ name: f.name, progress: 0 }))]);
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      const idx = startIdx + i;
      try {
        // FormData lets the browser set the multipart boundary header. Don't
        // set Content-Type manually — it'll break the boundary.
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        const res = await fetch(REST_BASE + '/wp/v2/media', {
          method: 'POST',
          headers: { 'X-WP-Nonce': BOOT.nonce, 'Accept': 'application/json' },
          credentials: 'include',
          body: fd,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = await res.json();
        // If a real folder is selected, attach the new upload to it.
        if (folderId > 0 && created.id) {
          await rest(`/wp/v2/media/${created.id}`, {
            method: 'POST',
            body: JSON.stringify({ attachment_folder: [folderId] }),
          });
        }
        setUploads((u) => u.map((up, j) => j === idx ? { ...up, progress: 100, doneId: created.id } : up));
      } catch (e) {
        setUploads((u) => u.map((up, j) => j === idx ? { ...up, error: e.message } : up));
      }
    }
    // Auto-clear successful uploads after 2s; keep errors on screen.
    setTimeout(() => setUploads((u) => u.filter((up) => up.error)), 2000);
    await Promise.all([refresh(), refreshFolders()]);
  }, [uploads.length, folderId, refresh, refreshFolders]);

  // -- Detail panel updates ------------------------------------------------
  const saveDetail = useCallback(async (patch) => {
    if (!detail) return;
    try {
      const updated = await rest(`/wp/v2/media/${detail.id}`, {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      setDetail(updated);
      setItems((prev) => prev.map((it) => Number(it.id) === Number(updated.id) ? { ...it, ...updated } : it));
      toast?.success?.('Saved');
    } catch (e) { toast?.error?.('Save failed', e.message); }
  }, [detail, toast]);

  if (!meta) return null;

  const activeFolderName = folderId > 0
    ? (folders.find((f) => f.id === folderId)?.name || '(unknown)')
    : 'All media';

  const hasDetail = !!id && !!detail;

  // Files-style folder navigation: the breadcrumb path up the parent chain, and
  // the child folders at the current level (root's children have parent 0).
  const folderPath = buildFolderPath(folders, folderId);
  const childFolders = folders.filter((f) => (f.parent || 0) === (folderId > 0 ? folderId : 0));

  const AppHeader = CIRegistry.AppHeader;
  const mediaActions = h`<${Fragment}>
    <${WPToolbar} label="Media actions" className="os-composer-toolbar os-media-toolbar shrink-0">
      <${ViewToggle} view=${view} onChange=${setView} />
      ${/* New folder sits at the toolbar's right edge, beside Upload; the group
            boundary renders the separator to the right of the view toggles. */ ''}
      <${WPToolbarGroup}>
        <${WPToolbarButton} icon=${h`<${Icon} name="folder-plus" />`} label="New folder" showTooltip=${true} onClick=${addFolder} />
      </${WPToolbarGroup}>
    </${WPToolbar}>
    <${WPButton} variant="primary" onClick=${() => uploadRef.current?.click()}>Upload</${WPButton}>
  </${Fragment}>`;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Media" icon="image" actions=${mediaActions} />
    <input ref=${uploadRef} type="file" multiple className="hidden" onChange=${(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
    <div className="flex-1 min-h-0 flex">
    ${/* Single pane — folders live in the header dropdown, not a sidebar. */ ''}
    <main
      className=${`flex-1 min-w-0 flex flex-col overflow-hidden relative ${dropActive ? 'ring-2 ring-ring ring-inset' : ''}`}
      onDragOver=${(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropActive) setDropActive(true); } }}
      onDragLeave=${(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDropActive(false); }}
      onDrop=${(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropActive(false); uploadFiles(e.dataTransfer.files); } }}>
      <div className="flex-1 overflow-y-auto">
       <div className="p-4 md:p-10 mx-auto w-full max-w-5xl">
        <${PageHeading} icon="image" title="Media"
          description="Upload and organise images and files into folders, then reference them across your content." />
        <${UploadZone}
          dest=${folderId > 0 ? activeFolderName : null}
          onBrowse=${() => uploadRef.current?.click()}
          onFiles=${uploadFiles} />
        <${Breadcrumb} path=${folderPath} count=${items.length} loading=${loading} onNavigate=${setFolderId} />
        ${loading ? h`<div className="p-10 text-center"><${Spinner} /></div>` : h`<${Fragment}>
          ${childFolders.length > 0 ? h`<${FolderCards} folders=${childFolders} onOpen=${setFolderId} onAssign=${assignFolder} busy=${bulkBusy} />` : null}
          ${items.length > 0
            ? (view === 'grid'
                ? h`<${MediaGrid} items=${items} selectedIds=${selectedIds} onSelectChange=${handleSelectChange} onOpen=${(itemId) => navigate(`/t/${type}/${itemId}`)} />`
                : h`<${MediaListView} items=${items} selectedIds=${selectedIds} onSelectChange=${handleSelectChange} onOpen=${(itemId) => navigate(`/t/${type}/${itemId}`)} />`)
            : (childFolders.length === 0 ? h`<div className="p-10 text-center text-sm text-muted-foreground">
                <div className="mb-1">No media here yet.</div>
                <div className="text-xs">Drop files here, or click Upload.</div>
              </div>` : null)}
        </${Fragment}>`}
       </div>
      </div>

      ${dropActive ? h`<div className="absolute inset-0 bg-foreground/5 border-2 border-dashed border-ring rounded-md pointer-events-none flex items-center justify-center">
        <div className="bg-card border border-border rounded-md px-4 py-2 text-sm shadow">Drop to upload</div>
      </div>` : null}

      ${uploads.length > 0 ? h`<div className="absolute bottom-4 right-4 w-72 bg-card border border-border rounded-md shadow-lg overflow-hidden">
        <div className="px-3 py-2 text-xs font-semibold border-b border-border">Uploading…</div>
        <div className="max-h-48 overflow-y-auto divide-y divide-border">
          ${uploads.map((up, i) => h`<div key=${i} className="px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">${up.name}</span>
              <span className=${up.error ? 'text-red-600' : up.doneId ? 'text-emerald-600' : 'text-muted-foreground'}>
                ${up.error ? 'Failed' : up.doneId ? 'Done' : 'Uploading…'}
              </span>
            </div>
            ${up.error ? h`<div className="text-[11px] text-muted-foreground mt-0.5 truncate">${up.error}</div>` : null}
          </div>`)}
        </div>
      </div>` : null}

      ${selectedIds.size > 0 ? h`<div className="border-t border-border bg-sidebar/95 backdrop-blur px-3 py-2 shrink-0 flex items-center gap-2 text-xs">
        <span className="font-semibold">${selectedIds.size} selected</span>
        <${WPButton} variant="tertiary" size="small" onClick=${clearSelection}>Clear</${WPButton}>
        <span className="ml-auto inline-flex items-center gap-1">
          <${MoveToFolderPicker} folders=${folders} disabled=${bulkBusy} onPick=${(fid) => assignFolder(Array.from(selectedIds), fid)} />
          <${WPButton} variant="tertiary" size="small" isDestructive=${true} disabled=${bulkBusy} onClick=${bulkTrash}>Trash</${WPButton}>
        </span>
      </div>` : null}
    </main>

    ${hasDetail ? h`<${MediaDetailPanel}
      item=${detail}
      folders=${folders}
      onClose=${() => navigate(`/t/${type}`)}
      onSave=${saveDetail}
      onTrash=${async () => {
        const proceed = await dialog.confirm(
          `Delete "${detail.title?.rendered || `#${detail.id}`}"?`,
          'The file is permanently removed from the library.',
          { danger: true, confirmLabel: 'Delete' }
        );
        if (!proceed) return;
        try {
          await rest(`/wp/v2/media/${detail.id}?force=true`, { method: 'DELETE' });
          toast?.success?.('Deleted');
          navigate(`/t/${type}`);
          await refresh();
        } catch (e) { toast?.error?.('Delete failed', e.message); }
      }}
    />` : null}
    </div>
  </div>`;
}

/**
 * Always-visible upload zone above the listing. A discoverable alternative to
 * the header Upload button and blind drag-onto-grid: a dashed drop target plus
 * a Browse button. Both paths funnel into the parent's single `uploadFiles`
 * (Browse re-triggers the shared file input, drops call `onFiles`), so uploads
 * still land in the active folder. `stopPropagation` on the drop keeps the
 * page-level handler from firing a second upload. `dest` is the active folder
 * name when a real folder is selected, else null.
 */
function UploadZone({ dest, onBrowse, onFiles }) {
  const [drag, setDrag] = useState(false);
  return h`<div
    className=${`mb-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${drag ? 'border-ring bg-muted' : 'border-border'}`}
    onDragOver=${(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!drag) setDrag(true); } }}
    onDragLeave=${(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDrag(false); }}
    onDrop=${(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDrag(false); onFiles(e.dataTransfer.files); } }}>
    <div className="text-sm text-muted-foreground mb-2">${dest ? `Drag files here to add to ${dest}, or` : 'Drag files here, or'}</div>
    <${WPButton} variant="secondary" onClick=${onBrowse}>Browse files</${WPButton}>
  </div>`;
}

/** Walk the attachment_folder parent chain to build a breadcrumb path (root to current). */
function buildFolderPath(folders, folderId) {
  const path = [];
  let cur = folderId > 0 ? folders.find((f) => f.id === folderId) : null;
  while (cur) {
    path.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent ? folders.find((f) => f.id === cur.parent) : null;
  }
  return path;
}

/**
 * Folder breadcrumb under the page heading. "All media" is the root; each crumb
 * walks back up the parent chain. The trailing count is the current level's file
 * tally. Navigating sets folderId (-1 = root).
 */
function Breadcrumb({ path, count, loading, onNavigate }) {
  return h`<nav className="flex items-center flex-wrap gap-1 mb-3 text-sm" aria-label="Folder path">
    <button type="button" onClick=${() => onNavigate(-1)}
      className=${`font-medium ${path.length ? 'text-muted-foreground hover:text-foreground' : 'text-foreground'}`}>All media</button>
    ${path.map((c, i) => h`<span key=${c.id} className="inline-flex items-center gap-1">
      <span className="text-muted-foreground" aria-hidden="true">›</span>
      <button type="button" onClick=${() => onNavigate(c.id)}
        className=${i === path.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}>${c.name}</button>
    </span>`)}
    <span className="text-xs text-muted-foreground shrink-0 ml-1">${loading ? 'Loading…' : `${count} item${count === 1 ? '' : 's'}`}</span>
  </nav>`;
}

/**
 * Child folders of the current level, rendered Files-style as a card grid above
 * the file list. Click to drill in; each card is also a drop target, so dragging
 * a media selection onto it moves those items into the folder (reusing the bulk
 * `assignFolder` path and the same `x-os-media-ids` payload media cards carry).
 */
function FolderCards({ folders, onOpen, onAssign, busy }) {
  return h`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
    ${folders.map((f) => h`<${FolderCard} key=${f.id} folder=${f} onOpen=${onOpen} onAssign=${onAssign} busy=${busy} />`)}
  </div>`;
}

function FolderCard({ folder, onOpen, onAssign, busy }) {
  const [over, setOver] = useState(false);
  return h`<button type="button" disabled=${busy} onClick=${() => onOpen(folder.id)}
    onDragOver=${(e) => { if (e.dataTransfer.types.includes('application/x-os-media-ids')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); } }}
    onDragLeave=${(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setOver(false); }}
    onDrop=${(e) => {
      if (!e.dataTransfer.types.includes('application/x-os-media-ids')) return;
      e.preventDefault(); e.stopPropagation(); setOver(false);
      try { const ids = JSON.parse(e.dataTransfer.getData('application/x-os-media-ids')); if (ids?.length) onAssign(ids, folder.id); } catch {}
    }}
    className=${`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-colors ${over ? 'border-ring bg-muted' : 'border-border bg-card os-card-hover'}`}>
    <${Icon} name="folder" className="w-4 h-4 text-muted-foreground shrink-0" />
    <span className="flex-1 min-w-0 text-sm font-medium truncate">${folder.name}</span>
    <span className="text-xs text-muted-foreground shrink-0">${folder.count}</span>
  </button>`;
}

/**
 * Grid of media cards. Each card is draggable (its ID payload goes into a
 * folder drop target) and clickable (opens detail). Hover/select shows the
 * checkbox overlay in the top-left corner; right-clicking is intentionally
 * left to the browser.
 */
function MediaGrid({ items, selectedIds, onSelectChange, onOpen }) {
  return h`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
    ${items.map((it) => {
      const isSelected = selectedIds.has(it.id);
      const thumb = mediaThumb(it);
      return h`<div
        key=${it.id}
        draggable=${true}
        onDragStart=${(e) => {
          const ids = isSelected ? Array.from(selectedIds) : [it.id];
          e.dataTransfer.setData('application/x-os-media-ids', JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick=${(e) => {
          // Cmd/shift = toggle selection; plain click = open detail.
          if (e.metaKey || e.ctrlKey || e.shiftKey) { onSelectChange(it.id, e); return; }
          onOpen(it.id);
        }}
        className=${`group relative rounded-md border bg-card cursor-pointer overflow-hidden transition-shadow ${
          isSelected ? 'border-foreground ring-2 ring-ring' : 'border-border os-card-hover'
        }`}>
        <div className="aspect-square bg-muted relative">
          ${thumb
            ? h`<img src=${thumb} alt=${it.alt_text || ''} loading="lazy" className="w-full h-full object-cover" />`
            : h`<${MimeIcon} mime=${it.mime_type} />`}
          <div className="absolute top-1 left-1 z-10" onClick=${(e) => e.stopPropagation()}>
            <${SelectCheckbox} checked=${isSelected} onChange=${(e) => onSelectChange(it.id, e)} ariaLabel=${`Select ${it.title?.rendered}`} />
          </div>
        </div>
        <div className="px-2 py-1.5">
          <div className="text-xs font-medium text-foreground truncate">${it.title?.rendered || '(untitled)'}</div>
          <div className="text-[10px] text-muted-foreground truncate">${it.mime_type || ''}</div>
        </div>
      </div>`;
    })}
  </div>`;
}

/**
 * List view of media items — one row per item with a small thumbnail.
 * Same select/open semantics as MediaGrid, optimized for tabular scanning.
 */
// Bytes → human size for the list table (mirrors the Files table's column).
function fmtSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / Math.pow(1024, i);
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

// List view = the Files-style table (Name / Type / Size / Date), so the two
// browsers read the same. Rows keep media's drag-to-folder + multi-select.
function MediaListView({ items, selectedIds, onSelectChange, onOpen }) {
  return h`<table className="w-full text-sm border-collapse">
    <thead>
      <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
        <th className="w-8 px-2 py-2"></th>
        <th className="text-left font-medium px-3 py-2">Name</th>
        <th className="text-left font-medium px-3 py-2 w-40 hidden md:table-cell">Type</th>
        <th className="text-right font-medium px-3 py-2 w-24 hidden sm:table-cell">Size</th>
        <th className="text-left font-medium px-3 py-2 w-32 hidden lg:table-cell">Date</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it) => {
        const isSelected = selectedIds.has(it.id);
        const thumb = mediaThumb(it);
        return h`<tr
          key=${it.id}
          draggable=${true}
          onDragStart=${(e) => {
            const ids = isSelected ? Array.from(selectedIds) : [it.id];
            e.dataTransfer.setData('application/x-os-media-ids', JSON.stringify(ids));
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick=${(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) { onSelectChange(it.id, e); return; }
            onOpen(it.id);
          }}
          className=${`group cursor-pointer border-b border-border/60 ${isSelected ? 'bg-muted' : 'hover:bg-muted'}`}>
          <td className="px-2 py-1.5" onClick=${(e) => e.stopPropagation()}>
            <${SelectCheckbox} checked=${isSelected} onChange=${(e) => onSelectChange(it.id, e)} ariaLabel=${`Select ${it.title?.rendered}`} />
          </td>
          <td className="px-3 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 shrink-0 rounded overflow-hidden bg-muted">
                ${thumb ? h`<img src=${thumb} alt="" loading="lazy" className="w-full h-full object-cover" />` : h`<${MimeIcon} mime=${it.mime_type} />`}
              </div>
              <span className="truncate font-medium">${it.title?.rendered || '(untitled)'}</span>
            </div>
          </td>
          <td className="px-3 py-1.5 text-muted-foreground hidden md:table-cell"><span className="truncate inline-block max-w-[10rem] align-bottom">${it.mime_type || ''}</span></td>
          <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums hidden sm:table-cell">${fmtSize(it.media_details?.filesize)}</td>
          <td className="px-3 py-1.5 text-muted-foreground hidden lg:table-cell">${it.modified ? new Date(it.modified).toLocaleDateString() : ''}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

/**
 * "Move to…" dropdown for the bulk action bar. Opens a small popover with
 * a flat list of folders (no nesting display — that's the tree's job) so
 * the user can pick a destination in one click.
 */
function MoveToFolderPicker({ folders, disabled, onPick }) {
  return h`<${WPDropdown}
    popoverProps=${{ placement: 'bottom-end' }}
    renderToggle=${({ isOpen, onToggle }) => h`<${WPButton} variant="tertiary" size="small" disabled=${disabled} onClick=${onToggle} aria-expanded=${isOpen}>Move…</${WPButton}>`}
    renderContent=${({ onClose }) => h`<div style=${{ minWidth: '180px', maxWidth: '280px' }}>
      <${WPMenuGroup} label="Move to folder">
        <${WPMenuItem} onClick=${() => { onPick(0); onClose(); }}>Unfiled (no folder)</${WPMenuItem}>
        ${folders.map((f) => h`<${WPMenuItem} key=${f.id} onClick=${() => { onPick(f.id); onClose(); }}>${f.name}</${WPMenuItem}>`)}
      </${WPMenuGroup}>
    </div>`}
  />`;
}

/**
 * Right-pane detail editor. Shows the image preview (or MIME placeholder)
 * with editable title / alt / caption / description. Save patches via REST
 * and the parent merges the result back into the list.
 */
function MediaDetailPanel({ item, folders, onClose, onSave, onTrash }) {
  const [title, setTitle] = useState(item.title?.raw || item.title?.rendered || '');
  const [alt, setAlt] = useState(item.alt_text || '');
  const [caption, setCaption] = useState(item.caption?.raw || '');
  const [desc, setDesc] = useState(item.description?.raw || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title?.raw || item.title?.rendered || '');
    setAlt(item.alt_text || '');
    setCaption(item.caption?.raw || '');
    setDesc(item.description?.raw || '');
    setDirty(false);
  }, [item.id]);

  const ch = (setter) => (e) => { setter(e.target.value); setDirty(true); };

  async function save() {
    setSaving(true);
    try { await onSave({ title, alt_text: alt, caption, description: desc }); setDirty(false); }
    finally { setSaving(false); }
  }

  const folderNames = (item.attachment_folder || [])
    .map((id) => folders.find((f) => f.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const thumb = mediaThumb(item);
  const dim = item.media_details?.width ? `${item.media_details.width} × ${item.media_details.height}` : '';
  const filesize = item.media_details?.filesize ? `${Math.round(item.media_details.filesize / 1024)} KB` : '';
  const isImage = item.media_type === 'image';
  // WP's native crop/rotate/scale UI lives on the attachment edit screen.
  // Opening it in a new tab keeps our app state intact; on close the user
  // can refresh the detail panel to pick up new media_details.
  const editImageUrl = isImage
    ? `/wp-admin/post.php?action=edit&post=${item.id}`
    : '';

  return h`<${ResizablePane} className="border-l border-border bg-card flex flex-col" storageKey="ci:media-preview-w" defaultWidth=${384} minWidth=${320} maxWidth=${720}>
    <header className="h-14 px-4 border-b border-border flex items-center gap-2 shrink-0">
      <div className="flex-1 font-semibold text-sm truncate">${title || '(untitled)'}</div>
      <${WPButton} size="small" icon=${iconClose} onClick=${onClose} label="Close" showTooltip=${true} />
    </header>
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="bg-muted rounded-md overflow-hidden flex items-center justify-center" style=${{ minHeight: '180px' }}>
        ${thumb
          ? h`<img src=${thumb} alt=${alt || ''} className="max-w-full max-h-80 object-contain" />`
          : h`<div className="p-10"><${MimeIcon} mime=${item.mime_type} /></div>`}
      </div>

      ${isImage ? h`<${WPButton} variant="secondary" href=${editImageUrl} className="justify-center w-full">Edit image (crop, rotate, scale)</${WPButton}>` : null}

      <div className="os-wpds-fields space-y-4">
        <${WPTextControl}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Title" value=${title} onChange=${(v) => { setTitle(v); setDirty(true); }} />
        <${WPTextControl}
          __nextHasNoMarginBottom __next40pxDefaultSize
          label="Alt text" value=${alt} onChange=${(v) => { setAlt(v); setDirty(true); }} />
        <${WPTextareaControl}
          __nextHasNoMarginBottom
          label="Caption" rows=${2} value=${caption} onChange=${(v) => { setCaption(v); setDirty(true); }} />
        <${WPTextareaControl}
          __nextHasNoMarginBottom
          label="Description" rows=${3} value=${desc} onChange=${(v) => { setDesc(v); setDirty(true); }} />
      </div>

      <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-1">
        ${dim ? h`<div><span className="font-medium text-foreground">Dimensions:</span> ${dim}</div>` : null}
        ${filesize ? h`<div><span className="font-medium text-foreground">Size:</span> ${filesize}</div>` : null}
        ${item.mime_type ? h`<div><span className="font-medium text-foreground">Type:</span> ${item.mime_type}</div>` : null}
        ${folderNames ? h`<div><span className="font-medium text-foreground">Folder:</span> ${folderNames}</div>` : null}
        ${item.source_url ? h`<div className="break-all"><a href=${item.source_url} target="_blank" rel="noopener" className="text-foreground hover:underline">Open file ↗</a></div>` : null}
      </div>
    </div>
    <footer className="px-4 py-3 border-t border-border flex items-center gap-2 shrink-0">
      <${WPButton} variant="tertiary" size="small" isDestructive=${true} onClick=${onTrash}>Delete</${WPButton}>
      ${dirty ? h`<${Badge} className="bg-amber-100 text-amber-700">Unsaved</${Badge}>` : null}
      <span className="ml-auto"><${WPButton} variant="primary" onClick=${save} isBusy=${saving} disabled=${saving || !dirty}>${saving ? 'Saving…' : 'Save'}</${WPButton}></span>
    </footer>
  </${ResizablePane}>`;
}

// Self-register the Media surface as the `media` editor + list view (bound to
// the attachment CPT; not user-selectable for arbitrary types). Runs on import.
registerEditor('media', () => h`<${MediaPage} />`, { listView: () => h`<${MediaPage} />` });
