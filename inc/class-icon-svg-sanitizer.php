<?php
/**
 * Strict sanitizer for inline Content Types icons.
 *
 * @package OS_Index
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'Core_Index_Icon_SVG_Sanitizer' ) ) {
	final class Core_Index_Icon_SVG_Sanitizer {

		/**
		 * Keep a small, inert SVG drawing subset.
		 *
		 * Scripts, event handlers, embedded HTML, animation, images, links,
		 * external references, CSS, and URL-based paint values are excluded.
		 */
		public static function sanitize( string $svg ): string {
			$svg = trim( $svg );
			if ( '' === $svg || strlen( $svg ) > 20000 || ! preg_match( '/^<svg[\s>]/i', $svg ) ) {
				return '';
			}

			$svg = (string) preg_replace( '#<(script|style)\b[^>]*>.*?</\1\s*>#is', '', $svg );
			$svg = (string) preg_replace( '/<!--.*?-->/s', '', $svg );

			$allowed = array(
				'svg'      => array(
					'xmlns'               => true,
					'viewbox'             => true,
					'width'               => true,
					'height'              => true,
					'fill'                => true,
					'stroke'              => true,
					'stroke-width'        => true,
					'stroke-linecap'      => true,
					'stroke-linejoin'     => true,
					'role'                => true,
					'aria-hidden'         => true,
					'focusable'           => true,
					'preserveaspectratio' => true,
				),
				'g'        => array(
					'fill'            => true,
					'stroke'          => true,
					'stroke-width'    => true,
					'stroke-linecap'  => true,
					'stroke-linejoin' => true,
					'fill-rule'       => true,
					'clip-rule'       => true,
					'transform'       => true,
					'opacity'         => true,
				),
				'path'     => array(
					'd'               => true,
					'fill'            => true,
					'stroke'          => true,
					'stroke-width'    => true,
					'stroke-linecap'  => true,
					'stroke-linejoin' => true,
					'fill-rule'       => true,
					'clip-rule'       => true,
					'opacity'         => true,
					'transform'       => true,
				),
				'circle'   => array(
					'cx'           => true,
					'cy'           => true,
					'r'            => true,
					'fill'         => true,
					'stroke'       => true,
					'stroke-width' => true,
					'opacity'      => true,
					'transform'    => true,
				),
				'ellipse'  => array(
					'cx'           => true,
					'cy'           => true,
					'rx'           => true,
					'ry'           => true,
					'fill'         => true,
					'stroke'       => true,
					'stroke-width' => true,
					'opacity'      => true,
					'transform'    => true,
				),
				'rect'     => array(
					'x'            => true,
					'y'            => true,
					'width'        => true,
					'height'       => true,
					'rx'           => true,
					'ry'           => true,
					'fill'         => true,
					'stroke'       => true,
					'stroke-width' => true,
					'opacity'      => true,
					'transform'    => true,
				),
				'line'     => array(
					'x1'             => true,
					'y1'             => true,
					'x2'             => true,
					'y2'             => true,
					'stroke'         => true,
					'stroke-width'   => true,
					'stroke-linecap' => true,
					'opacity'        => true,
					'transform'      => true,
				),
				'polyline' => array(
					'points'          => true,
					'fill'            => true,
					'stroke'          => true,
					'stroke-width'    => true,
					'stroke-linecap'  => true,
					'stroke-linejoin' => true,
					'opacity'         => true,
					'transform'       => true,
				),
				'polygon'  => array(
					'points'       => true,
					'fill'         => true,
					'stroke'       => true,
					'stroke-width' => true,
					'opacity'      => true,
					'transform'    => true,
				),
				'title'    => array(),
				'desc'     => array(),
			);
			$clean = wp_kses( $svg, $allowed );
			$clean = (string) preg_replace_callback(
				'/\s(?:fill|stroke)=("[^"]*"|\'[^\']*\')/i',
				static function ( array $match ): string {
					$value = html_entity_decode( substr( $match[1], 1, -1 ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
					return preg_match( '/(?:url\s*\(|javascript\s*:|data\s*:|expression\s*\()/i', $value ) ? '' : $match[0];
				},
				$clean
			);

			$clean = str_ireplace(
				array( 'viewbox=', 'preserveaspectratio=' ),
				array( 'viewBox=', 'preserveAspectRatio=' ),
				$clean
			);
			if (
				1 !== preg_match_all( '/<svg[\s>]/i', $clean )
				|| 1 !== preg_match_all( '/<\/svg>/i', $clean )
				|| ! preg_match( '/^<svg[\s>][\s\S]*<\/svg>\s*$/i', trim( $clean ) )
			) {
				return '';
			}
			return trim( $clean );
		}
	}
}
