/* GENERATED from llm-editor src/core/parse.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { COLOR_KEY } from './constants.js';

/* ================= parse ================= */
export function parse(text) {
  const lines = text.split('\n');
  const blocks = [];
  const meta = { requires: [] };
  let cur = null, fence = false, fm = false;

  lines.forEach((line, i) => {
    const t = line.trim();
    if (i === 0 && t === '---') { fm = true; return; }
    if (fm) {
      if (t === '---') { fm = false; return; }
      // READ the frontmatter, never rewrite it. `requires:` is the only key the
      // parser cares about; everything else passes through byte-identical,
      // which is what keeps md -> .llm -> md exact and honours OKF's "consumers
      // SHOULD preserve unknown keys when round-tripping".
      const r = t.match(/^requires:\s*(.*)$/);
      if (r) meta.requires = parseList(r[1]);
      // `name:` is READ for the doc-bar and nothing else. Reading is not
      // rewriting: it still passes through byte-identical, so the round-trip
      // guarantee holds. The bar used to be the literal string
      // "collaboration-pipeline" in shell.html, i.e. the seed's name, so every
      // document that was not the seed displayed someone else's title.
      const n = t.match(/^name:\s*(.*)$/);
      if (n) meta.name = n[1].trim().replace(/^["']|["']$/g, '');
      return;
    }
    if (t.startsWith('```')) { fence = !fence; if (cur) cur.body.push(line); return; }
    if (fence) { if (cur) cur.body.push(line); return; }

    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/);
    if (h) {
      const a = {
        id: null, color: null, ntype: null, pos: null, size: null,
        lang: null, tag: null, file: null, tool: null, run: null,
        collapsed: false,
      };
      (h[3] || '').split(/\s+/).filter(Boolean).forEach(tok => {
        if (tok.startsWith('#')) a.id = tok.slice(1);
        else if (tok.startsWith('@')) {
          const m = tok.slice(1).split(',').map(Number);
          if (m.length >= 2 && m.every(n => !isNaN(n))) a.pos = { x: m[0], y: m[1] };
        } else if (tok.startsWith('color=')) a.color = COLOR_KEY[tok.slice(6)] || tok.slice(6);
        else if (tok.startsWith('type=')) a.ntype = tok.slice(5);
        else if (tok.startsWith('lang=')) a.lang = tok.slice(5);
        else if (tok.startsWith('tag=')) a.tag = tok.slice(4);
        else if (tok.startsWith('file=')) a.file = tok.slice(5);
        else if (tok === 'collapsed' || tok === 'collapsed=true') a.collapsed = true;
        // CORE-26. `tool=` names the exact tool this step fires, the way
        // `@require` names a dependency in code: less for the agent to discover.
        else if (tok.startsWith('tool=')) a.tool = tok.slice(5);
        // SPEC section 15. `run=sh|py|js|webhook` marks the node executable: its
        // fenced body runs and its output binds to the anchor. Sibling of
        // `tool=`; where `tool=` fires a Claude tool, `run=` runs code or a hook.
        else if (tok.startsWith('run=')) a.run = tok.slice(4);
        // `size=WxH` — a manual node size from the resize grip. Same contract
        // as `@x,y`: presentation state that lives IN the text, so it survives
        // any editor and any host.
        else if (tok.startsWith('size=')) {
          const m = tok.slice(5).split('x').map(Number);
          if (m.length === 2 && m.every(n => n > 0)) a.size = { w: m[0], h: m[1] };
        }
      });
      if (!a.id) a.id = h[2].toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || ('n'+blocks.length);
      cur = { line: i, depth: h[1].length, title: h[2].trim(), ...a, body: [], edges: [], children: [] };
      blocks.push(cur);
      return;
    }
    if (!cur) return;
    // `-> #id` is the form we emit, matching the {#id} anchor it points at.
    // The bare `-> id` still parses: lenient is the rule, and old files exist.
    const e = t.match(/^->\s*#?([\w-]+)(?:\s+"([^"]*)")?$/);
    if (e) { cur.edges.push({ to: e[1], label: e[2] || '' }); return; }
    cur.body.push(line);
  });

  blocks.forEach(b => b.body = b.body.join('\n').trim());

  const roots = [], stack = [];
  blocks.forEach(b => {
    while (stack.length && stack[stack.length-1].depth >= b.depth) stack.pop();
    (stack.length ? stack[stack.length-1].children : roots).push(b);
    stack.push(b);
  });
  return { blocks, roots, meta };
}

/* ================= run= ================= */
// SPEC section 15.2. `run=` has two forms and one classifier so render and any
// executor read them the same way. Inline: a bare interpreter keyword runs the
// node's own fence. File: a value with an extension or slash runs that file,
// interpreter inferred from the extension, and the file keeps its own
// highlighting the way a fence never can.
const RUN_KIND = { sh: 'sh', py: 'py', js: 'js', webhook: 'webhook' };
const EXT_KIND = { py: 'py', js: 'js', mjs: 'js', sh: 'sh', bash: 'sh' };

export function runInfo(run) {
  if (!run) return null;
  if (RUN_KIND[run]) return { kind: run, file: null };
  const ext = run.includes('.') ? run.split('.').pop().toLowerCase() : null;
  return { kind: EXT_KIND[ext] || null, file: run };   // file form; kind may be null if unknown ext
}

/** `[a, b]`, a bare word, or a comma list. Same shape `tags:` already uses. */
export function parseList(raw) {
  if (!raw) return [];
  const s = raw.trim();
  const inner = s.startsWith('[') ? s.slice(1, s.endsWith(']') ? -1 : undefined) : s;
  return inner.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/* ================= embeds ================= */
// A body that is essentially one fence renders as code. Detecting it beats a
// new node type: the format stays "markdown body", the canvas just reads it.
export function fenceOf(body) {
  const m = body.match(/^```([\w-]*)\n([\s\S]*?)\n?```\s*$/);
  return m ? { lang: m[1] || null, code: m[2] } : null;
}

/**
 * Split one Markdown table row without mistaking an escaped pipe or a pipe in
 * inline code for a column boundary. Returned values are source values with an
 * escaped pipe decoded; renderTable() escapes it again on the way back out.
 */
function tableCells(line) {
  let s = String(line ?? '').trim();
  if (!s.includes('|')) return null;
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const cells = [];
  let cell = '', code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') { code = !code; cell += ch; continue; }
    if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function isTableRule(cells, width) {
  return !!cells && cells.length === width
    && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

/**
 * Every Markdown pipe table in a body, including tables surrounded by prose.
 * `start` and `end` are body-line offsets, so a visual cell edit can rewrite
 * just that table and leave every sentence around it byte-for-byte intact.
 */
export function tablesOf(body) {
  if (!body) return [];
  const lines = String(body).split('\n');
  const tables = [];
  let fence = false;

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;

    const head = tableCells(lines[i]);
    const rule = tableCells(lines[i + 1]);
    if (!head || head.length < 1 || !isTableRule(rule, head.length)) continue;

    let end = i + 2;
    const rows = [];
    while (end < lines.length) {
      const row = tableCells(lines[end]);
      if (!row) break;
      rows.push(row);
      end++;
    }
    tables.push({ start: i, end, head, rows });
    i = end - 1;
  }
  return tables;
}

// Daniel: "We need a 'table' node to do the dispatch table."
// Keep the original whole-body classifier for callers that replace an entire
// table. Mixed prose + table bodies use tablesOf() and surgical line offsets.
export function tableOf(body) {
  const tables = tablesOf(body);
  if (tables.length !== 1) return null;
  const lines = String(body).split('\n');
  const table = tables[0];
  const outside = [...lines.slice(0, table.start), ...lines.slice(table.end)];
  return outside.every(line => !line.trim()) ? table : null;
}
