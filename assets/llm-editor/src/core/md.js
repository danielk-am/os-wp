/* GENERATED from llm-editor src/core/md.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/* Markdown, the inline subset. .llm inherits from .md, so bold, italics,
   inline code, links, bullets, ordered items, and checkboxes should READ as
   what they are — on the canvas cards and in the source pane's highlighting.

   Two consumers, one grammar:

     mdBody(raw)   — canvas cards. Markers are consumed (** disappears, `- [x]`
                     becomes a checked glyph): the card is a rendering.
     mdLine(raw)   — source highlighting. Markers are KEPT and coloured: the
                     pane is the authored text, chars never move (the overlay
                     must stay column-identical with the textarea under it).

   Both are line-based on purpose. Cards keep white-space: pre-wrap and the
   height estimator (layout.js measure) reasons in lines of characters, so a
   real <ul> with its own box model would make every estimate a lie. Fenced
   code never reaches these: render.js and highlight.js both branch it away
   first.

   Escaping happens HERE, first, always — every transform below runs on
   escaped text and inserts only whitelisted spans. Link hrefs additionally
   pass allowedHref, because [x](javascript:...) is otherwise a stored-XSS
   vector on any shared site. */

import { tablesOf } from './parse.js';

const HREF_OK = /^(https?:\/\/|mailto:|ci:\/\/|[/#])/i;
const mdEscape = value => String(value).replace(
  /[&<>]/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]
);

function inline(line, keep) {
  // Protect code spans from the other transforms (a ** inside backticks is
  // code, not emphasis).
  const stash = [];
  let s = line.replace(/`([^`]+)`/g, (_, c) => {
    stash.push(c);
    return `\u0000${stash.length - 1}\u0000`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g,
    (_, t) => `<span class="md-b">${keep ? '**' + t + '**' : t}</span>`);
  // Single-star emphasis only when it hugs the text: `* ` at line start is a
  // bullet and `2 * 3` is arithmetic, neither is emphasis.
  s = s.replace(/(^|[\s(])\*([^\s*][^*]*?)\*(?=[\s).,;:!?]|$)/g,
    (_, pre, t) => `${pre}<span class="md-i">${keep ? '*' + t + '*' : t}</span>`);
  s = s.replace(/(^|[\s(])_([^\s_][^_]*?)_(?=[\s).,;:!?]|$)/g,
    (_, pre, t) => `${pre}<span class="md-i">${keep ? '_' + t + '_' : t}</span>`);

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    if (!HREF_OK.test(href)) return m;   // leave it as text, transform nothing
    return keep
      ? `<span class="md-link">[${label}](${href})</span>`
      : `<a class="md-link" href="${href}" target="_blank" rel="noopener">${label}</a>`;
  });

  return s.replace(/\u0000(\d+)\u0000/g,
    (_, i) => `<span class="md-code">${keep ? '`' + stash[+i] + '`' : stash[+i]}</span>`);
}

function prefix(line, keep) {
  const chk = line.match(/^(\s*)([-*])\s\[( |x|X)\]\s?(.*)$/);
  if (chk) {
    const done = chk[3] !== ' ';
    const rest = (r) => done ? `<span class="md-done">${r}</span>` : r;
    return keep
      ? `${chk[1]}<span class="md-bullet">${chk[2]}</span> <span class="md-check">[${chk[3]}]</span> ${rest(chk[4])}`
      : `${chk[1]}<span class="md-check">${done ? '☑' : '☐'}</span> ${rest(chk[4])}`;
  }
  const ul = line.match(/^(\s*)([-*])\s+(.*)$/);
  if (ul) {
    return keep
      ? `${ul[1]}<span class="md-bullet">${ul[2]}</span> ${ul[3]}`
      : `${ul[1]}<span class="md-bullet">•</span> ${ul[3]}`;
  }
  const ol = line.match(/^(\s*)(\d+[.)])\s+(.*)$/);
  if (ol) return `${ol[1]}<span class="md-bullet">${ol[2]}</span> ${ol[3]}`;
  const bq = line.match(/^(\s*)(>)\s?(.*)$/);
  if (bq) return `${bq[1]}<span class="md-quote">${keep ? '&gt; ' : ''}${bq[3]}</span>`;
  return line;
}

/* One SOURCE line -> highlighted HTML, markers kept, columns unchanged. */
export function mdLine(raw) {
  const e = mdEscape(raw);
  const p = prefix(e, true);
  // prefix() consumed the leading run when it matched; inline the remainder
  // either way (inline() is idempotent over the spans prefix inserted, since
  // none of its patterns match inside `<span class=...>` attribute text).
  return inline(p, true);
}

/* A CARD body -> rendered HTML, markers consumed, newlines preserved. */
export function mdBody(raw) {
  return String(raw).split('\n')
    .map((l) => inline(prefix(mdEscape(l), false), false))
    .join('\n');
}

// Claude replies are documents rather than fixed-height node bodies. They can
// therefore use semantic block markup without changing canvas measurements.
// Raw HTML remains escaped, except for a deliberately tiny set of attribute-free
// inline formatting tags. Links are only created by inline(), which applies the
// same protocol allowlist used everywhere else in the editor.
const SAFE_INLINE_HTML = /&lt;(\/?)(strong|b|em|i|code|kbd|s|del|mark|sub|sup|br)\s*\/?&gt;/gi;

function documentInline(raw) {
  return mdBody(raw).replace(SAFE_INLINE_HTML, (_match, closing, tag) => {
    const safeTag = tag.toLowerCase();
    if (safeTag === 'br') return '<br>';
    return `<${closing ? '/' : ''}${safeTag}>`;
  });
}

function markdownBlockStart(lines, index, tableStarts) {
  const line = lines[index] || '';
  const trimmed = line.trim();
  return !trimmed
    || /^```/.test(trimmed)
    || /^#{1,6}\s+/.test(line)
    || /^(?:\s*)[-*]\s+/.test(line)
    || /^(?:\s*)\d+[.)]\s+/.test(line)
    || /^(?:\s*)>\s?/.test(line)
    || /^(?:\s*)(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || tableStarts.has(index);
}

/**
 * A safe, block-level Markdown rendering for chat and other prose surfaces.
 * @param {string} raw
 * @returns {string}
 */
export function mdDocument(raw) {
  const source = String(raw ?? '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const tables = tablesOf(source);
  const tableStarts = new Map(tables.map(table => [table.start, table]));
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index++;
      continue;
    }

    const fence = trimmed.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1].toLowerCase();
      const body = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index++]);
      }
      if (index < lines.length) index++;
      const className = language ? ` class="language-${language}"` : '';
      out.push(`<pre class="md-fence"><code${className}>${mdEscape(body.join('\n'))}</code></pre>`);
      continue;
    }

    const table = tableStarts.get(index);
    if (table) {
      const head = table.head.map(cell => `<th>${documentInline(cell)}</th>`).join('');
      const rows = table.rows.map(row =>
        `<tr>${table.head.map((_, column) =>
          `<td>${documentInline(row[column] ?? '')}</td>`
        ).join('')}</tr>`
      ).join('');
      out.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`);
      index = table.end;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${documentInline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^(?:\s*)[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(?:\s*)[-*]\s+(.*)$/);
        if (!item) break;
        const checkbox = item[1].match(/^\[( |x|X)\]\s*(.*)$/);
        items.push(checkbox
          ? `<li><span class="md-check">${checkbox[1] === ' ' ? '☐' : '☑'}</span> ${documentInline(checkbox[2])}</li>`
          : `<li>${documentInline(item[1])}</li>`);
        index++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^(?:\s*)\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(?:\s*)\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${documentInline(item[1])}</li>`);
        index++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^(?:\s*)>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length) {
        const part = lines[index].match(/^(?:\s*)>\s?(.*)$/);
        if (!part) break;
        quote.push(documentInline(part[1]));
        index++;
      }
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    if (/^(?:\s*)(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      index++;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length
      && !markdownBlockStart(lines, index, tableStarts)
    ) {
      paragraph.push(documentInline(lines[index++]));
    }
    if (paragraph.length) out.push(`<p>${paragraph.join('<br>')}</p>`);
  }

  return out.join('');
}
