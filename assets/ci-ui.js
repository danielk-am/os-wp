/**
 * Context UI kernel — icon set + base presentational primitives shared by the
 * engine, type layer, and feature apps. Depends only on `h` (ci/core), React's
 * cloneElement/Children, the WPDS bridges, and the vendored DataViews bundle
 * (LogTable). No shell/nav coupling — the
 * layout shell (TypeLayout + nav tree) and the toast/dialog providers stay in
 * the main bundle until their own extraction pass.
 *
 * No build step — hand-authored native ES module; bare specifiers resolve via
 * the importmap.
 */
import { cloneElement, Children, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Card as WPCard, CardBody as WPCardBody, Button as WPButton, Spinner as WPSpinner,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton,
  Badge as WPBadge, ToggleGroupControl as WPToggleGroupControl,
  ToggleGroupControlOption as WPToggleGroupControlOption, TextControl as WPTextControl,
  Dropdown as WPDropdown, MenuItem as WPMenuItem,
} from '@wordpress/components';
// Already on the boot path via ci/type's static import, so this adds no fetch.
import { DataViews as WPDataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { h, CIRegistry } from 'ci/core';
import {
  faPlus, faRotateLeft, faRotateRight, faGear, faTerminal, faTableColumns, faList, faTrash,
  faChevronUp, faChevronDown, faChevronLeft, faChevronRight, faXmark, faFile,
  faFileLines, faTableCells, faCheck, faFolder, faFolderOpen, faFilePen,
  faCalendarDays, faHouse, faFolderPlus, faFileCirclePlus, faMarkdown,
  faBook, faImage, faMap, faGamepad, faUtensils, faStore, faFlask, faLeaf, faPaw,
  faGem, faScroll, faTag, faStar, faHeart, faBolt, faTree, faMusic, faCamera,
  faGift, faShield, faFlag, faTrophy, faCompass, faSeedling, faFish, faCrown,
  faPalette, faPuzzlePiece, faDice, faTicket, faGlobe, faLocationDot, faCube,
  faClipboard, faBoxArchive,
} from '@ci/fa-icons';

// name → Font Awesome Free icon object. Covers the old custom-SVG names, the
// former @wordpress/icons chrome glyphs, and the CPT-icon palette. The shipped
// UI deliberately uses only the GPL-compatible Free set.
export const CI_ICONS = {
  // chrome glyphs (former @wordpress/icons + custom set)
  'plus': faPlus, 'undo': faRotateLeft, 'redo': faRotateRight, 'refresh': faRotateRight, 'cog': faGear,
  'terminal': faTerminal,
  'drawer-right': faTableColumns, 'list-view': faList, 'trash': faTrash,
  'chevron-up': faChevronUp, 'chevron-down': faChevronDown,
  'chevron-left': faChevronLeft, 'chevron-right': faChevronRight,
  'close': faXmark, 'page': faFile, 'grid': faTableCells, 'check': faCheck,
  'folder': faFolder, 'folder-open': faFolderOpen, 'file': faFile,
  'file-pen': faFilePen, 'file-markdown': faMarkdown, 'file-lines': faFileLines,
  'calendar': faCalendarDays, 'home': faHouse, 'folder-plus': faFolderPlus,
  'file-circle-plus': faFileCirclePlus,
  // Viewport glyphs for the canvas toolbar (FA free v6, raw 512-grid paths,
  // not in the curated bundle): magnifying-glass-plus / -minus and expand.
  'zoom-in': { icon: [512, 512, [], '', 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 112c-13.3 0-24 10.7-24 24l0 48-48 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l48 0 0 48c0 13.3 10.7 24 24 24s24-10.7 24-24l0-48 48 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-48 0 0-48c0-13.3-10.7-24-24-24z'] },
  'zoom-out': { icon: [512, 512, [], '', 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM136 184c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0z'] },
  'fit-view': { icon: [448, 512, [], '', 'M32 32C14.3 32 0 46.3 0 64l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 32zM64 352c0-17.7-14.3-32-32-32S0 334.3 0 352l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 32c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM448 352c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96z'] },
  // Directional Free glyphs keep the four table insertion actions distinct.
  'table-rows-add-above': faChevronUp,
  'table-rows-add-below': faChevronDown,
  'table-columns-add-after': faChevronRight,
  'table-columns-add-before': faChevronLeft,
  'ellipsis-vertical': { icon: [640, 640, [], '', 'M320 152 m -44 0 a 44 44 0 1 0 88 0 a 44 44 0 1 0 -88 0 M320 320 m -44 0 a 44 44 0 1 0 88 0 a 44 44 0 1 0 -88 0 M320 488 m -44 0 a 44 44 0 1 0 88 0 a 44 44 0 1 0 -88 0'] },
  'grip-vertical': { icon: [640, 640, [], '', 'M240 160 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M400 160 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M240 320 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M400 320 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M240 480 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M400 480 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0'] },
  // Free panel glyphs replace the former Pro-only sidebar paths.
  'sidebar': faChevronLeft,
  'sidebar-flip': faChevronRight,
  'square-horizontal': faTableCells,
  // CPT icon palette
  'book': faBook, 'image': faImage, 'map': faMap, 'gamepad': faGamepad,
  'utensils': faUtensils, 'store': faStore, 'flask': faFlask, 'leaf': faLeaf,
  'paw': faPaw, 'gem': faGem, 'scroll': faScroll, 'tag': faTag, 'star': faStar,
  'heart': faHeart, 'bolt': faBolt, 'tree': faTree, 'music': faMusic,
  'camera': faCamera, 'gift': faGift, 'shield': faShield, 'flag': faFlag,
  'trophy': faTrophy, 'compass': faCompass, 'seedling': faSeedling, 'fish': faFish,
  'crown': faCrown, 'palette': faPalette, 'puzzle-piece': faPuzzlePiece,
  'dice': faDice, 'ticket': faTicket, 'globe': faGlobe, 'location-dot': faLocationDot,
  'cube': faCube, 'clipboard': faClipboard, 'box-archive': faBoxArchive,
};

// CPT-icon palette for the picker (Settings → Content types).
export const PICKABLE_ICONS = [
  'book', 'image', 'map', 'gamepad', 'utensils', 'store', 'flask', 'leaf', 'paw',
  'gem', 'scroll', 'tag', 'star', 'heart', 'bolt', 'tree', 'music', 'camera',
  'gift', 'shield', 'flag', 'trophy', 'compass', 'seedling', 'fish', 'crown',
  'palette', 'puzzle-piece', 'dice', 'ticket', 'globe', 'location-dot', 'cube',
  'clipboard', 'box-archive', 'folder', 'file', 'calendar', 'home',
];

// Render a FontAwesome icon object's path as an inline SVG.
function faSvg(fa, className, rest) {
  if (!fa || !fa.icon) return null;
  const [w, h2, , , path] = fa.icon;
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  return h`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox=${`0 0 ${w} ${h2}`}
    fill="currentColor"
    aria-hidden="true"
    className=${className}
    ...${rest}
  ><path d=${d} /></svg>`;
}

// Icon — FontAwesome-backed, name-based. Same API as before; unknown names
// render nothing. (`viewBox`-pair string entries from the old set are gone.)
export function Icon({ name, className = 'w-4 h-4', ...rest }) {
  return faSvg(CI_ICONS[name], className, rest);
}

// WPGlyph — kept for back-compat. Now its `icon` prop is an `<Icon/>` element
// (the former @wordpress/icons identifiers are redefined as FA Icon elements),
// so cloning it with a size/fill still works.
export function WPGlyph({ icon, size = 20, className = '' }) {
  if (!icon) return null;
  return cloneElement(
    icon,
    { width: size, height: size, className, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
    ...Children.toArray(icon.props?.children)
  );
}

// CptIcon — render a content-type's icon: a custom inline SVG when one is set
// (icon picker "Custom SVG" mode), otherwise the named FontAwesome glyph.
// `iconSvg` passes through the strict server-side icon allowlist before it
// reaches the client. The `.ci-cpt-svg` CSS sizes the inner <svg> to fill.
export function CptIcon({ icon, iconSvg, fallback = 'folder', className = 'w-4 h-4' }) {
  if (iconSvg) {
    return h`<span className=${'ci-cpt-svg ' + className} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: iconSvg }} />`;
  }
  return h`<${Icon} name=${icon && CI_ICONS[icon] ? icon : fallback} className=${className} />`;
}

// In-content page heading: the prominent title (with the page/type icon) plus an
// optional description, sitting at the top of the scrollable content. Pairs with
// the fixed top bar (AppHeader / EditorHeader) — the bar is the compact, sticky
// identity; this is the larger in-content one. Shared so every list and app page
// renders the heading the same way.
export function PageHeading({ icon, iconSvg, title, description, fallback, className = '' }) {
  return h`<header className=${'mb-6 ' + className}>
    <h1 className="text-2xl font-semibold flex items-center gap-2.5 min-w-0">
      ${(icon || iconSvg) ? h`<${CptIcon} icon=${icon} iconSvg=${iconSvg} fallback=${fallback} className="w-6 h-6 text-muted-foreground shrink-0" />` : null}
      <span className="truncate">${title}</span>
    </h1>
    ${description ? h`<p className="text-sm text-muted-foreground mt-1.5">${description}</p>` : null}
  </header>`;
}

// SelectMenu is the one shared single- or multi-select contract for Core Index.
// It deliberately uses WPDS Dropdown + MenuItem rather than SelectControl or a
// native <select>, so every authored selector opens the same custom popover.
// Options accept either { value, label } or { key, title, description }.
export function SelectMenu({
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  label,
  hideLabelFromVision = false,
  help,
  multiple = false,
  disabled = false,
  className = '',
}) {
  const rows = (options || []).filter(Boolean);
  const keyOf = (option) => (option.key !== undefined ? option.key : option.value);
  const labelOf = (option) => (
    option.title !== undefined
      ? option.title
      : option.label !== undefined
        ? option.label
        : String(keyOf(option) ?? '')
  );
  const selectedKeys = multiple ? (Array.isArray(value) ? value : []) : [value];
  const isSelected = (option) => selectedKeys.includes(keyOf(option));
  const selectedLabels = rows.filter(isSelected).map(labelOf);
  const hasValue = selectedLabels.length > 0;
  const toggleText = hasValue ? selectedLabels.join(', ') : placeholder;
  const accessibleLabel = ariaLabel || ariaLabelAttribute || label || placeholder || 'Select option';
  const toggleMultiple = (key) => {
    const next = selectedKeys.includes(key)
      ? selectedKeys.filter((item) => item !== key)
      : [...selectedKeys, key];
    // Existing editor-mode selectors require at least one active editor.
    onChange?.(next.length ? next : selectedKeys);
  };

  return h`<div className=${`ci-select-control ${className}`.trim()}>
    ${label && !hideLabelFromVision
      ? h`<div className="components-base-control__label ci-select-label">${label}</div>`
      : null}
    <${WPDropdown}
      className="ci-filter-dd ci-select-dd"
      popoverProps=${{ placement: 'bottom-start' }}
      renderToggle=${({ isOpen, onToggle }) => h`<button
          type="button"
          className=${`ci-filter-toggle ci-select-toggle${isOpen ? ' is-open' : ''}`}
          disabled=${disabled}
          aria-haspopup="listbox"
          aria-expanded=${isOpen}
          aria-label=${accessibleLabel}
          onClick=${disabled ? undefined : onToggle}
          onKeyDown=${(event) => {
            if (disabled || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            onToggle();
          }}
        >
          <span className=${`ci-select-value${hasValue ? '' : ' ci-filter-placeholder'}`}>${toggleText}</span>
          <${Icon} name="chevron-down" className="ci-filter-caret" />
        </button>`}
      renderContent=${({ onClose }) => h`<div className="ci-filter-menu">
        <div className="ci-filter-menu-list" role="listbox" aria-label=${accessibleLabel} aria-multiselectable=${multiple || undefined}>
          ${rows.map((option) => h`<${WPMenuItem}
            key=${keyOf(option)}
            role="option"
            aria-selected=${isSelected(option)}
            isSelected=${isSelected(option)}
            disabled=${!!option.disabled}
            icon=${isSelected(option) ? h`<${Icon} name="check" />` : undefined}
            info=${option.description || undefined}
            onClick=${() => {
              if (option.disabled) return;
              if (multiple) toggleMultiple(keyOf(option));
              else {
                onChange?.(keyOf(option));
                onClose();
              }
            }}
          >${labelOf(option)}</${WPMenuItem}>`)}
        </div>
      </div>`}
    />
    ${help ? h`<p className="components-base-control__help ci-select-help">${help}</p>` : null}
  </div>`;
}

// Back-compatible registry exposure for companion modules loaded by older
// generated products. New authored modules import SelectMenu from ci/ui.
CIRegistry.SelectMenu = SelectMenu;

// ---------------------------------------------------------------------------
// Browser primitives — shared by the file-browser apps (Media, Files) so the
// two look and act the same. The grid/list *cards* differ per app (an image
// thumbnail vs a folder/file glyph); the view-toggle, the persisted choice,
// and the resizable side pane are one implementation here.
// ---------------------------------------------------------------------------

// Persisted grid/list view mode — useState backed by localStorage under `key`,
// so each browser remembers its choice the same way.
export function useViewMode(key, initial = 'grid') {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(key) || initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, view); } catch {} }, [key, view]);
  return [view, setView];
}

// Grid/list toggle. Renders a bare <ToolbarGroup> so it drops into an existing
// `.ci-editor-toolbar` strip next to the other action groups.
export function ViewToggle({ view, onChange }) {
  return h`<${WPToolbarGroup}>
    <${WPToolbarButton} icon=${h`<${Icon} name="grid" />`} label="Grid view" showTooltip=${true} isActive=${view === 'grid'} onClick=${() => onChange('grid')} />
    <${WPToolbarButton} icon=${h`<${Icon} name="list-view" />`} label="List view" showTooltip=${true} isActive=${view === 'list'} onClick=${() => onChange('list')} />
  </${WPToolbarGroup}>`;
}

// Resizable side pane. Renders the <aside> whose width the user changes with
// the shared short vertical handle on its inner edge; `side="right"` (default)
// puts the handle on the LEFT and dragging left widens it. Width is clamped and
// persisted to localStorage under `storageKey`. The pointer, keyboard, and
// visual contract matches @1dr0/ai-chat's AiChatResizeHandle. Pass the
// border/bg/flex utilities via `className`; the pane owns its width.
export function ResizablePane({ children, className = '', side = 'right', storageKey, defaultWidth = 384, minWidth = 280, maxWidth = 720, style = {} }) {
  const clamp = useCallback((n) => Math.max(minWidth, Math.min(maxWidth, n)), [minWidth, maxWidth]);
  const [width, setWidth] = useState(() => {
    try { const v = storageKey && localStorage.getItem(storageKey); if (v) return Math.max(minWidth, Math.min(maxWidth, parseInt(v, 10) || defaultWidth)); } catch {}
    return Math.max(minWidth, Math.min(maxWidth, defaultWidth));
  });
  const widthRef = useRef(width);
  const dragRef = useRef(null);
  widthRef.current = width;
  const persist = useCallback((n) => { try { if (storageKey) localStorage.setItem(storageKey, String(n)); } catch {} }, [storageKey]);
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = e.currentTarget;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: widthRef.current,
      latestWidth: widthRef.current,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    node.classList.add('dragging');
    node.focus();
    node.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);
  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const movement = e.clientX - drag.startX;
    const next = clamp(drag.startWidth + (side === 'right' ? -movement : movement));
    drag.latestWidth = next;
    widthRef.current = next;
    setWidth(next);
  }, [clamp, side]);
  const finishPointer = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.classList.remove('dragging');
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    persist(drag.latestWidth);
  }, [persist]);
  // Arrow keys nudge by 16px. Home and End move to the bounded extremes.
  // On a right-side pane, ArrowLeft widens; left-side panes mirror it.
  const onKeyDown = useCallback((e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    setWidth((current) => {
      const grows = side === 'right' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      const next = e.key === 'Home'
        ? minWidth
        : e.key === 'End'
          ? maxWidth
          : clamp(current + (grows ? 16 : -16));
      widthRef.current = next;
      persist(next);
      return next;
    });
  }, [clamp, maxWidth, minWidth, persist, side]);
  return h`<aside className=${'ci-resizable-pane relative ' + className} style=${{ width: width + 'px', ...style }}>
    <span
      className=${'ci-pane-resizer ' + (side === 'right' ? 'is-left-edge' : 'is-right-edge')}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${finishPointer}
      onPointerCancel=${finishPointer}
      onLostPointerCapture=${finishPointer}
      onKeyDown=${onKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin=${minWidth}
      aria-valuemax=${maxWidth}
      aria-valuenow=${width}
      tabIndex=${0}
    />
    ${children}
  </aside>`;
}

// Card → WPDS Card (+ CardBody for padding). Strips the caller's p-* utilities
// (CardBody owns padding) unless p-0 (image-bleed cards reach the edge).
export const Card = ({ children, className = '' }) => {
  const cls = String(className);
  const noPad = /\bp-0\b/.test(cls);
  const inner = cls
    .replace(/\b(?:p|px|py|pt|pb|pl|pr)-(?:\[[^\]]+\]|[0-9.]+)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (noPad) {
    return h`<${WPCard} isRounded=${true} className=${inner}>${children}</${WPCard}>`;
  }
  return h`<${WPCard} isRounded=${true}>
    <${WPCardBody}>${inner ? h`<div className=${inner}>${children}</div>` : children}</${WPCardBody}>
  </${WPCard}>`;
};

// PadCard → WPDS Card + CardBody; the padded-content-card form.
export const PadCard = ({ children, className = '', size = 'medium' }) =>
  h`<${WPCard} size=${size} isRounded=${true}>
    <${WPCardBody}><div className=${className}>${children}</div></${WPCardBody}>
  </${WPCard}>`;

// Button → @wordpress/components Button (maps our variant vocab to WPDS).
export const Button = ({ children, variant = 'primary', size = 'md', className = '', disabled, ...rest }) => {
  const wpVariant = { primary: 'primary', secondary: 'secondary', ghost: 'tertiary', danger: 'primary' }[variant] || 'primary';
  const isDestructive = variant === 'danger';
  return h`<${WPButton}
    variant=${wpVariant}
    size=${size === 'sm' ? 'small' : size === 'compact' ? 'compact' : size === 'lg' ? '' : 'default'}
    isDestructive=${isDestructive}
    disabled=${disabled}
    className=${className}
    __next40pxDefaultSize=${size !== 'sm' && size !== 'compact'}
    ...${rest}>${children}</${WPButton}>`;
};

// Input → WPDS TextControl. Kept as a ci/ui export because companion plugins
// import it (e.g. ci-reminders) even where they don't render it; dropping the
// export breaks their module load. NOTE the contract differs from a native
// input: WPDS onChange receives the VALUE string, not a DOM event.
export const Input = ({ className = '', ...rest }) =>
  h`<${WPTextControl}
    className=${className}
    __nextHasNoMarginBottom=${true}
    __next40pxDefaultSize=${true}
    ...${rest} />`;

// Badge → WPDS Badge. Maps our colour-utility className convention to the WPDS
// `intent` prop (amber → warning, red → error, green → success, blue → info);
// any other className still passes through. Falls back to a styled span on
// older cores where WPDS Badge is unavailable.
export const Badge = ({ children, className = '' }) => {
  const cls = String(className);
  const intent =
    /\b(amber|yellow|orange)-/.test(cls) ? 'warning'
    : /\b(red|rose)-/.test(cls) ? 'error'
    : /\b(green|emerald)-/.test(cls) ? 'success'
    : /\b(blue|sky|indigo)-/.test(cls) ? 'info'
    : undefined;
  if (WPBadge) {
    return h`<${WPBadge} intent=${intent} className=${cls}>${children}</${WPBadge}>`;
  }
  return h`<span className=${`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-muted text-foreground ${cls}`}>${children}</span>`;
};

// Spinner → WPDS Spinner (native admin look), className passthrough.
export const Spinner = ({ className = '' }) =>
  h`<span className=${`inline-flex ${className}`}><${WPSpinner} /></span>`;

// One controlled @wordpress/dataviews table over an in-memory row set — owns
// the view state and the client-side filter/sort/paginate pass. Rows must
// carry a synthetic `_id` (log feeds have no natural ids); callers supply the
// field defs plus the initial view (title column, visible columns, default
// sort). Used by the log-style lists (Activity, Notifications) so they read
// like the CPT indexes (ci-type's DataViewsIndexReal owns those).
export function LogTable({ rows, fields, initialView, searchLabel, onClickItem, isItemClickable }) {
  const [view, setView] = useState({
    type: 'table', search: '', page: 1, perPage: 24, filters: [], layout: {},
    ...initialView,
  });
  const { data: shown, paginationInfo } = useMemo(() => {
    try { return filterSortAndPaginate(rows, view, fields); }
    catch (e) { return { data: rows, paginationInfo: { totalItems: rows.length, totalPages: 1 } }; }
  }, [rows, view, fields]);
  return h`<div className="ci-dataviews">
    <${WPDataViews}
      data=${shown}
      fields=${fields}
      view=${view}
      onChangeView=${setView}
      paginationInfo=${paginationInfo}
      getItemId=${(it) => it._id}
      defaultLayouts=${{ table: {} }}
      search=${true}
      searchLabel=${searchLabel}
      onClickItem=${onClickItem}
      isItemClickable=${isItemClickable}
      isLoading=${false}
    />
  </div>`;
}

// Live-status pill for an app top bar: a solid dot with an expanding ping
// ring inside a quiet bordered pill. The ring animation is the hand-owned
// `ci-ping` keyframes in ci-utils.css (and sits still under
// prefers-reduced-motion).
export function LiveBadge({ label = 'Live', title }) {
  return h`<span title=${title}
    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
    <span className="relative inline-flex w-2 h-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" aria-hidden="true" />
      <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
    </span>
    ${label}
  </span>`;
}

// ---------------------------------------------------------------------------
// Toolbar — the one CI toolbar used everywhere (editor headers, the block
// composer, app chrome). It is a thin wrapper over the WPDS `Toolbar` that
// stamps the shared `ci-editor-toolbar` class. ALL of the look lives in CSS
// (context-app-shell.css, keyed on `.ci-editor-toolbar`): a borderless
// Gutenberg-style strip, blue admin-colour primary inserter, dark-filled
// active toggles, compact 32px buttons, 20px square icons. Build new CI
// toolbars from these three so they stay consistent without re-styling.
//   <${Toolbar} label="View">
//     <${ToolbarGroup}>
//       <${ToolbarButton} icon=${…} label="…" isActive=${…} onClick=${…} />
//     </${ToolbarGroup}>
//   </${Toolbar}>
// `ToolbarGroup`/`ToolbarButton` are re-exported verbatim — the styling is
// class-driven, so no behavioural wrapper is needed.
export function Toolbar({ label = 'Tools', className = '', children, ...rest }) {
  return h`<${WPToolbar} label=${label} className=${`ci-editor-toolbar shrink-0 ${className}`.trim()} ...${rest}>${children}</${WPToolbar}>`;
}
export const ToolbarGroup = WPToolbarGroup;
export const ToolbarButton = WPToolbarButton;

// SegmentedToggle — the app's standard view switcher (the Visual | Code |
// Diagram style). Now backed by WPDS ToggleGroupControl for a native admin look
// and built-in roving-tabindex keyboard nav. The public API is unchanged:
// `options` is [{ key, label }] (falsy entries skipped so callers can do
// `[a, b, cond && c]`), `onChange` still receives the chosen key. Used for
// editor view modes, the tracker switcher, and the Settings section tabs.
// Falls back to the handrolled pill on cores without ToggleGroupControl.
export function SegmentedToggle({ value, onChange, options, className = '', ariaLabel = 'View' }) {
  const opts = (options || []).filter(Boolean);
  if (WPToggleGroupControl && WPToggleGroupControlOption) {
    return h`<${WPToggleGroupControl}
      label=${ariaLabel}
      hideLabelFromVision=${true}
      value=${value}
      onChange=${(v) => onChange(v)}
      isBlock=${false}
      __nextHasNoMarginBottom=${true}
      __next40pxDefaultSize=${true}
      className=${`ci-segmented ${className}`.trim()}>
      ${opts.map((o) => h`<${WPToggleGroupControlOption} key=${o.key} value=${o.key} label=${o.label} />`)}
    </${WPToggleGroupControl}>`;
  }
  return h`<div role="group" aria-label=${ariaLabel}
    className=${`inline-flex items-center gap-0.5 rounded border border-border p-0.5 bg-card ${className}`.trim()}>
    ${opts.map((o) => h`<button
      key=${o.key}
      type="button"
      onClick=${() => onChange(o.key)}
      className=${'px-2 py-0.5 text-xs rounded ' + (value === o.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
      aria-pressed=${value === o.key}
    >${o.label}</button>`)}
  </div>`;
}

// SelectCheckbox — multi-select checkbox (tree rows, media grid). Pure
// presentational; appears on row hover, shows ✓ / – (indeterminate).
export function SelectCheckbox({ checked, indeterminate, onChange, ariaLabel }) {
  const isActive = checked || indeterminate;
  return h`<button
    type="button"
    role="checkbox"
    aria-checked=${indeterminate ? 'mixed' : (checked ? 'true' : 'false')}
    aria-label=${ariaLabel || 'Select'}
    onClick=${(e) => { e.preventDefault(); e.stopPropagation(); onChange(e); }}
    className=${`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-opacity ${
      isActive
        ? 'bg-foreground border-foreground text-background opacity-100'
        : 'bg-card border-input opacity-0 group-hover:opacity-100'
    }`}>
    ${checked ? h`<span className="text-[10px] leading-none">✓</span>`
      : indeterminate ? h`<span className="text-[10px] leading-none font-bold">–</span>`
      : null}
  </button>`;
}
