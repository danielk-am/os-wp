/**
 * Context — global command palette.
 *
 * Renders on every wp-admin screen (enqueued by
 * Core_Index_Global_Palette). Uses wp.element so we don't ship
 * a separate React bundle — wp-element is already enqueued on admin.
 *
 * Shortcuts (capture phase, so WP's own ⌘K palette doesn't open first):
 *   ⌘/Ctrl + Shift + `   → toggle
 *   ⌘/Ctrl + Shift + P   → toggle
 *   ⌘/Ctrl + K           → toggle (overrides WP core's commands modal)
 *   /                    → toggle (only when not typing in an input)
 *   Esc                  → close
 *
 * Data sources (from window.CI_GLOBAL_PALETTE, set by PHP boot):
 *   • admin_menu      — full top + submenu list, capability-filtered
 *   • settings_fields — Settings API field index with #:~:text= anchors
 *   • content (live)  — fetched from /activity/v1/find
 *   • wp.commands     — opportunistic, if core/commands store is present
 */
( function () {
	if ( ! window.wp || ! window.wp.element ) {
		return;
	}
	if ( ! window.CI_GLOBAL_PALETTE ) {
		return;
	}
	// Avoid double-mounting if this script gets injected twice.
	if ( window.__ciGlobalPaletteMounted ) {
		return;
	}
	window.__ciGlobalPaletteMounted = true;

	const BOOT = window.CI_GLOBAL_PALETTE;
	const { createElement: el, useState, useEffect, useMemo, useRef, useCallback, Fragment } = window.wp.element;
	const createRoot = window.wp.element.createRoot || ( ( container ) => ( {
		render: ( node ) => window.wp.element.render( node, container ),
		unmount: () => {},
	} ) );

	// ---- Helpers ----------------------------------------------------------

	function rest( path ) {
		const url = BOOT.rest.replace( /\/$/, '' ) + path;
		return fetch( url, { headers: { 'X-WP-Nonce': BOOT.nonce, 'Accept': 'application/json' }, credentials: 'same-origin' } )
			.then( ( r ) => {
				if ( ! r.ok ) {
					throw new Error( 'HTTP ' + r.status );
				}
				return r.json();
			} );
	}

	// Fuzzy subsequence scorer — same shape as the React palette.
	function fuzzy( query, target ) {
		if ( ! query ) return 0;
		const q = query.toLowerCase();
		const t = ( target || '' ).toLowerCase();
		let qi = 0, bonus = 0, prevIdx = -2, gap = 0;
		for ( let ti = 0; ti < t.length && qi < q.length; ti++ ) {
			if ( t.charCodeAt( ti ) === q.charCodeAt( qi ) ) {
				const prev = ti > 0 ? t[ ti - 1 ] : ' ';
				if ( /[\s\-:_>\/.]/.test( prev ) ) bonus += 6;
				if ( ti - prevIdx === 1 ) bonus += 4;
				else if ( prevIdx >= 0 ) gap += ( ti - prevIdx - 1 ) * 0.3;
				prevIdx = ti;
				qi++;
			}
		}
		if ( qi < q.length ) return -1;
		return gap - bonus + t.length * 0.05;
	}

	function score( item, terms ) {
		const hay = item._search || '';
		let total = 0;
		for ( const t of terms ) {
			const s = fuzzy( t, hay );
			if ( s < 0 ) return -1;
			total += s;
		}
		return total;
	}

	// ---- Static pool (admin menu + settings + wp.commands) ----------------

	function buildStaticPool() {
		const out = [];
		( BOOT.admin_menu || [] ).forEach( ( m, i ) => {
			const parent = m.parent && m.parent !== m.label ? m.parent : '';
			const title  = parent ? parent + ' → ' + m.label : m.label;
			out.push( {
				kind: 'admin-page',
				id: 'p-' + i,
				title,
				subtitle: m.source || 'WordPress',
				url: m.url,
				icon: m.kind === 'top' ? '▤' : '↳',
				_search: ( m.label + ' ' + ( m.parent || '' ) + ' ' + ( m.source || '' ) ).toLowerCase(),
			} );
		} );
		( BOOT.settings_fields || [] ).forEach( ( f, i ) => {
			out.push( {
				kind: 'admin-setting',
				id: 's-' + i,
				title: f.label,
				subtitle: ( f.source || 'WordPress' ) + ( f.section ? ' · ' + f.section : '' ),
				url: f.url,
				icon: '⚙',
				_search: ( f.label + ' ' + ( f.section || '' ) + ' ' + ( f.page || '' ) + ' ' + ( f.source || '' ) ).toLowerCase(),
			} );
		} );
		// wp.commands: best-effort. Only present on pages that loaded wp-commands.
		try {
			const sel = window.wp?.data?.select;
			if ( sel ) {
				const store = sel( 'core/commands' );
				if ( store && typeof store.getCommands === 'function' ) {
					( store.getCommands() || [] ).forEach( ( c, i ) => {
						out.push( {
							kind: 'wp-command',
							id: 'c-' + ( c.name || i ),
							title: c.label || c.name || 'Untitled command',
							subtitle: 'WordPress command',
							icon: '▶',
							callback: c.callback || null,
							_search: ( ( c.label || '' ) + ' ' + ( c.searchLabel || '' ) + ' ' + ( c.name || '' ) ).toLowerCase(),
						} );
					} );
				}
			}
		} catch ( e ) { /* no-op */ }
		return out;
	}

	// ---- Palette UI -------------------------------------------------------

	function Palette( { onClose, initialQuery } ) {
		const [ q, setQ ]                       = useState( initialQuery || '' );
		const [ contentResults, setContent ]    = useState( [] );
		const [ loading, setLoading ]           = useState( false );
		const [ activeIndex, setActiveIndex ]   = useState( 0 );
		const inputRef                          = useRef( null );

		useEffect( () => { inputRef.current?.focus(); }, [] );

		const staticPool = useMemo( buildStaticPool, [] );

		// Debounced content search.
		useEffect( () => {
			if ( ! q.trim() ) { setContent( [] ); return; }
			setLoading( true );
			const t = setTimeout( async () => {
				try {
					const items = await rest( '/activity/v1/find?q=' + encodeURIComponent( q ) + '&limit=20' );
					setContent( ( items || [] ).map( ( it ) => ( {
						kind: 'content',
						id: 'co-' + it.type + '-' + it.id,
						title: typeof it.title === 'object' ? ( it.title?.rendered || '(untitled)' ) : ( it.title || '(untitled)' ),
						subtitle: ( it.type || 'content' ) + ' · ' + ( it.slug || '' ),
						icon: '•',
						edit_url: it.edit_url,
					} ) ) );
				} catch ( e ) { /* keep last results */ }
				finally { setLoading( false ); }
			}, 150 );
			return () => clearTimeout( t );
		}, [ q ] );

		const results = useMemo( () => {
			const terms = q.trim().toLowerCase().split( /\s+/ ).filter( Boolean );
			if ( terms.length === 0 ) return [];
			const scored = staticPool
				.map( ( it ) => ( { it, s: score( it, terms ) } ) )
				.filter( ( x ) => x.s >= 0 )
				.sort( ( a, b ) => a.s - b.s )
				.slice( 0, 25 )
				.map( ( x ) => x.it );
			return [ ...contentResults, ...scored ].slice( 0, 40 );
		}, [ q, contentResults, staticPool ] );

		useEffect( () => { setActiveIndex( 0 ); }, [ q ] );

		const pick = useCallback( ( item ) => {
			if ( ! item ) return;
			if ( item.kind === 'content' && item.edit_url ) {
				window.location.href = item.edit_url;
			} else if ( item.kind === 'admin-page' || item.kind === 'admin-setting' ) {
				window.location.href = item.url;
			} else if ( item.kind === 'wp-command' && typeof item.callback === 'function' ) {
				try { item.callback( { close: onClose } ); } catch ( e ) { /* no-op */ }
			}
			onClose();
		}, [ onClose ] );

		function onKey( e ) {
			if ( e.key === 'ArrowDown' ) { e.preventDefault(); setActiveIndex( ( i ) => Math.min( i + 1, results.length - 1 ) ); }
			else if ( e.key === 'ArrowUp' ) { e.preventDefault(); setActiveIndex( ( i ) => Math.max( i - 1, 0 ) ); }
			else if ( e.key === 'Enter' )    { e.preventDefault(); pick( results[ activeIndex ] ); }
		}

		return el( 'div', { className: 'ci-gp-root', onClick: onClose },
			el( 'div', { className: 'ci-gp-backdrop' } ),
			el( 'div', { className: 'ci-gp-wrap' },
				el( 'div', { className: 'ci-gp-card', onClick: ( e ) => e.stopPropagation() },
					el( 'div', { className: 'ci-gp-input-row' },
						el( 'span', { className: 'ci-gp-kbd' }, '⌘⇧`' ),
						el( 'input', {
							ref: inputRef,
							value: q,
							onChange: ( e ) => setQ( e.target.value ),
							onKeyDown: onKey,
							placeholder: 'Search admin pages, settings, content, commands…',
							className: 'ci-gp-input',
						} ),
						loading ? el( 'span', { className: 'ci-gp-spinner' } ) : null,
					),
					el( 'div', { className: 'ci-gp-results' },
						! q.trim()
							? el( 'div', { className: 'ci-gp-empty' }, 'Type to search.' )
							: results.length === 0 && ! loading
								? el( 'div', { className: 'ci-gp-empty' }, 'No matches' )
								: results.map( ( r, i ) => el( 'div', {
									key: r.id,
									className: 'ci-gp-result' + ( i === activeIndex ? ' is-active' : '' ),
									onClick: () => pick( r ),
									onMouseEnter: () => setActiveIndex( i ),
								},
									el( 'span', { className: 'ci-gp-icon' }, r.icon ),
									el( 'div', { className: 'ci-gp-text' },
										el( 'div', { className: 'ci-gp-title' }, r.title ),
										el( 'div', { className: 'ci-gp-sub' }, r.subtitle ),
									),
									el( 'span', { className: 'ci-gp-kind' },
										r.kind === 'content' ? 'Content' :
										r.kind === 'admin-page' ? 'Page' :
										r.kind === 'admin-setting' ? 'Setting' : 'Command'
									),
								) )
					),
					el( 'div', { className: 'ci-gp-footer' },
						el( 'span', null, '↑↓ navigate · ↵ open · esc close · ⌘⇧`, ⌘⇧P, ⌘K to reopen' ),
						results.length
							? el( 'span', null, results.length + ' result' + ( results.length === 1 ? '' : 's' ) )
							: null,
					),
				),
			),
		);
	}

	// ---- Mount + keyboard binding ----------------------------------------

	const host = document.createElement( 'div' );
	host.id = 'ci-global-palette-host';
	document.body.appendChild( host );
	const root = createRoot( host );

	let isOpen = false;
	function render() {
		root.render( isOpen ? el( Palette, { onClose: () => { isOpen = false; render(); } } ) : null );
	}

	// Capture phase so we can pre-empt WP core's ⌘K commands modal.
	// Note: `/` is intentionally NOT a trigger — the block editor uses `/`
	// as its slash-inserter, and capturing it here breaks block insertion.
	window.addEventListener( 'keydown', ( e ) => {
		const mod = e.metaKey || e.ctrlKey;
		const cmdShiftBacktick = mod && e.shiftKey && ( e.key === '`' || e.code === 'Backquote' );
		const cmdShiftP        = mod && e.shiftKey && e.key.toLowerCase() === 'p';
		const cmdK             = mod && ! e.shiftKey && e.key.toLowerCase() === 'k';
		if ( cmdShiftBacktick || cmdShiftP || cmdK ) {
			e.preventDefault();
			e.stopImmediatePropagation(); // beat WP core's listener (also capture phase)
			isOpen = ! isOpen;
			render();
		} else if ( e.key === 'Escape' && isOpen ) {
			isOpen = false;
			render();
		}
	}, true ); // capture phase
} )();
