/**
 * Context App — Code Snippets editor (self-contained leaf module).
 *
 * Authors php / js / css / html snippets that are materialised to real files
 * under wp-content/os-snippets/ (browsable in the Filesystem app). PHP runs via
 * the mu-plugin circuit-breaker loader; a snippet that fatals is auto-disabled
 * and surfaced here with a one-click recover. Self-registers the `code` editor
 * (dispatched from the type map's `editor: code`) on import.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { h, rest, registerEditor, registerNewFile, CIRegistry } from 'os/core';
import { Icon, Card, Button, Badge, Spinner, SelectMenu } from 'os/ui';
import { useToast } from 'os/shell';
import { CodeEditor } from 'os/editors';

const REST_BASE = '/wp/v2/os_code';
const NS = '/code/v1';

// Match the editor title's gutter (16px / 24px at the 783px breakpoint, set by
// `.os-editor-titlebar` in CI core). Tailwind's `md:mx-6` isn't in the compiled
// build, so the helper/error sat at 16px while the title moved to 24px on
// desktop. Inject a one-time responsive rule instead of relying on that class.
if ( typeof document !== 'undefined' && ! document.getElementById( 'os-code-gutter-style' ) ) {
  const s = document.createElement( 'style' );
  s.id = 'os-code-gutter-style';
  s.textContent = '#os-app-root .os-code-gutter{margin-left:16px;margin-right:16px}@media(min-width:783px){#os-app-root .os-code-gutter{margin-left:24px;margin-right:24px}}';
  document.head.appendChild( s );
}
const LANGS = [['php', 'PHP'], ['js', 'JavaScript'], ['css', 'CSS'], ['html', 'HTML']];
const SCOPES = [['everywhere', 'Everywhere'], ['admin', 'Admin only'], ['frontend', 'Front-end only']];
// Snippet language → CodeMirror language id.
const CM_LANG = { php: 'php', js: 'javascript', css: 'css', html: 'html' };

const fieldCls = 'h-8 px-2 rounded border border-input bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring';

// Starter scaffolds dropped into a NEW code file so the editor isn't a bare
// single line (mirrors how Skills seed their template).
const STARTERS = {
  php: "// New PHP snippet. Write PHP WITHOUT the opening <?php tag.\n// It runs via the guarded mu-plugin loader.\n\n",
  js: "// New JavaScript snippet.\n\n",
  css: "/* New CSS snippet. */\n\n",
  html: "<!-- New HTML snippet. -->\n\n",
};

function CodeEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const TypeLayout = CIRegistry.TypeLayout;

  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('php');
  const [scope, setScope] = useState('everywhere');
  const [priority, setPriority] = useState(10);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const EditorHeader = CIRegistry.EditorHeader;

  const loadStatus = useCallback(async (pid) => {
    try {
      const s = await rest(`${NS}/code/status`);
      setError((s.errors && s.errors[pid]) || null);
    } catch { /* status is best-effort */ }
  }, []);

  // New file → drop in a starter scaffold so the editor isn't a bare line.
  useEffect(() => { if (isNew) setCode((c) => c || (STARTERS[language] || '')); }, [isNew]);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    (async () => {
      try {
        const p = await rest(`${REST_BASE}/${id}?context=edit`);
        setTitle(p.title?.raw ?? '');
        setCode(p.content?.raw ?? '');
        const m = p.meta || {};
        setLanguage(m.os_code_language || 'php');
        setScope(m.os_code_scope || 'everywhere');
        setPriority(Number(m.os_code_priority) || 10);
        setActive(!!m.os_code_active);
        setDirty(false);
        loadStatus(Number(id));
      } catch (e) { toast?.error('Load failed', String(e.message || e)); }
      finally { setLoading(false); }
    })();
  }, [id, isNew, loadStatus, toast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const body = JSON.stringify({
        title: title || '(untitled snippet)',
        content: code,
        status: 'publish',
        meta: { os_code_language: language, os_code_scope: scope, os_code_priority: Number(priority) || 10 },
      });
      const p = isNew
        ? await rest(REST_BASE, { method: 'POST', body })
        : await rest(`${REST_BASE}/${id}`, { method: 'POST', body });
      toast?.success('Saved', `${LANGS.find((l) => l[0] === language)?.[1]} snippet written to disk.`);
      setDirty(false);
      if (isNew) { navigate(`/t/code/${p.id}`); return; }
      loadStatus(Number(id)); // editing re-arms the circuit breaker server-side
    } catch (e) { toast?.error('Save failed', String(e.message || e)); }
    finally { setSaving(false); }
  }, [title, code, language, scope, priority, isNew, id, navigate, toast, loadStatus]);

  const toggleActive = useCallback(async () => {
    if (isNew) { toast?.info('Save first', 'Save the snippet before activating it.'); return; }
    const next = !active;
    try {
      await rest(`${NS}/code/${id}/activate`, { method: 'POST', body: JSON.stringify({ active: next }) });
      setActive(next);
      setError(null);
      toast?.success(next ? 'Activated' : 'Deactivated', next && language === 'php' ? 'Running via the guarded loader.' : '');
    } catch (e) { toast?.error('Toggle failed', String(e.message || e)); }
  }, [active, id, isNew, language, toast]);

  if (loading) return h`<${TypeLayout} type="code" activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card"><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  // Per-editor options live in the right-hand Settings panel (gear), not the
  // toolbar — UI-Playground style.
  const headerSettings = h`<${Fragment}>
    <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Language"
      value=${language} onChange=${(v) => { setLanguage(v); setDirty(true); }}
      options=${LANGS.map((l) => ({ value: l[0], label: l[1] }))} />
    <${SelectMenu} __nextHasNoMarginBottom __next40pxDefaultSize label="Scope"
      value=${scope} onChange=${(v) => { setScope(v); setDirty(true); }}
      options=${SCOPES.map((s) => ({ value: s[0], label: s[1] }))} />
    <div>
      <div className="text-xs font-medium text-foreground mb-1">Priority</div>
      <input type="number" className=${`${fieldCls} w-full`} value=${priority}
        onChange=${(e) => { setPriority(e.target.value); setDirty(true); }} />
      <p className="text-[11px] text-muted-foreground mt-1">Lower runs first.</p>
    </div>
    <div className="pt-3 border-t border-border">
      <div className="flex items-center gap-2">
        <${Badge}>${active ? 'Active' : 'Inactive'}</${Badge}>
        <${Button} size="sm" variant=${active ? 'secondary' : 'primary'} onClick=${toggleActive} disabled=${isNew}>
          ${active ? 'Deactivate' : 'Activate'}
        </${Button}>
      </div>
      ${isNew ? h`<p className="text-[11px] text-muted-foreground mt-1">Save before activating.</p>` : null}
    </div>
  </${Fragment}>`;

  return h`<${TypeLayout} type="code" activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
    <div className="flex flex-col h-full bg-card pt-14">
      <${EditorHeader}
        title=${title}
        setTitle=${(v) => { setTitle(v); setDirty(true); }}
        placeholder="Code file title…"
        dirty=${dirty}
        isNew=${isNew}
        saving=${saving}
        onSave=${save}
        onClose=${() => navigate('/t/code')}
        settings=${headerSettings}
        hideTitlebar=${true}
      />

      ${/* Title as a field at the top of the content, gutter-aligned with the
          helper + editor (the floating titlebar is hidden above). */''}
      ${CIRegistry.EditorTitleField ? h`<${CIRegistry.EditorTitleField}
        title=${title}
        setTitle=${(v) => { setTitle(v); setDirty(true); }}
        placeholder="Code file title…"
        className="os-code-gutter pt-4 shrink-0"
      />` : null}

      ${language === 'php' ? h`<p className="shrink-0 os-code-gutter mt-2 text-sm text-muted-foreground">Write PHP <strong>without</strong> the opening <code className="font-mono bg-muted px-1 rounded">${'<?php'}</code> tag. Runs via the guarded mu-plugin loader.</p>` : null}

      ${error ? h`<div className="shrink-0 os-code-gutter mt-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm">
        <div className="font-medium text-red-700 flex items-center gap-2"><${Icon} name="bolt" className="w-4 h-4" /> Disabled by the circuit breaker — this snippet fataled.</div>
        <div className="mt-1 text-red-600 font-mono text-xs break-all">${error.msg}${error.file ? ` (${error.file}:${error.line})` : ''}</div>
        <div className="mt-2 text-muted-foreground text-xs">Fix the code and Save to clear the error and re-enable.</div>
      </div>` : null}

      <div className="flex-1 min-h-0 relative">
        <${CodeEditor} value=${code} onChange=${(v) => { setCode(v); setDirty(true); }} language=${CM_LANG[language] || 'plaintext'} />
      </div>
    </div>
  </${TypeLayout}>`;
}

registerEditor('code', () => h`<${CodeEditorPage} />`, {
  selectable: true,
  title: 'Code Editor',
  description: 'A code editor for php / js / css / html, materialised to real files with a fatal-error circuit breaker for PHP.',
});
registerNewFile('code', { label: 'Code file', desc: 'A php / js / css / html file on disk.' });
