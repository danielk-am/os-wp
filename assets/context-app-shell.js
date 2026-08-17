/**
 * Measure the WP admin sidebar + admin bar at runtime and expose them
 * as CSS custom properties (`--ci-adminbar-h`, `--ci-sidebar-w`) on
 * documentElement. The React root pins to these so it lines up
 * pixel-perfectly with the WordPress chrome regardless of WP version,
 * mobile breakpoint, or sidebar collapse state.
 *
 * Re-runs on window resize and whenever the admin bar / menu changes
 * size via a ResizeObserver.
 *
 * Loaded synchronously in the head so the React root has the right
 * dimensions before it mounts (avoids a layout shift on first paint).
 */
( function () {
	var doc = document.documentElement;

	function sync() {
		var bar = document.getElementById( 'wpadminbar' );
		var bh = bar ? Math.round( bar.getBoundingClientRect().height ) : 32;
		doc.style.setProperty( '--ci-adminbar-h', bh + 'px' );

		if ( window.matchMedia( '(max-width: 782px)' ).matches ) {
			doc.style.setProperty( '--ci-sidebar-w', '0px' );
			return;
		}
		var menu = document.getElementById( 'adminmenuwrap' )
			|| document.getElementById( 'adminmenuback' );
		var w = menu ? Math.round( menu.getBoundingClientRect().width ) : 160;
		doc.style.setProperty( '--ci-sidebar-w', w + 'px' );
	}

	sync();
	window.addEventListener( 'resize', sync );
	document.addEventListener( 'DOMContentLoaded', function () {
		sync();
		if ( 'ResizeObserver' in window ) {
			var ro = new ResizeObserver( sync );
			var menu = document.getElementById( 'adminmenuwrap' );
			var bar = document.getElementById( 'wpadminbar' );
			if ( menu ) ro.observe( menu );
			if ( bar ) ro.observe( bar );
		}
	} );
}() );

/**
 * Hover flyouts for the expanded admin menu. CI gives #adminmenuwrap its own
 * scroll (the single-scrollbar fix), and that scroll container's overflow clips
 * the submenu WordPress flies out to the right when you hover a top-level item.
 * Re-anchor that submenu as position:fixed at the hovered item's coordinates so
 * it escapes the clip, then restore on mouse-out. Only for the expanded desktop
 * menu — folded menus already fly out via core, and the open (current) menu
 * shows its submenu inline.
 *
 * The restore is delayed: the scroll container's scrollbar track sits between
 * the menu item and the flyout, and it hit-tests as #adminmenuwrap, so crossing
 * it fires mouseleave on the item. An immediate restore would snap the flyout
 * away mid-crossing, making it unclickable. Core's own hoverIntent keeps the
 * submenu open ~200ms after mouse-out for the same reason; the delay here must
 * outlast that. Re-entering the item (or its flyout, still a DOM child) cancels
 * the pending restore.
 */
( function () {
	function active() {
		return window.matchMedia( '(min-width: 961px)' ).matches
			&& document.body
			&& ! document.body.classList.contains( 'folded' );
	}

	function submenuOf( li ) {
		// Direct-child submenu only (avoid nested matches).
		var kids = li.children;
		for ( var k = 0; k < kids.length; k++ ) {
			if ( kids[ k ].classList && kids[ k ].classList.contains( 'wp-submenu' ) ) {
				return kids[ k ];
			}
		}
		return null;
	}

	function place( li ) {
		var sub = submenuOf( li );
		if ( ! sub ) return;
		var r = li.getBoundingClientRect();
		sub.style.position = 'fixed';
		sub.style.left = r.right + 'px';
		sub.style.bottom = 'auto';
		sub.style.top = '0px';
		// Clamp into the viewport once we know the height (tall submenus near
		// the bottom would otherwise overflow off-screen).
		var h = sub.offsetHeight;
		var top = r.top;
		var vh = window.innerHeight;
		if ( top + h > vh - 8 ) {
			top = Math.max( 8, vh - h - 8 );
		}
		sub.style.top = top + 'px';
	}

	function clear( li ) {
		var sub = submenuOf( li );
		if ( ! sub ) return;
		sub.style.position = '';
		sub.style.left = '';
		sub.style.top = '';
		sub.style.bottom = '';
	}

	var CLEAR_DELAY_MS = 300;

	document.addEventListener( 'DOMContentLoaded', function () {
		var lis = document.querySelectorAll( '#adminmenu li.menu-top.wp-has-submenu' );
		var all = Array.prototype.slice.call( lis );

		// Flyouts are mutually exclusive, enforced HERE, immediately. The grace
		// delay below is for re-entering the SAME item across the scrollbar
		// gap; it must never keep item A's flyout painted once item B is
		// hovered. Left to core, A lingers: its `.opensub` (core's hoverIntent
		// keeps it ~200ms after out, longer while the pointer keeps moving)
		// holds the old flyout visible, and a tall, viewport-clamped flyout
		// overlaps the sibling rows, so it reads as seconds of stale menu
		// sitting on top of the new one.
		function shutOthers( keep ) {
			all.forEach( function ( other ) {
				if ( other === keep ) return;
				other.classList.remove( 'opensub' );
				clear( other );
			} );
		}

		all.forEach( function ( li ) {
			var pendingClear = null;

			function cancelClear() {
				if ( pendingClear ) {
					clearTimeout( pendingClear );
					pendingClear = null;
				}
			}

			li.addEventListener( 'mouseenter', function () {
				cancelClear();
				shutOthers( li );
				// The open/current menu shows its submenu inline — leave it be.
				if ( li.classList.contains( 'wp-menu-open' ) || li.classList.contains( 'wp-has-current-submenu' ) ) {
					return;
				}
				if ( ! active() ) {
					clear( li );
					return;
				}
				place( li );
			} );
			li.addEventListener( 'mouseleave', function () {
				cancelClear();
				pendingClear = setTimeout( function () {
					pendingClear = null;
					clear( li );
				}, CLEAR_DELAY_MS );
			} );
		} );
	} );
}() );
