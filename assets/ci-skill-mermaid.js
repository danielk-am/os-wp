/**
 * Context — Skill structure → Mermaid flowchart (auto-derived).
 *
 * Turns a skill's markdown body into a Mermaid `flowchart TD` by walking its
 * STRUCTURE, not its prose: headings (nested by depth), XML-ish markup tags
 * (nested), fenced code blocks, and numbered steps (chained in sequence).
 * Anything that "fences" a section becomes a node; plain paragraphs are
 * skipped. Lossy + read-only — a navigational overview of the skill, never
 * round-tripped back to markdown.
 *
 * No build step — hand-authored native ES module. `skillBodyToMermaid` uses no
 * app APIs (only string work), so it stays unit-testable on its own; the
 * `SkillOutline` renderer below lazy-loads the (otherwise unused) 3 MB mermaid
 * bundle the first time it mounts and publishes itself on CIRegistry.
 */

import { h, CIRegistry, rest, registerRoute, registerNavRow } from 'ci/core';
import { PageHeading, SelectMenu } from 'ci/ui';
import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_NODES = 80; // keep generated diagrams readable; truncate beyond this.

// Strip inline HTML tags from a block-markup heading's inner text (e.g.
// `<h2>Fix <em>the</em> bug</h2>` → `Fix the bug`).
const stripTags = ( s ) => String( s ).replace( /<[^>]+>/g, '' );

// Cross-reference syntax: [[slug]] / [[slug|label]] (CI wikilinks) and
// ci://type/slug paths. Used both to spot references for clickable nodes and
// to tidy them out of other nodes' labels.
const WIKILINK_RX = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
const CIPATH_RX = /\bci:\/\/([A-Za-z0-9][\w/-]*)/g;
const cleanRefs = ( s ) => String( s )
  .replace( WIKILINK_RX, ( _, slug, label ) => ( label || slug ).trim() )
  .replace( CIPATH_RX, '$1' );

/**
 * Pure transform: markdown body → Mermaid flowchart source.
 * @param {string} md     Raw skill body (frontmatter is stripped).
 * @param {string} title  Optional root-node label (the skill title).
 * @returns {string} `flowchart TD` source, always at least the root node.
 */
export function skillBodyToMermaid( md, title ) {
  const src = String( md || '' );
  // Drop a leading YAML frontmatter block so `---` fences don't leak in.
  const body = src.replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '' );
  const lines = body.split( /\r?\n/ );

  const nodes = []; // { id, label, shape }
  const edges = []; // { from, to }
  const links = []; // { id, ref, label } — clickable cross-reference nodes
  let counter = 0;
  const nid = () => 'n' + ( ++counter );
  let truncated = false;

  const rootId = nid();
  const rootLabel = title || 'Skill';
  nodes.push( { id: rootId, label: rootLabel, shape: 'root' } );
  const norm = ( s ) => String( s ).toLowerCase().replace( /\s+/g, ' ' ).trim();
  const rootNorm = norm( rootLabel );

  const headingStack = []; // { level, id }
  const tagStack = [];     // { tag, id }
  let inFence = false;
  let lastStepId = null;   // chains consecutive numbered steps

  const currentParent = () => {
    if ( tagStack.length ) return tagStack[ tagStack.length - 1 ].id;
    if ( headingStack.length ) return headingStack[ headingStack.length - 1 ].id;
    return rootId;
  };
  const add = ( label, shape, parent ) => {
    if ( nodes.length >= MAX_NODES ) { truncated = true; return null; }
    const id = nid();
    nodes.push( { id, label, shape } );
    edges.push( { from: parent, to: id } );
    return id;
  };

  for ( let li = 0; li < lines.length; li++ ) {
    if ( nodes.length >= MAX_NODES ) { truncated = true; break; }
    let line = lines[ li ].trim();
    if ( ! line ) continue;
    // Strip block-markup wrapper comments (<!-- wp:… -->) so the inner
    // <h2>/<li>/<pre> survives whether or not it shares the line. A line that
    // is only a comment collapses to empty and is skipped.
    if ( line.indexOf( '<!--' ) !== -1 ) { line = line.replace( /<!--[\s\S]*?-->/g, '' ).trim(); if ( ! line ) continue; }

    // Fenced code block: one node per block, skip the contents.
    const fenceOpen = line.match( /^`{3,}\s*([A-Za-z0-9_+-]*)/ );
    if ( ! inFence && fenceOpen ) {
      inFence = true;
      add( '</> ' + ( fenceOpen[ 1 ] || 'code' ), 'code', currentParent() );
      lastStepId = null;
      continue;
    }
    if ( inFence ) { if ( /^`{3,}\s*$/.test( line ) ) inFence = false; continue; }

    // Tables → one node per table, labelled with its header cells + row count,
    // so the structure view shows "there is a table here" without exploding into
    // a node per cell. Both markdown pipe tables and block-markup <table>s.
    const tableNode = ( headerCells, rowCount ) => {
      const head = headerCells.slice( 0, 3 ).join( ' | ' ) || 'Table';
      const rows = rowCount ? ` (${ rowCount } row${ rowCount === 1 ? '' : 's' })` : '';
      add( '▦ ' + head + rows, 'table', currentParent() );
      lastStepId = null;
    };
    // Markdown pipe table: a `| a | b |` header followed by a `|---|---|` rule.
    // Tolerant of markdown trapped inside a wp:html block, where rows arrive as
    // `<p>| a | b |<br>` — strip wrapping tags and <br>s before matching.
    const stripBr = ( s ) => s.replace( /<br\s*\/?>/gi, '' ).replace( /^\s*(?:<[^>]+>\s*)+/, '' ).replace( /(?:\s*<\/?[^>]+>)+\s*$/, '' ).trim();
    const pipeRow = /^\|.*\|$/;
    const cl = stripBr( line );
    if ( pipeRow.test( cl ) ) {
      const next = stripBr( ( lines[ li + 1 ] || '' ).trim() );
      if ( /^\|?[\s:|-]*-[\s:|-]*\|?$/.test( next ) && next.indexOf( '-' ) !== -1 ) {
        const headers = cl.replace( /^\||\|$/g, '' ).split( '|' ).map( ( c ) => stripTags( c ).replace( /\*+/g, '' ).trim() ).filter( Boolean );
        let j = li + 2;
        while ( j < lines.length && pipeRow.test( stripBr( lines[ j ].trim() ) ) ) j++;
        tableNode( headers, j - ( li + 2 ) );
        li = j - 1; // skip the separator and body rows.
        continue;
      }
    }
    // Block-markup table: <figure class="wp-block-table">…<table>…</table>,
    // possibly spread across lines. Summarise its first row + row count.
    if ( /<table[\s>]/i.test( line ) || /wp-block-table/i.test( line ) ) {
      let chunk = line, j = li;
      while ( j < lines.length && ! /<\/table>/i.test( chunk ) ) { j++; chunk += ' ' + ( lines[ j ] || '' ); }
      const trCount = ( chunk.match( /<tr[\s>]/gi ) || [] ).length;
      const firstTr = ( chunk.match( /<tr[\s>][\s\S]*?<\/tr>/i ) || [ chunk ] )[ 0 ];
      const cells = firstTr.match( /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi ) || [];
      const firstRow = cells.slice( 0, 3 ).map( ( c ) => stripTags( c ).trim() ).filter( Boolean );
      tableNode( firstRow, trCount );
      li = j;
      continue;
    }

    // Cross-references — [[wikilink]] / [[slug|label]] and ci://type/slug —
    // become their own clickable nodes under the current section, wherever
    // they appear (prose, steps, headings). The renderer resolves the ref to
    // a post and navigates on click.
    for ( const m of line.matchAll( WIKILINK_RX ) ) {
      const slug = m[ 1 ].trim();
      const label = ( m[ 2 ] || slug ).trim();
      const id = add( label, 'ref', currentParent() );
      if ( id ) links.push( { id, ref: slug, label } );
    }
    for ( const m of line.matchAll( CIPATH_RX ) ) {
      const p = m[ 1 ];
      const id = add( p, 'ref', currentParent() );
      if ( id ) links.push( { id, ref: p, label: p } );
    }

    // Heading: markdown `## x` OR a block-markup `<h2>x</h2>` on its own line
    // (bodies authored in Visual mode are stored as block markup, not md).
    const htmlHead = line.match( /^<h([1-6])\b[^>]*>(.*?)<\/h\1>\s*$/i );
    const head = htmlHead
      ? [ line, '#'.repeat( Number( htmlHead[ 1 ] ) ), stripTags( htmlHead[ 2 ] ) ]
      : line.match( /^(#{1,6})\s+(.+?)\s*#*$/ );
    if ( head ) {
      const level = head[ 1 ].length;
      while ( headingStack.length && headingStack[ headingStack.length - 1 ].level >= level ) headingStack.pop();
      tagStack.length = 0;
      lastStepId = null;
      // A top-level heading whose text matches the title is the root itself —
      // map it onto rootId instead of drawing a duplicate node.
      if ( ! headingStack.length && norm( head[ 2 ] ) === rootNorm ) {
        headingStack.push( { level, id: rootId } );
        continue;
      }
      const parent = headingStack.length ? headingStack[ headingStack.length - 1 ].id : rootId;
      const id = add( head[ 2 ], 'heading', parent );
      if ( id ) headingStack.push( { level, id } );
      continue;
    }

    // XML-ish markup on its own line: <tag ...>, </tag>, <tag/>.
    const closeTag = line.match( /^<\/([A-Za-z][\w-]*)\s*>$/ );
    if ( closeTag ) {
      for ( let i = tagStack.length - 1; i >= 0; i-- ) {
        if ( tagStack[ i ].tag === closeTag[ 1 ] ) { tagStack.length = i; break; }
      }
      lastStepId = null;
      continue;
    }
    const selfTag = line.match( /^<([A-Za-z][\w-]*)(\s[^>]*)?\/>$/ );
    if ( selfTag ) { add( '<' + selfTag[ 1 ] + '/>', 'tag', currentParent() ); lastStepId = null; continue; }
    const openTag = line.match( /^<([A-Za-z][\w-]*)(\s[^>]*)?>$/ );
    if ( openTag ) {
      const id = add( '<' + openTag[ 1 ] + '>', 'tag', currentParent() );
      if ( id ) tagStack.push( { tag: openTag[ 1 ], id } );
      lastStepId = null;
      continue;
    }

    // Numbered step: "1. text" / "1) text" — chained in sequence.
    const step = line.match( /^(\d+)[.)]\s+(.+)$/ );
    if ( step ) {
      const id = add( step[ 2 ], 'step', lastStepId || currentParent() );
      if ( id ) lastStepId = id;
      continue;
    }

    // Any other line ends a step run (so a later list starts fresh).
    lastStepId = null;
  }

  return { source: renderMermaid( nodes, edges, truncated ), links };
}

function renderMermaid( nodes, edges, truncated ) {
  const esc = ( s ) => cleanRefs( String( s ) )
    .replace( /[\r\n]+/g, ' ' )
    .replace( /"/g, '#quot;' )
    .replace( /\s+/g, ' ' )
    .trim()
    .slice( 0, 70 );
  const wrap = ( n ) => {
    const l = '"' + ( esc( n.label ) || ' ' ) + '"';
    switch ( n.shape ) {
      case 'root':    return n.id + '([' + l + '])'; // stadium
      case 'heading': return n.id + '[' + l + ']';   // rectangle
      case 'tag':     return n.id + '{{' + l + '}}'; // hexagon
      case 'code':    return n.id + '[/' + l + '/]'; // parallelogram
      case 'step':    return n.id + '(' + l + ')';   // round
      case 'ref':     return n.id + '>' + l + ']';   // flag — a cross-reference
      case 'table':   return n.id + '[[' + l + ']]'; // subroutine — a table
      default:        return n.id + '[' + l + ']';
    }
  };
  const out = [ 'flowchart TD' ];
  nodes.forEach( ( n ) => out.push( '    ' + wrap( n ) ) );
  edges.forEach( ( e ) => out.push( '    ' + e.from + ' --> ' + e.to ) );
  // Style + flag the clickable reference nodes so they read as links.
  const refIds = nodes.filter( ( n ) => n.shape === 'ref' ).map( ( n ) => n.id );
  if ( refIds.length ) {
    out.push( '    classDef ciref fill:#eef2ff,stroke:#6366f1,color:#3730a3;' );
    out.push( '    class ' + refIds.join( ',' ) + ' ciref;' );
  }
  // Tint table nodes amber so data tables read apart from prose structure.
  const tableIds = nodes.filter( ( n ) => n.shape === 'table' ).map( ( n ) => n.id );
  if ( tableIds.length ) {
    out.push( '    classDef citable fill:#fffbeb,stroke:#d97706,color:#92400e;' );
    out.push( '    class ' + tableIds.join( ',' ) + ' citable;' );
  }
  if ( truncated ) {
    out.push( '    trunc["… (truncated)"]' );
  }
  return out.join( '\n' ) + '\n';
}

// ---------------------------------------------------------------------------
// Renderer — lazy mermaid loader + the editor's Outline panel.

// The 3 MB mermaid bundle is in the importmap but otherwise dead weight. Import
// it once, on first render, and memoise the initialised module so reopening the
// panel is instant. securityLevel 'strict' since skill bodies are user content;
// labels are pre-escaped in renderMermaid, so 'strict' loses nothing here.
let _mermaid = null;
function loadMermaid() {
  if ( ! _mermaid ) {
    _mermaid = import( 'mermaid' ).then( ( m ) => {
      const mer = m.default || m;
      mer.initialize( {
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        flowchart: { useMaxWidth: true, htmlLabels: false },
      } );
      return mer;
    } );
  }
  return _mermaid;
}

let _renderSeq = 0;

const clampZoom = ( z ) => Math.min( 4, Math.max( 0.2, z ) );

// Resolve a cross-reference (slug or os_path) to its post and navigate the
// in-app editor there. Best-effort: an unresolved ref is a silent no-op.
function openRef( refStr ) {
  rest( '/activity/v1/resolve?path=' + encodeURIComponent( refStr ) )
    .then( ( r ) => { if ( r && r.type && r.id ) window.location.hash = `#/t/${ r.type }/${ r.id }`; } )
    .catch( () => {} );
}

/**
 * Read-only structure diagram for a markdown body. Re-derives + re-renders
 * (debounced) as the body changes. Pan by dragging, zoom with the wheel or the
 * +/−/reset controls; reference nodes ([[wikilinks]] / ci://paths) are
 * clickable and navigate to the linked post.
 */
export function SkillOutline( { content, title, slug } ) {
  const ref = useRef( null );          // holds the rendered mermaid SVG
  const viewportRef = useRef( null );  // pan/zoom clipping viewport
  const dragRef = useRef( null );
  const movedRef = useRef( false );    // did the last pointer interaction pan?
  const linksRef = useRef( [] );       // [{ id, ref }] for the delegated click
  const [ status, setStatus ] = useState( 'idle' ); // idle | loading | ok | error | empty
  const [ err, setErr ] = useState( '' );
  const [ view, setView ] = useState( { z: 1, x: 0, y: 0 } );
  const [ dragging, setDragging ] = useState( false );
  const [ backlinks, setBacklinks ] = useState( [] ); // posts that link HERE

  // Inbound side of the graph: what references this post. The diagram itself
  // is outbound (what the body links to); this fills in the other direction.
  useEffect( () => {
    let alive = true;
    setBacklinks( [] );
    if ( ! slug ) return;
    rest( '/activity/v1/backlinks?slug=' + encodeURIComponent( slug ) )
      .then( ( r ) => { if ( alive ) setBacklinks( ( r && r.backlinks ) || [] ); } )
      .catch( () => {} );
    return () => { alive = false; };
  }, [ slug ] );

  useEffect( () => {
    let alive = true;
    const { source, links } = skillBodyToMermaid( content, title );
    // A body with no structure derives to just the root node (no edges).
    if ( source.indexOf( '-->' ) === -1 ) {
      setStatus( 'empty' );
      if ( ref.current ) ref.current.innerHTML = '';
      return;
    }
    setStatus( 'loading' );
    const t = setTimeout( () => {
      loadMermaid().then( async ( mer ) => {
        if ( ! alive ) return;
        try {
          const { svg } = await mer.render( 'ci-skill-outline-' + ( ++_renderSeq ), source );
          if ( ! alive || ! ref.current ) return;
          ref.current.innerHTML = svg;
          // Reference nodes are clickable (handled by the viewport's delegated
          // click below — a per-node listener gets swallowed by panning). Give
          // them a pointer cursor as the affordance. mermaid mangles node ids
          // to `…flowchart-<id>-<n>`, so match the `-<id>-` segment.
          linksRef.current = links;
          for ( const lnk of links ) {
            const el = ref.current.querySelector( `g.node[id*="-${ lnk.id }-"]` );
            if ( el ) el.style.cursor = 'pointer';
          }
          setView( { z: 1, x: 0, y: 0 } );
          setStatus( 'ok' );
          // Flag broken references in red: a [[link]] or ci:// path whose
          // target post does not exist. One batch call (always 200) checks the
          // whole body, so broken links never spray 404s in the console.
          if ( links.length ) {
            rest( '/activity/v1/resolve-refs?refs=' + encodeURIComponent( JSON.stringify( links.map( ( l ) => l.ref ) ) ) )
              .then( ( r ) => {
                if ( ! alive || ! ref.current ) return;
                const results = ( r && r.results ) || {};
                for ( const lnk of links ) {
                  const info = results[ lnk.ref ];
                  if ( info && info.found ) continue; // resolves fine
                  const el = ref.current.querySelector( `g.node[id*="-${ lnk.id }-"]` );
                  if ( ! el ) continue;
                  el.setAttribute( 'data-broken', '1' );
                  const shape = el.querySelector( 'polygon, rect, path' );
                  if ( shape ) { shape.style.stroke = '#dc2626'; shape.style.fill = '#fef2f2'; }
                  el.querySelectorAll( 'text, .nodeLabel, span' ).forEach( ( n ) => { n.style.fill = '#b91c1c'; n.style.color = '#b91c1c'; } );
                  let tt = el.querySelector( 'title' );
                  if ( ! tt ) { tt = document.createElementNS( 'http://www.w3.org/2000/svg', 'title' ); el.appendChild( tt ); }
                  tt.textContent = 'Broken link — no post resolves to "' + lnk.ref + '"';
                }
              } )
              .catch( () => {} );
          }
        } catch ( e ) {
          if ( alive ) { setErr( String( e && e.message || e ) ); setStatus( 'error' ); }
        }
      } ).catch( ( e ) => {
        if ( alive ) { setErr( String( e && e.message || e ) ); setStatus( 'error' ); }
      } );
    }, 350 ); // debounce keystrokes — mermaid render is heavy.
    return () => { alive = false; clearTimeout( t ); };
  }, [ content, title ] );

  // Wheel-zoom needs a non-passive listener (React's onWheel is passive and
  // can't preventDefault, which would scroll the page instead).
  useEffect( () => {
    const vp = viewportRef.current;
    if ( ! vp ) return;
    const onWheel = ( e ) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView( ( v ) => ( { ...v, z: clampZoom( v.z * f ) } ) );
    };
    vp.addEventListener( 'wheel', onWheel, { passive: false } );
    return () => vp.removeEventListener( 'wheel', onWheel );
  }, [ status ] );

  const onPointerDown = ( e ) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    movedRef.current = false;
    setDragging( true );
  };
  const onPointerMove = ( e ) => {
    const d = dragRef.current;
    if ( ! d ) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if ( Math.abs( dx ) + Math.abs( dy ) > 4 ) movedRef.current = true;
    setView( ( v ) => ( { ...v, x: d.ox + dx, y: d.oy + dy } ) );
  };
  const endDrag = () => { dragRef.current = null; setDragging( false ); };
  // Delegated click: a bare click (no pan) on a reference node navigates to
  // the linked post. setPointerCapture would steal the click, so we don't use
  // it — this catches the bubbled click instead, guarded by the drag flag.
  const onViewportClick = ( e ) => {
    if ( movedRef.current ) return;
    const g = e.target.closest && e.target.closest( 'g.node' );
    if ( ! g ) return;
    const m = g.id.match( /flowchart-(n\d+)-/ );
    if ( ! m ) return;
    const lnk = linksRef.current.find( ( l ) => l.id === m[ 1 ] );
    if ( lnk ) openRef( lnk.ref );
  };
  const zoom = ( f ) => setView( ( v ) => ( { ...v, z: clampZoom( v.z * f ) } ) );
  const reset = () => setView( { z: 1, x: 0, y: 0 } );

  const ctrl = ( label, onClick, tip ) => h`<button type="button" title=${ tip } aria-label=${ tip }
    onClick=${ ( e ) => { e.stopPropagation(); onClick(); } }
    onPointerDown=${ ( e ) => e.stopPropagation() }
    className="w-7 h-7 flex items-center justify-center rounded border border-border bg-card text-sm text-foreground hover:bg-muted shadow-sm">${ label }</button>`;

  return h`<div className="ci-skill-outline">
    ${ backlinks.length ? h`<div className="mb-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Referenced by</div>
      <ul className="space-y-1">
        ${ backlinks.map( ( b ) => h`<li key=${ b.id } className="text-xs">
          <button type="button"
            onClick=${ () => { window.location.hash = `#/t/${ b.type }/${ b.id }`; } }
            className="text-primary hover:underline">${ b.title || b.slug }</button>
          <span className="text-muted-foreground"> · ${ b.type }</span>
        </li>` ) }
      </ul>
    </div>` : null }
    ${ status === 'empty' ? h`<p className="text-xs text-muted-foreground">Add headings, numbered steps, fenced blocks, markup tags, or [[references]] to the body to see a structure diagram.</p>` : null }
    ${ status === 'loading' ? h`<p className="text-xs text-muted-foreground">Rendering diagram…</p>` : null }
    ${ status === 'error' ? h`<p className="text-xs text-red-600">Could not render the diagram.<br/>${ err }</p>` : null }
    <div ref=${ viewportRef } className="ci-skill-outline-viewport"
      style=${ { position: 'relative', overflow: 'hidden', height: '60vh', minHeight: '320px', display: status === 'ok' ? 'block' : 'none', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' } }
      onPointerDown=${ onPointerDown } onPointerMove=${ onPointerMove } onPointerUp=${ endDrag } onPointerLeave=${ endDrag } onClick=${ onViewportClick }>
      <div style=${ { position: 'absolute', top: '8px', right: '8px', zIndex: 2, display: 'flex', gap: '4px' } }>
        ${ ctrl( '+', () => zoom( 1.2 ), 'Zoom in' ) }
        ${ ctrl( '−', () => zoom( 1 / 1.2 ), 'Zoom out' ) }
        ${ ctrl( '⤢', reset, 'Reset view' ) }
      </div>
      <div ref=${ ref } className="ci-skill-outline-svg"
        style=${ { transform: `translate(${ view.x }px, ${ view.y }px) scale(${ view.z })`, transformOrigin: '0 0' } } />
    </div>
  </div>`;
}

CIRegistry.SkillOutline = SkillOutline;

// ---------------------------------------------------------------------------
// Whole-graph overview — every skill + wiki post as a node, every resolved
// reference as an edge. Its own page (#/graph). Drawn as a force-directed
// nodes-and-lines graph (dots sized by connection count, straight edges),
// with the same pan / zoom / click-to-open interactions as the per-doc
// diagram. The per-doc structure diagram above stays on mermaid; this page
// does not load it.

// Force-directed layout: pairwise repulsion, spring attraction along edges,
// and a weak centering pull, cooled over a fixed iteration budget. Runs
// synchronously — the graph is a few hundred nodes at most, and a one-shot
// layout keeps positions stable for the pan/zoom transform (an animated sim
// would fight the CSS-transform viewport).
function forceLayout( nodes, edges ) {
  const N = nodes.length;
  const idx = {};
  nodes.forEach( ( n, i ) => { idx[ n.id ] = i; } );
  const links = edges
    .map( ( e ) => [ idx[ e.from ], idx[ e.to ] ] )
    .filter( ( l ) => l[ 0 ] !== undefined && l[ 1 ] !== undefined && l[ 0 ] !== l[ 1 ] );

  // Deterministic ring start (golden-angle spread, radius jittered by a hash
  // of the index) so re-renders of the same data produce the same picture.
  const pos = new Array( N );
  for ( let i = 0; i < N; i++ ) {
    const a = i * 2.399963; // golden angle
    const r = 120 + ( ( i * 2654435761 >>> 0 ) % 160 );
    pos[ i ] = { x: Math.cos( a ) * r, y: Math.sin( a ) * r };
  }

  const K = 90;      // ideal edge length
  const ITER = 300;
  for ( let iter = 0; iter < ITER; iter++ ) {
    const temp = 12 * ( 1 - iter / ITER ) + 0.5; // max displacement, cooling
    const dx = new Float64Array( N );
    const dy = new Float64Array( N );

    for ( let i = 0; i < N; i++ ) {
      for ( let j = i + 1; j < N; j++ ) {
        let vx = pos[ i ].x - pos[ j ].x;
        let vy = pos[ i ].y - pos[ j ].y;
        let d2 = vx * vx + vy * vy;
        if ( d2 < 0.01 ) { vx = ( ( i + j ) % 2 ) ? 0.1 : -0.1; vy = 0.1; d2 = 0.02; }
        const f = ( K * K ) / d2 * 0.6; // repulsion
        const d = Math.sqrt( d2 );
        dx[ i ] += ( vx / d ) * f; dy[ i ] += ( vy / d ) * f;
        dx[ j ] -= ( vx / d ) * f; dy[ j ] -= ( vy / d ) * f;
      }
    }
    links.forEach( ( [ a, b ] ) => {
      const vx = pos[ a ].x - pos[ b ].x;
      const vy = pos[ a ].y - pos[ b ].y;
      const d = Math.sqrt( vx * vx + vy * vy ) || 0.01;
      const f = ( d - K ) * 0.05; // spring
      dx[ a ] -= ( vx / d ) * f; dy[ a ] -= ( vy / d ) * f;
      dx[ b ] += ( vx / d ) * f; dy[ b ] += ( vy / d ) * f;
    } );
    for ( let i = 0; i < N; i++ ) {
      dx[ i ] -= pos[ i ].x * 0.005; // centering
      dy[ i ] -= pos[ i ].y * 0.005;
      const disp = Math.sqrt( dx[ i ] * dx[ i ] + dy[ i ] * dy[ i ] ) || 1;
      const cap = Math.min( disp, temp );
      pos[ i ].x += ( dx[ i ] / disp ) * cap;
      pos[ i ].y += ( dy[ i ] / disp ) * cap;
    }
  }
  return { pos, idx };
}

const GRAPH_TYPE_COLORS = {
  skill:  { fill: '#eef2ff', stroke: '#6366f1', text: '#3730a3' },
  wiki:   { fill: '#ecfeff', stroke: '#0891b2', text: '#155e75' },
  memory: { fill: '#fffbeb', stroke: '#d97706', text: '#92400e' },
};
const GRAPH_FALLBACK_COLOR = { fill: '#f8fafc', stroke: '#64748b', text: '#334155' };
const GRAPH_BROKEN_COLOR   = { fill: '#fef2f2', stroke: '#dc2626', text: '#991b1b' };

function buildGraphSvg( nodes, edges ) {
  const escXml = ( s ) => String( s ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
  const { pos, idx } = forceLayout( nodes, edges );

  const degree = {};
  edges.forEach( ( e ) => {
    degree[ e.from ] = ( degree[ e.from ] || 0 ) + 1;
    degree[ e.to ] = ( degree[ e.to ] || 0 ) + 1;
  } );

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pos.forEach( ( p ) => {
    minX = Math.min( minX, p.x ); maxX = Math.max( maxX, p.x );
    minY = Math.min( minY, p.y ); maxY = Math.max( maxY, p.y );
  } );
  const PAD = 70;
  const w = Math.max( 320, maxX - minX + PAD * 2 );
  const hgt = Math.max( 240, maxY - minY + PAD * 2 );
  const X = ( p ) => ( p.x - minX + PAD ).toFixed( 1 );
  const Y = ( p ) => ( p.y - minY + PAD ).toFixed( 1 );

  const lines = edges
    .filter( ( e ) => idx[ e.from ] !== undefined && idx[ e.to ] !== undefined )
    .map( ( e ) => `<line x1="${ X( pos[ idx[ e.from ] ] ) }" y1="${ Y( pos[ idx[ e.from ] ] ) }" x2="${ X( pos[ idx[ e.to ] ] ) }" y2="${ Y( pos[ idx[ e.to ] ] ) }" stroke="#cbd5e1" stroke-width="1.2" />` );

  const dots = nodes.map( ( n, i ) => {
    const p = pos[ i ];
    const c = n.broken ? GRAPH_BROKEN_COLOR : ( GRAPH_TYPE_COLORS[ n.type ] || GRAPH_FALLBACK_COLOR );
    const r = Math.min( 16, 6 + 2 * Math.sqrt( degree[ n.id ] || 0 ) );
    const label = ( n.broken ? n.ref : ( n.title || n.slug ) ) || '';
    const short = label.length > 24 ? label.slice( 0, 23 ) + '…' : label;
    return `<g class="ci-graph-node" data-node="${ n.broken ? '' : 'n' + n.id }" style="cursor:${ n.broken ? 'default' : 'pointer' }">`
      + `<title>${ escXml( label ) }</title>`
      + `<circle cx="${ X( p ) }" cy="${ Y( p ) }" r="${ r.toFixed( 1 ) }" fill="${ c.fill }" stroke="${ c.stroke }" stroke-width="1.5"${ n.broken ? ' stroke-dasharray="3 2"' : '' } />`
      + `<text x="${ X( p ) }" y="${ ( parseFloat( Y( p ) ) + r + 12 ).toFixed( 1 ) }" text-anchor="middle" font-size="10" font-family="inherit" fill="${ c.text }">${ escXml( short ) }</text>`
      + '</g>';
  } );

  // Edges first so dots and labels paint above them.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ w.toFixed( 0 ) }" height="${ hgt.toFixed( 0 ) }" viewBox="0 0 ${ w.toFixed( 0 ) } ${ hgt.toFixed( 0 ) }">${ lines.join( '' ) }${ dots.join( '' ) }</svg>`;
}

export function GraphOverview() {
  const ref = useRef( null );
  const viewportRef = useRef( null );
  const dragRef = useRef( null );
  const movedRef = useRef( false );
  const nodeMapRef = useRef( {} );
  const [ status, setStatus ] = useState( 'loading' ); // loading | ok | empty | error
  const [ err, setErr ] = useState( '' );
  const [ counts, setCounts ] = useState( { nodes: 0, edges: 0, broken: 0 } );
  const [ view, setView ] = useState( { z: 1, x: 0, y: 0 } );
  const [ dragging, setDragging ] = useState( false );
  const dataRef = useRef( { nodes: [], edges: [] } );
  const [ selectedType, setSelectedType ] = useState( 'all' );
  const [ types, setTypes ] = useState( [] );

  // Render the graph for one type filter ('all' or a content-type key). When a
  // type is picked we keep only its nodes and the edges between them.
  const renderGraph = useCallback( async ( type ) => {
    const { nodes, edges } = dataRef.current;
    let fn = nodes, fe = edges;
    if ( type !== 'all' ) {
      const keep = new Set( nodes.filter( ( n ) => n.type === type ).map( ( n ) => n.id ) );
      fn = nodes.filter( ( n ) => keep.has( n.id ) );
      fe = edges.filter( ( e ) => keep.has( e.from ) && keep.has( e.to ) );
    }
    const brokenCount = fn.filter( ( n ) => n.broken ).length;
    setCounts( { nodes: fn.length - brokenCount, edges: fe.length, broken: brokenCount } );
    if ( ! fn.length ) { setStatus( 'empty' ); return; }
    nodeMapRef.current = {};
    fn.forEach( ( n ) => { nodeMapRef.current[ 'n' + n.id ] = n; } );
    if ( ! ref.current ) return;
    ref.current.innerHTML = buildGraphSvg( fn, fe );
    setView( { z: 1, x: 0, y: 0 } );
    setStatus( 'ok' );
  }, [] );

  useEffect( () => {
    let alive = true;
    setStatus( 'loading' );
    rest( '/activity/v1/graph' ).then( async ( g ) => {
      if ( ! alive ) return;
      const nodes = ( g && g.nodes ) || [];
      const edges = ( g && g.edges ) || [];
      dataRef.current = { nodes, edges };
      const tc = {};
      nodes.forEach( ( n ) => { if ( n.type && ! n.broken ) tc[ n.type ] = ( tc[ n.type ] || 0 ) + 1; } );
      setTypes( Object.keys( tc ).sort().map( ( k ) => ( { key: k, label: `${ k } (${ tc[ k ] })` } ) ) );
      if ( ! nodes.length ) { setCounts( { nodes: 0, edges: 0, broken: 0 } ); setStatus( 'empty' ); return; }
      await renderGraph( 'all' );
    } ).catch( ( e ) => { if ( alive ) { setErr( String( e && e.message || e ) ); setStatus( 'error' ); } } );
    return () => { alive = false; };
  }, [ renderGraph ] );

  // Re-render when the type filter changes (after the initial load).
  useEffect( () => {
    if ( dataRef.current.nodes.length ) renderGraph( selectedType );
  }, [ selectedType, renderGraph ] );

  useEffect( () => {
    const vp = viewportRef.current;
    if ( ! vp ) return;
    const onWheel = ( e ) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 1 / 1.1; setView( ( v ) => ( { ...v, z: clampZoom( v.z * f ) } ) ); };
    vp.addEventListener( 'wheel', onWheel, { passive: false } );
    return () => vp.removeEventListener( 'wheel', onWheel );
  }, [ status ] );

  const onPointerDown = ( e ) => { dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; movedRef.current = false; setDragging( true ); };
  const onPointerMove = ( e ) => {
    const d = dragRef.current;
    if ( ! d ) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if ( Math.abs( dx ) + Math.abs( dy ) > 4 ) movedRef.current = true;
    setView( ( v ) => ( { ...v, x: d.ox + dx, y: d.oy + dy } ) );
  };
  const endDrag = () => { dragRef.current = null; setDragging( false ); };
  const onClick = ( e ) => {
    if ( movedRef.current ) return;
    const g = e.target.closest && e.target.closest( 'g.ci-graph-node' );
    if ( ! g ) return;
    const n = g.dataset.node && nodeMapRef.current[ g.dataset.node ];
    if ( n ) window.location.hash = `#/t/${ n.type }/${ n.id }`;
  };
  const zoom = ( f ) => setView( ( v ) => ( { ...v, z: clampZoom( v.z * f ) } ) );
  const reset = () => setView( { z: 1, x: 0, y: 0 } );
  const ctrl = ( label, onClick2, tip ) => h`<button type="button" title=${ tip } aria-label=${ tip }
    onClick=${ ( e ) => { e.stopPropagation(); onClick2(); } } onPointerDown=${ ( e ) => e.stopPropagation() }
    className="w-7 h-7 flex items-center justify-center rounded border border-border bg-card text-sm text-foreground hover:bg-muted shadow-sm">${ label }</button>`;

  const AppHeader = CIRegistry.AppHeader;
  // Type filter rides in the top bar's actions zone, so Graph matches the rest
  // of ci > * (Apps, csv, skills) which all use AppHeader for their top bar.
  const typeFilter = status === 'ok' && types.length > 1 ? h`<div className="flex items-center gap-2" style=${ { minWidth: '9rem' } }>
    <${ SelectMenu }
      label="Type"
      hideLabelFromVision=${ true }
      value=${ selectedType }
      onChange=${ setSelectedType }
      options=${ [ { label: 'All types', value: 'all' }, ...types.map( ( t ) => ( { label: t.label, value: t.key } ) ) ] }
      __nextHasNoMarginBottom=${ true }
    />
  </div>` : null;

  return h`<div className="absolute inset-0 flex flex-col pt-14">
    <${ AppHeader } title="Knowledge Graph" icon="map" actions=${ typeFilter } />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className="p-4 md:p-10 mx-auto w-full max-w-none">
    <${ PageHeading } icon="map" title="Knowledge Graph"
      description=${ `Every skill and wiki post, linked by their [[wikilinks]] and ci:// references. Drag to pan, scroll to zoom, click a node to open it.${ status === 'ok' ? ` (${ counts.nodes } post${ counts.nodes === 1 ? '' : 's' }, ${ counts.edges } link${ counts.edges === 1 ? '' : 's' })` : '' }` } />
    ${ status === 'ok' && counts.broken ? h`<p className="text-sm text-red-600 mb-4">${ counts.broken } broken link${ counts.broken === 1 ? '' : 's' } (dashed red dots) point${ counts.broken === 1 ? 's' : '' } to a post that does not exist.</p>` : null }
    ${ status === 'loading' ? h`<p className="text-sm text-muted-foreground">Loading graph…</p>` : null }
    ${ status === 'empty' ? h`<p className="text-sm text-muted-foreground">No linked content yet. Add [[wikilinks]] between skills and wiki posts to see the graph here.</p>` : null }
    ${ status === 'error' ? h`<p className="text-sm text-red-600">Could not load the graph.<br/>${ err }</p>` : null }
    <div ref=${ viewportRef }
      style=${ { position: 'relative', overflow: 'hidden', height: '70vh', minHeight: '400px', display: status === 'ok' ? 'block' : 'none', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px' } }
      onPointerDown=${ onPointerDown } onPointerMove=${ onPointerMove } onPointerUp=${ endDrag } onPointerLeave=${ endDrag } onClick=${ onClick }>
      <div style=${ { position: 'absolute', top: '8px', right: '8px', zIndex: 2, display: 'flex', gap: '4px' } }>
        ${ ctrl( '+', () => zoom( 1.2 ), 'Zoom in' ) }
        ${ ctrl( '−', () => zoom( 1 / 1.2 ), 'Zoom out' ) }
        ${ ctrl( '⤢', reset, 'Reset view' ) }
      </div>
      <div ref=${ ref } style=${ { transform: `translate(${ view.x }px, ${ view.y }px) scale(${ view.z })`, transformOrigin: '0 0', padding: '12px' } } />
    </div>
    </div>
    </div>
  </div>`;
}

CIRegistry.GraphOverview = GraphOverview;
registerRoute( '/graph', h`<${ GraphOverview } />` );
registerNavRow( { adminMenu: true, key: 'graph', label: 'Knowledge Graph', icon: 'map', path: '/graph', order: 13, match: ( p ) => p === '/graph' } );
