/* GENERATED from llm-editor src/core/repair.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * Make a document minimally complete for the .llm editor.
 *
 * This is deliberately mechanical rather than a formatter. It adds only the
 * structural details the editor can know with confidence: the editor's
 * canonical skill frontmatter, heading anchors, and the `#` in an edge target.
 * Existing frontmatter values and prose remain in their original order.
 * Ambiguous input is returned untouched with a warning instead of guessed at.
 */

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+\{([^}]*)\})?\s*$/;
const ID = /(?:^|\s)#([\w-]+)(?=\s|$)/;
const EDGE = /^(->\s*)#?([\w-]+)(\s+"[^"]*")?$/;

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';
}

function titleFor(name) {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function frontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { present: false, close: -1, keys: new Set(), name: '' };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) return { present: true, close: -1, keys: new Set(), name: '' };
  const keys = new Set();
  let name = '';
  for (let i = 1; i < close; i++) {
    const match = lines[i].match(/^\s*([\w-]+)\s*:/);
    if (match) keys.add(match[1]);
    if (match?.[1] === 'name') name = lines[i].slice(lines[i].indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { present: true, close, keys, name };
}

function bodyFacts(lines, start) {
  const headings = [];
  const ids = new Set();
  const duplicates = new Set();
  let firstContent = '';
  let fenced = false;

  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!firstContent && trimmed) firstContent = trimmed;

    const heading = line.match(HEADING);
    if (heading) {
      const anchor = (heading[3] || '').match(ID)?.[1] || null;
      headings.push({ index, match: heading, id: anchor });
      if (anchor) {
        if (ids.has(anchor)) duplicates.add(anchor);
        ids.add(anchor);
      }
    }
  }

  return { headings, ids, duplicates, firstContent };
}

/**
 * @param {string} source
 * @returns {{ text: string, changes: string[], warnings: string[] }}
 */
export function repairDocument(source) {
  const original = String(source ?? '');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const changes = [];
  const warnings = [];
  let normalized = original.replace(/^\uFEFF/, '');
  if (normalized !== original) changes.push('removed the byte-order mark');
  const lines = normalized.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines.at(-1) === '') lines.pop();

  let fm = frontmatter(lines);
  if (fm.present && fm.close < 0) {
    return {
      text: original,
      changes: [],
      warnings: ['The opening frontmatter block has no closing --- line. Repair it manually first.'],
    };
  }

  let bodyStart = fm.present ? fm.close + 1 : 0;
  let facts = bodyFacts(lines, bodyStart);
  if (facts.duplicates.size) {
    return {
      text: original,
      changes: [],
      warnings: [`Duplicate heading anchor${facts.duplicates.size === 1 ? '' : 's'}: ${[...facts.duplicates].join(', ')}. Repair them manually so links stay unambiguous.`],
    };
  }

  const name = slug(fm.name || facts.headings[0]?.match[2] || facts.firstContent || 'document');

  if (!facts.headings.length) {
    const id = uniqueId(name, facts.ids);
    lines.splice(bodyStart, 0, `# ${titleFor(name)} {#${id}}`, ...(lines.slice(bodyStart).some(line => line.trim()) ? [''] : []));
    changes.push('wrapped the body in a root heading');
    bodyStart += 1 + (lines[bodyStart + 1] === '' ? 1 : 0);
    facts = bodyFacts(lines, bodyStart);
  }

  for (const heading of facts.headings) {
    if (heading.id) continue;
    const id = uniqueId(slug(heading.match[2]), facts.ids);
    facts.ids.add(id);
    const attrs = heading.match[3]?.trim();
    lines[heading.index] = `${heading.match[1]} ${heading.match[2].trim()} {${attrs ? `${attrs} ` : ''}#${id}}`;
    changes.push(`anchored “${heading.match[2].trim()}”`);
  }

  let fenced = false;
  for (let index = bodyStart; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const edge = trimmed.match(EDGE);
    if (!edge || trimmed.includes('-> #')) continue;
    const indent = line.slice(0, line.indexOf(trimmed));
    lines[index] = `${indent}${edge[1]}#${edge[2]}${edge[3] || ''}`;
    changes.push(`normalised edge to #${edge[2]}`);
  }

  fm = frontmatter(lines);
  if (!fm.present) {
    lines.unshift(
      '---',
      'type: skill',
      'name: untitled',
      'description:',
      'tags: []',
      'triggers: []',
      'returns:',
      '---',
      ''
    );
    changes.push('added the canonical skill frontmatter');
  } else {
    const missing = [];
    if (!fm.keys.has('type')) missing.push('type: skill');
    if (!fm.keys.has('name')) missing.push('name: untitled');
    if (!fm.keys.has('description')) missing.push('description:');
    if (!fm.keys.has('tags')) missing.push('tags: []');
    if (!fm.keys.has('triggers')) missing.push('triggers: []');
    if (!fm.keys.has('returns')) missing.push('returns:');
    if (missing.length) {
      lines.splice(fm.close, 0, ...missing);
      changes.push(`added ${missing.map(line => line.split(':')[0]).join(' and ')} to frontmatter`);
    }
  }

  if (!changes.length) return { text: original, changes, warnings };
  return { text: `${lines.join(eol)}${eol}`, changes, warnings };
}
