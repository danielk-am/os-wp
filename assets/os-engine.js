/**
 * Context Engine — the field-group / taxonomy / validation layer shared by the
 * Type layer (StructureEditorPage builder + the generic CptEditorPage). Holds
 * the field-type vocabulary, conditional-logic evaluator, column-width map, and
 * the two data-bound pickers (Relationship + Taxonomy). Depends only on
 * `ci/core` (h, BOOT, rest, decodeEntities), React hooks, and the WPDS
 * FormTokenField — NO shell coupling (toast/dialog/nav), so it can stand alone.
 *
 * (FgTermManager stays in the main bundle for now — it needs the toast hook,
 * which moves to Core in a later pass.)
 *
 * No build step — hand-authored native ES module; bare specifiers resolve via
 * the importmap.
 */
import { useState, useEffect, useRef } from 'react';
import { FormTokenField as WPFormTokenField } from '@wordpress/components';
import { h, BOOT, rest, decodeEntities } from 'os/core';

export const FG_FIELD_TYPES = [
  ['text', 'Text'], ['textarea', 'Text area'], ['richtext', 'Rich text (Gutenberg)'],
  ['number', 'Number'], ['checkbox', 'Checkbox'], ['select', 'Select'], ['date', 'Date'], ['datetime', 'Date & time'], ['url', 'URL'], ['image', 'Image'],
  ['relationship', 'Relationship'], ['list', 'List'], ['repeater', 'Repeater'],
  ['heading', 'Section heading'], ['tab', 'Tab'], ['notice', 'Notice'], ['progress', 'Progress bar'],
];
// Presentational/layout blocks store no meta — they shape the editor only.
// `progress` is computed (child rollup), so it stores nothing either.
export const FG_PRESENTATIONAL = new Set(['heading', 'tab', 'notice', 'progress']);
// Field width → 12-column span. Stored as a percentage; mapped to grid cols.
export const FG_WIDTHS = [['25', 'Quarter'], ['33', 'Third'], ['50', 'Half'], ['66', 'Two-thirds'], ['75', 'Three-quarters'], ['100', 'Full']];
export const fgCols = (w) => ({ 25: 3, 33: 4, 50: 6, 66: 8, 75: 9, 100: 12 }[Number(w) || 50] || 6);
let __fgUid = 0;
export const fgWithId = (f) => ({ __id: f.__id || ('f' + (++__fgUid)), ...f });
export const fgStrip = ({ __id, ...rest }) => rest;
export const FG_COND_OPS = [
  ['equals', 'is'], ['not_equals', 'is not'],
  ['contains', 'contains'], ['not_empty', 'has any value'], ['empty', 'is empty'],
];

// Evaluate a field's conditional-logic rule against the current values.
// Returns true (show) when there's no rule. Hidden fields keep their stored
// value (ACF behaviour) — we only gate rendering, never strip on save.
export function evalConditional(cond, values) {
  if (!cond || !Array.isArray(cond.rules) || !cond.rules.length) return true;
  const test = (r) => {
    const v = values ? values[r.field] : undefined;
    const sv = Array.isArray(v) ? v.join(',') : String(v ?? '');
    switch (r.op) {
      case 'empty': return sv === '' || sv === '0' || v === false;
      case 'not_empty': return !(sv === '' || sv === '0' || v === false);
      case 'not_equals': return sv !== String(r.value ?? '');
      case 'contains': return sv.toLowerCase().includes(String(r.value ?? '').toLowerCase());
      case 'equals': default: return sv === String(r.value ?? '');
    }
  };
  return cond.logic === 'or' ? cond.rules.some(test) : cond.rules.every(test);
}

// Distinct CPT options for relationship target pickers (dedupe types that
// share a CPT).
export function fgCptOptions() {
  const seen = new Set();
  const out = [{ label: 'Select a post type…', value: '' }];
  for (const m of Object.values(BOOT.types || {})) {
    if (!m || !m.cpt || seen.has(m.cpt)) continue;
    seen.add(m.cpt);
    out.push({ label: `${m.label} (${m.cpt})`, value: m.cpt });
  }
  return out;
}

// Relationship field — search + pick related posts from a target CPT.
// Stores post IDs; tokens display resolved titles via an id→title cache.
export function RelationshipField({ field, value, onChange }) {
  const base = field.target_rest_base || field.target_cpt;
  const ids = Array.isArray(value) ? value : (value ? [value] : []);
  const [cache, setCache] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const timer = useRef(null);
  const idKey = ids.join(',');

  useEffect(() => {
    const missing = ids.filter((id) => id && !(id in cache));
    if (!missing.length || !base) return;
    rest(`/wp/v2/${base}?include=${missing.join(',')}&per_page=100&_fields=id,title`)
      .then((rows) => setCache((c) => { const n = { ...c }; (rows || []).forEach((r) => { n[r.id] = decodeEntities(r.title?.rendered) || ('#' + r.id); }); return n; }))
      .catch(() => {});
  }, [idKey, base]);

  const doSearch = (q) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!base || !q) { setSuggestions([]); return; }
      try {
        const rows = await rest(`/wp/v2/${base}?search=${encodeURIComponent(q)}&per_page=20&_fields=id,title`);
        setCache((c) => { const n = { ...c }; (rows || []).forEach((r) => { n[r.id] = decodeEntities(r.title?.rendered) || ('#' + r.id); }); return n; });
        setSuggestions((rows || []).map((r) => decodeEntities(r.title?.rendered) || ('#' + r.id)));
      } catch { setSuggestions([]); }
    }, 250);
  };

  const tokens = ids.map((id) => cache[id] || ('#' + id));
  const onTokens = (next) => {
    const titleToId = {};
    Object.keys(cache).forEach((id) => { titleToId[cache[id]] = Number(id); });
    let newIds = next.map((t) => titleToId[t]).filter(Boolean);
    if (!field.multiple) newIds = newIds.slice(-1);
    onChange(field.multiple ? newIds : (newIds[0] || 0));
  };

  return h`<${WPFormTokenField}
    __nextHasNoMarginBottom
    __next40pxDefaultSize
    label=${field.label}
    help=${field.description || (field.multiple ? 'Search and add related items.' : 'Search and pick one related item.')}
    value=${tokens}
    suggestions=${suggestions}
    onInputChange=${doSearch}
    onChange=${onTokens}
    __experimentalExpandOnFocus=${true}
  />`;
}

// Taxonomy term picker — autocompletes existing terms (suggestions) while
// still allowing new terms to be typed (auto-created on save via the
// ci_<tax>_names REST field). Value/onChange are arrays of term names.
export function TaxonomyField({ field, value, onChange }) {
  const base = field.rest_base || field.taxonomy;
  const [suggestions, setSuggestions] = useState([]);
  useEffect(() => {
    if (!base) return;
    rest(`/wp/v2/${base}?per_page=100&hide_empty=false&orderby=name&order=asc&_fields=name`)
      .then((rows) => setSuggestions((rows || []).map((r) => r.name).filter(Boolean)))
      .catch(() => {});
  }, [base]);
  const noun = (field.label || 'term').toLowerCase();
  return h`<${WPFormTokenField}
    __nextHasNoMarginBottom
    __next40pxDefaultSize
    label=${field.label}
    value=${Array.isArray(value) ? value : []}
    suggestions=${suggestions}
    onChange=${onChange}
    placeholder=${`Add ${noun}…`}
    tokenizeOnBlur=${true}
    __experimentalExpandOnFocus=${true}
  />`;
}
