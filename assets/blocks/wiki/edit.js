/* global wp */
( function ( wp ) {
	const { registerBlockType, createBlock, rawHandler } = wp.blocks;
	const { useState, useEffect, useMemo, createElement: h } = wp.element;
	const { InspectorControls, useBlockProps } = wp.blockEditor;
	const {
		PanelBody,
		Dropdown,
		MenuItem,
		TextControl,
		ComboboxControl,
		Notice,
		Placeholder,
		Spinner,
		Button,
	} = wp.components;
	const ServerSideRender = wp.serverSideRender;
	const { apiFetch } = wp;
	const { dispatch } = wp.data;
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
		return h( 'div', { className: 'components-base-control ci-block-popover-select' },
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

	const MODES = [
		{ label: 'Full article (rendered)', value: 'article' },
		{ label: 'Frontmatter field', value: 'field' },
		{ label: 'Section (by heading)', value: 'section' },
		{ label: 'JSON block', value: 'json' },
		{ label: 'CSV block', value: 'csv' },
		{ label: 'Markdown table', value: 'table' },
		{ label: 'Query (list)', value: 'query' },
	];

	function SlugPicker( { value, onChange } ) {
		const [ input, setInput ] = useState( value || '' );
		const [ options, setOptions ] = useState( [] );
		const [ loading, setLoading ] = useState( false );

		useEffect( () => {
			if ( ! input || input.length < 2 ) {
				setOptions( [] );
				return;
			}
			let cancelled = false;
			setLoading( true );
			apiFetch( {
				path: `/activity/v1/wiki-data/search?q=${ encodeURIComponent( input ) }&limit=20`,
			} )
				.then( ( results ) => {
					if ( cancelled ) return;
					setOptions(
						( results || [] ).map( ( r ) => ( {
							value: r.slug,
							label: `${ r.title } — ${ r.slug }${ r.path ? ' [' + r.path + ']' : '' }`,
						} ) )
					);
				} )
				.catch( () => setOptions( [] ) )
				.finally( () => ! cancelled && setLoading( false ) );
			return () => {
				cancelled = true;
			};
		}, [ input ] );

		return h( ComboboxControl, {
			label: 'Article slug',
			help: 'Type to search wiki articles.',
			value,
			onChange,
			onFilterValueChange: setInput,
			options: options.length ? options : ( value ? [ { value, label: value } ] : [] ),
			__experimentalRenderItem: undefined,
			__next40pxDefaultSize: true,
			__nextHasNoMarginBottom: true,
		} );
	}

	function SelectorControl( { mode, value, slug, onChange } ) {
		const [ inspect, setInspect ] = useState( null );
		const [ loading, setLoading ] = useState( false );

		useEffect( () => {
			if ( ! slug || mode === 'article' || mode === 'query' ) {
				setInspect( null );
				return;
			}
			let cancelled = false;
			setLoading( true );
			apiFetch( {
				path: `/activity/v1/wiki-data/inspect?slug=${ encodeURIComponent( slug ) }`,
			} )
				.then( ( data ) => ! cancelled && setInspect( data ) )
				.catch( () => ! cancelled && setInspect( null ) )
				.finally( () => ! cancelled && setLoading( false ) );
			return () => {
				cancelled = true;
			};
		}, [ slug, mode ] );

		if ( mode === 'article' || mode === 'query' ) return null;

		const list =
			mode === 'field'   ? inspect?.frontmatter
			: mode === 'section' ? inspect?.sections
			: mode === 'json'    ? inspect?.json_blocks
			: mode === 'csv'     ? inspect?.csv_blocks
			: mode === 'table'   ? inspect?.tables
			: [];

		const label =
			mode === 'field'   ? 'Frontmatter key'
			: mode === 'section' ? 'Section (heading slug)'
			: mode === 'json'    ? 'JSON block name'
			: mode === 'csv'     ? 'CSV block name'
			: mode === 'table'   ? 'Table name'
			: '';

		if ( loading ) {
			return h( Placeholder, { label }, h( Spinner ) );
		}

		if ( list && list.length ) {
			return h( PopoverSelectControl, {
				label,
				value,
				onChange,
				options: [ { label: '— choose —', value: '' } ].concat(
					list.map( ( k ) => ( { label: k, value: k } ) )
				),
				__next40pxDefaultSize: true,
				__nextHasNoMarginBottom: true,
			} );
		}

		return h( TextControl, {
			label,
			value,
			onChange,
			help: 'No options found — type a key manually.',
			__next40pxDefaultSize: true,
			__nextHasNoMarginBottom: true,
		} );
	}

	// Build native Gutenberg blocks from the `/wiki-data/extract` payload.
	// Returns an array of blocks (callers wrap them in a core/group).
	function blocksFromPayload( payload, mode ) {
		if ( ! payload ) return [];
		const kind = payload.kind;

		if ( kind === 'html' ) {
			// rawHandler parses HTML into the appropriate sequence of core
			// blocks (paragraphs, headings, lists, code, etc). For `article`
			// mode we prepend the post title as an H2 for context.
			const blocks = rawHandler( { HTML: payload.html || '' } ) || [];
			if ( mode === 'article' && payload.title ) {
				return [ createBlock( 'core/heading', { level: 2, content: payload.title } ), ...blocks ];
			}
			return blocks;
		}

		if ( kind === 'text' ) {
			return [ createBlock( 'core/paragraph', { content: String( payload.text || '' ) } ) ];
		}

		if ( kind === 'list' ) {
			// Modern Gutenberg `core/list` is an inner-blocks parent; each
			// item is a `core/list-item` child. `values` (legacy) is left
			// behind for older WP versions but the inner-block form is
			// what current editors render-edit cleanly.
			const items = ( payload.items || [] ).map( ( s ) =>
				createBlock( 'core/list-item', { content: String( s ) } )
			);
			return [ createBlock( 'core/list', { ordered: false }, items ) ];
		}

		if ( kind === 'json' ) {
			return [ createBlock( 'core/code', { content: String( payload.text || '' ) } ) ];
		}

		if ( kind === 'rows' ) {
			const rows = payload.rows || [];
			if ( rows.length === 0 ) return [];
			const [ head, ...body ] = rows;
			const toCell = ( c ) => ( { content: String( c ?? '' ), tag: 'td' } );
			return [ createBlock( 'core/table', {
				head: [ { cells: ( head || [] ).map( ( c ) => ( { content: String( c ?? '' ), tag: 'th' } ) ) } ],
				body: body.map( ( r ) => ( { cells: ( r || [] ).map( toCell ) } ) ),
			} ) ];
		}

		if ( kind === 'items' ) {
			const items = ( payload.items || [] ).map( ( it ) => {
				const url   = it.url ? String( it.url ) : '#';
				const title = String( it.title || it.slug || '(untitled)' )
					.replace( /[&<>]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ c ] ) );
				return createBlock( 'core/list-item', {
					content: `<a href="${ url }">${ title }</a>`,
				} );
			} );
			return [ createBlock( 'core/list', { ordered: false }, items ) ];
		}

		return [];
	}

	registerBlockType( 'core-index/wiki', {
		edit: function Edit( { attributes, setAttributes, clientId } ) {
			const { slug, mode, selector, separator, queryPath, queryType, queryLimit } = attributes;
			const blockProps = useBlockProps();
			const [ converting, setConverting ] = useState( false );
			const [ convertError, setConvertError ] = useState( '' );

			// Resolve the current selection on the server, then synthesise
			// native blocks and replace ourselves with a core/group wrapper.
			// Wrapping in a Group keeps the conversion as a single
			// undo-step and gives the author one obvious thing to delete /
			// move if they don't like the result.
			const convertToBlocks = async () => {
				setConvertError( '' );
				setConverting( true );
				try {
					const params = new URLSearchParams();
					params.set( 'mode', mode );
					if ( mode === 'query' ) {
						if ( queryPath ) params.set( 'path', queryPath );
						if ( queryType ) params.set( 'type', queryType );
						if ( queryLimit ) params.set( 'limit', String( queryLimit ) );
					} else {
						if ( slug ) params.set( 'slug', slug );
						if ( selector ) params.set( 'selector', selector );
					}
					const payload = await apiFetch( {
						path: `/activity/v1/wiki-data/extract?${ params.toString() }`,
					} );
					const inner = blocksFromPayload( payload, mode );
					if ( ! inner.length ) {
						setConvertError( 'Nothing to convert — selection is empty.' );
						setConverting( false );
						return;
					}
					const group = createBlock( 'core/group', {}, inner );
					dispatch( 'core/block-editor' ).replaceBlock( clientId, group );
				} catch ( e ) {
					setConvertError( e?.message || 'Conversion failed.' );
					setConverting( false );
				}
			};

			const canConvert = mode === 'query'
				? Boolean( queryPath || queryType )
				: Boolean( slug );

			const summary = useMemo( () => {
				if ( mode === 'query' ) {
					return `Query: ${ queryPath || 'any path' }${ queryType ? ' · type=' + queryType : '' }`;
				}
				if ( ! slug ) return 'Pick a wiki article';
				const pieces = [ `${ mode } · ${ slug }` ];
				if ( selector ) pieces.push( '· ' + selector );
				return pieces.join( ' ' );
			}, [ mode, slug, selector, queryPath, queryType ] );

			return h(
				'div',
				blockProps,
				h(
					InspectorControls,
					null,
					h(
						PanelBody,
						{ title: 'Wiki Data', initialOpen: true },
						h( PopoverSelectControl, {
							label: 'Mode',
							value: mode,
							options: MODES,
							onChange: ( v ) => setAttributes( { mode: v } ),
							__next40pxDefaultSize: true,
							__nextHasNoMarginBottom: true,
						} ),
						mode !== 'query' &&
							h( SlugPicker, {
								value: slug,
								onChange: ( v ) => setAttributes( { slug: v || '' } ),
							} ),
						h( SelectorControl, {
							mode,
							value: selector,
							slug,
							onChange: ( v ) => setAttributes( { selector: v } ),
						} ),
						mode === 'field' &&
							h( TextControl, {
								label: 'Array separator',
								value: separator,
								onChange: ( v ) => setAttributes( { separator: v } ),
								__next40pxDefaultSize: true,
								__nextHasNoMarginBottom: true,
							} ),
						mode === 'query' && [
							h( TextControl, {
								key: 'qp',
								label: 'Folder path (os_path)',
								value: queryPath,
								onChange: ( v ) => setAttributes( { queryPath: v } ),
								help: 'e.g. pokemon, items, habitats',
								__next40pxDefaultSize: true,
								__nextHasNoMarginBottom: true,
							} ),
							h( TextControl, {
								key: 'qt',
								label: 'Type filter (frontmatter type)',
								value: queryType,
								onChange: ( v ) => setAttributes( { queryType: v } ),
								__next40pxDefaultSize: true,
								__nextHasNoMarginBottom: true,
							} ),
							h( TextControl, {
								key: 'ql',
								label: 'Limit',
								type: 'number',
								value: String( queryLimit ),
								onChange: ( v ) => setAttributes( { queryLimit: parseInt( v, 10 ) || 25 } ),
								__next40pxDefaultSize: true,
								__nextHasNoMarginBottom: true,
							} ),
						],
						h(
							'div',
							{ style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ddd' } },
							h( Button, {
								variant: 'secondary',
								isBusy: converting,
								disabled: ! canConvert || converting,
								onClick: convertToBlocks,
								__next40pxDefaultSize: true,
							}, converting ? 'Converting…' : 'Convert to blocks' ),
							h( 'p', {
								style: { fontSize: '11px', color: '#757575', marginTop: '6px', marginBottom: 0 },
							}, 'Replaces this block with a Group containing native Gutenberg blocks (paragraphs, tables, lists, code) so you can edit the content inline.' ),
							convertError && h( Notice, {
								status: 'error',
								isDismissible: true,
								onRemove: () => setConvertError( '' ),
							}, convertError ),
						)
					)
				),
				h(
					'div',
					{ className: 'ci-wiki-block-preview', style: { border: '1px dashed #ddd', padding: '8px' } },
					h( 'div', { style: { fontSize: '12px', opacity: 0.7, marginBottom: '6px' } }, summary ),
					( slug || mode === 'query' )
						? h( ServerSideRender, { block: 'core-index/wiki', attributes } )
						: h( Notice, { status: 'info', isDismissible: false }, 'Choose a wiki article in the sidebar.' )
				)
			);
		},
		save: () => null,
	} );
} )( window.wp );
