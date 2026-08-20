/**
 * Context Editors — shared editor primitives used by the Markdown editor and
 * other surfaces: a CodeMirror 6 code editor (CMEditor / CodeEditor) and the
 * Gutenberg block composer. A neutral layer above `ci/core` that the Type
 * layer + feature apps consume, so neither owns a heavyweight editor dependency.
 *
 * No build step — hand-authored native ES module; bare specifiers resolve via
 * the importmap. CodeMirror 6 is one vendored bundle (vendor/codemirror.js, see
 * vendor/codemirror.build.md); every @codemirror/* specifier maps to it so
 * there is a single @codemirror/state instance. Monaco was removed in its
 * favour (lighter + better on mobile).
 */
import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { EditorView, Compartment, basicSetup, languageFor, keymap, indentWithTab, lintGutter, setDiagnostics, autocompletion } from 'codemirror';
import { BlockEditorProvider, BlockList, BlockTools, BlockToolbar, BlockInspector, BlockCanvas, ListView as WPListView, WritingFlow, ObserveTyping, Inserter, BlockEditorKeyboardShortcuts } from '@wordpress/block-editor';
import { parse as parseBlocks, serialize as serializeBlocks, pasteHandler, createBlock, getBlockTypes } from '@wordpress/blocks';
import { SlotFillProvider as WPSlotFillProvider, Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton, Button as WPButton, TextareaControl as WPTextareaControl } from '@wordpress/components';
import { ShortcutProvider } from '@wordpress/keyboard-shortcuts';
import { h, BOOT, rest } from 'os/core';
import { Icon, Card, Toolbar as CIToolbar } from 'os/ui';

// --- [[wikilink]] autocomplete (CM6 completion source) ---------------------
// Typing `[[` in a prose body offers the existing skill / wiki slugs, so
// authors write links that actually resolve. Slugs are fetched once and
// memoised; a page reload picks up newly-created posts.
let _slugCache = null;
async function fetchWikilinkSlugs() {
  if ( _slugCache ) return _slugCache;
  const grab = ( base ) => rest( `/wp/v2/${ base }?per_page=100&_fields=slug,title` ).catch( () => [] );
  try {
    const [ skills, wikis ] = await Promise.all( [ grab( 'os_skill' ), grab( 'os_wiki' ) ] );
    _slugCache = [ ...( skills || [] ), ...( wikis || [] ) ]
      .filter( ( p ) => p && p.slug )
      .map( ( p ) => ( { slug: p.slug, title: String( p.title?.rendered || p.title || '' ).replace( /<[^>]+>/g, '' ).trim() } ) );
  } catch { _slugCache = []; }
  return _slugCache;
}
function wikilinkApply( slug ) {
  return ( view, completion, from, to ) => {
    const after = view.state.sliceDoc( to, to + 2 );
    const insert = slug + ( after === ']]' ? '' : ']]' );
    view.dispatch( { changes: { from, to, insert }, selection: { anchor: from + insert.length } } );
  };
}
function wikilinkCompletionSource( context ) {
  const m = context.matchBefore( /\[\[[^\]\n]*$/ );
  if ( ! m || m.from + 2 > context.pos ) return null;
  const from = m.from + 2; // first char after the opening [[
  return fetchWikilinkSlugs().then( ( slugs ) => ( {
    from,
    options: slugs.map( ( s ) => ( { label: s.slug, detail: s.title || undefined, type: 'text', apply: wikilinkApply( s.slug ) } ) ),
    validFor: /^[^\]\n]*$/,
  } ) );
}

// Native Gutenberg icons for the composer toolbar so it matches the block
// editor exactly (the adjacent BlockToolbar uses these same glyphs). The block
// editor loads window.wp.primitives (SVG/Path) as a dependency; fall back to a
// raw SVG element if it is somehow absent. plus/list-view/more-vertical are
// verified against core's bundle; undo/redo are the canonical @wordpress/icons
// arrows.
const _wpPrim = (typeof window !== 'undefined' && window.wp && window.wp.primitives) || null;
const wpIcon = (d) => (_wpPrim && _wpPrim.SVG && _wpPrim.Path)
  ? h`<${_wpPrim.SVG} viewBox="0 0 24 24"><${_wpPrim.Path} d=${d} /></${_wpPrim.SVG}>`
  : h`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d=${d} /></svg>`;
const iconPlus = wpIcon('M11 12.5V17.5H12.5V12.5H17.5V11H12.5V6H11V11H6V12.5H11Z');
const iconUndo = wpIcon('M18.3 11.7c-.6-.6-1.4-.9-2.3-.9H6.7l2.9-3.3-1.1-1-4.5 5.1 4.5 4.5 1.1-1.1-2.7-2.7h9.2c.5 0 .9.2 1.3.5 1 1 1 3.4 1 4.5v.3h1.5v-.2c0-1.5 0-4.3-1.6-5.7z');
const iconRedo = wpIcon('M15.6 6.5l-1.1 1 2.9 3.3H8c-.9 0-1.7.3-2.3.9-1.6 1.4-1.6 4.2-1.6 5.7v.2h1.5v-.3c0-1.1 0-3.5 1-4.5.3-.3.7-.5 1.3-.5h9.2l-2.7 2.7 1.1 1.1 4.5-4.5-4.6-5z');
const iconListView = wpIcon('M3 6h11v1.5H3V6Zm3.5 5.5h11V13h-11v-1.5ZM21 17H10v1.5h11V17Z');
const iconDrawerRight = wpIcon('M13 19h-2v-2h2v2zm0-6h-2v-2h2v2zm0-6h-2V5h2v2z');
// Shared with the Fields designer canvas (os-type), so its toolbar carries
// the exact same glyphs as this composer's.
export const EDITOR_ICONS = {
  plus: iconPlus,
  undo: iconUndo,
  redo: iconRedo,
  listView: iconListView,
  drawerRight: iconDrawerRight,
  // core's close-small glyph, for panel headers
  close: wpIcon('M12 13.06l3.712 3.713 1.061-1.06L13.061 12l3.712-3.712-1.06-1.06L12 10.938 8.288 7.227l-1.061 1.06L10.939 12l-3.712 3.712 1.06 1.061L12 13.061z'),
};

// Monaco was removed in favour of CodeMirror 6: lighter (~800KB vs several MB),
// far better on touch/mobile, and php({plain}) highlights tag-free php files.
// `monacoReady` is kept as a resolved stub so any consumer or companion that
// still imports it does not break.
export const monacoReady = Promise.resolve(null);

// Shared code-editor theme: full height, monospace, mobile-friendly scrolling,
// subtle gutters. The light token border lives on the wrapper, not here.
const __cmTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.6',
    // iOS Safari: keep touch scrolling on the editor, not the
    // (overflow:hidden) body.
    touchAction: 'pan-y',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
  },
  '.cm-content': { padding: '12px 4px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
});

/**
 * CodeMirror 6 editor — the single code editor across the app and companions
 * (markdown bodies, code files, os_code). Props: value, onChange, language (a
 * CI language id; see languageFor in the bundle), jumpToLine/onJumpConsumed
 * (scroll to a 1-based line), onReady (hands back the EditorView so the Insert
 * popover can dispatch a cursor-aware insert), diagnostics (externally-computed
 * CM6 lint diagnostics: [{from, to, severity, message}], e.g. frontmatter
 * schema validation — painted as squiggles + gutter markers + hover tooltips).
 */
export function CMEditor({ value, onChange, language, jumpToLine, onJumpConsumed, onReady, diagnostics, wikilinks }) {
  const ref = useRef(null);
  const viewRef = useRef(null);
  const langCompRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const valueRef = useRef(value);
  valueRef.current = value;
  const wikilinksRef = useRef(wikilinks);
  wikilinksRef.current = wikilinks;
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!ref.current) return;
    const langComp = new Compartment();
    langCompRef.current = langComp;
    const view = new EditorView({
      doc: valueRef.current || '',
      parent: ref.current,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        langComp.of(languageFor(language)),
        // Prose bodies get [[wikilink]] slug completion. Scoped to prose (the
        // override would otherwise replace a code language's own completion).
        ...(wikilinksRef.current ? [autocompletion({ override: [wikilinkCompletionSource] })] : []),
        EditorView.lineWrapping,
        lintGutter(),
        __cmTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;
    // Hand the view to the parent (CM6 replacement for the Monaco instance) so
    // the Insert popover can dispatch a cursor-aware insert.
    onReadyRef.current?.(view);
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  // External value updates (e.g. after a fetch resolves).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === undefined) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value || '' } });
    }
  }, [value]);

  // Externally-computed lint diagnostics (e.g. frontmatter schema validation).
  // Clamp ranges to the current doc so a stale range can't throw, then paint.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const len = view.state.doc.length;
    const diags = (Array.isArray(diagnostics) ? diagnostics : []).map((d) => {
      const from = Math.max(0, Math.min(d.from | 0, len));
      const to = Math.max(from, Math.min(d.to | 0, len));
      return { from, to, severity: d.severity || 'info', message: d.message || '' };
    });
    view.dispatch(setDiagnostics(view.state, diags));
  }, [diagnostics]);

  // Re-apply the language when it changes (fileLang resolves async).
  useEffect(() => {
    const view = viewRef.current;
    const comp = langCompRef.current;
    if (!view || !comp) return;
    view.dispatch({ effects: comp.reconfigure(languageFor(language)) });
  }, [language]);

  // Jump to a 1-based line (pencil-from-canvas): select end-of-line + scroll.
  // Retry across a frame in case the view mounts a tick after the request.
  useEffect(() => {
    if (!jumpToLine) return;
    let cancelled = false;
    const tryJump = () => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) { requestAnimationFrame(tryJump); return; }
      try {
        const n = Math.max(1, Math.min(jumpToLine, view.state.doc.lines));
        const line = view.state.doc.line(n);
        view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
        view.focus();
      } catch {}
      onJumpConsumed?.();
    };
    tryJump();
    return () => { cancelled = true; };
  }, [jumpToLine]);

  return h`<div ref=${ref} className="w-full h-full overflow-auto bg-card os-cm6" />`;
}


// CodeEditor is the public name consumers and companions import; it is now
// CodeMirror 6 (one editor across desktop and mobile).
export function CodeEditor(props) {
  return h`<${CMEditor} ...${props} />`;
}

// ---------------------------------------------------------------------------
// Gutenberg block composer — a self-contained block editor (fixed toolbar +
// block inspector + native chrome). Shared by richtext CPT fields, wizard
// step bodies/tips, and the automation email body. Relocated here so the Type
// layer (CptEditorPage) no longer reaches "up" into an app for it.
// ---------------------------------------------------------------------------
let __coreBlocksRegistered = false;
function ensureCoreBlocksRegistered() {
  if (__coreBlocksRegistered) return;
  try {
    const lib = window.wp?.blockLibrary;
    if (lib && typeof lib.registerCoreBlocks === 'function') {
      lib.registerCoreBlocks();
      __coreBlocksRegistered = true;
    }
  } catch (e) {
    console.error('[core-index] registerCoreBlocks failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Markdown → blocks conversion. Gutenberg's own "Convert to blocks" (rawHandler)
// handles prose but DROPS GitHub-flavoured pipe tables, so a table-heavy
// markdown body has to be rebuilt by hand. We run the prose through pasteHandler
// (headings, lists, quotes, code) and build core/table blocks ourselves for the
// pipe tables it misses. Round-trips lossless (verified on real bodies).
// ---------------------------------------------------------------------------

// A pipe table cell row: `| a | b |`. The separator below the header: `|---|`.
const MD_PIPE_ROW = /^\|.*\|$/;
const MD_TABLE_SEP = ( l ) => /^\|?[\s:|-]*-[\s:|-]*\|?$/.test( l ) && l.indexOf( '-' ) !== -1;
const mdCells = ( l ) => l.replace( /^\||\|$/g, '' ).split( '|' ).map( ( c ) => c.trim() );
// Table cells are RichText (HTML). pasteHandler renders inline markdown for
// prose blocks, but our hand-built cells need it applied directly. Escape HTML
// first, then turn the common inline marks into tags.
const cellHtml = ( s ) => s
  .replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' )
  .replace( /`([^`]+)`/g, '<code>$1</code>' )
  .replace( /\*\*([^*]+?)\*\*/g, '<strong>$1</strong>' )
  .replace( /\*([^*]+?)\*/g, '<em>$1</em>' )
  .replace( /\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>' );

// Heuristic for showing the convert button: the body has markdown a block
// parser won't recognise — a pipe table, or markdown trapped in a wp:html block.
export function looksConvertibleToBlocks( value ) {
  const s = String( value || '' ).replace( /<br\s*\/?>/gi, '\n' );
  if ( ! s.trim() ) return false;
  const lines = s.split( /\r?\n/ ).map( ( l ) => l.replace( /^\s*<[^>]+>\s*/, '' ).replace( /\s*<[^>]+>\s*$/, '' ).trim() );
  for ( let i = 0; i < lines.length - 1; i++ ) {
    if ( MD_PIPE_ROW.test( lines[ i ] ) ) {
      let k = i + 1; while ( k < lines.length && lines[ k ] === '' ) k++;
      if ( k < lines.length && MD_TABLE_SEP( lines[ k ] ) ) return true;
    }
  }
  return false;
}

// Convert a markdown (or markdown-trapped-in-html) body to serialized block
// markup. Leading YAML frontmatter is preserved verbatim — the app reads
// name/description from it, so converting it to paragraphs would lose that.
export function convertMarkdownToBlocks( value ) {
  ensureCoreBlocksRegistered();
  const src = String( value || '' );
  const fmMatch = src.match( /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/ );
  const fm = fmMatch ? fmMatch[ 0 ].replace( /\s+$/, '' ) : '';
  const rest = fmMatch ? src.slice( fmMatch[ 0 ].length ) : src;

  // Normalise the block-markup wrapper noise away so the markdown underneath is
  // line-addressable: drop wp comments, turn <br> into newlines, unwrap the
  // structural tags wp:html bodies use.
  const norm = rest
    .replace( /<!--[\s\S]*?-->/g, '' )
    .replace( /<br\s*\/?>/gi, '\n' )
    .replace( /<\/?(?:section|p|figure|div|span)\b[^>]*>/gi, '' )
    .replace( /[ \t]+\n/g, '\n' );
  const lines = norm.split( /\r?\n/ );
  const nextNonBlank = ( from ) => { let k = from; while ( k < lines.length && lines[ k ].trim() === '' ) k++; return k; };

  const blocks = [];
  let buf = [];
  const flush = () => {
    const chunk = buf.join( '\n' ).trim();
    buf = [];
    if ( ! chunk ) return;
    try { blocks.push( ...pasteHandler( { plainText: chunk, mode: 'BLOCKS' } ) ); }
    catch { blocks.push( createBlock( 'core/paragraph', { content: chunk } ) ); }
  };
  for ( let i = 0; i < lines.length; i++ ) {
    const cl = lines[ i ].trim();
    if ( MD_PIPE_ROW.test( cl ) ) {
      const sepIdx = nextNonBlank( i + 1 );
      if ( sepIdx < lines.length && MD_TABLE_SEP( lines[ sepIdx ].trim() ) ) {
        flush();
        const head = [ { cells: mdCells( cl ).map( ( c ) => ( { content: cellHtml( c ), tag: 'th' } ) ) } ];
        const body = [];
        let k = nextNonBlank( sepIdx + 1 );
        while ( k < lines.length && MD_PIPE_ROW.test( lines[ k ].trim() ) ) {
          body.push( { cells: mdCells( lines[ k ].trim() ).map( ( c ) => ( { content: cellHtml( c ), tag: 'td' } ) ) } );
          k = nextNonBlank( k + 1 );
        }
        blocks.push( createBlock( 'core/table', { head, body } ) );
        i = k - 1;
        continue;
      }
    }
    buf.push( lines[ i ] );
  }
  flush();
  const serialized = serializeBlocks( blocks );
  return fm ? fm + '\n\n' + serialized : serialized;
}

// The --wp-block-editor shipping recipe's static set. ci runs inside a real
// WordPress, so dynamic blocks genuinely render here — the flag defaults ON;
// pass dynamicBlocks={false} for surfaces whose output leaves WordPress.
const STATIC_BLOCKS = [
  'core/paragraph',
  'core/heading',
  'core/list',
  'core/list-item',
  'core/quote',
  'core/code',
  'core/preformatted',
  'core/table',
  'core/separator',
  'core/image',
  'core/html',
];

// BlockCanvas (current WP) always iframes its content; the iframe starts
// styleless, so snapshot every stylesheet the wp-admin page already loaded
// (editor chrome + content + theme presets) and inject them via `styles`.
let _canvasStylesCache = null;
export function collectCanvasStyles() {
  if (_canvasStylesCache) return _canvasStylesCache;
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n'; } catch {}
  }
  // The snapshot alone is not enough: wp-admin scopes its typography to admin
  // classes the iframe body lacks, so give the canvas an explicit base.
  const base =
    // The iframe never inherits wp-admin's theme-color custom properties;
    // pin them to Blueberry so selection outlines and accents match the app.
    ':root,body.editor-styles-wrapper{--wp-admin-theme-color:#3858e9;--wp-admin-theme-color-darker-10:#2145e6;--wp-admin-theme-color-darker-20:#183ad6;}' +
    'body.editor-styles-wrapper{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'font-size:14px;line-height:1.7;color:#1e1e1e;padding:12px 16px;background:#fff;}' +
    '.editor-styles-wrapper .wp-block{max-width:none;}';
  _canvasStylesCache = [{ css }, { css: base }];
  return _canvasStylesCache;
}

export function GutenbergComposer({
  value,
  onChange,
  placeholder = 'Type / to insert a block, or just start writing…',
  showInspector: showInspectorInit = false,
  minHeight = 200,
  className = '',
  dynamicBlocks = true,
}) {
  // Register on first mount — no-op on subsequent mounts thanks to the
  // module-level guard. Done eagerly (not lazily) so the BlockList
  // below renders blocks correctly on first paint.
  ensureCoreBlocksRegistered();
  const editorMissing = !BlockEditorProvider || !parseBlocks || !serializeBlocks;
  const [blocks, setBlocks] = useState(() => {
    if (editorMissing) return [];
    try { return parseBlocks(value || '') || []; }
    catch { return []; }
  });
  // Sync external value -> blocks only when the prop changes from
  // outside (e.g. loading a different step). We compare against our
  // last-serialized output so user edits don't loop.
  const lastSerializedRef = useRef(value || '');
  useEffect(() => {
    if (editorMissing) return;
    if (value === lastSerializedRef.current) return;
    try {
      const fresh = parseBlocks(value || '') || [];
      setBlocks(fresh);
      lastSerializedRef.current = value || '';
    } catch {}
  }, [value, editorMissing]);

  const onBlocksChange = useCallback((next) => {
    setBlocks(next);
    if (editorMissing) return;
    let str = '';
    try { str = serializeBlocks(next) || ''; } catch {}
    lastSerializedRef.current = str;
    onChange(str);
  }, [onChange, editorMissing]);

  // Live refs for the Tab-add-row handler (registered once in a [] effect, so it
  // must read current state through refs, not its initial closure).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onBlocksChangeRef = useRef(onBlocksChange);
  onBlocksChangeRef.current = onBlocksChange;

  // Right-hand block-settings panel, closed by default for a clean editor;
  // the toolbar's drawer toggle opens it on demand (mirrors WP's "Settings"
  // sidebar, which also starts collapsed in compact contexts).
  // Panels (List View + inspector) are part of the base editor and default
  // OPEN — but only when they fit: in a readable-width column two 256px
  // panels would leave the canvas a sliver, so measure the wrap first.
  const wrapRef = useRef(null);
  const [showInspector, setShowInspector] = useState(false);
  // Auto-open once whenever the wrap first has room (mount, or the
  // full-width toggle later); user toggles are respected afterwards.
  const panelsAutoRef = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const maybeOpen = () => {
      if (panelsAutoRef.current) return;
      if (el.offsetWidth >= 1000) {
        panelsAutoRef.current = true;
        setShowInspector(true);
        setShowListView(true);
      }
    };
    maybeOpen();
    if (!panelsAutoRef.current && showInspectorInit) setShowInspector(true);
    const ro = new ResizeObserver(maybeOpen);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Visual | Code (the --wp-block-editor recipe): the code view edits the
  // serialized markup in CMEditor; edits parse back live, so the parent's
  // value stays canonical whichever view is active.
  const [mode, setMode] = useState('visual');
  const [markup, setMarkup] = useState(() => value || '');
  const showCode = useCallback(() => {
    let str = '';
    try { str = serializeBlocks(blocksRef.current || []) || ''; } catch {}
    setMarkup(str);
    setMode('code');
  }, []);
  const showVisual = useCallback(() => setMode('visual'), []);
  const onCodeChange = useCallback((m) => {
    setMarkup(m);
    try { onBlocksChange(parseBlocks(m || '') || []); } catch {}
  }, [onBlocksChange]);
  // List view (document overview) as a left panel inside the editor, the way
  // WP shows it, rather than a cramped dropdown. Toggled from the top toolbar.
  const [showListView, setShowListView] = useState(false);
  // Document-tools undo/redo — dispatch on the core/block-editor store, scoped
  // to this provider via the implicit registry context (same as the post editor
  // header). These sit in the top toolbar next to the inserter, like Gutenberg.
  const wpDispatch = window.wp?.data?.dispatch;
  const doUndo = useCallback(() => { try { wpDispatch?.('core/block-editor')?.undo(); } catch {} }, [wpDispatch]);
  const doRedo = useCallback(() => { try { wpDispatch?.('core/block-editor')?.redo(); } catch {} }, [wpDispatch]);

  // Tab moves between table cells (spreadsheet-style). Core Gutenberg tabs OUT
  // of the editor instead, so intercept Tab in capture phase (before WritingFlow)
  // when the caret is in a table cell and move it to the next/previous cell.
  // Forward Tab past the LAST cell appends a row and lands in its first cell;
  // Shift+Tab before the first cell falls through so you can still leave.
  const canvasRef = useRef(null);
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const selectCell = (el) => {
      el.focus();
      // Select the whole cell so typing replaces it (spreadsheet behaviour).
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const ce = e.target.closest && e.target.closest('.block-editor-rich-text__editable');
      if (!ce) return;
      const table = ce.closest('table');
      const cell = ce.closest('td, th');
      if (!table || !cell) return;
      const editables = Array.from(table.querySelectorAll('td .block-editor-rich-text__editable, th .block-editor-rich-text__editable'));
      const idx = editables.indexOf(ce);
      if (idx === -1) return;
      const next = idx + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next < editables.length) {
        e.preventDefault();
        e.stopPropagation();
        selectCell(editables[next]);
        return;
      }
      // Shift+Tab before the first cell: let Tab leave the table.
      if (e.shiftKey) return;
      // Forward Tab past the last cell: append a body row and land in it. The
      // composer's BlockEditorProvider uses a scoped registry, so the global
      // wp.data store can't see this block; edit the React block state we own.
      const blockEl = ce.closest('[data-block]');
      const clientId = blockEl && blockEl.getAttribute('data-block');
      if (!clientId) return; // can't identify the table → let Tab leave
      const find = (list) => {
        for (const b of list) {
          if (b.clientId === clientId) return b;
          if (b.innerBlocks && b.innerBlocks.length) { const f = find(b.innerBlocks); if (f) return f; }
        }
        return null;
      };
      const block = find(blocksRef.current || []);
      if (!block || block.name !== 'core/table') return;
      const a = block.attributes || {};
      const cols = ( a.body && a.body[0] && a.body[0].cells ? a.body[0].cells.length : 0 )
        || ( a.head && a.head[0] && a.head[0].cells ? a.head[0].cells.length : 0 ) || 1;
      const newRow = { cells: Array.from({ length: cols }, () => ( { content: '', tag: 'td' } ) ) };
      const newBody = [ ...( a.body || [] ), newRow ];
      const replace = (list) => list.map((b) => {
        if (b.clientId === clientId) return { ...b, attributes: { ...b.attributes, body: newBody } };
        if (b.innerBlocks && b.innerBlocks.length) return { ...b, innerBlocks: replace(b.innerBlocks) };
        return b;
      });
      e.preventDefault();
      e.stopPropagation();
      onBlocksChangeRef.current(replace(blocksRef.current || []));
      // Focus the new row's first cell once the block re-renders (a few frames).
      let tries = 0;
      const focusNew = () => {
        const t = blockEl.querySelector('table');
        const rows = t ? t.querySelectorAll('tbody > tr') : [];
        const target = rows.length ? rows[rows.length - 1].querySelector('.block-editor-rich-text__editable') : null;
        if (target) { selectCell(target); return; }
        if (tries++ < 20) requestAnimationFrame(focusNew);
      };
      requestAnimationFrame(focusNew);
    };
    root.addEventListener('keydown', onKeyDown, true); // capture: beat WritingFlow
    // BlockCanvas iframes the content in current WP — iframe events never
    // bubble to the wrapper, so attach inside its document as well (retrying
    // until the iframe mounts and on reloads).
    let iframeDoc = null;
    let tries = 0;
    let timer = null;
    const attachIframe = () => {
      const ifr = root.querySelector('iframe');
      const doc = ifr && ifr.contentDocument;
      if (doc && doc !== iframeDoc && doc.body) {
        if (iframeDoc) { try { iframeDoc.removeEventListener('keydown', onKeyDown, true); } catch {} }
        iframeDoc = doc;
        doc.addEventListener('keydown', onKeyDown, true);
      }
      if (doc && doc.head && !doc.getElementById('os-canvas-styles')) {
        const st = doc.createElement('style');
        st.id = 'os-canvas-styles';
        st.textContent = collectCanvasStyles()[0].css;
        doc.head.appendChild(st);
      }
      if (tries++ < 100) timer = setTimeout(attachIframe, 200);
    };
    attachIframe();
    return () => {
      root.removeEventListener('keydown', onKeyDown, true);
      if (timer) clearTimeout(timer);
      if (iframeDoc) { try { iframeDoc.removeEventListener('keydown', onKeyDown, true); } catch {} }
    };
  }, []);

  if (editorMissing) {
    return h`<${Card} className="p-4 text-xs text-foreground bg-amber-50 border border-amber-200">
      <strong className="font-semibold">Block editor unavailable.</strong> Falling back to a plain markdown textarea — wp-block-editor wasn't loaded on this page.
      <${WPTextareaControl}
        value=${value || ''}
        onChange=${onChange}
        rows=${6}
        className="os-md-fallback mt-2"
        __nextHasNoMarginBottom=${true}
      />
    </${Card}>`;
  }

  // BlockEditorKeyboardShortcuts.Register registers the slash inserter,
  // Cmd+Z/Y undo/redo, Tab navigation, and the multi-selection shortcuts
  // into the keyboard-shortcuts store. Without it the autocompleter that
  // turns `/heading` into the block inserter never fires.
  const KbShortcutsRegister = BlockEditorKeyboardShortcuts?.Register;
  // SlotFillProvider connects each block's InspectorControls (Fill) to the
  // BlockInspector (Slot) in the sidebar; ShortcutProvider provides the
  // keydown context that makes the registered editor shortcuts fire.
  // Both fall back to Fragment if the host WP is too old to export them.
  const SlotFill = WPSlotFillProvider || Fragment;
  const Shortcuts = ShortcutProvider || Fragment;
  const hasInspector = !!BlockInspector;
  // NB: we intentionally do NOT render a <Popover.Slot/> here. With a slot
  // inside this (overflow-hidden) wrapper, the editor's dropdown popovers
  // (Border, font-size "Fit text", the toolbar ⋮ menus) rendered at the
  // slot's DOM position — bottom-left over the content — and lost their
  // padding to the #os-app-root Tailwind reset. Without a slot, @wordpress
  // Popover falls back to its default document.body portal: anchored
  // correctly to the trigger AND styled natively (outside #os-app-root).
  return h`<div ref=${wrapRef} className=${'os-ed-wrap os-step-block-editor bg-card ' + className}>
    <${SlotFill}>
    <${Shortcuts}>
    <${BlockEditorProvider}
      value=${blocks}
      onInput=${onBlocksChange}
      onChange=${onBlocksChange}
      settings=${{
        // theme.json presets (font sizes, colours, spacing, …) injected
        // server-side so the inspector's typography/colour/spacing controls
        // work like the real editor. Spread first so our flags win.
        ...(BOOT?.block_editor_settings || {}),
        hasUploadPermissions: true,
        // Fixed toolbar mode: the selected block's controls dock into our
        // persistent top bar (GutenbergComposerToolbar renders BlockToolbar)
        // instead of floating above the block. Sticks to the top of the editor
        // and scrolls horizontally on narrow/mobile widths.
        hasFixedToolbar: true,
        bodyPlaceholder: placeholder,
        titlePlaceholder: '',
        // Static content blocks only when the output leaves WordPress
        // (dynamic blocks serialize to empty markers there). Either way the
        // os-designer/* blocks stay out — they are the Fields-tab structure
        // designer's vocabulary, meaningless inside a content body.
        allowedBlockTypes: dynamicBlocks
          ? (() => { try { return (getBlockTypes() || []).map((b) => b.name).filter((n) => !n.startsWith('os-designer/')); } catch { return true; } })()
          : STATIC_BLOCKS,
      }}
    >
      ${KbShortcutsRegister ? h`<${KbShortcutsRegister} />` : null}
      <${GutenbergComposerToolbar}
        canToggleInspector=${hasInspector}
        inspectorOpen=${showInspector}
        onToggleInspector=${() => setShowInspector((v) => !v)}
        listViewOpen=${showListView}
        onToggleListView=${() => setShowListView((v) => !v)}
        mode=${mode}
        onShowVisual=${showVisual}
        onShowCode=${showCode}
      />
      ${mode === 'code' ? h`<div className="os-ed-code">
        <${CMEditor} value=${markup} onChange=${onCodeChange} language="html" />
      </div>` : h`<div className="os-ed-row flex items-stretch">
        ${showListView && WPListView ? h`<div className="os-block-list-view w-64 shrink-0 border-r border-border bg-card overflow-y-auto max-h-[60vh] p-1 text-sm">
          <${WPListView} />
        </div>` : null}
        <div className="os-ed-main flex-1 min-w-0">
          <${BlockTools}>
            ${BlockCanvas ? h`<div ref=${canvasRef} className="os-ed-canvas os-ed-canvas--bc block-editor__container" style=${{ minHeight: `${minHeight}px` }}>
              <${BlockCanvas} height=${`${Math.max(minHeight, 240)}px`} styles=${collectCanvasStyles()} />
            </div>` : h`<${WritingFlow}>
              <${ObserveTyping}>
                <div ref=${canvasRef} className="os-ed-canvas px-3 py-3 block-editor__container" style=${{ minHeight: `${minHeight}px` }}>
                  <${BlockList} />
                </div>
              </${ObserveTyping}>
            </${WritingFlow}>`}
          </${BlockTools}>
        </div>
        ${hasInspector && showInspector ? h`<div className="os-block-inspector w-64 shrink-0 border-l border-border bg-card overflow-y-auto max-h-[60vh] text-sm">
          <${BlockInspector} />
        </div>` : null}
      </div>`}
    </${BlockEditorProvider}>
    </${Shortcuts}>
    </${SlotFill}>
  </div>`;
}

// Persistent top toolbar matching WP's block-editor chrome:
//   [+ Add block]  [↶ Undo]  [↷ Redo]  | [ contextual block toolbar ]  [⚙]
// Undo/Redo dispatch on the core/block-editor store (scoped to whatever
// BlockEditorProvider this toolbar lives inside thanks to the implicit
// registry context).
function GutenbergComposerToolbar({ canToggleInspector, inspectorOpen, onToggleInspector, listViewOpen, onToggleListView, mode, onShowVisual, onShowCode }) {
  const dispatch = window.wp?.data?.dispatch;
  const undo = useCallback(() => {
    try { dispatch?.('core/block-editor')?.undo(); } catch {}
  }, [dispatch]);
  const redo = useCallback(() => {
    try { dispatch?.('core/block-editor')?.redo(); } catch {}
  }, [dispatch]);
  return h`<div className="os-block-editor-chrome sticky top-0 z-20 flex items-center gap-1 border-b border-border bg-card overflow-x-auto">
    <${CIToolbar} label="Document tools" className="os-composer-toolbar shrink-0">
      <${WPToolbarGroup}>
        ${Inserter ? h`<${Inserter}
          position="bottom right"
          renderToggle=${({ onToggle, isOpen, disabled }) => h`<${WPToolbarButton}
            icon=${iconPlus}
            label="Add block"
            className="os-inserter-toggle"
            onClick=${onToggle}
            disabled=${disabled}
            isActive=${isOpen}
          />`}
        />` : null}
        <${WPToolbarButton} icon=${iconUndo} label="Undo" onClick=${undo} />
        <${WPToolbarButton} icon=${iconRedo} label="Redo" onClick=${redo} />
        ${WPListView ? h`<${WPToolbarButton}
          icon=${iconListView}
          label="List view"
          isActive=${listViewOpen}
          onClick=${onToggleListView}
        />` : null}
      </${WPToolbarGroup}>
    </${CIToolbar}>
    ${BlockToolbar ? h`<div className="os-composer-blocktoolbar flex-1 min-w-0">
      <${BlockToolbar} hideDragHandle />
    </div>` : null}
    <div className="ml-auto shrink-0 flex items-center gap-1">
      <div className="os-composer-viewtoggle flex items-center">
        <${WPButton} size="small" isPressed=${mode !== 'code'} onClick=${mode === 'code' ? onShowVisual : undefined}>Visual</${WPButton}>
        <${WPButton} size="small" isPressed=${mode === 'code'} onClick=${mode !== 'code' ? onShowCode : undefined}>Code</${WPButton}>
      </div>
      ${canToggleInspector ? h`<${CIToolbar} label="Settings" className="os-composer-toolbar">
        <${WPToolbarGroup}>
          <${WPToolbarButton}
            icon=${iconDrawerRight}
            label=${inspectorOpen ? 'Hide settings' : 'Show settings'}
            isActive=${inspectorOpen}
            onClick=${onToggleInspector}
          />
        </${WPToolbarGroup}>
      </${CIToolbar}>` : null}
    </div>
  </div>`;
}

// Shared, persisted full-width toggle for the editor pages (wizard,
// reminder, …). One localStorage key so the preference carries across them.
export function useEditorFullWidth() {
  const [fullWidth, setFullWidth] = useState(() => {
    try { return localStorage.getItem('ci:editor-fullwidth') === '1'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setFullWidth((v) => {
      const next = !v;
      try { localStorage.setItem('ci:editor-fullwidth', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);
  return [fullWidth, toggle];
}

// The expand / contract glyph as a standalone SVG element, so it can be used
// both by the bordered standalone button below and as a header toolbar
// contribution (EditorToolbarItem children, via the toolbar API).
export function fullWidthIcon(fullWidth, size = 16) {
  return fullWidth
    ? h`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`
    : h`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
}

// Compact icon button that expands/contracts an editor page's content width.
// Still used by editors that render their own toolbars (wizards / reminders);
// editors that use the shared EditorHeader contribute the toggle through the
// toolbar API instead, so it sits unframed in the header's icon group.
export function EditorFullWidthButton({ fullWidth, onToggle }) {
  return h`<button
    type="button"
    onClick=${onToggle}
    aria-pressed=${fullWidth}
    title=${fullWidth ? 'Use readable width' : 'Expand to full width'}
    className=${'inline-flex items-center justify-center w-10 h-10 rounded-md border ' + (fullWidth ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card hover:border-primary text-foreground')}
  >
    ${fullWidthIcon(fullWidth)}
  </button>`;
}
