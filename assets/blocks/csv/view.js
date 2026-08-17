/**
 * Frontend filter enhancer for the CSV Preview block. The block ships
 * the parsed CSV data as a `data-rows` JSON payload on the wrapper;
 * this script hooks the filter inputs (global + per-column) and shows /
 * hides rows in-place. No network calls — everything is client-side
 * once the block is on the page.
 *
 * Filter semantics mirror the editor's CsvGridEditor: comma- or
 * pipe-separated needles AND together (each must match somewhere in
 * the row for global, in the specific cell for per-column).
 */
( function () {
	'use strict';

	function splitNeedles( raw ) {
		return String( raw || '' )
			.toLowerCase()
			.split( /\s*[,|]\s*/ )
			.map( ( s ) => s.trim() )
			.filter( Boolean );
	}

	function hydrate( root ) {
		var rows;
		try { rows = JSON.parse( root.getAttribute( 'data-rows' ) || '[]' ); }
		catch ( e ) { rows = []; }
		var trEls = root.querySelectorAll( 'tbody > tr' );
		var globalInput = root.querySelector( '.ci-csv-filter' );
		var colInputs = root.querySelectorAll( '.ci-csv-col-filter' );
		var countEl = root.querySelector( '.ci-csv-count' );
		var totalRows = rows.length;

		function applyFilters() {
			var globalNeedles = globalInput ? splitNeedles( globalInput.value ) : [];
			var colFilters = [];
			colInputs.forEach( function ( inp ) {
				var idx = parseInt( inp.getAttribute( 'data-col' ), 10 );
				var needles = splitNeedles( inp.value );
				if ( needles.length ) colFilters.push( { idx: idx, needles: needles } );
			} );
			var visible = 0;
			rows.forEach( function ( row, i ) {
				var rowLower = row.map( function ( c ) { return String( c == null ? '' : c ).toLowerCase(); } );
				var rowMatches = true;
				for ( var n = 0; n < globalNeedles.length; n++ ) {
					var needle = globalNeedles[ n ];
					if ( ! rowLower.some( function ( c ) { return c.indexOf( needle ) !== -1; } ) ) {
						rowMatches = false;
						break;
					}
				}
				if ( rowMatches ) {
					for ( var f = 0; f < colFilters.length; f++ ) {
						var cf = colFilters[ f ];
						var cell = rowLower[ cf.idx ] || '';
						var allHit = true;
						for ( var k = 0; k < cf.needles.length; k++ ) {
							if ( cell.indexOf( cf.needles[ k ] ) === -1 ) { allHit = false; break; }
						}
						if ( ! allHit ) { rowMatches = false; break; }
					}
				}
				if ( trEls[ i ] ) {
					trEls[ i ].style.display = rowMatches ? '' : 'none';
					if ( rowMatches ) visible++;
				}
			} );
			if ( countEl ) {
				countEl.textContent = visible + '/' + totalRows + ' row' + ( totalRows === 1 ? '' : 's' );
			}
		}

		if ( globalInput ) globalInput.addEventListener( 'input', applyFilters );
		colInputs.forEach( function ( inp ) { inp.addEventListener( 'input', applyFilters ); } );

		// Initial pass — keeps the row counter accurate when the block is
		// first rendered (no filters applied yet, count = total).
		applyFilters();
	}

	function boot() {
		document.querySelectorAll( '.ci-csv-block[data-rows]' ).forEach( hydrate );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
} )();
