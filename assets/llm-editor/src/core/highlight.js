/* GENERATED from llm-editor src/core/highlight.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { esc } from './project.js';
import { mdLine } from './md.js';
import { span } from '../editor/edit-ops.js';
import { t } from '../editor/boot.js';

export function highlight(text) {
  const out = [];
  let fm = false, fence = false;

  text.split('\n').forEach((line, i) => {
    const t = line.trim();

    if (i === 0 && t === '---') { fm = true; out.push(`<span class="t-fm">${esc(line)}</span>`); return; }
    if (fm) {
      out.push(t === '---'
        ? `<span class="t-fm">${esc(line)}</span>`
        : line.replace(/^([\w-]+)(:)(.*)$/,
            (_, k, c, v) => `<span class="t-fmkey">${esc(k)}</span><span class="t-fm">${c}</span><span class="t-fm">${esc(v)}</span>`)
          || esc(line));
      if (t === '---') fm = false;
      return;
    }

    if (t.startsWith('```')) {
      fence = !fence;
      out.push(`<span class="t-fence">${esc(line)}</span>`);
      return;
    }
    if (fence) { out.push(`<span class="t-code">${esc(line)}</span>`); return; }

    const h = line.match(/^(#{1,6})(\s+)(.*?)(\s*)(\{[^}]*\})?\s*$/);
    if (h) {
      let s = `<span class="t-hash">${h[1]}</span>${h[2]}<span class="t-title">${esc(h[3])}</span>`;
      if (h[5]) {
        const inner = h[5].slice(1, -1).split(/\s+/).map(tok => {
          if (tok.startsWith('#')) return `<span class="t-id">${esc(tok)}</span>`;
          if (tok.startsWith('@')) return `<span class="t-pos">${esc(tok)}</span>`;
          const kv = tok.match(/^([\w-]+)=(.*)$/);
          if (kv) return `<span class="t-key">${esc(kv[1])}</span><span class="t-attr">=</span><span class="t-label">${esc(kv[2])}</span>`;
          return `<span class="t-attr">${esc(tok)}</span>`;
        }).join(' ');
        s += `${h[4]}<span class="t-attr">{</span>${inner}<span class="t-attr">}</span>`;
      }
      out.push(s);
      return;
    }

    const e = line.match(/^(\s*)(->)(\s*)(#?[\w-]+)(?:(\s+)("[^"]*"))?\s*$/);
    if (e) {
      out.push(`${e[1]}<span class="t-edge">${e[2]}</span>${e[3]}<span class="t-id">${esc(e[4])}</span>`
        + (e[6] ? `${e[5]}<span class="t-label">${esc(e[6])}</span>` : ''));
      return;
    }

    // Body prose: .llm inherits from .md, so bold / italics / inline code /
    // links / bullets / checkboxes colour here too. Markers are kept: the
    // overlay must stay column-identical with the textarea beneath it.
    out.push(mdLine(line));
  });
  // Trailing newline keeps the last line scrollable in lockstep with the textarea.
  return out.join('\n') + '\n';
}
