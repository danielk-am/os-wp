/**
 * Quick Add Reminder — global ⌘. overlay.
 *
 * Press Cmd+. (Ctrl+. on Win/Linux) anywhere in wp-admin to open a single
 * text input. Live preview shows what the PHP parser extracted (title,
 * due date/time, priority). Enter creates a `os_reminder` post seeded
 * with a ci/task block; Esc closes.
 *
 * Renders with `wp.element` so we don't ship a bundle. Self-contained:
 * no module imports, no dependencies beyond wp.element + the
 * CI_QUICK_ADD boot payload.
 */
( function () {
	const boot = window.CI_QUICK_ADD;
	if ( ! boot || ! window.wp || ! window.wp.element ) return;

	const { createElement: h, useState, useEffect, useRef, render, createRoot } = window.wp.element;

	const HOTKEY_KEY = '.';
	let _open = false;
	let _setOpenExternal = null;
	let _debounceTimer = 0;

	async function parsePreview( text, signal ) {
		const res = await fetch( boot.rest + 'activity/v1/reminders/quick-add', {
			method: 'POST',
			credentials: 'same-origin',
			signal,
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': boot.nonce },
			body: JSON.stringify( { text, preview: true } ),
		} );
		if ( ! res.ok ) throw new Error( 'preview_failed' );
		const json = await res.json();
		return json.parsed || null;
	}

	async function createReminder( text ) {
		const res = await fetch( boot.rest + 'activity/v1/reminders/quick-add', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': boot.nonce },
			body: JSON.stringify( { text } ),
		} );
		if ( ! res.ok ) throw new Error( 'create_failed' );
		return res.json();
	}

	function QuickAdd() {
		const [ open, setOpen ]     = useState( false );
		const [ value, setValue ]   = useState( '' );
		const [ parsed, setParsed ] = useState( null );
		const [ busy, setBusy ]     = useState( false );
		const [ toast, setToast ]   = useState( null );
		const inputRef              = useRef( null );

		_setOpenExternal = setOpen;
		_open = open;

		useEffect( () => {
			if ( open ) {
				setTimeout( () => inputRef.current?.focus(), 30 );
			} else {
				setValue( '' );
				setParsed( null );
			}
		}, [ open ] );

		// Live preview (debounced).
		useEffect( () => {
			if ( ! open || ! value.trim() ) {
				setParsed( null );
				return;
			}
			clearTimeout( _debounceTimer );
			const ctrl = new AbortController();
			_debounceTimer = setTimeout( () => {
				parsePreview( value, ctrl.signal )
					.then( ( p ) => setParsed( p ) )
					.catch( () => {} );
			}, 180 );
			return () => { clearTimeout( _debounceTimer ); ctrl.abort(); };
		}, [ value, open ] );

		const submit = async () => {
			if ( ! value.trim() || busy ) return;
			setBusy( true );
			try {
				const r = await createReminder( value );
				setToast( { id: r.post_id, parsed: r.parsed, edit_url: r.edit_url } );
				setOpen( false );
				setTimeout( () => setToast( null ), 5000 );
			} catch ( e ) {
				setToast( { error: true, msg: 'Could not save reminder.' } );
				setTimeout( () => setToast( null ), 3500 );
			} finally {
				setBusy( false );
			}
		};

		const onKey = ( e ) => {
			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				submit();
			} else if ( e.key === 'Escape' ) {
				e.preventDefault();
				setOpen( false );
			}
		};

		return h(
			'div',
			{ className: 'ci-qa-root' },
			open
				? h(
						'div',
						{
							className: 'ci-qa-backdrop',
							onClick: ( e ) => {
								if ( e.target === e.currentTarget ) setOpen( false );
							},
						},
						h(
							'div',
							{ className: 'ci-qa-panel', role: 'dialog', 'aria-label': 'Quick add reminder' },
							h( 'div', { className: 'ci-qa-header' },
								h( 'span', { className: 'ci-qa-title' }, 'Quick add' ),
								h( 'span', { className: 'ci-qa-hint' }, 'Cmd+. to toggle · Esc to close · Enter to save' )
							),
							h( 'input', {
								ref: inputRef,
								className: 'ci-qa-input',
								type: 'text',
								value: value,
								onChange: ( e ) => setValue( e.target.value ),
								onKeyDown: onKey,
								placeholder: 'e.g. "Remind me to call Bob tomorrow at 3pm high prio"',
								spellCheck: false,
							} ),
							parsed && h(
								'div',
								{ className: 'ci-qa-preview' },
								h( 'div', { className: 'ci-qa-row' },
									h( 'span', { className: 'ci-qa-k' }, 'Title' ),
									h( 'span', { className: 'ci-qa-v' }, parsed.title || '—' )
								),
								h( 'div', { className: 'ci-qa-row' },
									h( 'span', { className: 'ci-qa-k' }, 'Due' ),
									h( 'span', { className: 'ci-qa-v' },
										parsed.due_date
											? parsed.due_date + ( parsed.due_time ? ' · ' + parsed.due_time : '' )
											: '—'
									)
								),
								h( 'div', { className: 'ci-qa-row' },
									h( 'span', { className: 'ci-qa-k' }, 'Priority' ),
									h( 'span', { className: 'ci-qa-v ci-qa-pri-' + ( parsed.priority || 'none' ) },
										parsed.priority || '—'
									)
								)
							),
							h( 'div', { className: 'ci-qa-footer' },
								h( 'button', {
									type: 'button',
									className: 'ci-qa-btn-secondary',
									onClick: () => setOpen( false ),
								}, 'Cancel' ),
								h( 'button', {
									type: 'button',
									className: 'ci-qa-btn-primary',
									disabled: busy || ! value.trim(),
									onClick: submit,
								}, busy ? 'Saving…' : 'Add reminder' )
							)
						)
				  )
				: null,
			toast
				? h(
						'div',
						{ className: 'ci-qa-toast' + ( toast.error ? ' is-error' : '' ) },
						toast.error
							? toast.msg
							: h(
									'span',
									null,
									'Reminder saved · ',
									h( 'a', { href: toast.edit_url }, 'Open' )
							  )
				  )
				: null
		);
	}

	function mount() {
		if ( document.getElementById( 'ci-quick-add-host' ) ) return;
		const host = document.createElement( 'div' );
		host.id = 'ci-quick-add-host';
		document.body.appendChild( host );
		// React 18 createRoot when available (WP 6.2+); fall back to the
		// legacy render() on older cores. Avoids the "ReactDOM.render is no
		// longer supported" warning.
		if ( typeof createRoot === 'function' ) {
			createRoot( host ).render( h( QuickAdd ) );
		} else {
			render( h( QuickAdd ), host );
		}

		// Capture-phase listener so we win over the Gutenberg editor's
		// own keymap when present.
		document.addEventListener( 'keydown', ( e ) => {
			const mod = e.metaKey || e.ctrlKey;
			if ( ! mod || e.altKey ) return;
			if ( e.key !== HOTKEY_KEY ) return;
			// Don't intercept while a non-text modal already owns Esc/Enter.
			e.preventDefault();
			e.stopImmediatePropagation();
			if ( _setOpenExternal ) _setOpenExternal( ! _open );
		}, true );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', mount );
	} else {
		mount();
	}
} )();
