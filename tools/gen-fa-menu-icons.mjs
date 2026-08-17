/**
 * Generate inc/runtime/fa-icon-paths.php from the tree-shaken FontAwesome
 * bundle the apps render (assets/vendor/fa-icons.js), so the sidebar icon
 * picker offers exactly the icons the plugin ships.
 *
 * Run from the plugin root:  node tools/gen-fa-menu-icons.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const bundle = await import( join( root, 'assets/vendor/fa-icons.js' ) );

const rows = [];
for ( const value of Object.values( bundle ) ) {
	const def = value?.icon && value?.iconName ? value : null;
	if ( ! def ) continue;
	const [ width, height, , , path ] = def.icon;
	if ( typeof path !== 'string' ) continue; // duotone glyphs ship arrays; the menu wants one path
	rows.push( `\t'${def.iconName}' => array( ${width}, ${height}, '${path.replace(/'/g, "\\'")}' ),` );
}
rows.sort();

writeFileSync( join( root, 'inc/runtime/fa-icon-paths.php' ), `<?php
/**
 * GENERATED FILE — do not edit by hand.
 * FontAwesome path data for admin menu icons, extracted from the same
 * tree-shaken bundle the apps render (assets/vendor/fa-icons.js).
 * name => array( width, height, path ). Regenerate: node tools/gen-fa-menu-icons.mjs
 *
 * Icon data CC BY 4.0, code MIT. Copyright Fonticons, Inc. See ../../license.txt.
 *
 * @package OS
 */

return array(
${rows.join( '\n' )}
);
` );
console.log( `wrote ${rows.length} icons` );
