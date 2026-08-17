/**
 * The .llm editor, as a Context app leaf. CORE-25 / CORE-30.
 *
 * This file replaces a wp-admin picker and a `replace_editor` takeover that were
 * both aimed at screens CI core redirects away from. CI core does not use
 * WordPress post screens for its types: class-context-app.php:689 bounces
 * load-post-new.php, load-edit-tags.php, load-upload.php and even load-index.php
 * into its own React app. A picker on post-new.php cannot ever appear, and the
 * wp-admin edit screen is, in CI core's own words, "a fallback for revisions /
 * status edits".
 *
 * The real extension points already exist, and every sibling uses them:
 *
 *   registerEditor(key, render, opts)   ci-core.js:116
 *   opts.selectable: true               puts the editor in the Content Types
 *                                       picker; "the picker reads the registry,
 *                                       not a hard-coded list"
 *   typeMeta(type).editors: []          per-type list; >1 renders the switcher
 *                                       in the header with a ?ed= param
 *
 * So CORE-30's "format picker" is not a thing to build. It is CI core's editor
 * switcher, and .llm just has to turn up in it. The modal I wrote was a second
 * picker competing with the one already on the page.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { h, rest, registerEditor, typeMeta, CIRegistry } from 'ci/core';

/**
 * Where the canvas's own files are, worked out from this file's own URL.
 *
 * This leaf sits at  …/ci-llm/assets/ci-app-llm.js
 * and the canvas at  …/ci-llm/assets/llm-editor/src/…
 *
 * import.meta.url rather than a PHP-supplied path. I first wrote a
 * `context_intelligence_boot` filter to inject it and then checked: that filter
 * never existed, I had invented it. The check was worth more than the filter,
 * because this is strictly better anyway. A module that locates its own siblings
 * cannot be told the wrong URL, survives a renamed or relocated plugin
 * directory, and needs no server round-trip to know where it lives.
 */
const ASSETS = new URL( 'llm-editor/', import.meta.url ).href;

/**
 * Deploy stamp for NON-MODULE resources (CSS, shell.html): this module's own
 * query string, verbatim (?v=<mtime>&b=<core build>, both from the importmap
 * entry), reapplied to resources the import map cannot reach.
 *
 * Never applied to module imports: `boot.js?v=x` importing `./host.js`
 * resolves WITHOUT the query, so a stamped entry plus plain deps would load
 * two instances of the same module and split the graph (setHost on one copy,
 * boot reading the other). Modules are stamped by the import map instead
 * (canvas_map() in class-llm-app.php), which does reach transitive imports.
 */
const VER = new URL( import.meta.url ).search.replace( /^\?/, '' );
const stamped = ( url ) => VER ? `${ url }${ url.includes( '?' ) ? '&' : '?' }${ VER }` : url;

/**
 * The parent page's import map entries for the canvas, re-serialised for the
 * iframe. An iframe is its own realm with its own resolution context: the
 * parent's map does not apply inside it, so without this the frame's modules
 * load at their PLAIN urls and can go stale independently of the parent's.
 */
function canvasImportMap() {
	try {
		const raw = JSON.parse( document.querySelector( 'script[type="importmap"]' )?.textContent || '{}' ).imports || {};
		const mine = {};
		for ( const [ k, v ] of Object.entries( raw ) ) {
			if ( k.startsWith( ASSETS ) ) mine[ k ] = v;
		}
		if ( ! Object.keys( mine ).length ) return '';
		return `<script type="importmap">${ JSON.stringify( { imports: mine } ) }<\/script>`;
	} catch ( e ) {
		return ''; // no map, plain URLs; the canvas still boots.
	}
}

/**
 * The seed for a brand new .llm document.
 *
 * Anchored heading plus an edge, so the very first save is already detectable as
 * .llm by Format::is_llm(). An empty body would be detected as blocks and the
 * choice would evaporate on reload.
 */
const SEED = `---
type: skill
name: untitled
description: One sentence on what this is and when it fires.
---

# First step {#start}

What happens first.

-> #next

# Next step {#next}

What happens after.
`;

/**
 * Mount the canvas into a container the React leaf owns.
 *
 * The canvas is not React. It is 24 plain ES modules that expect to own a DOM
 * shell and read/write it directly, which is exactly why it can also run in a VS
 * Code webview and in a standalone page. Rewriting it as React components would
 * fork it three ways to satisfy one host.
 *
 * So: React owns a div, the canvas owns everything inside it, and the host
 * contract carries the document across. The one rule is that mounting must be
 * idempotent, because React will re-run effects.
 */
// Keyed on the ELEMENT, not a module-level boolean.
//
// A `let mounted = false` would be true for the life of the page after the
// first mount, so opening a second document, or leaving and coming back, would
// hand React a fresh empty div and skip the mount: a blank canvas that only
// ever appears on the second visit. The WeakSet answers the real question
// ("has THIS element been mounted"), and drops the entry when React discards
// the node.
const MOUNTED = new WeakSet();

/**
 * The canvas stylesheet, loaded once into the document head.
 *
 * shell.html is a FRAGMENT and carries no <link> of its own, because its other
 * two hosts supply the CSS themselves: the VS Code webview and the wp-admin
 * fallback screen both emit the tag. This leaf did not, so the canvas mounted
 * and parsed correctly and rendered as a plain stack of unstyled text, which
 * reads like a much deeper failure than a missing stylesheet.
 *
 * Resolved once and awaited, so the canvas never paints unstyled first.
 */
let cssReady = null;

function sheet( href ) {
	return new Promise( ( resolve ) => {
		if ( document.querySelector( `link[href="${ href }"]` ) ) return resolve();
		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = href;
		// Resolve either way: a missing stylesheet should degrade to an ugly
		// canvas, never to a promise that hangs and blocks the mount forever.
		link.onload = resolve;
		link.onerror = resolve;
		document.head.appendChild( link );
	} );
}

function loadCss() {
	if ( cssReady ) return cssReady;
	cssReady = Promise.all( [
		// The canvas's own look, shared with every host.
		sheet( stamped( `${ ASSETS }src/editor/editor.css` ) ),
		// This host's overrides. Loaded AFTER, so it wins on source order at
		// equal specificity. NOT admin.css: that one is for the wp-admin
		// fallback screen and would strip the padding off CI's app shell.
		sheet( stamped( new URL( 'ci-app-llm.css', import.meta.url ).href ) ),
	] );
	return cssReady;
}

async function mountCanvas( el, ctx, hooks = {} ) {
	if ( MOUNTED.has( el ) ) return;
	MOUNTED.add( el );

	const [ shell ] = await Promise.all( [
		fetch( `${ ASSETS }src/editor/shell.html` ).then( ( r ) => r.text() ),
		loadCss(),
	] );
	el.innerHTML = shell;

	const { setHost } = await import( `${ ASSETS }src/host/host.js` );

	// A CI-app host rather than the generic WordPress one: inside the Context
	// app we already have `rest()` from ci/core, which carries the nonce, the
	// namespace and CI's own error handling. Reaching for window.wpApiSettings
	// here would be reimplementing that badly.
	//
	// The route is built from `meta.rest_base`, which is what ci-type.js:1705
	// uses. My first cut read `ctx.restBase`: a property I INVENTED. The
	// dispatch at ci-type.js:7007 passes exactly { type, id, isNew, meta } and
	// nothing else, so it was undefined, and template interpolation turned that
	// into the string "undefined" rather than throwing. The request went to
	// `/wp-jsonundefined/7` and 404'd. An undefined that reads as a URL is why
	// this looked like a mount failure instead of a typo.
	//
	// Leading slash, because rest() is `REST_BASE + path` (ci-core.js:43) and
	// REST_BASE has its trailing slash stripped.
	const base = `/wp/v2/${ ctx.meta.rest_base }`;

	// The document's own address, remembered at load so save can hand it back.
	//
	// Core's Path_Meta::on_save (class-path-meta.php:77) fires on EVERY save,
	// re-derives os_path from a `<!-- ci:path=… -->` marker in the content, and
	// calls delete_post_meta when it finds none. No document on any site carries
	// that marker, so a content-only save DELETES os_path, and the post drops out
	// of the VFS: ci/path-ls and ci/path-resolve stop seeing it, which is exactly
	// how agents address it. Saving a skill in the canvas would quietly unaddress
	// it.
	//
	// So the editor hands back what it was given. This does not manage os_path and
	// must not destroy it: an editor that silently deletes metadata it does not
	// own is worse than one that cannot edit it at all.
	let ciPath = null;

	setHost( {
		name: 'ci-app',
		async load() {
			if ( ctx.isNew ) return SEED;
			const post = await rest( `${ base }/${ ctx.id }?context=edit&_fields=content,meta` );
			ciPath = post?.meta?.os_path || null;
			return ( post && post.content && post.content.raw ) || SEED;
		},
		async save( text ) {
			// Hand the text up before writing it. CI's header owns the title, and
			// saving a title has to carry the CURRENT body with it or the POST
			// would revert whatever the canvas has done since load.
			hooks.onText?.( text );
			// `body`, not `data`: rest() spreads opts straight into fetch()
			// (ci-core.js:50), so it takes a serialised body like every other
			// caller. A `data` key would have been silently dropped and the
			// POST would have saved nothing while reporting success.
			//
			// `meta` only when there IS one: sending os_path: null or '' would
			// write an empty address, which is a different way of losing it.
			await rest( `${ base }/${ ctx.id }`, {
				method: 'POST',
				body: JSON.stringify( ciPath ? { content: text, meta: { os_path: ciPath } } : { content: text } ),
			} );
		},
		// Mirror the canvas's own save state into CI's header, rather than
		// keeping a second one here that guesses from the outside. The canvas
		// knows; this just forwards.
		onSaveState: ( label, busy ) => hooks.onSaveState?.( label, busy ),
		pickFile: ciPickFile,
		readFile: ciReadFile,
	} );

	await import( `${ ASSETS }src/editor/boot.js` );
}

/* File-node host pieces, shared by the full-page mount above and the body
   embed below. Parent-realm closures on purpose: rest() carries the nonce and
   openPicker renders in the parent document, and same-origin iframes may call
   straight into them. */
async function ciPickFile( opts = {} ) {
	const { openPicker } = await import( `${ ASSETS }src/editor/file-picker.js` );
	return openPicker( {
		sources: [
			{
				id: 'ci',
				label: 'Context',
				search: async ( term ) => {
					const rows = await rest( `/wp/v2/search?search=${ encodeURIComponent( term || '' ) }&per_page=20` );
					return ( rows || [] ).map( ( r ) => ( { uri: r.url, label: `${ r.title } (${ r.subtype })` } ) );
				},
			},
		],
		accept: opts.accept,
	} );
}

async function ciReadFile( uri ) {
	try {
		const r = await fetch( uri, { credentials: 'same-origin' } );
		return r.ok ? await r.text() : null;
	} catch {
		return null;   // OKF: consumers MUST tolerate broken links.
	}
}

/**
 * The page: CI's chrome on top, the canvas underneath.
 *
 * This is the ci-canvas shape (ci-app-canvas.js:3429), and it is the shape for a
 * reason. The EDITOR SWITCHER, which is the whole of what CORE-30 asked for,
 * lives inside CI's EditorHeader and "self-discovers from the route so every
 * editor that uses this shared header gets it for free"
 * (ci-editor-chrome.js:447). An editor that draws its own header instead does
 * not get it, and .llm did not: the type advertised the editor and offered no
 * way to reach it short of typing ?ed=llm by hand.
 *
 * So CI owns the title, the save button and the switcher. The canvas keeps its
 * own toolbar below (inserter, undo/redo, positions, source/agent), which is
 * canvas-specific and has no CI equivalent. Exactly how ci-canvas splits it, and
 * why it passes canInsert=false.
 */
function LlmEditorPage() {
	const TypeLayout = CIRegistry.TypeLayout;
	const EditorHeader = CIRegistry.EditorHeader;
	const { type, id } = useParams();
	const navigate = useNavigate();
	const meta = typeMeta( type );
	const isNew = id === 'new';

	const [ title, setTitle ] = useState( '' );
	const [ titleDirty, setTitleDirty ] = useState( false );
	const [ saving, setSaving ] = useState( false );
	const [ canvasDirty, setCanvasDirty ] = useState( false );
	// The canvas owns the document text; this is the latest it has handed us.
	const text = useRef( '' );
	// And its address, for the same reason the host keeps one: every save has to
	// hand os_path back or core's Path_Meta::on_save deletes it and the document
	// falls out of the VFS. See the note on `ciPath` in mountCanvas.
	const ciPath = useRef( null );

	useEffect( () => {
		if ( isNew ) return;
		( async () => {
			try {
				const p = await rest( `/wp/v2/${ meta.rest_base }/${ id }?context=edit&_fields=title,meta` );
				setTitle( p.title?.raw || '' );
				ciPath.current = p.meta?.os_path || null;
			} catch { /* the canvas reports its own load failures; do not double-report */ }
		} )();
	}, [ type, id ] );

	// The canvas's save state, forwarded rather than re-derived. 'Saving…' is the
	// only busy label it emits; 'Saved' means the body is durable.
	const onSaveState = useCallback( ( label, busy ) => {
		setSaving( busy );
		if ( ! busy && label === 'Saved' ) setCanvasDirty( false );
		else if ( busy ) setCanvasDirty( true );
	}, [] );

	const save = useCallback( async () => {
		setSaving( true );
		try {
			// Title AND body together. A title-only POST would revert the body to
			// whatever was last loaded, silently undoing the canvas. And os_path
			// with them, or this save deletes the document's address.
			const body = { title, content: text.current };
			if ( ciPath.current ) body.meta = { os_path: ciPath.current };
			await rest( `/wp/v2/${ meta.rest_base }/${ id }`, {
				method: 'POST',
				body: JSON.stringify( body ),
			} );
			setTitleDirty( false );
		} finally { setSaving( false ); }
	}, [ title, id, meta?.rest_base ] );

	const hooks = useRef( null );
	if ( ! hooks.current ) {
		hooks.current = {
			onText: ( t ) => { text.current = t; },
			onSaveState,
		};
	}

	if ( ! meta ) return h`<${ TypeLayout } type=${ type }><div className="p-10 text-muted-foreground">Unknown type: ${ type }</div></${ TypeLayout }>`;

	return h`<${ TypeLayout } type=${ type } activeId=${ id } mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
		<div className="flex flex-col h-full bg-card pt-14">
			<${ EditorHeader }
				title=${ title }
				setTitle=${ ( v ) => { setTitle( v ); setTitleDirty( true ); } }
				placeholder=${ `${ meta.singular || 'Document' } title…` }
				dirty=${ titleDirty || canvasDirty }
				isNew=${ isNew }
				saving=${ saving }
				onSave=${ save }
				onClose=${ () => navigate( `/t/${ type }` ) }
				editorMode=${ null }
				onSetEditorMode=${ null }
				fileLang=${ null }
				canInsert=${ false }
			/>
			${ '' /* className, not class: CI's `h` is htm bound to REACT's createElement,
			        not preact's. React drops an unknown DOM property after a console
			        warning, so this div rendered with no class at all and the mount
			        had no styles and nothing to select it by. */ }
			<div
				className="ci-llm-mount flex-1 min-h-0 relative"
				ref=${ ( el ) => { if ( el ) mountCanvas( el, { type, id, isNew, meta }, hooks.current ); } }
			/>
		</div>
	</${ TypeLayout }>`;
}

/**
 * Body-mode embed: the canvas inside an IFRAME, driven by { value, onChange }.
 *
 * An iframe, not a div. boot.js and state.js grab their elements and wire
 * listeners at module top level, so one module graph carries exactly ONE
 * canvas; a second mount into the same document goes dead silently. An iframe
 * is its own realm with its own module graph: every mount boots fresh, the
 * full-page editor above keeps its singleton, and unmount is discarding the
 * frame. Same-origin, so the host below is plain parent-realm closures.
 *
 * The parent hands the body in once (load) and receives every edit back
 * (save → onChange). The echo — onChange updates the parent's state, which
 * re-renders this component with the new value — must NOT rebuild the frame:
 * the canvas owns the text while mounted, so the frame is built exactly once
 * per mount and value-prop changes are only read before that build.
 *
 * `fill`: fill the parent's height instead of the default 72vh. Opt-in, so the
 * scrolling body composer keeps its viewport-relative size while a height-bounded
 * host (the ci-filesystem preview pane) can stretch the canvas edge to edge.
 */
async function buildBodyFrame( iframe, hostApi ) {
	const [ shell ] = await Promise.all( [
		fetch( stamped( `${ ASSETS }src/editor/shell.html` ) ).then( ( r ) => r.text() ),
	] );
	if ( ! iframe.isConnected ) return; // unmounted while fetching
	const doc = iframe.contentDocument;
	doc.open();
	doc.write( `<!doctype html><html><head><meta charset="utf-8">
		${ canvasImportMap() }
		<link rel="stylesheet" href="${ stamped( `${ ASSETS }src/editor/editor.css` ) }">
		<link rel="stylesheet" href="${ stamped( new URL( 'ci-app-llm.css', import.meta.url ).href ) }">
		<style>body{margin:0}</style></head><body></body></html>` );
	doc.close();
	iframe.contentWindow.__ciLlmHost = hostApi;
	doc.body.innerHTML = shell;
	const s = doc.createElement( 'script' );
	s.type = 'module';
	// Runs in the IFRAME's realm — importing from the parent would land the
	// host on the parent's singleton graph instead of this frame's.
	s.textContent = `
		const H = window.__ciLlmHost;
		const { setHost } = await import( ${ JSON.stringify( `${ ASSETS }src/host/host.js` ) } );
		setHost( { name: 'ci-body', load: H.load, save: H.save, onSaveState: H.onSaveState, pickFile: H.pickFile, readFile: H.readFile } );
		await import( ${ JSON.stringify( `${ ASSETS }src/editor/boot.js` ) } );
	`;
	doc.body.appendChild( s );
}

function LlmBodyEditor( { value, onChange, fill = false } ) {
	const boxRef = useRef( null );
	const builtRef = useRef( false );
	const valueRef = useRef( '' );
	const onChangeRef = useRef( onChange );
	onChangeRef.current = onChange;
	if ( ! builtRef.current ) valueRef.current = value; // pre-build only; after that the canvas owns the text.

	useEffect( () => {
		const box = boxRef.current;
		if ( ! box ) return;
		const iframe = document.createElement( 'iframe' );
		iframe.setAttribute( 'title', '.llm editor' );
		iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;';
		box.appendChild( iframe );
		builtRef.current = true;
		buildBodyFrame( iframe, {
			load: () => valueRef.current || SEED,
			save: async ( text ) => {
				valueRef.current = text;
				onChangeRef.current?.( text );
			},
			onSaveState: () => {},
			pickFile: ciPickFile,
			readFile: ciReadFile,
		} );
		return () => {
			builtRef.current = false;
			box.removeChild( iframe );
		};
	}, [] );

	// Default: viewport-relative height for the scrolling body composer. `fill`:
	// stretch to the parent's height (a height-bounded pane, e.g. the ci-filesystem
	// preview) and drop the inner frame, since the pane already supplies chrome.
	return h`<div ref=${ boxRef }
		className=${ fill ? 'relative overflow-hidden bg-card' : 'relative border border-border rounded-md overflow-hidden bg-card' }
		style=${ fill ? { height: '100%' } : { height: '72vh', minHeight: '480px' } } />`;
}

// Published for core's body composer: when present, the composer collapses its
// Code + Diagram modes into this (Blocks | .llm). Absent companion, absent key,
// and the composer keeps its own three modes — the usual registry contract.
CIRegistry.LlmBodyEditor = LlmBodyEditor;

registerEditor( 'llm', () => h`<${ LlmEditorPage } />`, {
	selectable: true,
	title: '.llm editor',
	description: 'A document that is also a graph. Heading depth is containment; steps carry edges.',
	// newFile puts ".llm editor" in the single-new menu, which is the OTHER half
	// of what the modal was trying to do, done by the surface that owns it.
	newFile: { label: '.llm editor', desc: 'Start a flow: steps, decisions and edges.' },
} );
