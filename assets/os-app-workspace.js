/**
 * Context App — Workspaces / Reference companion (self-contained leaf module).
 *
 * A togglable side drawer that opens any ci:// content BESIDE your current
 * work — read-only, with folder drill-down and an "open in app" jump. The
 * first slice of the workspaces idea: side-by-side reference (a Canvas open
 * next to the Skill it documents) without a full multi-window refactor.
 *
 * Built on WPDS (@wordpress/components) for chrome consistency — no shadcn/
 * Tailwind controls. Fully additive + safe: a fixed overlay mounted once in
 * the Shell, riding entirely on the ci:// VFS (GET /vfs/resolve) + read-only
 * content fetches. It never mutates anything and can't affect the main app.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { h, BOOT, rest, decodeEntities } from 'os/core';
import { Icon } from 'os/ui';
import { Button, Spinner, Notice, ItemGroup as WPItemGroup, Item as WPItem } from '@wordpress/components';

const VFS = '/activity/v1/vfs';

// Pull the in-app hash route out of a vfs app_route (admin.php?page=…#/t/x/y).
function hashRoute(appRoute) {
  if (!appRoute) return null;
  const i = appRoute.indexOf('#');
  return i >= 0 ? appRoute.slice(i + 1) : null;
}

export function ReferencePanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('ci://');
  const [node, setNode] = useState(null);   // dir listing OR resolved file
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (p) => {
    setLoading(true); setContent(null);
    try {
      const n = await rest(`${VFS}/resolve?path=${encodeURIComponent(p)}`);
      setNode(n); setPath(n.path || p);
      if (n.kind === 'file' && n.type && n.id) {
        const meta = BOOT.types?.[n.type];
        const base = meta?.rest_base || n.type;
        try {
          // Rendered HTML reads far better than raw block markup in a panel.
          const post = await rest(`/wp/v2/${base}/${n.id}?_fields=title,content`);
          setContent({ title: decodeEntities(post.title?.rendered || n.title || ''), html: post.content?.rendered ?? '' });
        } catch { setContent({ title: n.title || '', html: '<p><em>Could not load content.</em></p>' }); }
      }
    } catch (e) { setNode({ kind: 'not_found', entries: [] }); }
    finally { setLoading(false); }
  }, []);

  // Open the panel at the root the first time it's shown.
  useEffect(() => { if (open && !node) browse('ci://'); }, [open, node, browse]);

  // Let other parts of the app open the panel at a path: window.ciRefOpen(path)
  useEffect(() => {
    const handler = (e) => { setOpen(true); browse(e.detail || 'ci://'); };
    window.addEventListener('ci:ref-open', handler);
    window.ciRefOpen = (p) => window.dispatchEvent(new CustomEvent('ci:ref-open', { detail: p }));
    return () => { window.removeEventListener('ci:ref-open', handler); delete window.ciRefOpen; };
  }, [browse]);

  const crumbs = (path.replace(/^ci:\/*/, '').split('/').filter(Boolean));
  const muted = 'var(--wp-components-color-gray-700, #757575)';
  const border = '1px solid var(--wp-components-color-gray-200, #e0e0e0)';

  // Opened from the Command Palette ("Open Reference") or programmatically via
  // window.ciRefOpen(path). No floating button.
  if (!open) return null;

  return h`<aside style=${{
      position: 'fixed', top: 'var(--wp-admin--admin-bar--height, 32px)', right: 0, bottom: 0, width: '100%', maxWidth: '440px', zIndex: 99,
      background: 'var(--wp-components-color-background, #fff)', borderLeft: border,
      boxShadow: '-8px 0 24px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column',
    }}>
      <div style=${{ minHeight: '48px', padding: '0 8px 0 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: border, flexShrink: 0 }}>
        <${Icon} name="folder-open" className="w-4 h-4" />
        <span style=${{ fontSize: '14px', fontWeight: 600, flex: 1 }}>Reference</span>
        <${Button} size="small" variant="tertiary" onClick=${() => setOpen(false)} aria-label="Close reference panel">
          <${Icon} name="close" className="w-4 h-4" />
        </${Button}>
      </div>

      <nav aria-label="Breadcrumb" style=${{ padding: '8px 16px', borderBottom: border, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap', fontSize: '12px', background: 'var(--wp-components-color-gray-100, #f6f7f7)' }}>
        <${Button} variant="link" onClick=${() => browse('ci://')} style=${{ fontSize: '12px', textDecoration: 'none', minHeight: 'auto', padding: '0 2px' }}>ci://</${Button}>
        ${crumbs.map((seg, i) => h`<${'span'} key=${i} style=${{ display: 'inline-flex', alignItems: 'center', gap: '2px', minWidth: 0 }}>
          <span style=${{ color: muted }} aria-hidden="true">›</span>
          ${i === crumbs.length - 1
            ? h`<span style=${{ fontWeight: 600, padding: '0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '14rem' }}>${seg}</span>`
            : h`<${Button} variant="link" onClick=${() => browse('ci://' + crumbs.slice(0, i + 1).join('/'))} style=${{ fontSize: '12px', textDecoration: 'none', minHeight: 'auto', padding: '0 2px' }}>${seg}</${Button}>`}
        </${'span'}>`)}
      </nav>

      <div style=${{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        ${loading ? h`<div style=${{ padding: '24px' }}><${Spinner} /></div>` :
          content ? h`<div style=${{ padding: '16px' }}>
              <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <h3 style=${{ fontSize: '13px', fontWeight: 600, flex: 1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${content.title}</h3>
                ${node?.app_route ? h`<${Button} size="small" variant="secondary" onClick=${() => { const r = hashRoute(node.app_route); if (r) navigate(r); }}>Open ↗</${Button}>` : null}
              </div>
              <div className="os-ref-rendered" style=${{ fontSize: '13px', lineHeight: 1.5, wordBreak: 'break-word' }}
                dangerouslySetInnerHTML=${{ __html: content.html || '<p><em>(empty)</em></p>' }} />
            </div>` :
          node && node.kind === 'not_found' ? h`<div style=${{ padding: '24px' }}><${Notice} status="warning" isDismissible=${false}>Nothing at that path.</${Notice}></div>` :
          (node?.entries || []).length === 0 ? h`<div style=${{ padding: '24px', textAlign: 'center', color: muted, fontSize: '13px' }}>
              <div style=${{ marginBottom: '8px' }}><${Icon} name="folder-open" className="w-6 h-6" /></div>
              This folder is empty.
            </div>` :
          h`<${WPItemGroup}>
            ${(node?.entries || []).map((e, i) => h`<${WPItem}
              key=${e.path + '|' + (e.id || e.kind || i)}
              size="small"
              onClick=${() => browse(e.path)}>
              <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', fontSize: '13px' }}>
                <${Icon} name=${e.kind === 'dir' ? 'folder' : 'file-lines'} className="w-4 h-4" />
                <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${e.label || e.name}</span>
                ${e.kind === 'dir' ? h`<${Icon} name="chevron-right" className="w-3 h-3" />` : null}
              </div>
            </${WPItem}>`)}
          </${WPItemGroup}>`}
      </div>

      <div style=${{ padding: '8px 12px', borderTop: border, fontSize: '11px', color: muted, flexShrink: 0 }}>
        Browse by ci:// path · read-only · open beside your work
      </div>
    </aside>`;
}
