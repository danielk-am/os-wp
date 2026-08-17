/**
 * Context App — Notifications center (self-contained leaf module).
 *
 * A unified alert tray over the signals scattered across subsystems: circuit-
 * breaker trips (a PHP snippet fataled), failed/known automation runs, failed
 * ability calls, and reminders that fired. Reads one endpoint
 * (GET /notifications); a per-user "last read" marker drives the unread count,
 * shown as a live badge on the nav row.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { h, rest, registerRoute, registerNavRow, setNavBadge, CIRegistry } from 'ci/core';
import { Icon, Card, Button, Badge, Spinner, PageHeading, LogTable } from 'ci/ui';
import { useToast } from 'ci/shell';

const FEED = '/activity/v1/notifications';

function rel(ts, now) {
  if (!ts) return '';
  const d = now - ts;
  const f = (n, u) => `${n} ${u}${n === 1 ? '' : 's'} ago`;
  return d < 60 ? 'just now' : d < 3600 ? f(Math.round(d / 60), 'min') : d < 86400 ? f(Math.round(d / 3600), 'hour') : f(Math.round(d / 86400), 'day');
}

const SEV = {
  error:   { dot: 'bg-red-500',     icon: 'bolt',  label: 'Error' },
  warning: { dot: 'bg-amber-500',   icon: 'flag',  label: 'Warning' },
  info:    { dot: 'bg-blue-500',    icon: 'check', label: 'Info' },
};

// The alert tray as a DataViews table — search over title + detail, severity /
// source / read-state filters, sortable time — matching the log lists on the
// Activity page. Rows with a `link` stay clickable (navigate on click).
function NotificationsTable({ items, readAt, now }) {
  const navigate = useNavigate();
  const rows = useMemo(
    () => items.map((it) => ({ ...it, _id: String(it.id), unread: it.t > readAt })),
    [items, readAt]
  );
  const fields = useMemo(() => {
    const sources = [...new Set(rows.map((r) => String(r.source || '')))].filter(Boolean).sort();
    const sevs = [...new Set(rows.map((r) => String(r.severity || '')))].filter(Boolean).sort();
    return [
      {
        id: 'title', label: 'Notification', enableHiding: false, enableGlobalSearch: true,
        getValue: ({ item }) => `${item.title || ''} ${item.detail || ''}`.trim(),
        render: ({ item }) => {
          const sev = SEV[item.severity] || SEV.info;
          return h`<span className="flex items-start gap-2 min-w-0">
            <span className=${`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${sev.dot}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className=${`ci-cell-text ${item.unread ? 'font-semibold' : ''}`} style=${item.unread ? undefined : { fontWeight: 400 }}>${item.title}</span>
                ${item.unread ? h`<span className="shrink-0 text-[10px] uppercase tracking-wider text-blue-500 font-semibold">new</span>` : null}
              </span>
              ${item.detail ? h`<span className="ci-cell-text text-xs text-muted-foreground" style=${{ fontWeight: 400 }}>${item.detail}</span>` : null}
            </span>
          </span>`;
        },
      },
      {
        // Filter-only: the dot on the title cell already shows severity per row.
        id: 'severity', label: 'Severity',
        elements: sevs.map((v) => ({ value: v, label: (SEV[v] || SEV.info).label })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => String(item.severity || ''),
      },
      {
        id: 'read', label: 'Read state',
        elements: [{ value: 'new', label: 'New' }, { value: 'read', label: 'Read' }],
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => (item.unread ? 'new' : 'read'),
      },
      {
        id: 'source', label: 'Source',
        elements: sources.map((v) => ({ value: v, label: v })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => String(item.source || ''),
        render: ({ item }) => h`<${Badge}>${item.source}</${Badge}>`,
      },
      {
        id: 't', label: 'When', enableSorting: true,
        getValue: ({ item }) => item.t || 0,
        render: ({ item }) => h`<span className="text-muted-foreground tabular-nums" style=${{ whiteSpace: 'nowrap' }}
          title=${item.t ? new Date(item.t * 1000).toLocaleString() : ''}>${rel(item.t, now)}</span>`,
      },
    ];
  }, [rows, now]);
  return h`<${LogTable} rows=${rows} fields=${fields} searchLabel="Search notifications…"
    initialView=${{ sort: { field: 't', direction: 'desc' }, titleField: 'title', fields: ['source', 't'] }}
    onClickItem=${(it) => { if (it && it.link) navigate(it.link); }}
    isItemClickable=${(it) => !!(it && it.link)} />`;
}

function NotificationsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await rest(FEED);
      setData(d);
      setNavBadge('notifications', d.unread_count > 0 ? d.unread_count : '');
    } catch (e) { /* surfaced on first paint */ setData({ items: [], unread_count: 0, read_at: 0, server_time: Math.floor(Date.now() / 1000) }); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const markRead = useCallback(async () => {
    setBusy(true);
    try {
      const r = await rest(`${FEED}/read`, { method: 'POST' });
      setData((d) => ({ ...d, read_at: r.read_at, unread_count: 0 }));
      setNavBadge('notifications', '');
      toast?.success('All caught up', 'Marked everything as read.');
    } catch (e) { toast?.error('Failed', String(e.message || e)); }
    finally { setBusy(false); }
  }, [toast]);

  const AppHeader = CIRegistry.AppHeader;

  if (!data) return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Notifications" icon="flag" />
    <div className="flex-1 min-h-0 overflow-y-auto"><div className="p-10 mx-auto w-full max-w-4xl"><${Spinner} /></div></div>
  </div>`;

  const now = data.server_time || Math.floor(Date.now() / 1000);
  const items = data.items || [];
  const readAt = data.read_at || 0;

  // Unread count + "Mark all read" live in the top bar's actions zone, so the
  // page matches the rest of ci > * (Apps, csv, skills) which all use AppHeader.
  const headerActions = [
    data.unread_count > 0 ? h`<span key="badge" style=${{ minWidth: '1.25rem' }} className="h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-semibold">${data.unread_count}</span>` : null,
    items.length ? h`<${Button} key="read" variant="secondary" disabled=${busy || data.unread_count === 0} onClick=${markRead}>Mark all read</${Button}>` : null,
  ];

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Notifications" icon="flag" actions=${headerActions} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className="p-6 md:p-10 mx-auto w-full max-w-4xl space-y-6 pb-24">
    <${PageHeading} icon="flag" title="Notifications"
      description="Alerts from across Context — circuit-breaker trips, automations, ability failures, and reminders." />

    ${items.length === 0
      ? h`<${Card} className="p-8 text-center text-sm text-muted-foreground">
          <div className="w-10 h-10 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center"><${Icon} name="check" className="w-5 h-5 text-emerald-600" /></div>
          Nothing needs your attention. Failures, fired reminders, and disabled snippets will show up here.
        </${Card}>`
      : h`<${NotificationsTable} items=${items} readAt=${readAt} now=${now} />`}
    </div>
    </div>
  </div>`;
}

registerRoute('/notifications', h`<${NotificationsPage} />`);
registerNavRow({
  adminMenu: true,
  key: 'notifications',
  label: 'Notifications',
  icon: 'flag',
  path: '/notifications',
  order: 11,
  match: (p) => p === '/notifications',
});

// The unread nav-row badge is polled by the shell (see LAZY_APPS in
// context-app.js) so it works before this module loads; the page itself
// refreshes the feed on its own interval while open.
