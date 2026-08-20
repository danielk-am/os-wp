/**
 * Context App — CSV tables editor (self-contained leaf module).
 *
 * Edits `os_csv` posts whose post_content is raw CSV. The browse surface is the
 * native @wordpress/dataviews grid (search / sort / dropdown filters / chips /
 * pagination — its sweet spot); cells are edited inline by double-clicking, and
 * a small Columns control adds / renames / deletes columns (which DataViews
 * itself does not model). Self-registers the `csv` editor on import.
 *
 * No build step — native ES module; specifiers resolve via the importmap.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { h, rest, registerEditor, registerNewFile, typeMeta, CIRegistry } from 'os/core';
import { Icon, Spinner, SelectMenu } from 'os/ui';
import { useToast } from 'os/shell';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { Modal, Button as WPButton, TextControl, TextareaControl, Dropdown as WPDropdown, MenuGroup as WPMenuGroup, MenuItem as WPMenuItem, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton } from '@wordpress/components';

// Seed a NEW table with a tiny, chip-flavoured example so the grid isn't a bare
// single cell (mirrors how Code/Skills seed a starter).
const STARTER = 'name,role,tags\nAlice,Engineer,"mentor, backend"\nBob,Designer,ui\n';

// A cell whose value contains `,` or `|` is treated as a list (chips).
const CHIP_RX = /\s*[,|]\s*/;
const splitChips = ( v ) => String( v ?? '' ).split( CHIP_RX ).filter( ( p ) => p !== '' );

// The app's canonical chip/label (matches the DataViews list chips elsewhere in
// OS) so tags read the same wherever they appear.
const CHIPS_WRAP = { display: 'flex', flexWrap: 'wrap', gap: '4px' };
const CHIP = {
  fontSize: '11px',
  background: 'var(--wp-components-color-gray-100,#f0f0f0)',
  color: 'var(--wp-components-color-gray-700,#757575)',
  padding: '1px 8px',
  borderRadius: '10px',
};

// A grid cell: shows the value (chips for a multi-value cell), and turns into a
// text input on double-click anywhere in the cell. Commits on Enter / blur,
// cancels on Escape. @wordpress/dataviews has no native cell editor, so the
// field `render` owns it. The input is an ABSOLUTE overlay over a full-width
// wrapper, so editing never changes the row height (no layout shift) and the
// whole cell (not just the text) is the double-click target.
function InlineCell( { value, isChip, onCommit } ) {
  const [ editing, setEditing ] = useState( false );
  const [ draft, setDraft ] = useState( value ?? '' );
  const ref = useRef( null );
  useEffect( () => {
    if ( editing && ref.current ) {
      ref.current.focus();
      const n = ref.current.value.length;
      try { ref.current.setSelectionRange( n, n ); } catch ( e ) { /* noop */ }
    }
  }, [ editing ] );
  const commit = () => { setEditing( false ); if ( draft !== ( value ?? '' ) ) onCommit( draft ); };
  const cancel = () => { setEditing( false ); setDraft( value ?? '' ); };
  const parts = splitChips( value );
  const display = ( isChip && parts.length > 1 )
    ? h`<div style=${ CHIPS_WRAP }>${ parts.map( ( p, k ) => h`<span key=${ k } style=${ CHIP }>${ p }</span>` ) }</div>`
    // A non-breaking space keeps an empty cell tall + wide enough to double-click.
    : h`<span>${ String( value ?? '' ) || ' ' }</span>`;
  return h`<div
    onDoubleClick=${ ( e ) => { if ( ! editing ) { e.stopPropagation(); setDraft( value ?? '' ); setEditing( true ); } } }
    title="Double-click to edit"
    style=${ { position: 'relative', width: '100%', minHeight: '24px', display: 'flex', alignItems: 'center', cursor: 'text' } }
  >
    ${ display }
    ${ editing ? h`<input
      ref=${ ref }
      value=${ draft }
      onChange=${ ( e ) => setDraft( e.target.value ) }
      onBlur=${ commit }
      onMouseDown=${ ( e ) => e.stopPropagation() }
      onKeyDown=${ ( e ) => {
        if ( e.key === 'Enter' ) { e.preventDefault(); commit(); }
        else if ( e.key === 'Escape' ) { e.preventDefault(); cancel(); }
      } }
      style=${ {
        // Vertically centred on the cell and a touch wider for breathing room.
        // Absolute, so it floats over the row without changing any row height.
        position: 'absolute', top: '50%', left: '-4px',
        transform: 'translateY(-50%)',
        width: 'calc(100% + 8px)', height: '32px',
        boxSizing: 'border-box', margin: 0, padding: '0 10px',
        border: 'none', borderRadius: '4px',
        font: 'inherit', fontSize: 'inherit', lineHeight: 'normal',
        background: 'var(--card,#fff)', color: 'inherit', outline: 'none',
        boxShadow: '0 0 0 1.5px var(--ring,#3858e9), 0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 1,
      } }
    />` : null }
  </div>`;
}

// --- CSV parse / serialize (RFC-4180-ish, self-contained) ------------------
// Handles quoted fields, embedded commas / newlines, and "" escapes. Kept in
// the plugin so it carries no dependency on CI core internals.
function parseCsv( text ) {
  const s = String( text ?? '' );
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;
  for ( let i = 0; i < s.length; i++ ) {
    const c = s[ i ];
    if ( inQuotes ) {
      if ( c === '"' ) {
        if ( s[ i + 1 ] === '"' ) { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if ( c === '"' ) { inQuotes = true; sawAny = true; }
    else if ( c === ',' ) { row.push( field ); field = ''; sawAny = true; }
    else if ( c === '\n' ) { row.push( field ); rows.push( row ); row = []; field = ''; sawAny = false; }
    else if ( c === '\r' ) { /* swallow; \r\n handled by the \n branch */ }
    else { field += c; sawAny = true; }
  }
  // Flush a trailing field/row unless the input ended exactly on a newline.
  if ( sawAny || field !== '' || row.length ) { row.push( field ); rows.push( row ); }
  return rows;
}

function serializeCsv( rows ) {
  const esc = ( v ) => {
    const t = v == null ? '' : String( v );
    return /[",\n\r]/.test( t ) ? '"' + t.replace( /"/g, '""' ) + '"' : t;
  };
  return rows.map( ( r ) => r.map( esc ).join( ',' ) ).join( '\n' ) + '\n';
}

function CsvEditorPage() {
  const { type = 'csv', id } = useParams();
  const meta = typeMeta( type );
  const restBase = `/wp/v2/${ meta?.rest_base || meta?.cpt || 'os_csv' }`;
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const TypeLayout = CIRegistry.TypeLayout;
  const EditorHeader = CIRegistry.EditorHeader;

  const [ title, setTitle ] = useState( '' );
  const [ rows, setRows ] = useState( () => parseCsv( STARTER ) );
  const [ loading, setLoading ] = useState( ! isNew );
  const [ saving, setSaving ] = useState( false );
  const [ dirty, setDirty ] = useState( false );
  const [ showCols, setShowCols ] = useState( false );
  const [ showImport, setShowImport ] = useState( false );
  const [ importText, setImportText ] = useState( '' );
  const [ importFileName, setImportFileName ] = useState( '' );
  const fileRef = useRef( null );

  useEffect( () => {
    if ( isNew ) { setTitle( '' ); setRows( parseCsv( STARTER ) ); setDirty( false ); return; }
    setLoading( true );
    ( async () => {
      try {
        const p = await rest( `${ restBase }/${ id }?context=edit` );
        setTitle( p.title?.raw ?? '' );
        const parsed = parseCsv( p.content?.raw ?? '' );
        setRows( parsed.length ? parsed : [ [ 'column1' ], [ '' ] ] );
        setDirty( false );
      } catch ( e ) {
        toast?.error( 'Load failed', String( e.message || e ) );
      } finally {
        setLoading( false );
      }
    } )();
  }, [ id, isNew, restBase, toast ] );

  const header = rows[ 0 ] || [];
  const body = rows.slice( 1 );
  const cols = header.length || 1;

  const update = ( next ) => { setRows( next ); setDirty( true ); };

  // --- row + column mutations (defined above `fields` so the cell render can
  //     call setCell for inline editing) ---
  const deleteRows = ( idxs ) => {
    const drop = new Set( idxs );
    update( [ header, ...body.filter( ( _, i ) => ! drop.has( i ) ) ] );
  };
  const addRow = () => {
    // Append an empty row; the user fills it by double-clicking its cells.
    update( [ header, ...body, new Array( cols ).fill( '' ) ] );
  };
  const setCell = ( bIdx, c, val ) => {
    const next = rows.map( ( r ) => r.slice() );
    const target = next[ bIdx + 1 ];  // body row → rows[bIdx + 1]
    if ( ! target ) return;
    while ( target.length <= c ) target.push( '' );
    target[ c ] = val;
    update( next );
  };
  const renameCol = ( c, label ) => {
    const next = rows.map( ( r ) => r.slice() );
    next[ 0 ][ c ] = label;
    update( next );
  };
  const deleteCol = ( c ) => {
    const next = rows.map( ( r ) => { const x = r.slice(); x.splice( c, 1 ); return x; } );
    if ( ! next[ 0 ] || ! next[ 0 ].length ) next[ 0 ] = [ 'column1' ];
    update( next );
  };
  const addCol = () => {
    // "After" = append a column on the right.
    update( rows.map( ( r, i ) => { const x = r.slice(); x.push( i === 0 ? `column${ cols + 1 }` : '' ); return x; } ) );
  };
  // "Before" = insert a column on the left (kebab; no per-column menu exists).
  const addColBefore = () => update( rows.map( ( r, i ) => { const x = r.slice(); x.unshift( i === 0 ? `column${ cols + 1 }` : '' ); return x; } ) );
  // Insert a row above/below a specific body row (the per-row actions menu).
  // body row `bodyIdx` lives at rows[bodyIdx + 1] (rows[0] is the header).
  const addRowAt = ( bodyIdx, where ) => {
    const next = rows.map( ( r ) => r.slice() );
    next.splice( where === 'above' ? bodyIdx + 1 : bodyIdx + 2, 0, new Array( cols ).fill( '' ) );
    update( next );
  };
  // Move a body row up/down (the per-row Move up / Move down actions, block-
  // editor style). bodyIdx is the row's index in `body`; rows[bodyIdx + 1].
  const moveRow = ( bodyIdx, dir ) => {
    const to = bodyIdx + dir;
    if ( to < 0 || to >= body.length ) return;
    const next = rows.map( ( r ) => r.slice() );
    const a = bodyIdx + 1, b = to + 1;
    const tmp = next[ a ]; next[ a ] = next[ b ]; next[ b ] = tmp;
    update( next );
  };

  // --- import (file picker or paste) → replaces the table ---
  const onPickFile = ( e ) => {
    const file = e.target.files && e.target.files[ 0 ];
    if ( ! file ) return;
    setImportFileName( file.name );
    const reader = new FileReader();
    reader.onload = () => setImportText( String( reader.result || '' ) );
    reader.readAsText( file );
    e.target.value = '';  // let the same file be re-picked
  };
  const closeImport = () => { setShowImport( false ); setImportText( '' ); setImportFileName( '' ); };
  const doImport = () => {
    const parsed = parseCsv( importText );
    if ( parsed.length ) update( parsed );
    closeImport();
  };

  const save = useCallback( async () => {
    setSaving( true );
    try {
      const payload = JSON.stringify( {
        title: title || '(untitled table)',
        content: serializeCsv( rows ),
        status: 'publish',
      } );
      const p = isNew
        ? await rest( restBase, { method: 'POST', body: payload } )
        : await rest( `${ restBase }/${ id }`, { method: 'POST', body: payload } );
      toast?.success( 'Saved', 'CSV table saved.' );
      setDirty( false );
      if ( isNew ) navigate( `/t/${ type }/${ p.id }` );
    } catch ( e ) {
      toast?.error( 'Save failed', String( e.message || e ) );
    } finally {
      setSaving( false );
    }
  }, [ title, rows, isNew, id, navigate, restBase, toast, type ] );

  // Columns whose body cells ever hold a multi-value list → render as chips.
  const chipCols = useMemo( () => {
    const set = new Set();
    for ( let c = 0; c < header.length; c++ ) {
      for ( const r of body ) {
        if ( /[,|]/.test( String( r[ c ] ?? '' ) ) ) { set.add( c ); break; }
      }
    }
    return set;
  }, [ rows ] );

  // One DataViews record per body row; id is the body index (rows re-derive
  // each render, so a delete/add just renumbers — fine for an in-memory grid).
  const data = useMemo( () => body.map( ( cells, i ) => ( { id: i, cells } ) ), [ rows ] );

  // One DataViews field per CSV column. Filtering is our own styled bar below
  // (DataViews' native filter popover renders unstyled in this app, which is why
  // CI core avoids it too), so no `elements`/`filterBy` here.
  const fields = useMemo( () => header.map( ( label, c ) => {
    const isChip = chipCols.has( c );
    return {
      id: `c${ c }`,
      label: label || `column${ c + 1 }`,
      enableGlobalSearch: true,
      enableSorting: true,
      getValue: ( { item } ) => String( item.cells[ c ] ?? '' ),
      render: ( { item } ) => h`<${ InlineCell }
        value=${ item.cells[ c ] ?? '' }
        isChip=${ isChip }
        onCommit=${ ( val ) => setCell( item.id, c, val ) }
      />`,
    };
  } ), [ rows, chipCols ] );

  // Custom filter bar: a styled dropdown per categorical column (few distinct
  // values). Chip columns filter by an individual chip; others by exact value.
  const colFilterDefs = useMemo( () => {
    const defs = [];
    for ( let c = 0; c < header.length; c++ ) {
      const isChip = chipCols.has( c );
      const values = isChip
        ? [ ...new Set( body.flatMap( ( r ) => splitChips( r[ c ] ) ) ) ]
        : [ ...new Set( body.map( ( r ) => String( r[ c ] ?? '' ) ).filter( ( v ) => v !== '' ) ) ];
      if ( values.length > 1 && values.length <= 15 ) {
        defs.push( { c, isChip, label: header[ c ] || `column${ c + 1 }`, values: values.sort() } );
      }
    }
    return defs;
  }, [ rows, chipCols ] );
  const [ colFilters, setColFilters ] = useState( {} );
  const setColFilter = ( c, v ) => setColFilters( ( f ) => { const n = { ...f }; if ( v ) n[ c ] = v; else delete n[ c ]; return n; } );
  const hasActiveFilters = Object.values( colFilters ).some( Boolean );
  const filteredData = useMemo( () => {
    const active = Object.entries( colFilters ).filter( ( [ , v ] ) => v );
    if ( ! active.length ) return data;
    return data.filter( ( { cells } ) => active.every( ( [ c, v ] ) => {
      const cell = String( cells[ Number( c ) ] ?? '' );
      return chipCols.has( Number( c ) ) ? splitChips( cell ).includes( v ) : cell === v;
    } ) );
  }, [ data, colFilters, chipCols ] );

  // ALL columns are regular, uniformly-editable cells. No titleField: DataViews
  // renders the title field in a special primary slot that swallows the cell's
  // double-click, so the first column (e.g. NAME) would not be editable. Drop it
  // and every column behaves the same.
  const defaultVisible = useMemo( () => header.map( ( _, c ) => `c${ c }` ), [ header.length ] );
  const [ view, setView ] = useState( () => ( {
    type: 'table', search: '', page: 1, perPage: 50,
    // No default sort: rows display in CSV/data order so manual reorder (the
    // per-row Move up/down) is visible. Clicking a column header sorts (and
    // overrides manual order until cleared), which is the expected behaviour.
    sort: {},
    fields: defaultVisible, filters: [], layout: {},
  } ) );
  // Re-sync the visible set only when the columns themselves change (add /
  // delete / rename), so the user's hide/sort choices aren't clobbered.
  useEffect( () => {
    setView( ( v ) => ( { ...v, fields: defaultVisible } ) );
  }, [ defaultVisible.join( ',' ) ] );

  // The native column menu's "Move left / Move right" reorders view.fields.
  // Apply that to the real CSV data (header + every row's cell) and keep the
  // field ids canonical (c0..cN), so the reorder persists on save instead of
  // being a display-only change. Hide (fewer fields) falls through untouched.
  const onChangeView = useCallback( ( next ) => {
    const canonical = header.map( ( _, c ) => `c${ c }` );
    const nf = next.fields;
    if ( nf && nf.length === canonical.length && nf.join() !== canonical.join() && nf.every( ( id ) => canonical.includes( id ) ) ) {
      const order = nf.map( ( id ) => parseInt( id.slice( 1 ), 10 ) );
      update( rows.map( ( r ) => order.map( ( i ) => r[ i ] ) ) );
      setView( { ...next, fields: canonical } );
      return;
    }
    setView( next );
  }, [ header, rows ] );

  const { data: shown, paginationInfo } = useMemo( () => {
    try { return filterSortAndPaginate( filteredData, view, fields ); }
    catch ( e ) { return { data: filteredData, paginationInfo: { totalItems: filteredData.length, totalPages: 1 } }; }
  }, [ filteredData, view, fields ] );

  // Cells are edited inline (double-click). Per-row actions: contextual insert
  // (above / below THIS row), manual reorder (move up / down, block-editor
  // style — no drag, Mac-friendly), and delete. Column ops live in the native
  // column menu (sort / move left / right / hide) + the header toolbar kebab.
  const actions = useMemo( () => [
    { id: 'move-up', label: 'Move up', icon: h`<${ Icon } name="chevron-up" width=${ 16 } height=${ 16 } />`,
      isEligible: ( it ) => it.id > 0,
      callback: ( its ) => { if ( its && its[ 0 ] ) moveRow( its[ 0 ].id, -1 ); } },
    { id: 'move-down', label: 'Move down', icon: h`<${ Icon } name="chevron-down" width=${ 16 } height=${ 16 } />`,
      isEligible: ( it ) => it.id < body.length - 1,
      callback: ( its ) => { if ( its && its[ 0 ] ) moveRow( its[ 0 ].id, 1 ); } },
    { id: 'add-above', label: 'Add row above', icon: h`<${ Icon } name="table-rows-add-above" width=${ 16 } height=${ 16 } />`,
      callback: ( its ) => { if ( its && its[ 0 ] ) addRowAt( its[ 0 ].id, 'above' ); } },
    { id: 'add-below', label: 'Add row below', icon: h`<${ Icon } name="table-rows-add-below" width=${ 16 } height=${ 16 } />`,
      callback: ( its ) => { if ( its && its[ 0 ] ) addRowAt( its[ 0 ].id, 'below' ); } },
    { id: 'delete', label: 'Delete row', isDestructive: true, icon: h`<${ Icon } name="trash" width=${ 16 } height=${ 16 } />`,
      callback: ( its ) => deleteRows( ( its || [] ).map( ( i ) => i.id ) ) },
  ], [ rows ] );

  const layoutMain = 'absolute inset-y-0 right-0 left-0 overflow-hidden bg-card';
  if ( loading ) {
    return h`<${ TypeLayout } type=${ type } activeId=${ id } mainClassName=${ layoutMain }>
      <div className="p-10"><${ Spinner } /></div>
    </${ TypeLayout }>`;
  }

  return h`<${ TypeLayout } type=${ type } activeId=${ id } mainClassName=${ layoutMain }>
    <div className="flex flex-col h-full bg-card pt-14">
      <${ EditorHeader }
        title=${ title }
        setTitle=${ ( v ) => { setTitle( v ); setDirty( true ); } }
        placeholder="CSV table title…"
        dirty=${ dirty }
        isNew=${ isNew }
        saving=${ saving }
        onSave=${ save }
        onClose=${ () => navigate( `/t/${ type }` ) }
        hideTitlebar=${ true }
      />

      ${ /* Table actions in the header's left toolbar zone. The two quick
           buttons use "add after" logic (row below, column after); the kebab
           offers every direction plus manage / import. */ '' }
      ${ CIRegistry.EditorToolbar ? h`<${ CIRegistry.EditorToolbar.Item } group="left" label="Add row" onClick=${ addRow }><${ Icon } name="table-rows-add-below" className="w-4 h-4" /></${ CIRegistry.EditorToolbar.Item }>` : null }
      ${ CIRegistry.EditorToolbar ? h`<${ CIRegistry.EditorToolbar.Item } group="left" label="Add column" onClick=${ addCol }><${ Icon } name="table-columns-add-after" className="w-4 h-4" /></${ CIRegistry.EditorToolbar.Item }>` : null }
      ${ CIRegistry.EditorToolbar ? h`<${ CIRegistry.EditorToolbar.LeftFill }>
        <${ WPToolbarGroup }>
          <${ WPDropdown }
            popoverProps=${ { placement: 'bottom-start' } }
            renderToggle=${ ( { isOpen, onToggle } ) => h`<${ WPToolbarButton } onClick=${ onToggle } aria-expanded=${ isOpen } label="More table actions" showTooltip=${ true }><${ Icon } name="ellipsis-vertical" className="w-4 h-4" /></${ WPToolbarButton }>` }
            renderContent=${ ( { onClose } ) => h`<div>
              ${ /* Column directions live here (no per-column menu in DataViews);
                   row directions are on each row's actions menu. */ '' }
              <${ WPMenuGroup }>
                <${ WPMenuItem } onClick=${ () => { addColBefore(); onClose(); } }><span className="flex items-center gap-2"><${ Icon } name="table-columns-add-before" width=${ 16 } height=${ 16 } /> Add column before</span></${ WPMenuItem }>
                <${ WPMenuItem } onClick=${ () => { addCol(); onClose(); } }><span className="flex items-center gap-2"><${ Icon } name="table-columns-add-after" width=${ 16 } height=${ 16 } /> Add column after</span></${ WPMenuItem }>
              </${ WPMenuGroup }>
              <${ WPMenuGroup }>
                <${ WPMenuItem } onClick=${ () => { setShowCols( true ); onClose(); } }>Manage columns…</${ WPMenuItem }>
                <${ WPMenuItem } onClick=${ () => { setShowImport( true ); onClose(); } }>Import CSV…</${ WPMenuItem }>
              </${ WPMenuGroup }>
            </div>` }
          />
        </${ WPToolbarGroup }>
      </${ CIRegistry.EditorToolbar.LeftFill }>` : null }

      ${ /* Title as a field above the filters + table (titlebar hidden above). */ '' }
      <div className="shrink-0 px-4 md:px-6 pt-4">
        ${ CIRegistry.EditorTitleField ? h`<${ CIRegistry.EditorTitleField } title=${ title } setTitle=${ ( v ) => { setTitle( v ); setDirty( true ); } } placeholder="CSV table title…" />` : null }
        <p className="text-xs text-muted-foreground mt-1">${ body.length } row${ body.length === 1 ? '' : 's' } · ${ header.length } column${ header.length === 1 ? '' : 's' }</p>
      </div>

      ${ colFilterDefs.length ? h`<div className="shrink-0 flex flex-wrap items-end gap-3 px-4 md:px-6 py-2 border-b border-border">
        ${ colFilterDefs.map( ( d ) => h`<div key=${ d.c } style=${ { minWidth: '150px' } }>
          <${ SelectMenu } __nextHasNoMarginBottom __next40pxDefaultSize
            label=${ d.label }
            value=${ colFilters[ d.c ] || '' }
            onChange=${ ( v ) => setColFilter( d.c, v ) }
            options=${ [ { label: 'All', value: '' }, ...d.values.map( ( v ) => ( { label: v, value: v } ) ) ] } />
        </div>` ) }
        ${ hasActiveFilters ? h`<${ WPButton } variant="link" onClick=${ () => setColFilters( {} ) }>Reset filters</${ WPButton }>` : null }
      </div>` : null }

      <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6 os-dataviews">
        <${ DataViews }
          data=${ shown }
          fields=${ fields }
          view=${ view }
          onChangeView=${ onChangeView }
          paginationInfo=${ paginationInfo }
          getItemId=${ ( it ) => String( it.id ) }
          actions=${ actions }
          search=${ true }
          searchLabel="Search rows…"
          defaultLayouts=${ { table: {} } }
        />
      </div>


      ${ showImport ? h`<${ Modal } title="Import CSV" onRequestClose=${ closeImport } size="medium">
        <div style=${ { display: 'flex', flexDirection: 'column', gap: '16px' } }>
          <p style=${ { margin: 0, color: 'var(--muted-foreground)' } }>Choose a .csv file or paste CSV below. This replaces the current table.</p>
          <div style=${ { display: 'flex', alignItems: 'center', gap: '12px' } }>
            <input ref=${ fileRef } type="file" accept=".csv,text/csv" onChange=${ onPickFile } style=${ { display: 'none' } } />
            <${ WPButton } variant="secondary" __next40pxDefaultSize onClick=${ () => fileRef.current && fileRef.current.click() }>
              Choose .csv file…
            </${ WPButton }>
            ${ importFileName ? h`<span style=${ { fontSize: '13px', color: 'var(--muted-foreground)' } }>${ importFileName }</span>` : null }
          </div>
          <${ TextareaControl } __nextHasNoMarginBottom
            label="Or paste CSV"
            value=${ importText }
            onChange=${ setImportText }
            rows=${ 8 }
            placeholder=${ 'name,role,tags\nAlice,Engineer,"mentor, backend"' }
          />
          <div style=${ { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }>
            <${ WPButton } variant="tertiary" onClick=${ closeImport }>Cancel</${ WPButton }>
            <${ WPButton } variant="primary" onClick=${ doImport } disabled=${ ! importText.trim() }>Replace table</${ WPButton }>
          </div>
        </div>
      </${ Modal }>` : null }

      ${ showCols ? h`<${ Modal } title="Columns" onRequestClose=${ () => setShowCols( false ) }>
        <div className="flex flex-col gap-2" style=${ { minWidth: '360px' } }>
          <p className="text-xs text-muted-foreground" style=${ { margin: '0 0 4px' } }>Rename, delete, or add columns. Reorder a column from its header menu (Move left / right); reorder rows from a row's actions (Move up / down).</p>
          ${ header.map( ( label, c ) => h`<div key=${ c } className="flex items-end gap-2">
            <div className="flex-1"><${ TextControl } __nextHasNoMarginBottom __next40pxDefaultSize
              label=${ `Column ${ c + 1 }` } value=${ label } onChange=${ ( v ) => renameCol( c, v ) } /></div>
            <${ WPButton } variant="tertiary" isDestructive onClick=${ () => deleteCol( c ) } disabled=${ header.length <= 1 }>
              Delete
            </${ WPButton }>
          </div>` ) }
          <div className="pt-2"><${ WPButton } variant="secondary" onClick=${ addCol }>+ Add column</${ WPButton }></div>
        </div>
      </${ Modal }>` : null }
    </div>
  </${ TypeLayout }>`;
}

registerEditor( 'csv', () => h`<${ CsvEditorPage } />`, {
  selectable: true,
  title: 'CSV table',
  description: 'A DataViews grid for CSV data — search, sort, dropdown filters, and chips; double-click a cell to edit inline.',
} );
registerNewFile( 'csv', { label: 'CSV table', desc: 'A comma-separated data table an agent can read.' } );
