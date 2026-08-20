/**
 * Context App — Apps registry / "App Store" (self-contained leaf module).
 *
 * Manage the Context app modules and, per app, the MCP abilities they expose:
 *   - toggle an individual ci/* ability on/off (writes the shared
 *     ci_mcp_disabled_tools deny-list the MCP server honours);
 *   - enable/disable a sideloaded app module (uploads/os-apps/*.js).
 * Built-in apps can't be unloaded (static imports) — their abilities are the
 * control surface. Self-registers the /apps route + nav row on import.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { h, rest, registerRoute, registerNavRow, CIRegistry } from 'os/core';
import { Icon, Card, Badge, Spinner, PageHeading, SegmentedToggle } from 'os/ui';
import { ToggleControl as WPToggleControl, ItemGroup as WPItemGroup, Item as WPItem } from '@wordpress/components';
import { useToast } from 'os/shell';

const BASE = '/activity/v1/apps';

// Inline styles for the track/thumb: the arbitrary Tailwind values
// (translate-x-[18px], the muted-foreground/30 tint) aren't in the precompiled
// build, so we style them directly rather than rely on no-op classes.
// Native WPDS toggle. Wrapped so a click on the switch doesn't also toggle the
// surrounding (clickable) app-card row; label is accessible but visually hidden
// (the ability id / app name already labels the row).
function Toggle({ on, onChange, disabled, label }) {
  return h`<span onClick=${(e) => e.stopPropagation()} style=${{ display: 'inline-flex' }}>
    <${WPToggleControl}
      __nextHasNoMarginBottom=${true}
      checked=${!!on}
      disabled=${disabled}
      onChange=${(v) => onChange(v)}
      aria-label=${label || 'Toggle'}
    />
  </span>`;
}

// The build-an-app guide, shown on the "How to create" tab (always expanded).
function HowToCreatePanel({ dir }) {
  return h`<div className="text-sm text-muted-foreground space-y-3">
    <p>Drop a <code className="font-mono bg-muted px-1 rounded">.js</code> file in <code className="font-mono bg-muted px-1 rounded">${dir}</code>. It's a native ES module (no build step) that self-registers on import using the Context registry:</p>
    <pre className="text-xs font-mono whitespace-pre-wrap bg-muted rounded-md p-3 text-foreground">${`import { h, rest, registerRoute, registerNavRow } from 'os/core';

function MyAppPage() {
  return h\`<div className="p-8">Hello from my app</div>\`;
}

registerRoute('/my-app', h\`<\${MyAppPage} />\`);
registerNavRow({ key: 'my-app', label: 'My App', icon: 'star', path: '/my-app' });`}</pre>
    <ul className="list-disc pl-5 space-y-1 text-xs">
      <li><code className="font-mono bg-muted px-1 rounded">registerRoute(path, element)</code> — a screen</li>
      <li><code className="font-mono bg-muted px-1 rounded">registerNavRow({key,label,icon,path})</code> — a sidebar entry</li>
      <li><code className="font-mono bg-muted px-1 rounded">registerEditor(key, render, {selectable})</code> — a content-type editor</li>
      <li>Server abilities (ci/*) are exposed over MCP and managed on the Manage tab. New PHP abilities register via the Abilities API.</li>
    </ul>
    <p>Your module then appears on the <strong>Manage</strong> tab as a <strong>sideloaded</strong> app you can enable or disable.</p>
  </div>`;
}

function AppsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = location.pathname.replace(/\/+$/, '').endsWith('/create') ? 'create' : 'manage';
  const [apps, setApps] = useState(null);
  const [dir, setDir] = useState('uploads/os-apps/');
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    try {
      const d = await rest(BASE);
      setApps(d.apps || []);
      if (d.sideload_dir) setDir(d.sideload_dir);
    } catch (e) { toast?.error('Load failed', String(e.message || e)); setApps([]); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggleAbility = useCallback(async (appId, ability, next) => {
    setApps((list) => list.map((a) => a.id !== appId ? a : { ...a, abilities: a.abilities.map((ab) => ab.id === ability ? { ...ab, enabled: next } : ab) }));
    try { await rest(`${BASE}/ability`, { method: 'POST', body: JSON.stringify({ ability, enabled: next }) }); }
    catch (e) { toast?.error('Failed', String(e.message || e)); load(); }
  }, [toast, load]);

  const toggleApp = useCallback(async (appId, next) => {
    setApps((list) => list.map((a) => a.id === appId ? { ...a, enabled: next } : a));
    try {
      await rest(`${BASE}/enabled`, { method: 'POST', body: JSON.stringify({ id: appId, enabled: next }) });
      toast?.success(next ? 'App enabled' : 'App disabled', 'Reload the page to apply module loading changes.');
    } catch (e) { toast?.error('Failed', String(e.message || e)); load(); }
  }, [toast, load]);

  const AppHeader = CIRegistry.AppHeader;
  const tabs = h`<${SegmentedToggle} value=${tab} ariaLabel="Apps view"
    onChange=${(t) => navigate(t === 'create' ? '/apps/create' : '/apps')}
    options=${[{ key: 'manage', label: 'Manage' }, { key: 'create', label: 'How to create' }]} />`;
  if (!apps) return h`<div className="absolute inset-0 flex flex-col pt-14"><${AppHeader} title="Apps" icon="store" actions=${tabs} /><div className="flex-1 min-h-0 overflow-y-auto"><div className="p-10 mx-auto w-full max-w-4xl"><${Spinner} /></div></div></div>`;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Apps" icon="store" actions=${tabs} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className="p-6 md:p-10 mx-auto w-full max-w-4xl space-y-4 pb-24">
      ${tab === 'create'
        ? h`<${PageHeading} icon="file-circle-plus" title="How to create an app"
              description="Sideload a self-registering ES module. No build step." />
            <${HowToCreatePanel} dir=${dir} />`
        : h`<${PageHeading} icon="store" title="Apps"
              description="Context apps and the MCP abilities each exposes. Turning an ability off removes it from the MCP tools list immediately." />

          <div className="space-y-3">
        ${apps.map((app) => {
          const enabledCount = app.abilities.filter((a) => a.enabled).length;
          const isOpen = !!expanded[app.id];
          const hasAbilities = app.abilities.length > 0;
          return h`<${Card} key=${app.id} className="p-0">
            <div
              onClick=${() => hasAbilities && setExpanded((m) => ({ ...m, [app.id]: !m[app.id] }))}
              className=${`flex items-start gap-3 p-4 ${hasAbilities ? 'cursor-pointer hover:bg-muted' : ''} ${isOpen && hasAbilities ? 'border-b border-border' : ''}`}>
              ${hasAbilities
                ? h`<${Icon} name=${isOpen ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 mt-2 text-muted-foreground/60 shrink-0" />`
                : h`<span className="w-3 shrink-0" />`}
              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                <${Icon} name=${app.icon || 'puzzle-piece'} className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">${app.name}</span>
                  <${Badge}>${app.source}</${Badge}>
                  ${hasAbilities ? h`<span className="text-xs text-muted-foreground">${enabledCount}/${app.abilities.length} abilities on</span>` : null}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">${app.description}</p>
              </div>
              ${app.can_disable
                ? h`<div className="shrink-0 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">${app.enabled ? 'Enabled' : 'Disabled'}</span>
                    <${Toggle} on=${app.enabled} onChange=${(v) => toggleApp(app.id, v)} label=${`Enable ${app.name}`} />
                  </div>`
                : null}
            </div>
            ${isOpen && hasAbilities
              ? h`<${WPItemGroup}>
                  ${app.abilities.map((ab) => h`<${WPItem} key=${ab.id} size="small">
                    <div className="flex items-center gap-3 w-full">
                      <code className="font-mono text-xs text-foreground flex-1 truncate">${ab.id}</code>
                      <${Toggle} on=${ab.enabled} onChange=${(v) => toggleAbility(app.id, ab.id, v)} label=${ab.id} />
                    </div>
                  </${WPItem}>`)}
                </${WPItemGroup}>`
              : null}
          </${Card}>`;
        })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">Sideload a new app by dropping a <code className="font-mono bg-muted px-1 rounded">.js</code> module in <code className="font-mono bg-muted px-1 rounded">${dir}</code>. See the How to create tab.</p>`}
    </div>
    </div>
  </div>`;
}

registerRoute('/apps', h`<${AppsPage} />`);
registerRoute('/apps/create', h`<${AppsPage} />`);
registerNavRow({
  adminMenu: true,
  key: 'apps',
  label: 'Apps',
  icon: 'store',
  path: '/apps',
  order: 12,
  match: (p) => p === '/apps' || p.startsWith('/apps/'),
});
