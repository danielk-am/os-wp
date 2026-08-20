( function () {
	'use strict';

	function applyIdentity() {
		var runtime = window.WPDSIdentity;
		var config = window.CI_WPDS_IDENTITY || {};
		if ( ! runtime || ! config.title ) return;
		var primaryColor = runtime.readAppPrimaryColor
			? runtime.readAppPrimaryColor( document.documentElement )
			: undefined;

		var currentMenu = document.querySelector(
			'#adminmenu li.menu-top.wp-has-current-submenu:not(#menu-tools):not(#menu-settings)'
		);
		var menuImage = currentMenu && currentMenu.querySelector( ':scope > a .wp-menu-image' );
		if ( menuImage ) {
			var mark = document.createElement( 'img' );
			mark.className = 'wpds-identity-image is-mark os-product-menu-mark';
			mark.src = runtime.generatedIdentityImage( 'mark', config.title, 'product', 0, { primaryColor: primaryColor } );
			mark.alt = '';
			mark.style.setProperty( '--wpds-identity-size', '20px' );
			menuImage.replaceChildren( mark );
		}

		var accountAvatar = document.querySelector( '#wp-admin-bar-my-account img.avatar' );
		if ( accountAvatar ) {
			accountAvatar.classList.add( 'wpds-identity-image', 'is-avatar' );
			accountAvatar.style.setProperty( '--wpds-identity-size', '28px' );
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', applyIdentity, { once: true } );
	} else {
		applyIdentity();
	}
}() );
