/**
 * Content type app — Menus & icons (self-contained leaf module).
 *
 * Where every OS type sits in the admin sidebar: menu label, icon, and
 * position, for built-in and user-defined types alike. Reads and writes
 * `content-types/v1/type-menus`; the shared admin runtime applies the saved
 * overrides when it builds the menus, so a save lands on the next page load.
 *
 * The icon picker is a searchable combobox over two sets: the Font Awesome
 * glyphs bundled with the plugin (rendered as SVG data URIs, same pipeline as
 * the sidebar itself) and every dashicon the running WordPress ships.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect } from 'react';
import { h, rest, registerRoute } from 'ci/core';
import { PageHeading, Spinner } from 'ci/ui';
import { Button, ComboboxControl, TextControl } from '@wordpress/components';
import { useToast } from 'ci/shell';

const BASE = '/content-types/v1/type-menus';

// One preview cell: an <img> for a Font Awesome data URI, a dashicon span for
// a dashicon, empty for "module default".
function IconPreview({ value, faIcons }) {
  if (value && value.startsWith('fa-') && faIcons[value.slice(3)]) {
    return h`<img src=${faIcons[value.slice(3)]} alt="" style=${{ width: 20, height: 20 }} />`;
  }
  if (value && value.startsWith('dashicons-')) {
    return h`<span className=${'dashicons ' + value} style=${{ fontSize: 20 }}></span>`;
  }
  return null;
}

function TypeMenusPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    rest(BASE).then((payload) => {
      setData(payload);
      const initial = {};
      for (const row of payload.types) {
        initial[row.type] = { label: row.label, icon: row.icon, position: row.position };
      }
      setRows(initial);
    }).catch((e) => toast(`Could not load type menus: ${e.message}`, 'error'));
  }, []);

  if (!data) {
    return h`<div className="p-8"><${Spinner} /></div>`;
  }

  // Options for the combobox: both sets, prefixed so the stored value is
  // unambiguous. ComboboxControl filters as you type, so 417 options stay
  // usable without any custom search code.
  const iconOptions = [
    { value: '', label: 'Module default' },
    ...data.icon_sets.fa.map((name) => ({ value: 'fa-' + name, label: `${name} (Font Awesome)` })),
    ...data.icon_sets.dashicons.map((name) => ({ value: 'dashicons-' + name, label: `${name} (Dashicons)` })),
  ];

  const update = (type, field, value) =>
    setRows((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      await rest(BASE, { method: 'POST', body: JSON.stringify({ menus: rows }) });
      toast('Menus updated. Reload to see the sidebar change.', 'success');
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return h`<div className="p-8 max-w-4xl">
    <${PageHeading} icon="cube" title="Menus & icons"
      subtitle="Where each type sits in the sidebar. Leave a field empty to keep the module's default; lower positions sit higher." />
    <div className="mt-6 space-y-2">
      ${data.types.map((row) => {
        const value = rows[row.type] || {};
        return h`<div key=${row.type} className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3">
          <div style=${{ width: 200 }}>
            <div className="font-medium text-sm">${row.plural}</div>
            <code className="text-xs text-muted-foreground">${row.type}</code>
          </div>
          <div style=${{ width: 170 }}>
            <${TextControl} __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true}
              label="Menu label" hideLabelFromVision=${true}
              placeholder=${row.plural}
              value=${value.label || ''}
              onChange=${(v) => update(row.type, 'label', v)} />
          </div>
          <div style=${{ width: 24, textAlign: 'center' }}>
            <${IconPreview} value=${value.icon} faIcons=${data.icon_uris} />
          </div>
          <div style=${{ width: 260 }}>
            <${ComboboxControl} __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true}
              label="Icon" hideLabelFromVision=${true}
              options=${iconOptions}
              value=${value.icon || ''}
              onChange=${(v) => update(row.type, 'icon', v || '')} />
          </div>
          <div style=${{ width: 90 }}>
            <${TextControl} __nextHasNoMarginBottom=${true} __next40pxDefaultSize=${true}
              label="Position" hideLabelFromVision=${true}
              placeholder="auto"
              value=${value.position || ''}
              onChange=${(v) => update(row.type, 'position', v)} />
          </div>
        </div>`;
      })}
    </div>
    <div className="mt-6">
      <${Button} variant="primary" isBusy=${saving} onClick=${save}>Save menus</${Button}>
    </div>
    <p className="mt-4 text-xs text-muted-foreground">
      Font Awesome icons are the set bundled with the plugin; Dashicons are everything this WordPress ships.
      Fields for each type live under its own Manage screen.
    </p>
  </div>`;
}

registerRoute('/type-menus', h`<${TypeMenusPage} />`);
