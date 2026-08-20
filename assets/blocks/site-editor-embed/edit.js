/* global wp */
( function ( wp ) {
	const { registerBlockType }                              = wp.blocks;
	const { createElement: h, useState, useEffect, useMemo } = wp.element;
	const { InspectorControls, useBlockProps, BlockControls } = wp.blockEditor;
	const {
		PanelBody,
		Dropdown,
		MenuItem,
		TextControl,
		RangeControl,
		ToggleControl,
		Notice,
		Placeholder,
		Spinner,
		Toolbar,
		ToolbarGroup,
		ToolbarButton,
	} = wp.components;
	const { apiFetch } = wp;
	const ciBlocks = window.CoreIndexBlocks = window.CoreIndexBlocks || {};
	const PopoverSelectControl = ciBlocks.PopoverSelectControl || ( ciBlocks.PopoverSelectControl = function ( {
		label,
		help,
		value,
		options = [],
		onChange,
		disabled = false,
		hideLabelFromVision = false,
		placeholder = 'Select…',
		ariaLabel,
	} ) {
		const selected = options.find( ( option ) => option.value === value );
		const selectedLabel = selected ? selected.label : placeholder;
		const accessibleLabel = ariaLabel || label || placeholder;
		return h( 'div', { className: 'components-base-control os-block-popover-select' },
			label ? h( 'div', {
				className: hideLabelFromVision ? 'screen-reader-text' : 'components-base-control__label',
				style: hideLabelFromVision ? undefined : { display: 'block', marginBottom: 8 },
			}, label ) : null,
			h( Dropdown, {
				popoverProps: { placement: 'bottom-start' },
				renderToggle: ( { isOpen, onToggle } ) => h( 'button', {
					type: 'button',
					disabled,
					'aria-label': accessibleLabel,
					'aria-haspopup': 'listbox',
					'aria-expanded': isOpen,
					onClick: disabled ? undefined : onToggle,
					onKeyDown: ( event ) => {
						if ( ! disabled && event.key === 'ArrowDown' ) {
							event.preventDefault();
							onToggle();
						}
					},
					style: {
						display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
						width: '100%', minHeight: 40, padding: '6px 12px', boxSizing: 'border-box',
						background: '#fff', color: '#1e1e1e', border: `1px solid ${ isOpen ? '#3858e9' : '#949494' }`,
						borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
						boxShadow: isOpen ? '0 0 0 1px #3858e9' : 'none', textAlign: 'left',
					},
				},
					h( 'span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selectedLabel ),
					h( 'span', { 'aria-hidden': true, style: { color: '#757575', flexShrink: 0 } }, '⌄' )
				),
				renderContent: ( { onClose } ) => h( 'div', {
					role: 'listbox', 'aria-label': accessibleLabel,
					style: { minWidth: 220, maxWidth: 320, maxHeight: 280, overflowY: 'auto', padding: 4 },
				}, options.map( ( option ) => {
					const isSelected = option.value === value;
					return h( MenuItem, {
						key: String( option.value ), role: 'option', 'aria-selected': isSelected,
						isSelected, disabled: !! option.disabled, info: option.description,
						onClick: () => {
							if ( option.disabled ) return;
							onChange( option.value );
							onClose();
						},
					}, option.label );
				} ) ),
			} ),
			help ? h( 'p', { className: 'components-base-control__help', style: { marginTop: 8 } }, help ) : null
		);
	} );

	const SITE_EDITOR_BASE = '/wp-admin/site-editor.php?path=';

	/**
	 * Fetches a flat list of selectable Site-Editor targets — templates,
	 * template parts, navigations, and pages — building user-friendly
	 * labels with grouping so the picker isn't a wall of slugs.
	 */
	function useSiteEditorTargets() {
		const [ options, setOptions ] = useState( null );
		useEffect( () => {
			let cancelled = false;
			( async () => {
				const targets = [
					{ value: '/',                       label: '— Site Editor home —' },
					{ value: '/wp_template',            label: 'All templates' },
					{ value: '/wp_template_part/all',   label: 'All template parts' },
					{ value: '/page',                   label: 'All pages' },
					{ value: '/navigation',             label: 'All navigations' },
					{ value: '/patterns',               label: 'All patterns' },
				];
				try {
					const [ tpls, parts, pages, navs ] = await Promise.all( [
						apiFetch( { path: '/wp/v2/templates?per_page=100&_fields=id,slug,title,theme' } ).catch( () => [] ),
						apiFetch( { path: '/wp/v2/template-parts?per_page=100&_fields=id,slug,title,theme,area' } ).catch( () => [] ),
						apiFetch( { path: '/wp/v2/pages?per_page=20&_fields=id,title,slug' } ).catch( () => [] ),
						apiFetch( { path: '/wp/v2/navigation?per_page=20&_fields=id,title,slug' } ).catch( () => [] ),
					] );
					( tpls || [] ).forEach( ( t ) => {
						targets.push( {
							value: `/wp_template/${ t.theme || '' }//${ t.slug }`,
							label: `Template — ${ ( t.title?.rendered || t.slug ) }`,
						} );
					} );
					( parts || [] ).forEach( ( p ) => {
						const where = p.area && p.area !== 'uncategorized' ? ` (${ p.area })` : '';
						targets.push( {
							value: `/wp_template_part/${ p.theme || '' }//${ p.slug }`,
							label: `Part — ${ ( p.title?.rendered || p.slug ) }${ where }`,
						} );
					} );
					( pages || [] ).forEach( ( p ) => {
						targets.push( {
							value: `/page/${ p.id }`,
							label: `Page — ${ p.title?.rendered || p.slug }`,
						} );
					} );
					( navs || [] ).forEach( ( n ) => {
						targets.push( {
							value: `/navigation/${ n.id }`,
							label: `Navigation — ${ n.title?.rendered || n.slug || `#${ n.id }` }`,
						} );
					} );
				} catch ( e ) { /* fall through with built-ins only */ }
				if ( ! cancelled ) setOptions( targets );
			} )();
			return () => { cancelled = true; };
		}, [] );
		return options;
	}

	function PathPicker( { value, onChange } ) {
		const options = useSiteEditorTargets();
		if ( ! options ) {
			return h( 'div', { className: 'os-se-embed-loading' },
				h( Spinner, null ), h( 'span', { style: { marginLeft: 6, fontSize: 12 } }, 'Loading targets…' )
			);
		}
		return h( PopoverSelectControl, {
			label: 'Target',
			help: 'Pick what the Site Editor should open at.',
			value: value || '/',
			options,
			onChange: ( v ) => onChange( v ),
			__next40pxDefaultSize: true,
			__nextHasNoMarginBottom: true,
		} );
	}

	registerBlockType( 'os/site-editor-embed', {
		edit: function Edit( { attributes, setAttributes } ) {
			const { path, height, wide, label } = attributes;
			const blockProps = useBlockProps( { className: 'os-site-editor-embed' + ( wide ? ' is-wide' : '' ) } );
			const url = useMemo(
				() => path ? SITE_EDITOR_BASE + encodeURIComponent( path ) : '',
				[ path ]
			);

			const inspector = h(
				InspectorControls,
				null,
				h(
					PanelBody,
					{ title: 'Site Editor embed', initialOpen: true },
					h( PathPicker, {
						value: path,
						onChange: ( v ) => setAttributes( { path: v || '' } ),
					} ),
					h( TextControl, {
						label: 'Custom path (override)',
						help: 'Optional. Overrides the picker. Example: /wp_template/twentytwentyfive//home',
						value: path || '',
						onChange: ( v ) => setAttributes( { path: v || '' } ),
						__next40pxDefaultSize: true,
						__nextHasNoMarginBottom: true,
					} ),
					h( RangeControl, {
						label: 'Height (px)',
						min: 200,
						max: 1400,
						step: 20,
						value: height || 600,
						onChange: ( v ) => setAttributes( { height: v } ),
						__next40pxDefaultSize: true,
						__nextHasNoMarginBottom: true,
					} ),
					h( ToggleControl, {
						label: 'Full-width',
						help: 'Lets the iframe stretch beyond the readable content max-width.',
						checked: !! wide,
						onChange: ( v ) => setAttributes( { wide: !! v } ),
						__nextHasNoMarginBottom: true,
					} ),
					h( TextControl, {
						label: 'Caption (optional)',
						value: label || '',
						onChange: ( v ) => setAttributes( { label: v } ),
						__next40pxDefaultSize: true,
						__nextHasNoMarginBottom: true,
					} )
				)
			);

			if ( ! path ) {
				return h(
					'div',
					blockProps,
					inspector,
					h( Placeholder, {
						icon: 'layout',
						label: 'Site Editor embed',
						instructions: 'Pick a template / part / page / navigation from the block inspector to embed it.',
					}, h( Notice, { status: 'info', isDismissible: false }, 'Choose a target in the right-side panel.' ) )
				);
			}

			return h(
				'div',
				blockProps,
				inspector,
				label ? h( 'div', { className: 'os-se-embed-caption' }, label ) : null,
				h( 'div', { className: 'os-se-embed-frame', style: { height: ( height || 600 ) + 'px', position: 'relative' } },
					h( 'iframe', {
						src: url,
						title: 'Site Editor — ' + path,
						style: { width: '100%', height: '100%', border: '0', display: 'block', background: '#fff' },
					} )
				)
			);
		},
		save: () => null,
	} );
} )( window.wp );
