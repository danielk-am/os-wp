/**
 * Task block front-end: clicking the checkbox toggles `checked` and
 * persists the new state back to the post by POSTing to
 * /activity/v1/task-toggle. The server parses the post
 * content, finds the block by data-task-id, updates the attribute,
 * and re-serializes.
 *
 * No build step — vanilla browser JS.
 */
( function () {
	const NONCE = ( window.wpApiSettings && window.wpApiSettings.nonce ) || '';
	const ROOT  = ( window.wpApiSettings && window.wpApiSettings.root ) || '/wp-json/';
	const POST_ID = ( () => {
		const m = document.querySelector( 'body' );
		if ( ! m ) return 0;
		const cls = ( m.className || '' ).match( /\bpostid-(\d+)\b/ );
		if ( cls ) return parseInt( cls[ 1 ], 10 );
		const pageCls = ( m.className || '' ).match( /\bpage-id-(\d+)\b/ );
		return pageCls ? parseInt( pageCls[ 1 ], 10 ) : 0;
	} )();

	async function persist( postId, taskId, checked ) {
		if ( ! postId || ! NONCE ) return true;
		const res = await fetch( ROOT + 'activity/v1/task-toggle', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
			body: JSON.stringify( { postId, taskId, checked: !! checked } ),
		} );
		return res.ok;
	}

	function applyState( wrap, checked ) {
		wrap.classList.toggle( 'is-checked', checked );
		wrap.setAttribute( 'data-checked', checked ? '1' : '0' );
		const cb = wrap.querySelector( '.wp-block-ci-task__checkbox' );
		if ( cb ) {
			cb.classList.toggle( 'is-aria-checked-true', checked );
			cb.classList.toggle( 'is-aria-checked-false', ! checked );
			cb.setAttribute( 'aria-checked', checked ? 'true' : 'false' );
		}
		const emoji = wrap.querySelector( '.wp-block-ci-task__emoji-status' );
		if ( emoji ) {
			emoji.textContent = ( checked ? '✅' : '⬜' ) + ' ';
			emoji.setAttribute( 'title', checked ? 'Done' : 'Pending' );
		}
		// Legacy compatibility for older `.ci-task__checkbox` input markup.
		const legacy = wrap.querySelector( 'input.ci-task__checkbox' );
		if ( legacy ) legacy.checked = checked;
	}

	function bindNew( cb ) {
		const wrap = cb.closest( '.wp-block-ci-task' );
		if ( ! wrap ) return;
		const taskId = wrap.getAttribute( 'data-task-id' );
		if ( ! taskId ) return;
		cb.classList.remove( 'is-disabled' );
		const toggle = async ( e ) => {
			e.preventDefault();
			const next = ! wrap.classList.contains( 'is-checked' );
			applyState( wrap, next );
			const ok = await persist( POST_ID, taskId, next ).catch( () => false );
			if ( ! ok ) applyState( wrap, ! next ); // revert
		};
		cb.addEventListener( 'click', toggle );
		cb.addEventListener( 'keydown', ( e ) => {
			if ( e.key === ' ' || e.key === 'Enter' ) toggle( e );
		} );
	}

	function bindLegacy( el ) {
		const wrap = el.closest( '.ci-task' );
		if ( ! wrap ) return;
		const taskId = wrap.getAttribute( 'data-task-id' );
		if ( ! taskId ) return;
		el.removeAttribute( 'readonly' );
		el.addEventListener( 'change', async () => {
			const next = el.checked;
			wrap.classList.toggle( 'is-checked', next );
			wrap.setAttribute( 'data-checked', next ? '1' : '0' );
			const ok = await persist( POST_ID, taskId, next ).catch( () => false );
			if ( ! ok ) {
				el.checked = ! next;
				wrap.classList.toggle( 'is-checked', ! next );
				wrap.setAttribute( 'data-checked', next ? '0' : '1' );
			}
		} );
	}

	function init() {
		document.querySelectorAll( '.wp-block-ci-task .wp-block-ci-task__checkbox' ).forEach( bindNew );
		// Pre-v0.3 markup (before the p2-style redesign).
		document.querySelectorAll( '.ci-task input.ci-task__checkbox' ).forEach( bindLegacy );
	}
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
