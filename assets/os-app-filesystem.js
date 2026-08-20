/**
 * Context App — Filesystem (self-contained leaf module).
 *
 * The disk-backed sibling of the Media Library: a jailed file browser over
 * real files on disk. Where Media is a virtual filesystem over WP
 * attachments, this manages actual directories under admin-configured
 * roots. Registered as the standalone `/filesystem` route (not a CPT
 * editor) and surfaced in the WP-admin "Filesystem Library" submenu group.
 *
 * Layout (file-manager style, mirrors the Media two/three-pane shell):
 *   - Left: lazy directory TREE (folders only; children fetched on expand —
 *     a real filesystem is unbounded so we never load it all up front).
 *   - Main: listing of the current directory (dirs + files) + a collapsible
 *     command console; per-row kebab + right-click context menu for ops.
 *   - Right: preview pane — editable code (CodeMirror) for text, image preview,
 *     or a download for binaries. .llm opens on the os-llm graph canvas instead,
 *     when that companion is active (CIRegistry.LlmBodyEditor).
 *
 * File ops + the command console call the manage_options-gated /fs/* REST
 * routes; every path is jailed server-side to the selected root. The
 * console (exec) is OFF until an admin opts in.
 *
 * No build step — native ES module; bare specifiers resolve via the importmap.
 */
import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import {
  Button as WPButton, Notice as WPNotice,
  TextControl as WPTextControl, SearchControl as WPSearchControl,
  Dropdown as WPDropdown, MenuGroup as WPMenuGroup, MenuItem as WPMenuItem,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton,
} from '@wordpress/components';
import { h, BOOT, rest, REST_BASE, registerRoute, CIRegistry, rankSearch } from 'os/core';
import { Icon, Spinner, PageHeading, ViewToggle, useViewMode, ResizablePane } from 'os/ui';
import { useToast, useDialog } from 'os/shell';
import { CodeEditor, useEditorFullWidth } from 'os/editors';

const NS = '/filesystem/v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / Math.pow(1024, i);
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

function fmtMtime(mtime) {
  if (!mtime) return '';
  try { return new Date(mtime * 1000).toLocaleString(); } catch { return ''; }
}

function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }
function parentOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
function baseName(path) { return path.split('/').pop() || path; }

// An entry's path relative to the active root. In a normal listing that's just
// cwd + name; a SEARCH result already carries its own path (relative to cwd),
// so it can live several folders deep — use that when present.
function entryFull(cwd, e) { return joinPath(cwd, e.path || e.name); }

function entryIcon(entry, open) {
  if (entry.type === 'dir') return open ? 'folder-open' : 'folder';
  const ext = entry.ext || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['md', 'markdown'].includes(ext)) return 'file-markdown';
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'rar', '7z'].includes(ext)) return 'box-archive';
  if (['txt', 'log', 'json', 'yml', 'yaml', 'php', 'js', 'ts', 'css', 'scss', 'html', 'xml', 'sh', 'py', 'sql', 'ini', 'conf', 'env'].includes(ext)) return 'file-lines';
  return 'file';
}

// `.llm` has no glyph in the icon font, but it is a first-class authored format
// here (opens on the os-llm graph canvas). Render a `.llm` chip that mirrors the
// `file-markdown` document badge — a rounded outline with the extension inside —
// so it reads as a labelled file type, theme-aware via currentColor.
function LlmGlyph({ className }) {
  return h`<svg viewBox="0 0 32 32" className=${className} aria-hidden="true" role="img">
    <rect x="1" y="7" width="30" height="18" rx="4.5" fill="var(--wp-admin-theme-color, #6d28d9)" />
    <text x="16" y="20.4" textAnchor="middle" fontSize="11.5" fontWeight="800" letterSpacing="0.4"
      fill="#fff" fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">LLM</text>
  </svg>`;
}

// Icon element for one entry: the `.llm` chip for llm files, otherwise the
// icon-font glyph from entryIcon(). Folders and every other type are unchanged.
function EntryIcon({ entry, open, className }) {
  if (entry.type !== 'dir' && (entry.ext || '') === 'llm') {
    return h`<${LlmGlyph} className=${className} />`;
  }
  return h`<${Icon} name=${entryIcon(entry, open)} className=${className} />`;
}

// ext → CodeMirror language id (best-effort; unknown falls back to plaintext).
const CM_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', css: 'css', scss: 'scss',
  less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', php: 'php',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', sh: 'shell', bash: 'shell', zsh: 'shell', md: 'markdown',
  markdown: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', ini: 'ini',
  toml: 'ini', conf: 'ini', env: 'ini', txt: 'plaintext', log: 'plaintext',
};
function cmLangFor(ext) { return CM_LANG[ext] || 'plaintext'; }

// Extensions that prefer the .llm graph canvas over the code editor, when the
// os-llm companion is active. Only .llm, its native format: .md stays on the
// code editor for markdown syntax highlighting (and to avoid the canvas
// reserializing plain markdown on save). os-llm publishes the embeddable editor
// as CIRegistry.LlmBodyEditor — a { value, onChange } component, the same shape
// as CodeEditor — so this is a drop-in swap. Absent the companion the key is
// undefined and we fall back to the code editor, the usual registry contract.
const LLM_CANVAS_EXT = new Set(['llm']);
function llmCanvasFor(ext) { return LLM_CANVAS_EXT.has(ext) ? CIRegistry.LlmBodyEditor : null; }

function fsGet(path, root, rel, extra = '') {
  const qs = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}${extra}`;
  return rest(`${NS}${path}?${qs}`);
}
function fsPost(path, body) {
  return rest(`${NS}${path}`, { method: 'POST', body: JSON.stringify(body) });
}
function downloadUrl(root, path) {
  return `${REST_BASE}${NS}/fs/download?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&_wpnonce=${encodeURIComponent(BOOT.nonce)}`;
}

// ---------------------------------------------------------------------------
// Reusable cursor-anchored context menu (CI has none, so a small local one)
// ---------------------------------------------------------------------------

function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  // Clamp into the viewport.
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - (items.length * 32 + 16));
  return h`<${Fragment}>
    <div className="fixed inset-0" style=${{ zIndex: 70 }} onClick=${onClose} onContextMenu=${(e) => { e.preventDefault(); onClose(); }} />
    <div className="fixed bg-card border border-border rounded-md shadow-lg py-1 text-sm"
      style=${{ left, top, zIndex: 71, minWidth: '11rem' }}>
      ${items.map((it, i) => it.sep
        ? h`<div key=${i} className="my-1 border-t border-border" />`
        : h`<button key=${i} type="button"
            onClick=${() => { onClose(); it.onClick?.(); }}
            disabled=${it.disabled}
            className=${`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed ${it.danger ? 'text-red-600' : 'text-foreground'}`}>
            ${it.icon ? h`<${Icon} name=${it.icon} className="w-3.5 h-3.5 shrink-0" />` : h`<span className="w-3.5" />`}
            <span className="truncate">${it.label}</span>
          </button>`)}
    </div>
  </${Fragment}>`;
}

// ---------------------------------------------------------------------------
// Roots manager
// ---------------------------------------------------------------------------

function RootsManager({ roots, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => roots.map((r) => ({ label: r.label, path: r.path })));
  const [saving, setSaving] = useState(false);
  const update = (i, key, val) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [key]: val } : r));
  const add = () => setRows((rs) => [...rs, { label: '', path: '' }]);
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true);
    try {
      const payload = rows.filter((r) => r.path.trim()).map((r) => ({ label: r.label.trim(), path: r.path.trim() }));
      const res = await fsPost('/fs/roots', { roots: payload });
      toast?.success?.('Roots saved');
      onSaved(res.roots || []);
      onClose();
    } catch (e) { toast?.error?.('Save failed', e.message); }
    finally { setSaving(false); }
  };

  return h`<div className="fixed inset-0 flex items-center justify-center bg-black/40" style=${{ zIndex: 60 }} onClick=${onClose}>
    <div className="bg-card border border-border rounded-md shadow-lg overflow-hidden flex flex-col" style=${{ width: '32rem', maxWidth: '92vw', maxHeight: '80vh' }} onClick=${(e) => e.stopPropagation()}>
      <header className="h-12 px-4 flex items-center border-b border-border shrink-0">
        <span className="font-semibold text-sm flex-1">Filesystem roots</span>
        <${WPButton} size="small" icon=${h`<${Icon} name="close" />`} onClick=${onClose} label="Close" showTooltip=${true} />
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <p className="text-xs text-muted-foreground">Each root is an absolute path the Files browser is jailed to. Access never escapes a root (symlinks included).</p>
        ${rows.map((r, i) => h`<div key=${i} className="flex items-end gap-2">
          <div className="w-32 shrink-0 os-wpds-fields">
            <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Label" value=${r.label} onChange=${(v) => update(i, 'label', v)} placeholder="wp-content" />
          </div>
          <div className="flex-1 os-wpds-fields">
            <${WPTextControl} __nextHasNoMarginBottom __next40pxDefaultSize label="Absolute path" value=${r.path} onChange=${(v) => update(i, 'path', v)} placeholder="/var/www/html/wp-content" />
          </div>
          <${WPButton} size="small" isDestructive=${true} onClick=${() => remove(i)} label="Remove" showTooltip=${true} icon=${h`<${Icon} name="trash" />`} />
        </div>`)}
        <${WPButton} variant="secondary" size="small" onClick=${add} icon=${h`<${Icon} name="folder-plus" />`}>Add root</${WPButton}>
      </div>
      <footer className="px-4 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
        <${WPButton} variant="tertiary" onClick=${onClose}>Cancel</${WPButton}>
        <${WPButton} variant="primary" onClick=${save} isBusy=${saving} disabled=${saving}>Save roots</${WPButton}>
      </footer>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// File preview pane (editable for text)
// ---------------------------------------------------------------------------

function PreviewPane({ root, file, onClose, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [edited, setEdited] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setData(null); setDirty(false);
    fsGet('/fs/read', root, file)
      .then((res) => { if (!cancelled) { setData(res); setEdited(res.content || ''); } })
      .catch((e) => { if (!cancelled) { toast?.error?.('Failed to read file', e.message); setData({ error: e.message }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, file]);

  const name = baseName(file);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isImage = data && data.mime && data.mime.startsWith('image/');
  const isText = data && !data.error && !data.binary && !data.too_large && !isImage;
  // .llm / .md open on the os-llm canvas when that companion is loaded; every
  // other text file, and any of these when it isn't, use the code editor.
  const LlmEditor = isText ? llmCanvasFor(ext) : null;
  // Drag cap: let the handle pull the pane most of the way across the viewport
  // (the flex sibling shrinks to make room), well past the shared 720px default.
  // Maximize goes the rest of the way — absolute-covers the row for full width.
  const dragMax = Math.max(720, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1440) * 0.9));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fsPost('/fs/write', { root, path: file, content: edited });
      toast?.success?.('Saved', `${res.bytes} bytes`);
      setDirty(false);
      setData((d) => ({ ...d, size: res.bytes }));
      onSaved?.();
    } catch (e) { toast?.error?.('Save failed', e.message); }
    finally { setSaving(false); }
  }, [root, file, edited, toast, onSaved]);

  return h`<${ResizablePane} className="border-l border-border bg-card flex flex-col" storageKey="ci:fs-preview-w" defaultWidth=${384} minWidth=${320} maxWidth=${dragMax} style=${maximized ? { position: 'absolute', inset: 0, width: 'auto', zIndex: 20 } : {}}>
    <header className="h-14 px-4 border-b border-border flex items-center gap-2 shrink-0">
      <${Icon} name=${entryIcon({ type: 'file', ext }, false)} className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">${name}${dirty ? ' •' : ''}</div>
        <div className="text-[11px] text-muted-foreground truncate">${file}</div>
      </div>
      ${isText ? h`<${WPButton} size="small" variant="primary" onClick=${save} isBusy=${saving} disabled=${saving || !dirty}>Save</${WPButton}>` : null}
      <${WPButton} size="small" icon=${h`<${Icon} name=${maximized ? 'drawer-right' : 'fit-view'} />`} onClick=${() => setMaximized((m) => !m)} label=${maximized ? 'Restore split view' : 'Expand to full width'} showTooltip=${true} />
      <${WPButton} size="small" icon=${h`<${Icon} name="close" />`} onClick=${onClose} label="Close" showTooltip=${true} />
    </header>
    <div className="flex-1 overflow-hidden relative">
      ${loading ? h`<div className="p-10 text-center"><${Spinner} /></div>` :
        !data ? null :
        data.error ? h`<div className="p-4"><${WPNotice} status="error" isDismissible=${false}>${data.error}</${WPNotice}></div>` :
        isImage ? h`<div className="p-4 h-full overflow-auto flex items-center justify-center bg-muted/40">
          <img src=${downloadUrl(root, file)} alt=${name} className="max-w-full max-h-full object-contain" />
        </div>` :
        data.too_large ? h`<div className="p-6 text-center text-sm text-muted-foreground space-y-3">
          <div>File is ${fmtSize(data.size)} — too large to preview inline.</div>
          <${WPButton} variant="primary" href=${downloadUrl(root, file)}>Download</${WPButton}>
        </div>` :
        data.binary ? h`<div className="p-6 text-center text-sm text-muted-foreground space-y-3">
          <div>Binary file (${data.mime || 'unknown type'}, ${fmtSize(data.size)}).</div>
          <${WPButton} variant="primary" href=${downloadUrl(root, file)}>Download</${WPButton}>
        </div>` :
        h`<div className="absolute inset-0">
          ${LlmEditor
            ? h`<${LlmEditor} value=${edited} onChange=${(v) => { setEdited(v); setDirty(true); }} fill=${true} />`
            : h`<${CodeEditor} value=${edited} language=${cmLangFor(ext)} onChange=${(v) => { setEdited(v); setDirty(true); }} />`}
        </div>`}
    </div>
    ${data && !data.error ? h`<footer className="px-4 py-2 border-t border-border flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
      <span>${fmtSize(data.size)}</span>
      ${data.mime ? h`<span>${data.mime}</span>` : null}
      <span className="ml-auto"><a href=${downloadUrl(root, file)} className="text-foreground hover:underline">Download ↓</a></span>
    </footer>` : null}
  </${ResizablePane}>`;
}

// ---------------------------------------------------------------------------
// Command console
// ---------------------------------------------------------------------------

// Terminal console palette: 4 admin-editable colours (kept in sync with the PHP
// CONSOLE_DEFAULTS); the rest of the palette is derived so a preset — dark or
// light — stays coherent without exposing nine pickers.
const CONSOLE_DEFAULTS = { bg: '#1e1e1e', body: '#d4d4d4', prompt: '#4ec9b0', error: '#f48771' };
const CONSOLE_PRESETS = {
  'VS Code': { bg: '#1e1e1e', body: '#d4d4d4', prompt: '#4ec9b0', error: '#f48771' },
  Solarized: { bg: '#002b36', body: '#93a1a1', prompt: '#859900', error: '#dc322f' },
  Light: { bg: '#ffffff', body: '#1f2328', prompt: '#0a7d54', error: '#cf222e' },
};
// Linear blend of two #rrggbb colours; t=0 → a, t=1 → b.
function mixHex(a, b, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a);
  const [br, bg, bb] = p(b);
  const c = [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
  return '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}
// Full console palette derived from the 4 core colours.
function consolePalette(theme) {
  const t = { ...CONSOLE_DEFAULTS, ...(theme || {}) };
  return {
    bg: t.bg, body: t.body, input: t.body, green: t.prompt, red: t.error,
    bar: mixHex(t.bg, t.body, 0.08),
    dim: mixHex(t.bg, t.body, 0.55),
    faint: mixHex(t.bg, t.body, 0.42),
    amber: '#d7ba7d',
  };
}

// Console colours settings modal: the 4 core pickers + presets, with a live
// preview. Saves to ci_fs_console via POST /fs/console (manage_options).
function ConsoleSettings({ theme, onClose, onSaved }) {
  const toast = useToast();
  const [c, setC] = useState(() => ({ ...CONSOLE_DEFAULTS, ...(theme || {}) }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const preview = consolePalette(c);
  const fields = [['bg', 'Background'], ['body', 'Text'], ['prompt', 'Prompt'], ['error', 'Error']];
  const swatch = { width: '2.25rem', height: '2rem', padding: 0, border: '1px solid var(--border,#ddd)', borderRadius: '4px', background: 'none', cursor: 'pointer' };
  const hexInput = { width: '7rem', padding: '4px 8px', border: '1px solid var(--border,#ddd)', borderRadius: '4px' };
  const save = async () => {
    setSaving(true);
    try {
      const res = await fsPost('/fs/console', { colors: c });
      toast?.success?.('Console colours saved');
      onSaved(res.console || c);
      onClose();
    } catch (e) { toast?.error?.('Save failed', e.message); }
    finally { setSaving(false); }
  };
  return h`<div className="fixed inset-0 flex items-center justify-center bg-black/40" style=${{ zIndex: 60 }} onClick=${onClose}>
    <div className="bg-card border border-border rounded-md shadow-lg overflow-hidden flex flex-col" style=${{ width: '30rem', maxWidth: '92vw', maxHeight: '85vh' }} onClick=${(e) => e.stopPropagation()}>
      <header className="h-12 px-4 flex items-center border-b border-border shrink-0">
        <span className="font-semibold text-sm flex-1">Console colours</span>
        <${WPButton} size="small" icon=${h`<${Icon} name="close" />`} onClick=${onClose} label="Close" showTooltip=${true} />
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Presets:</span>
          ${Object.keys(CONSOLE_PRESETS).map((name) => h`<${WPButton} key=${name} variant="secondary" size="small" onClick=${() => setC({ ...CONSOLE_PRESETS[name] })}>${name}</${WPButton}>`)}
          <span className="flex-1"></span>
          <${WPButton} variant="tertiary" size="small" onClick=${() => setC({ ...CONSOLE_DEFAULTS })}>Reset</${WPButton}>
        </div>
        <div className="space-y-2">
          ${fields.map(([k, label]) => h`<div key=${k} className="flex items-center gap-3">
            <input type="color" value=${c[k]} onChange=${(e) => set(k, e.target.value)} style=${swatch} aria-label=${label} />
            <span className="text-sm flex-1">${label}</span>
            <input type="text" value=${c[k]} spellcheck=${false} onChange=${(e) => set(k, e.target.value)}
              className="text-sm font-mono" style=${hexInput} />
          </div>`)}
        </div>
        <div className="rounded-md overflow-hidden border border-border text-xs" style=${{ fontFamily: 'ui-monospace, monospace' }}>
          <div className="px-3 py-2 space-y-0.5" style=${{ background: preview.bg, color: preview.body }}>
            <div style=${{ color: preview.green }}>$ ls -la identity/</div>
            <div>drwxr-xr-x  soul.llm</div>
            <div style=${{ color: preview.red }}>error: permission denied</div>
          </div>
        </div>
      </div>
      <footer className="px-4 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
        <${WPButton} variant="tertiary" onClick=${onClose}>Cancel</${WPButton}>
        <${WPButton} variant="primary" onClick=${save} isBusy=${saving} disabled=${saving}>Save</${WPButton}>
      </footer>
    </div>
  </div>`;
}

function CommandConsole({ root, cwd, enabled, theme, onOpenSettings, onEnable, onAfterRun, onClose }) {
  const toast = useToast();
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState([]); // [{ cmd, stdout, stderr, exit, timedout }]
  const [running, setRunning] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [ch, setCh] = useState(240);       // console height in px (drag the top edge)
  const [full, setFull] = useState(false); // full-screen overlay
  const scrollRef = useRef(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [history]);

  const run = useCallback(async () => {
    const c = cmd.trim();
    if (!c || running) return;
    setRunning(true);
    try {
      const res = await fsPost('/fs/exec', { root, path: cwd, cmd: c });
      setHistory((h2) => [...h2, { cmd: c, ...res }]);
      setCmd('');
      onAfterRun?.();
    } catch (e) { setHistory((h2) => [...h2, { cmd: c, stderr: e.message, exit: -1 }]); }
    finally { setRunning(false); }
  }, [cmd, running, root, cwd, onAfterRun]);

  const enable = useCallback(async () => {
    setEnabling(true);
    try { await fsPost('/fs/exec-config', { enabled: true, timeout: 30 }); onEnable(); toast?.success?.('Command console enabled'); }
    catch (e) { toast?.error?.('Failed to enable', e.message); }
    finally { setEnabling(false); }
  }, [onEnable, toast]);

  // The palette is applied via inline styles (the precompiled tailwind.css has
  // no arbitrary-colour utilities), and derived from the 4 admin-configured
  // colours so a custom theme or preset flows through every token.
  const C = consolePalette(theme);
  const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' };

  // Full-screen fills the app's content region (the `relative` wrapper that
  // holds the listing), NOT the viewport — `absolute` keeps it clear of the
  // wp-admin menu and toolbar. Otherwise a drag-to-resize panel docked at the bottom.
  const containerStyle = full
    ? { position: 'absolute', inset: 0, zIndex: 60, background: C.bg, color: C.body }
    : { height: ch + 'px', background: C.bg, color: C.body };
  const onResizeStart = (e) => {
    if (full) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = ch;
    const onMove = (ev) => setCh(Math.max(120, Math.min(startH + (startY - ev.clientY), window.innerHeight - 120)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return h`<div className="border-t border-border flex flex-col shrink-0" style=${containerStyle}>
    ${!full ? h`<div onMouseDown=${onResizeStart} title="Drag to resize"
      style=${{ height: '6px', marginTop: '-3px', cursor: 'ns-resize', flex: '0 0 auto', zIndex: 1 }} />` : null}
    <div className="h-9 px-3 flex items-center gap-2 shrink-0" style=${{ background: C.bar, borderBottom: '1px solid rgba(0,0,0,0.4)' }}>
      <span className="text-xs font-semibold" style=${{ color: C.dim }}>Terminal</span>
      <span className="text-xs truncate" style=${{ color: C.faint, ...mono }}>${root}:/${cwd}</span>
      <span className="ml-auto"></span>
      <button type="button" onClick=${onOpenSettings} className="text-xs px-2 py-0.5 rounded" style=${{ color: C.dim }}>Colours</button>
      <button type="button" onClick=${() => setFull((f) => !f)} className="text-xs px-2 py-0.5 rounded"
        style=${{ color: C.dim }}>${full ? 'Exit full screen' : 'Full screen'}</button>
      <button type="button" onClick=${onClose} className="text-xs px-2 py-0.5 rounded" style=${{ color: C.dim }}>Hide</button>
    </div>
    ${!enabled ? h`<div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="text-xs" style=${{ color: C.dim, maxWidth: '26rem' }}>The command console runs shell commands on the server in the selected directory. It's disabled by default. Commands run as the web user, jailed to the current root's working directory, with a timeout.</div>
      <${WPButton} variant="primary" onClick=${enable} isBusy=${enabling} disabled=${enabling}>Enable command console</${WPButton}>
    </div>` : h`<${Fragment}>
      <div ref=${scrollRef} className="flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed" style=${mono}>
        ${history.length === 0 ? h`<div style=${{ color: C.faint }}>Type a command and press Enter. cwd = the selected directory.</div>` : null}
        ${history.map((entry, i) => h`<div key=${i} className="mb-2">
          <div style=${{ color: C.green }}>$ ${entry.cmd}</div>
          ${entry.stdout ? h`<pre className="whitespace-pre-wrap m-0" style=${{ color: C.body, ...mono }}>${entry.stdout}</pre>` : null}
          ${entry.stderr ? h`<pre className="whitespace-pre-wrap m-0" style=${{ color: C.red, ...mono }}>${entry.stderr}</pre>` : null}
          ${entry.timedout ? h`<div style=${{ color: C.amber }}>[timed out]</div>` : (entry.exit ? h`<div style=${{ color: C.faint }}>[exit ${entry.exit}]</div>` : null)}
        </div>`)}
        ${running ? h`<div style=${{ color: C.faint }}>running…</div>` : null}
      </div>
      <div className="h-10 px-2 flex items-center gap-2 shrink-0" style=${{ borderTop: '1px solid rgba(0,0,0,0.4)' }}>
        <span className="text-sm pl-1" style=${{ color: C.green, ...mono }}>$</span>
        <input
          type="text" value=${cmd} disabled=${running}
          onChange=${(e) => setCmd(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
          placeholder="e.g. ls -la"
          className="flex-1 border-0 outline-none text-sm"
          style=${{ background: 'transparent', color: C.input, boxShadow: 'none', outline: 'none', border: 'none', ...mono }}
          autoFocus />
      </div>
    </${Fragment}>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Directory listing (main pane) with kebab + right-click ops
// ---------------------------------------------------------------------------

// Wrap each case-insensitive occurrence of the query in <mark>, for the
// content-match snippet. Returns an array of strings + <mark> nodes.
function markMatch(text, query) {
  const s = String(text || '');
  const needle = (query || '').trim();
  if (!needle) return s;
  const low = s.toLowerCase();
  const nlow = needle.toLowerCase();
  const out = [];
  let i = 0, idx;
  while ((idx = low.indexOf(nlow, i)) !== -1) {
    if (idx > i) out.push(s.slice(i, idx));
    out.push(h`<mark>${s.slice(idx, idx + needle.length)}</mark>`);
    i = idx + needle.length;
  }
  out.push(s.slice(i));
  return out;
}

function DirListing({ root, cwd, view, query, content, onOpenDir, onOpenFile, selectedFile, reloadKey, makeMenuItems, hiddenPaths, onLoaded }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(null); // { x, y, entry }
  const q = (query || '').trim();
  const searching = !!q;
  // What the listing currently SHOWS, as opposed to reloadKey (a post-op
  // refresh of the same view). Navigation swaps to the spinner; a refresh keeps
  // the stale rows on screen and replaces them in place when the fetch lands —
  // no unmount, no layout collapse, no scroll jump.
  const navKey = `${root}|${cwd}|${q}|${content ? 1 : 0}`;
  const lastNavRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (lastNavRef.current !== navKey) { lastNavRef.current = navKey; setLoading(true); }
    setError('');
    // A live query switches from the plain directory read to the recursive
    // /fs/search walk (rooted at cwd), then ranks the hits by name relevance —
    // the SAME rankSearch the content-type lists use, so "search" ranks the
    // same way everywhere. No query → the ordinary jailed directory listing.
    const req = searching
      ? fsGet('/fs/search', root, cwd, `&q=${encodeURIComponent(q)}${content ? '&content=1' : ''}`)
      : fsGet('/fs/list', root, cwd);
    req
      .then((res) => {
        if (cancelled) return;
        if (searching) {
          const ranked = rankSearch(res.results || [], q, {
            fields: [
              { weight: 10, get: (e) => e.name },   // basename hit = the strongest signal
              { weight: 3, get: (e) => e.path || e.name }, // a hit deeper in the path ranks below a basename hit
              // Body hit (content search): the server already confirmed the whole
              // query is in the file, so feed rankSearch the query itself for these
              // rows — guarantees they survive the all-terms filter (the 120-char
              // snippet can't hold a long phrase) while still ranking below any
              // name/path hit (weight 1).
              { weight: 1, get: (e) => (e.match === 'content' ? q : (e.snippet || '')) },
            ],
            recency: (e) => e.mtime || 0,
          });
          setEntries(ranked); setTruncated(!!res.capped);
          onLoaded?.(ranked);
        } else {
          setEntries(res.entries || []); setTruncated(!!res.truncated);
          onLoaded?.(res.entries || []);
        }
      })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to read directory'); setEntries([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, cwd, reloadKey, q, searching, content]);

  if (loading) return h`<div className="p-10 text-center"><${Spinner} /></div>`;
  if (error) return h`<div className="p-4"><${WPNotice} status="error" isDismissible=${false}>${error}</${WPNotice}></div>`;

  // Rows pending an optimistic removal (delete in flight) are dropped from the
  // render immediately; the follow-up refresh reconciles with the server.
  const visible = hiddenPaths?.size ? entries.filter((e) => !hiddenPaths.has(entryFull(cwd, e))) : entries;
  if (!visible.length) return h`<div className="p-10 text-center text-sm text-muted-foreground">${searching ? h`No matches for “${q}”.` : 'Empty directory.'}</div>`;

  const subPath = (e) => (searching && e.path && parentOf(e.path)) ? parentOf(e.path) : '';

  // Open + right-click + the per-entry actions menu are shared by both views.
  const openEntry = (e, full) => e.type === 'dir' ? onOpenDir(full) : onOpenFile(full);
  const onCtx = (e) => (ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, entry: e }); };
  const kebab = (e) => h`<${WPDropdown}
    popoverProps=${{ placement: 'bottom-end' }}
    renderToggle=${({ isOpen, onToggle }) => h`<button type="button" onClick=${onToggle} aria-expanded=${isOpen}
      className="opacity-0 group-hover:opacity-100 w-7 h-7 inline-flex items-center justify-center rounded hover:bg-border text-muted-foreground"
      style=${{ opacity: isOpen ? 1 : undefined }}>⋯</button>`}
    renderContent=${({ onClose }) => h`<${WPMenuGroup}>
      ${makeMenuItems(e).map((it, i) => it.sep ? null : h`<${WPMenuItem} key=${i} isDestructive=${it.danger} disabled=${it.disabled}
        onClick=${() => { onClose(); it.onClick?.(); }}>${it.label}</${WPMenuItem}>`)}
    </${WPMenuGroup}>`} />`;

  // Grid follows Media: folders as a compact card row, files as square tiles
  // below. (Files have no thumbnails, so tiles show the file-type glyph — the
  // same fallback Media's tiles use when an attachment has no preview.)
  const folders = visible.filter((e) => e.type === 'dir');
  const files = visible.filter((e) => e.type !== 'dir');
  const grid = h`<div className="space-y-4">
    ${folders.length ? h`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      ${folders.map((e) => {
        const full = entryFull(cwd, e);
        return h`<div key=${e.path || e.name} onClick=${() => openEntry(e, full)} onContextMenu=${onCtx(e)}
          className="group relative flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card cursor-pointer os-card-hover">
          <${Icon} name="folder" className="w-4 h-4 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" title=${e.name}>${e.name}${e.is_link ? ' ↗' : ''}</div>
            ${subPath(e) ? h`<div className="text-[10px] text-muted-foreground truncate" title=${subPath(e)}>in ${subPath(e)}</div>` : null}
          </div>
          <div onClick=${(ev) => ev.stopPropagation()}>${kebab(e)}</div>
        </div>`;
      })}
    </div>` : null}
    ${files.length ? h`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      ${files.map((e) => {
        const full = entryFull(cwd, e);
        const isSel = selectedFile === full;
        return h`<div key=${e.path || e.name} onClick=${() => openEntry(e, full)} onContextMenu=${onCtx(e)}
          className=${`group relative rounded-md border bg-card cursor-pointer overflow-hidden transition-shadow ${isSel ? 'border-foreground ring-2 ring-ring' : 'border-border os-card-hover'}`}>
          <div className="aspect-square bg-muted flex items-center justify-center">
            <${EntryIcon} entry=${e} open=${false} className="w-10 h-10 text-muted-foreground" />
          </div>
          <div className="px-2 py-1.5 flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground truncate" title=${e.name}>${e.name}${e.is_link ? ' ↗' : ''}</div>
              <div className="text-[10px] text-muted-foreground truncate" title=${e.match === 'content' && e.snippet ? e.snippet : subPath(e)}>${e.match === 'content' && e.snippet ? markMatch(e.snippet, q) : (subPath(e) ? `in ${subPath(e)}` : fmtSize(e.size))}</div>
            </div>
            <div onClick=${(ev) => ev.stopPropagation()}>${kebab(e)}</div>
          </div>
        </div>`;
      })}
    </div>` : null}
  </div>`;

  const table = h`<table className="w-full text-sm border-collapse">
    <thead>
      <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
        <th className="text-left font-medium px-4 py-2">Name</th>
        <th className="text-right font-medium px-3 py-2 w-24">Size</th>
        <th className="text-left font-medium px-3 py-2 w-44 hidden md:table-cell">Modified</th>
        <th className="text-left font-medium px-3 py-2 w-28 hidden lg:table-cell">Perms</th>
        <th className="w-10"></th>
      </tr>
    </thead>
    <tbody>
      ${visible.map((e, i) => {
        const full = entryFull(cwd, e);
        const isSel = e.type === 'file' && selectedFile === full;
        // No divider under the last row (CI's utility CSS has no `last:` variant,
        // so drop the border by index rather than a last-child selector).
        const border = i === visible.length - 1 ? '' : 'border-b border-border/60';
        return h`<tr
          key=${e.path || e.name}
          onClick=${() => openEntry(e, full)}
          onContextMenu=${onCtx(e)}
          className=${`group cursor-pointer ${border} ${isSel ? 'bg-accent' : 'hover:bg-muted'}`}>
          <td className="px-4 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <${EntryIcon} entry=${e} open=${false} className=${`w-4 h-4 shrink-0 ${e.type === 'dir' ? 'text-blue-500' : 'text-muted-foreground'}`} />
              <span className="truncate">${e.name}</span>
              ${subPath(e) ? h`<span className="text-[11px] text-muted-foreground truncate" title=${subPath(e)}>— ${subPath(e)}</span>` : null}
              ${e.is_link ? h`<span className="text-[10px] text-muted-foreground">↗ link</span>` : null}
            </div>
            ${e.match === 'content' && e.snippet ? h`<div className="mt-0.5 ml-6 text-[11px] text-muted-foreground font-mono truncate" title=${e.snippet}>${markMatch(e.snippet, q)}</div>` : null}
          </td>
          <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">${e.type === 'dir' ? '—' : fmtSize(e.size)}</td>
          <td className="px-3 py-1.5 text-muted-foreground hidden md:table-cell">${fmtMtime(e.mtime)}</td>
          <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px] hidden lg:table-cell">${e.perms || ''}</td>
          <td className="px-1 py-1.5 text-right" onClick=${(ev) => ev.stopPropagation()}>${kebab(e)}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;

  return h`<div>
    ${view === 'grid' ? grid : table}
    ${truncated ? h`<div className="px-4 py-2 text-xs text-amber-700">Listing truncated — directory has more than the display cap.</div>` : null}
    ${menu ? h`<${ContextMenu} x=${menu.x} y=${menu.y} items=${makeMenuItems(menu.entry)} onClose=${() => setMenu(null)} />` : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function Breadcrumb({ rootLabel, leading, cwd, onNavigate }) {
  const parts = cwd ? cwd.split('/') : [];
  return h`<div className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
    ${leading || h`<button type="button" onClick=${() => onNavigate('')} className="text-foreground hover:underline font-medium shrink-0">${rootLabel}</button>`}
    ${parts.map((p, i) => {
      const path = parts.slice(0, i + 1).join('/');
      return h`<${Fragment} key=${path}>
        <span className="text-muted-foreground">/</span>
        <button type="button" onClick=${() => onNavigate(path)} className="text-foreground hover:underline truncate max-w-[12rem]">${p}</button>
      </${Fragment}>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Top-level Filesystem page
// ---------------------------------------------------------------------------

function FilesystemPage() {
  const toast = useToast();
  const dialog = useDialog();
  const [roots, setRoots] = useState([]);
  const [rootId, setRootId] = useState('');
  const [execEnabled, setExecEnabled] = useState(false);
  const [cwd, setCwd] = useState('');
  // Recursive search query, scoped to the current directory subtree. Cleared on
  // any navigation so opening a result (or a breadcrumb) drops back to browsing.
  const [query, setQuery] = useState('');
  // Whether the recursive search also scans file *contents* (slower). Name-only
  // by default, mirroring the ci/fs-search ability's default.
  const [searchContents, setSearchContents] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [showRoots, setShowRoots] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTheme, setConsoleTheme] = useState(null);
  const [showConsoleSettings, setShowConsoleSettings] = useState(false);
  // Grid/list choice, persisted (own key, shared hook with Media). Files
  // defaults to the list — its size / modified / perms columns are useful.
  const [view, setView] = useViewMode('ci:fs-view', 'list');
  // Shared, persisted readable/full-width toggle (same hook + storage key as the
  // other Context apps), surfaced as a PageFooter action below.
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();
  const uploadRef = useRef(null);

  const loadRoots = useCallback(async () => {
    setLoadingRoots(true);
    try {
      const res = await rest(`${NS}/fs/roots`);
      const list = res.roots || [];
      setRoots(list);
      setExecEnabled(!!res.exec_enabled);
      setConsoleTheme(res.console || null);
      setRootId((cur) => cur && list.some((r) => r.id === cur) ? cur : (list[0]?.id || ''));
    } catch (e) { toast?.error?.('Failed to load roots', e.message); }
    finally { setLoadingRoots(false); }
  }, [toast]);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  const activeRoot = useMemo(() => roots.find((r) => r.id === rootId) || null, [roots, rootId]);
  const openDir = useCallback((path) => { setCwd(path); setSelectedFile(null); setQuery(''); }, []);
  const openFile = useCallback((path) => setSelectedFile(path), []);
  const refresh = useCallback(() => { setReloadKey((k) => k + 1); }, []);
  useEffect(() => { setCwd(''); setSelectedFile(null); setQuery(''); }, [rootId]);

  // Optimistic deletes: paths hidden from the listing the moment the user
  // confirms, before the server round-trip. A failed delete unhides (the row
  // comes back with the error toast); a completed listing fetch prunes paths
  // the server no longer reports, so a later same-named file isn't masked.
  const [hiddenPaths, setHiddenPaths] = useState(() => new Set());
  const hidePath = useCallback((p) => setHiddenPaths((s) => new Set(s).add(p)), []);
  const unhidePath = useCallback((p) => setHiddenPaths((s) => { const n = new Set(s); n.delete(p); return n; }), []);
  const onListingLoaded = useCallback((entries) => {
    setHiddenPaths((s) => {
      if (!s.size) return s;
      const present = new Set(entries.map((e) => entryFull(cwd, e)));
      const next = new Set([...s].filter((p) => present.has(p)));
      return next.size === s.size ? s : next;
    });
  }, [cwd]);

  // -- File operations -----------------------------------------------------
  const opNewFolder = useCallback(async () => {
    const name = await dialog.prompt('New folder', `Created inside ${cwd || activeRoot?.label}.`, { placeholder: 'folder-name' });
    if (!name?.trim()) return;
    try { await fsPost('/fs/create', { root: rootId, path: joinPath(cwd, name.trim()), type: 'dir' }); toast?.success?.('Folder created'); refresh(); }
    catch (e) { toast?.error?.('Create failed', e.message); }
  }, [dialog, cwd, activeRoot, rootId, refresh, toast]);

  const opNewFile = useCallback(async () => {
    const name = await dialog.prompt('New file', `Created inside ${cwd || activeRoot?.label}.`, { placeholder: 'file.txt' });
    if (!name?.trim()) return;
    try { await fsPost('/fs/create', { root: rootId, path: joinPath(cwd, name.trim()), type: 'file' }); toast?.success?.('File created'); refresh(); openFile(joinPath(cwd, name.trim())); }
    catch (e) { toast?.error?.('Create failed', e.message); }
  }, [dialog, cwd, activeRoot, rootId, refresh, openFile, toast]);

  const opRename = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    const next = await dialog.prompt('Rename', `Rename "${entry.name}".`, { value: entry.name });
    if (!next?.trim() || next.trim() === entry.name) return;
    try { await fsPost('/fs/move', { root: rootId, from: full, to: joinPath(parentOf(full), next.trim()) }); toast?.success?.('Renamed'); if (selectedFile === full) setSelectedFile(null); refresh(); }
    catch (e) { toast?.error?.('Rename failed', e.message); }
  }, [dialog, cwd, rootId, selectedFile, refresh, toast]);

  const opDuplicate = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    const dot = entry.name.lastIndexOf('.');
    const copyName = entry.type === 'file' && dot > 0
      ? `${entry.name.slice(0, dot)}-copy${entry.name.slice(dot)}`
      : `${entry.name}-copy`;
    try { await fsPost('/fs/copy', { root: rootId, from: full, to: joinPath(parentOf(full), copyName) }); toast?.success?.('Duplicated'); refresh(); }
    catch (e) { toast?.error?.('Copy failed', e.message); }
  }, [cwd, rootId, refresh, toast]);

  const opDelete = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    const ok = await dialog.confirm(`Delete "${entry.name}"?`, entry.type === 'dir' ? 'The folder and everything inside it is permanently removed.' : 'The file is permanently removed.', { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    // Optimistic: the row vanishes now; the refresh reconciles with the server.
    hidePath(full);
    if (selectedFile === full) setSelectedFile(null);
    try { await fsPost('/fs/delete', { root: rootId, path: full }); toast?.success?.('Deleted'); refresh(); }
    catch (e) { unhidePath(full); toast?.error?.('Delete failed', e.message); }
  }, [dialog, cwd, rootId, selectedFile, refresh, toast, hidePath, unhidePath]);

  const opChmod = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    const mode = await dialog.prompt('Change permissions', `Octal mode for "${entry.name}" (e.g. 644 or 755).`, { placeholder: '644' });
    if (!mode?.trim()) return;
    try { await fsPost('/fs/chmod', { root: rootId, path: full, mode: mode.trim() }); toast?.success?.('Permissions changed'); refresh(); }
    catch (e) { toast?.error?.('chmod failed', e.message); }
  }, [dialog, cwd, rootId, refresh, toast]);

  const opCompress = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    try { await fsPost('/fs/archive', { root: rootId, paths: [full], dest: joinPath(parentOf(full), `${entry.name}.zip`) }); toast?.success?.('Archive created'); refresh(); }
    catch (e) { toast?.error?.('Compress failed', e.message); }
  }, [cwd, rootId, refresh, toast]);

  const opExtract = useCallback(async (entry) => {
    const full = entryFull(cwd, entry);
    try { await fsPost('/fs/extract', { root: rootId, path: full }); toast?.success?.('Extracted'); refresh(); }
    catch (e) { toast?.error?.('Extract failed', e.message); }
  }, [cwd, rootId, refresh, toast]);

  const opTerminalHere = useCallback((entry) => {
    if (entry.type === 'dir') openDir(entryFull(cwd, entry));
    setConsoleOpen(true);
  }, [cwd, openDir]);

  // Build the action menu for one entry (shared by kebab + right-click).
  const makeMenuItems = useCallback((entry) => {
    const full = entryFull(cwd, entry);
    const items = [];
    if (entry.type === 'dir') items.push({ label: 'Open', icon: 'folder-open', onClick: () => openDir(full) });
    else {
      items.push({ label: 'Open', icon: 'file-lines', onClick: () => openFile(full) });
      items.push({ label: 'Download', icon: 'box-archive', onClick: () => window.open(downloadUrl(rootId, full), '_blank') });
    }
    items.push({ sep: true });
    items.push({ label: 'Rename', icon: 'file-pen', onClick: () => opRename(entry) });
    items.push({ label: 'Duplicate', icon: 'page', onClick: () => opDuplicate(entry) });
    items.push({ label: 'Permissions (chmod)', icon: 'cog', onClick: () => opChmod(entry) });
    if (entry.type === 'dir' || entry.type === 'file') items.push({ label: 'Compress to .zip', icon: 'box-archive', onClick: () => opCompress(entry) });
    if (entry.ext === 'zip') items.push({ label: 'Extract here', icon: 'folder-plus', onClick: () => opExtract(entry) });
    items.push({ sep: true });
    items.push({ label: 'Open terminal here', icon: 'terminal', onClick: () => opTerminalHere(entry) });
    items.push({ sep: true });
    items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: () => opDelete(entry) });
    return items;
  }, [cwd, rootId, openDir, openFile, opRename, opDuplicate, opChmod, opCompress, opExtract, opTerminalHere, opDelete]);

  // -- Upload --------------------------------------------------------------
  const uploadFiles = useCallback(async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    let ok = 0, fail = 0;
    for (const file of arr) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${REST_BASE}${NS}/fs/upload?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(cwd)}`, {
          method: 'POST', headers: { 'X-WP-Nonce': BOOT.nonce, 'Accept': 'application/json' },
          credentials: 'include', body: fd,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ok++;
      } catch { fail++; }
    }
    toast?.[fail ? 'error' : 'success']?.(`Uploaded ${ok}/${arr.length}${fail ? ` (${fail} failed)` : ''}`);
    refresh();
  }, [rootId, cwd, refresh, toast]);

  if (loadingRoots) return h`<div className="absolute inset-0 flex items-center justify-center"><${Spinner} /></div>`;

  if (!roots.length) {
    return h`<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-sm text-muted-foreground">No filesystem roots configured.</div>
      <${WPButton} variant="primary" onClick=${() => setShowRoots(true)}>Add a root</${WPButton}>
      ${showRoots ? h`<${RootsManager} roots=${roots} onClose=${() => setShowRoots(false)} onSaved=${(r) => { setRoots(r); setRootId(r[0]?.id || ''); }} />` : null}
    </div>`;
  }

  const rootMissing = activeRoot && !activeRoot.exists;

  const AppHeader = CIRegistry.AppHeader;
  const PageFooter = CIRegistry.PageFooter;
  // Root picker = the breadcrumb's first segment (under the heading). Borderless
  // tertiary toggle + caret + menu, mirroring Media's folder dropdown so the two
  // file browsers share one design language. Picking a root also jumps to its
  // top (the same select resets cwd), so it doubles as the "home" crumb.
  const rootPicker = h`<${WPDropdown}
    popoverProps=${{ placement: 'bottom-start' }}
    renderToggle=${({ isOpen, onToggle }) => h`<${WPButton} variant="tertiary" size="small" onClick=${onToggle} aria-expanded=${isOpen}>
      <span className="inline-flex items-center gap-1.5"><${Icon} name="folder-open" className="w-4 h-4" />${activeRoot?.label || 'Select root'}<span aria-hidden="true">▾</span></span>
    </${WPButton}>`}
    renderContent=${({ onClose }) => h`<div style=${{ minWidth: '180px', maxWidth: '320px' }}>
      <${WPMenuGroup}>
        ${roots.map((r) => h`<${WPMenuItem} key=${r.id} isSelected=${r.id === rootId} onClick=${() => { setRootId(r.id); openDir(''); onClose(); }}>${r.label}</${WPMenuItem}>`)}
      </${WPMenuGroup}>
    </div>`}
  />`;
  // Gutenberg-style action bar: a bordered, rounded WPToolbar whose logical
  // groups are split by the toolbar's own separators (view · create · session),
  // set a comfortable gap from the primary Upload button so the cluster reads as
  // spaced controls, not a cramped icon strip.
  const fsActions = h`<div className="os-fs-actions flex items-center gap-3 shrink-0">
    <${WPToolbar} label="File actions" className="os-editor-toolbar os-fs-toolbar">
      <${ViewToggle} view=${view} onChange=${setView} />
      <${WPToolbarGroup}>
        <${WPToolbarButton} icon=${h`<${Icon} name="folder-plus" />`} label="New folder" showTooltip=${true} onClick=${opNewFolder} />
        <${WPToolbarButton} icon=${h`<${Icon} name="file-circle-plus" />`} label="New file" showTooltip=${true} onClick=${opNewFile} />
      </${WPToolbarGroup}>
      <${WPToolbarGroup}>
        <${WPToolbarButton} icon=${h`<${Icon} name="terminal" />`} label="Terminal" showTooltip=${true} isActive=${consoleOpen} onClick=${() => setConsoleOpen((o) => !o)} />
        <${WPToolbarButton} icon=${h`<${Icon} name="refresh" />`} label="Refresh" showTooltip=${true} onClick=${refresh} />
      </${WPToolbarGroup}>
    </${WPToolbar}>
    <${WPButton} variant="primary" onClick=${() => uploadRef.current?.click()}>Upload</${WPButton}>
  </div>`;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Files" icon="folder-open" actions=${fsActions} />
    <input ref=${uploadRef} type="file" multiple className="hidden" onChange=${(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
    <div className="flex-1 min-h-0 flex relative">
    ${/* Single pane — navigate via the breadcrumb (its first segment is the root
         selector) and by opening folders in the listing. */ ''}
    <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
       <div className=${'p-4 md:p-10 mx-auto w-full ' + (fullWidth ? 'max-w-none' : 'max-w-5xl')}>
        <${PageHeading} icon="folder-open" title="Files"
          description="Browse and edit real files on disk under the configured roots." />
        ${/* Root selector: always on top, always rendered (the "which disk"
             control), so it can never be collapsed by the search. */ ''}
        <div className="flex items-center mt-1 mb-2" style=${{ minHeight: '32px' }}>
          ${rootPicker}
        </div>
        ${/* Search, full width, its own row (CI's utility CSS has no `sm:`
             responsive width, so it must not share a flex row). */ ''}
        <div className="mb-2 os-wpds-fields" style=${{ width: '100%' }}>
          <${WPSearchControl} __nextHasNoMarginBottom
            value=${query} onChange=${setQuery}
            placeholder=${cwd ? `Search in ${baseName(cwd)}…` : `Search ${activeRoot?.label || 'files'}…`} />
        </div>
        ${/* Breadcrumb PATH stacked beneath the search — only once you've
             navigated into a folder. Root label is the home crumb. */ ''}
        ${cwd ? h`<div className="flex items-center gap-2 mb-3 flex-wrap">
          <${WPButton} size="small" icon=${h`<${Icon} name="chevron-up" />`} label="Up" showTooltip=${true} onClick=${() => openDir(parentOf(cwd))} />
          <div className="flex-1 min-w-0"><${Breadcrumb} rootLabel=${activeRoot?.label || 'root'} cwd=${cwd} onNavigate=${openDir} /></div>
        </div>` : null}
        ${query.trim() ? h`<div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-xs text-muted-foreground">Searching recursively under <span className="font-mono">${activeRoot?.label || rootId}${cwd ? `:/${cwd}` : ''}</span></div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0" title="Also match inside file contents (slower)">
            <input type="checkbox" checked=${searchContents} onChange=${(e) => setSearchContents(e.target.checked)} />
            Search contents
          </label>
        </div>` : null}
        ${rootMissing
          ? h`<div className="p-10 text-center text-sm text-red-600">Configured root does not exist on disk.</div>`
          : h`<${DirListing} root=${rootId} cwd=${cwd} view=${view} query=${query} content=${searchContents} onOpenDir=${openDir} onOpenFile=${openFile} selectedFile=${selectedFile} reloadKey=${reloadKey} makeMenuItems=${makeMenuItems} hiddenPaths=${hiddenPaths} onLoaded=${onListingLoaded} />`}
        ${PageFooter ? h`<${PageFooter}>
          <${PageFooter.Action} onClick=${() => setShowRoots(true)}>Manage roots</${PageFooter.Action}>
          <${PageFooter.Action} onClick=${() => setShowConsoleSettings(true)}>Console colours</${PageFooter.Action}>
          <${PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${PageFooter.Action}>
        </${PageFooter}>` : null}
       </div>
      </div>
      ${consoleOpen ? h`<${CommandConsole}
        root=${rootId} cwd=${cwd} enabled=${execEnabled}
        theme=${consoleTheme}
        onOpenSettings=${() => setShowConsoleSettings(true)}
        onEnable=${() => setExecEnabled(true)}
        onAfterRun=${refresh}
        onClose=${() => setConsoleOpen(false)} />` : null}
    </main>

    ${selectedFile ? h`<${PreviewPane} root=${rootId} file=${selectedFile} onClose=${() => setSelectedFile(null)} onSaved=${refresh} />` : null}

    ${showRoots ? h`<${RootsManager} roots=${roots} onClose=${() => setShowRoots(false)} onSaved=${(r) => { setRoots(r); if (!r.some((x) => x.id === rootId)) setRootId(r[0]?.id || ''); }} />` : null}

    ${showConsoleSettings ? h`<${ConsoleSettings} theme=${consoleTheme} onClose=${() => setShowConsoleSettings(false)} onSaved=${(t) => setConsoleTheme(t)} />` : null}
    </div>
  </div>`;
}

// Self-register the Filesystem surface as the standalone `/filesystem` route.
registerRoute('/filesystem', h`<${FilesystemPage} />`);
