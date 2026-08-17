/* GENERATED from llm-editor src/core/compile.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { parse } from './parse.js';

const GENERATED_BANNER = sourceName =>
  `<!-- Compiled from ${String(sourceName).replace(/--/g, '- -')}. `
  + `Edit the .llm source, then recompile. -->`;

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char]));
}

function compileCamel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, char) => char.toUpperCase())
    .replace(/^[^a-zA-Z_]+/, '') || 'section';
}

function xmlName(value) {
  const name = String(value || '');
  return /^[A-Za-z_][\w.-]*$/.test(name) ? name : compileCamel(name);
}

function splitDocument(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: '', body: text, fields: new Map() };
  const close = text.indexOf('\n---', 4);
  if (close < 0) return { frontmatter: '', body: text, fields: new Map() };

  const end = close + 4;
  const frontmatter = text.slice(0, end);
  const fields = new Map();
  for (const line of frontmatter.split('\n').slice(1, -1)) {
    const match = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return {
    frontmatter,
    body: text.slice(end).replace(/^\n+/, ''),
    fields,
  };
}

function transition(edge, byId, indent = '') {
  const target = byId.get(edge.to);
  const label = edge.label ? ` when \`${edge.label}\`` : '';
  const destination = target ? `[${target.title}](#${edge.to})` : `\`#${edge.to}\``;
  return `${indent}**Next${label}:** ${destination}`;
}

/**
 * Project parsed .llm nodes into a Claude-readable Markdown prompt.
 *
 * Visual-only attributes disappear. Semantic attributes remain explicit:
 * authored tag= regions become XML, file=/tool=/run= become self-describing
 * elements, and edges become links with their branch conditions intact.
 */
export function projectPrompt(nodes, tagged = false, depth = 0, out = [], byId = null) {
  const index = byId || new Map(flattenCompileNodes(nodes).map(node => [node.id, node]));
  nodes.forEach(node => {
    const inheritsTag = tagged || !!node.tag;
    const pad = '  '.repeat(depth);

    if (inheritsTag) {
      const tag = node.tag ? xmlName(node.tag) : compileCamel(node.title);
      out.push(`${pad}<${tag}>`);
      if (node.tool) out.push(`${pad}  <tool use="${xmlEscape(node.tool)}" />`);
      if (node.file) out.push(`${pad}  <include src="${xmlEscape(node.file)}" />`);
      if (node.run) out.push(`${pad}  <run using="${xmlEscape(node.run)}" />`);
      if (node.body) out.push(node.body.split('\n').map(line => `${pad}  ${line}`).join('\n'));
      node.edges.forEach(edge => out.push(
        `${pad}  <next to="${xmlEscape(edge.to)}"`
        + `${edge.label ? ` when="${xmlEscape(edge.label)}"` : ''} />`
      ));
      projectPrompt(node.children, true, depth + 1, out, index);
      out.push(`${pad}</${tag}>`);
      return;
    }

    out.push(`<a id="${xmlEscape(node.id)}"></a>`);
    out.push(`${'#'.repeat(node.depth)} ${node.title}`);
    if (node.tool) out.push('', `<tool use="${xmlEscape(node.tool)}" />`);
    if (node.file) out.push('', `<include src="${xmlEscape(node.file)}" />`);
    if (node.run) out.push('', `<run using="${xmlEscape(node.run)}" />`);
    if (node.body) out.push('', node.body);
    if (node.edges.length) {
      out.push('');
      node.edges.forEach(edge => out.push(transition(edge, index)));
    }
    out.push('');
    projectPrompt(node.children, false, depth, out, index);
  });
  return out;
}

function flattenCompileNodes(nodes, out = []) {
  nodes.forEach(node => {
    out.push(node);
    flattenCompileNodes(node.children, out);
  });
  return out;
}

export function requiresBlock(requires) {
  if (!requires?.length) return '';
  const servers = requires.map(server => `  <server>${xmlEscape(server)}</server>`).join('\n');
  return `<requires>\n${servers}\n</requires>\n\n`
    + `<!-- Preference for ambiguous tool matches, not an allowlist. -->`;
}

function contractWarnings(source, parsed, fields) {
  const warnings = [];
  const type = String(fields.get('type') || '').trim().replace(/^["']|["']$/g, '');
  if (type === 'skill') {
    if (!String(fields.get('description') || '').trim()) warnings.push('description is empty');
    if (!fields.has('tags')) warnings.push('tags is missing');
    if (!fields.has('triggers') && !fields.has('trigger')) warnings.push('triggers is missing');
    if (!String(fields.get('returns') || '').trim() && !/\bDone when\b/.test(source)) {
      warnings.push('returns is empty');
    }
  }
  if (!/<!--\s*eof\s*-->\s*$/.test(source)) warnings.push('terminal <!-- eof --> marker is missing');

  const ids = new Set();
  const duplicates = new Set();
  parsed.blocks.forEach(node => {
    if (ids.has(node.id)) duplicates.add(node.id);
    ids.add(node.id);
  });
  if (duplicates.size) warnings.push(`duplicate anchors: ${[...duplicates].join(', ')}`);

  const unresolved = new Set();
  parsed.blocks.forEach(node => node.edges.forEach(edge => {
    if (!ids.has(edge.to)) unresolved.add(edge.to);
  }));
  if (unresolved.size) warnings.push(`unresolved edge targets: ${[...unresolved].join(', ')}`);
  return warnings;
}

export function compiledFileName(sourceName, source = '') {
  const cleanSource = String(sourceName || '').split(/[\\/]/).pop();
  if (/\.llm$/i.test(cleanSource)) return cleanSource.replace(/\.llm$/i, '.md');
  const { meta } = parse(source);
  const base = String(meta.name || cleanSource || 'untitled')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
  return `${base}.md`;
}

/**
 * Compile one authored .llm document into a deterministic Markdown artifact.
 * No model call is involved, so the same source always produces the same file.
 */
export function compileSkillDocument(source, {
  sourceName = 'untitled.llm',
  banner = true,
} = {}) {
  const original = String(source ?? '');
  const parsed = parse(original);
  const { frontmatter, body, fields } = splitDocument(original);
  const sections = [];
  if (frontmatter) sections.push(frontmatter);
  if (banner) sections.push(GENERATED_BANNER(sourceName));
  if (parsed.meta.requires.length) sections.push(requiresBlock(parsed.meta.requires));

  if (parsed.roots.length) {
    sections.push(projectPrompt(parsed.roots).join('\n').replace(/\n{3,}/g, '\n\n').trim());
  } else if (body.trim()) {
    // Leniency from the .llm spec: a body without headings stays readable and
    // must never disappear merely because it has no graph nodes.
    sections.push(body.trimEnd());
  }

  return {
    text: `${sections.filter(Boolean).join('\n\n').trimEnd()}\n`,
    fileName: compiledFileName(sourceName, original),
    warnings: contractWarnings(original, parsed, fields),
  };
}

/** Compile a picker result into one artifact per source, with unique names. */
export function compileSkillDocuments(documents) {
  const used = new Map();
  return (documents || []).map(document => {
    const compiled = compileSkillDocument(document.text, { sourceName: document.name });
    const count = (used.get(compiled.fileName) || 0) + 1;
    used.set(compiled.fileName, count);
    if (count > 1) {
      compiled.fileName = compiled.fileName.replace(/\.md$/i, `-${count}.md`);
    }
    return { ...document, ...compiled };
  });
}
