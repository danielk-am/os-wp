// Single CodeMirror 6 bundle for Context Intelligence.
//
// Everything (state, view, language, commands, search, autocomplete, the
// languages, and basicSetup) is bundled into ONE ESM file so there is exactly
// ONE copy of @codemirror/state. The old per-package vendored bundles each
// inlined their own state, so cross-package `instanceof` checks failed at
// runtime ("multiple instances of @codemirror/state"). One bundle = one
// instance, by construction.
export { EditorState, Compartment, StateEffect, StateField, EditorSelection } from '@codemirror/state';
export {
  EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  keymap, drawSelection, highlightSpecialChars, rectangularSelection,
  crosshairCursor, dropCursor,
} from '@codemirror/view';
export {
  syntaxHighlighting, defaultHighlightStyle, indentOnInput, foldGutter,
  foldKeymap, bracketMatching, StreamLanguage, HighlightStyle, LanguageSupport,
  indentUnit,
} from '@codemirror/language';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { lintGutter, setDiagnostics, forceLinting, linter } from '@codemirror/lint';
export { basicSetup } from 'codemirror';

import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage as _SL } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

export { markdown };

// Map a CI language id (the same ids LANG_ICON_MAP uses, plus Monaco-style
// aliases) to a CodeMirror language extension. Unknown -> [] (plain text).
// php uses { plain: true } so a file stored WITHOUT the opening <?php tag still
// highlights as PHP (ci_code stores tag-free; the loader adds it at runtime).
export function languageFor(name) {
  switch ((name || '').toLowerCase()) {
    case 'javascript': case 'js': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'typescript': case 'ts': return javascript({ typescript: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'python': case 'py': return python();
    case 'json': return json();
    case 'yaml': case 'yml': return yaml();
    case 'php': return php({ plain: true });
    case 'css': return css();
    case 'html': return html();
    case 'sql': return sql();
    case 'xml': return xml();
    case 'markdown': case 'md': return markdown();
    case 'bash': case 'shell': case 'sh': return _SL.define(shell);
    default: return [];
  }
}
