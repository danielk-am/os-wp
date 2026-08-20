/**
 * Context App — Activity Monitor (self-contained leaf module).
 *
 * The "Activity Monitor" for the Context-as-OS metaphor: one screen that
 * shows what's *running* on the site — recent ability invocations (the
 * syscall stream agents + MCP go through), the cron schedule (daemons),
 * automation run history, reminder pressure, and the agent roster.
 *
 * Self-registers on import:
 *   - the `/activity` route (rendered inside the app Shell), and
 *   - a top-level nav row (CIRegistry.navRows) via registerNavRow — the
 *     first consumer of the new nav registry, so it sits flush-left next to
 *     Calendar / Content Types with no type-layer changes.
 *
 * Reads one endpoint: GET /activity/v1/activity (polled while the
 * page is open). No build step — native ES module; specifiers via importmap.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { h, BOOT, rest, registerRoute, registerNavRow, CIRegistry } from 'os/core';
import { Icon, Card, Badge, Spinner, Button, PageHeading, LogTable, LiveBadge } from 'os/ui';

const FEED = '/activity/v1/activity';

// Relative "x ago" / "in x" against the server clock so client skew doesn't
// make a just-fired job read as minutes old.
function rel(ts, now) {
  if (!ts) return '—';
  const d = now - ts;
  const fmt = (n, u) => `${n} ${u}${n === 1 ? '' : 's'}`;
  const span = (s) => s < 60 ? fmt(s, 'sec') : s < 3600 ? fmt(Math.round(s / 60), 'min') : s < 86400 ? fmt(Math.round(s / 3600), 'hour') : fmt(Math.round(s / 86400), 'day');
  return d >= 0 ? `${span(d)} ago` : `in ${span(-d)}`;
}

function StatCard({ icon, label, value, tone = 'text-foreground' }) {
  return h`<${Card} className="p-4">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
        <${Icon} name=${icon} className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className=${`text-xl font-semibold leading-none ${tone}`}>${value}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate">${label}</div>
      </div>
    </div>
  </${Card}>`;
}

function Section({ title, count, children }) {
  return h`<section className="space-y-3">
    <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
      ${title}
      ${count != null ? h`<span className="text-xs font-normal text-muted-foreground">${count}</span>` : null}
    </h2>
    ${children}
  </section>`;
}

function OkDot({ ok }) {
  return h`<span className=${`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden="true" />`;
}

// Dot colour for a site-activity event: additive (green), removing/disabling
// (amber), everything else (blue).
function eventTone(type) {
  const t = String(type || '');
  if (t.indexOf('published') >= 0 || t.indexOf('register') >= 0) return 'bg-emerald-500';
  if (t.indexOf('trashed') >= 0 || t.indexOf('unpublished') >= 0 || t.indexOf('deactivated') >= 0) return 'bg-amber-500';
  return 'bg-blue-500';
}

// "post_published" → "post published" for the type filter + column chip.
function typeLabel(type) {
  return String(type || '').replace(/_/g, ' ');
}

// Shared "x ago" cell with the absolute timestamp on hover.
function WhenCell({ ts, now, text }) {
  return h`<span className="text-muted-foreground tabular-nums" style=${{ whiteSpace: 'nowrap' }}
    title=${ts ? new Date(ts * 1000).toLocaleString() : ''}>${text != null ? text : rel(ts, now)}</span>`;
}

// Site activity — search over summary + actor, type/actor filters, sortable time.
function EventsTable({ events, now }) {
  // Ring-buffer rows carry no id; synthesise one for getItemId/React keys.
  const rows = useMemo(() => events.map((e, i) => ({ ...e, _id: `${e.t}.${i}` })), [events]);
  const fields = useMemo(() => {
    const uniq = (key) => [...new Set(rows.map((r) => String(r[key] || '')))].filter(Boolean).sort();
    return [
      {
        id: 'summary', label: 'Event', enableHiding: false, enableGlobalSearch: true,
        getValue: ({ item }) => item.summary || '',
        render: ({ item }) => h`<span className="flex items-center gap-2 min-w-0">
          <span className=${`inline-block w-2 h-2 rounded-full shrink-0 ${eventTone(item.type)}`} aria-hidden="true" />
          <span className="os-cell-text" style=${{ fontWeight: 400 }}>${item.summary}</span>
        </span>`,
      },
      {
        id: 'type', label: 'Type',
        elements: uniq('type').map((v) => ({ value: v, label: typeLabel(v) })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => String(item.type || ''),
        render: ({ item }) => h`<${Badge}>${typeLabel(item.type)}</${Badge}>`,
      },
      {
        id: 'actor', label: 'Actor', enableGlobalSearch: true,
        elements: uniq('actor').map((v) => ({ value: v, label: v })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => item.actor || '',
        render: ({ item }) => h`<span className="text-muted-foreground">${item.actor}</span>`,
      },
      {
        id: 't', label: 'When', enableSorting: true,
        getValue: ({ item }) => item.t || 0,
        render: ({ item }) => h`<${WhenCell} ts=${item.t} now=${now} />`,
      },
    ];
  }, [rows, now]);
  return h`<${LogTable} rows=${rows} fields=${fields} searchLabel="Search activity…"
    initialView=${{ sort: { field: 't', direction: 'desc' }, titleField: 'summary', fields: ['actor', 't'] }} />`;
}

// Scheduled jobs — the ci_* cron hooks, schedule filter, soonest first.
function CronTable({ cron, now }) {
  const rows = useMemo(() => cron.map((c, i) => ({ ...c, _id: `${c.hook}.${c.next}.${i}` })), [cron]);
  const fields = useMemo(() => {
    const scheds = [...new Set(rows.map((r) => String(r.label || r.schedule || '')))].filter(Boolean).sort();
    return [
      {
        id: 'hook', label: 'Hook', enableHiding: false, enableGlobalSearch: true,
        getValue: ({ item }) => item.hook || '',
        render: ({ item }) => h`<code className="font-mono text-xs text-foreground">${item.hook}</code>`,
      },
      {
        id: 'schedule', label: 'Schedule',
        elements: scheds.map((v) => ({ value: v, label: v })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => String(item.label || item.schedule || ''),
        render: ({ item }) => h`<${Badge}>${item.label || item.schedule}</${Badge}>`,
      },
      {
        id: 'next', label: 'Next run', enableSorting: true,
        getValue: ({ item }) => item.next || 0,
        render: ({ item }) => h`<${WhenCell} ts=${item.next} now=${now}
          text=${item.next > now ? `next ${rel(item.next, now)}` : 'due now'} />`,
      },
    ];
  }, [rows, now]);
  return h`<${LogTable} rows=${rows} fields=${fields} searchLabel="Search jobs…"
    initialView=${{ sort: { field: 'next', direction: 'asc' }, titleField: 'hook', fields: ['schedule', 'next'] }} />`;
}

// Automations — status filter, run counts, the recent-run dots, last run.
function AutomationsTable({ autos, now }) {
  const rows = useMemo(() => autos.map((a) => ({ ...a, _id: String(a.id) })), [autos]);
  const fields = useMemo(() => {
    const statuses = [...new Set(rows.map((r) => String(r.status || '')))].filter(Boolean).sort();
    return [
      {
        id: 'title', label: 'Automation', enableHiding: false, enableGlobalSearch: true,
        getValue: ({ item }) => item.title || '',
      },
      {
        id: 'status', label: 'Status',
        elements: statuses.map((v) => ({ value: v, label: v })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => String(item.status || ''),
        render: ({ item }) => h`<${Badge}>${item.status}</${Badge}>`,
      },
      {
        id: 'run_count', label: 'Runs', enableSorting: true,
        getValue: ({ item }) => item.run_count || 0,
      },
      {
        id: 'recent', label: 'Recent runs', enableSorting: false,
        getValue: ({ item }) => (item.runs || []).length,
        render: ({ item }) => (item.runs && item.runs.length)
          ? h`<span className="inline-flex items-center gap-1.5" title="recent runs (newest right)">
              ${item.runs.slice().reverse().map((r, i) => h`<${OkDot} key=${i} ok=${r.ok} />`)}
            </span>`
          : h`<span className="text-muted-foreground">—</span>`,
      },
      {
        id: 'last_run', label: 'Last run', enableSorting: true,
        getValue: ({ item }) => item.last_run || 0,
        render: ({ item }) => h`<${WhenCell} ts=${item.last_run} now=${now}
          text=${item.last_run ? rel(item.last_run, now) : 'never run'} />`,
      },
    ];
  }, [rows, now]);
  return h`<${LogTable} rows=${rows} fields=${fields} searchLabel="Search automations…"
    initialView=${{ sort: { field: 'last_run', direction: 'desc' }, titleField: 'title', fields: ['status', 'run_count', 'recent', 'last_run'] }} />`;
}

// Recent ability calls — result/user filters, sortable duration + time.
function InvocationsTable({ inv, now }) {
  const rows = useMemo(() => inv.map((r, i) => ({ ...r, _id: `${r.t}.${i}` })), [inv]);
  const fields = useMemo(() => {
    const users = [...new Set(rows.map((r) => String(r.user || '')))].filter(Boolean).sort();
    return [
      {
        id: 'ability', label: 'Ability', enableHiding: false, enableGlobalSearch: true,
        getValue: ({ item }) => item.id || '',
        render: ({ item }) => h`<span className="flex items-center gap-2 min-w-0">
          <${OkDot} ok=${item.ok} />
          <code className="font-mono text-xs text-foreground">${item.id}</code>
        </span>`,
      },
      {
        // Filter-only field (not a default column): the dot on the ability
        // cell already shows the result per row.
        id: 'ok', label: 'Result',
        elements: [{ value: 'ok', label: 'ok' }, { value: 'failed', label: 'failed' }],
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => (item.ok ? 'ok' : 'failed'),
      },
      {
        id: 'user', label: 'User', enableGlobalSearch: true,
        elements: users.map((v) => ({ value: v, label: v })),
        filterBy: { operators: ['isAny'] },
        getValue: ({ item }) => item.user || '',
        render: ({ item }) => h`<span className="text-muted-foreground">${item.user}</span>`,
      },
      {
        id: 'ms', label: 'Duration', enableSorting: true,
        getValue: ({ item }) => item.ms || 0,
        render: ({ item }) => h`<span className="text-muted-foreground tabular-nums">${item.ms}ms</span>`,
      },
      {
        id: 't', label: 'When', enableSorting: true,
        getValue: ({ item }) => item.t || 0,
        render: ({ item }) => h`<${WhenCell} ts=${item.t} now=${now} />`,
      },
    ];
  }, [rows, now]);
  return h`<${LogTable} rows=${rows} fields=${fields} searchLabel="Search calls…"
    initialView=${{ sort: { field: 't', direction: 'desc' }, titleField: 'ability', fields: ['user', 'ms', 't'] }} />`;
}

// The activity log shows WHAT changed; VaultPress Backup is how you roll it
// back. Upsell card — links out to Jetpack.
function VaultPressUpsell() {
  return h`<${Card} className="p-0 overflow-hidden">
    <div className="flex items-start gap-4 p-5 border-l-4 border-emerald-500">
      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
        <${Icon} name="shield" className="w-5 h-5 text-emerald-600" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">Roll back, not just look back</h3>
        <p className="text-sm text-muted-foreground mt-1">
          This log shows <em>what</em> changed. <strong>Jetpack VaultPress Backup</strong> lets you <strong>restore</strong> to any point in it — real-time off-site backups with one-click rewind, even from your phone.
        </p>
        <a href="https://jetpack.com/upgrade/backup/" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-emerald-700 no-underline hover:underline">
          Explore Jetpack VaultPress Backup ↗
        </a>
      </div>
    </div>
  </${Card}>`;
}

function ActivityPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await rest(`${FEED}?limit=80`);
      setData(d);
      setError('');
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  useEffect(() => {
    load();
    // Poll while the page is mounted. 5s is responsive without hammering;
    // pauses when the tab is hidden to avoid background churn.
    const tick = () => { if (!document.hidden) load(); };
    timer.current = setInterval(tick, 5000);
    return () => clearInterval(timer.current);
  }, [load]);

  const clearLog = useCallback(async () => {
    setBusy(true);
    try { await rest(`${FEED}/log`, { method: 'DELETE' }); await load(); }
    finally { setBusy(false); }
  }, [load]);

  const AppHeader = CIRegistry.AppHeader;
  // Live-refresh indicator sits in the top bar's right-hand actions zone,
  // matching the rest of ci > * (Apps, csv, skills) which all use AppHeader.
  const refreshDot = h`<${LiveBadge} label="Live" title="Auto-refreshes every 5 seconds while open" />`;

  if (!data && !error) {
    return h`<div className="absolute inset-0 flex flex-col pt-14">
      <${AppHeader} title="Activity" icon="bolt" actions=${refreshDot} />
      <div className="flex-1 min-h-0 overflow-y-auto"><div className="p-10 mx-auto w-full max-w-6xl"><${Spinner} /></div></div>
    </div>`;
  }

  const now = data?.server_time || Math.floor(Date.now() / 1000);
  const events = data?.events || [];
  const inv = data?.invocations || [];
  const cron = data?.cron || [];
  const autos = data?.automations || [];
  const rem = data?.reminders || { pending: 0, done: 0, next_run: 0 };
  const agents = data?.agents || [];
  const okCount = inv.filter((i) => i.ok).length;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${AppHeader} title="Activity" icon="bolt" actions=${refreshDot} />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className="p-6 md:p-10 mx-auto w-full max-w-6xl space-y-8 pb-24">
    <${PageHeading} icon="bolt" title="Activity"
      description=${`An activity log for ${BOOT.site_name || 'this site'} — what changed (content, plugins, logins) plus the live automation, cron, and ability streams.`} />

    ${error ? h`<${Card} className="p-4 text-sm text-red-600">Couldn't load activity: ${error}</${Card}>` : null}

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <${StatCard} icon="clipboard" label="site events logged" value=${events.length} />
      <${StatCard} icon="bolt" label="ability calls" value=${inv.length} />
      <${StatCard} icon="calendar" label="reminders pending" value=${rem.pending} />
      <${StatCard} icon="paw" label="agents" value=${agents.length} />
    </div>

    <${Section} title="Site activity" count=${events.length || null}>
      ${events.length === 0
        ? h`<${Card} className="p-4 text-sm text-muted-foreground">No site events yet. Publishing a post, toggling a plugin, switching theme, or signing in will appear here.</${Card}>`
        : h`<${EventsTable} events=${events} now=${now} />`}
    </${Section}>

    <${Section} title="Scheduled jobs" count=${cron.length ? `${cron.length} daemon${cron.length === 1 ? '' : 's'}` : null}>
      ${cron.length === 0
        ? h`<${Card} className="p-4 text-sm text-muted-foreground">No Context cron events scheduled.</${Card}>`
        : h`<${CronTable} cron=${cron} now=${now} />`}
    </${Section}>

    <${Section} title="Automations" count=${autos.length || null}>
      ${autos.length === 0
        ? h`<${Card} className="p-4 text-sm text-muted-foreground">No automations defined yet.</${Card}>`
        : h`<${AutomationsTable} autos=${autos} now=${now} />`}
    </${Section}>

    <${Section} title="Recent ability calls" count=${inv.length ? `${okCount}/${inv.length} ok` : null}>
      <div className="flex items-center justify-end -mt-9 mb-1">
        ${inv.length ? h`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${clearLog}>Clear log</${Button}>` : null}
      </div>
      ${inv.length === 0
        ? h`<${Card} className="p-4 text-sm text-muted-foreground">No ability calls recorded yet. They appear here as agents (and MCP clients) invoke ci/* tools.</${Card}>`
        : h`<${InvocationsTable} inv=${inv} now=${now} />`}
    </${Section}>

    <${Section} title="Recommendations">
      <${VaultPressUpsell} />
    </${Section}>
    </div>
    </div>
  </div>`;
}

registerRoute('/activity', h`<${ActivityPage} />`);
registerNavRow({
  adminMenu: true,
  key: 'activity',
  label: 'Activity',
  icon: 'bolt',
  path: '/activity',
  order: 10,
  match: (p) => p === '/activity' || p.indexOf('/activity') === 0,
});
