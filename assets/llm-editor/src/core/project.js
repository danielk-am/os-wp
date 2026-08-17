/* GENERATED from llm-editor src/core/project.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { compileSkillDocument, projectPrompt, requiresBlock } from './compile.js';
import { src } from '../editor/state.js';


export function projectAgent(nodes, tagged, depth, out) {
  return projectPrompt(nodes, tagged, depth, out);
}

export function agentText() {
  return compileSkillDocument(src.value, { banner: false }).text;
}

/**
 * What `requires:` projects to, and the wording is the finding, not decoration.
 *
 * eval_requires.py (CORE-26) measured this rather than assuming it, and the
 * headline number was misleading: full list 78%, narrowed 100%, but only 2 of 9
 * tasks discriminated at all. On the other 7 both scored 100%. BOTH
 * discriminating tasks were the same confusion, capture a browser page vs
 * capture the Mac screen, where the full list picked cleanshot 0/3 and the
 * narrowed list picked playwright 3/3.
 *
 * So list SIZE is not the mechanism. 30 tools vs 2 made no difference on 7 of 9.
 * What narrowing does is REMOVE THE WRONG-BUT-PLAUSIBLE TOOL. `requires:` is a
 * collision breaker between servers whose descriptions genuinely overlap, and
 * the projection says exactly that: prefer these when two tools could both
 * plausibly do the job. Telling the agent "these are the only tools" would be a
 * lie the format cannot enforce, and would also be the wrong instruction: a
 * skill that requires playwright still needs Read and Bash.
 */
export { requiresBlock };

/* ================= .llm syntax mode ================= */
export const esc = s => s.replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));

// The token grammar. Line-oriented, with two stateful regions (frontmatter and
// fences) because both suspend the normal rules. This is exactly the shape a
