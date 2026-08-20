/* global wp */
( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { useState, useEffect, createElement: h } = wp.element;
	const { InspectorControls, useBlockProps } = wp.blockEditor;
	const {
		PanelBody,
		ComboboxControl,
		ToggleControl,
		TextControl,
		Notice,
		Placeholder,
		Spinner,
	} = wp.components;
	const ServerSideRender = wp.serverSideRender;
	const { apiFetch } = wp;

	function CsvPicker( { value, onChange } ) {
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
				path: `/activity/v1/csv-data/search?q=${ encodeURIComponent( input ) }&limit=20`,
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
			return () => { cancelled = true; };
		}, [ input ] );

		return h( ComboboxControl, {
			label: 'CSV file slug',
			help: loading ? 'Searching…' : 'Type to find a CSV file (skills / wiki).',
			value,
			onChange,
			onFilterValueChange: setInput,
			options: options.length ? options : ( value ? [ { value, label: value } ] : [] ),
			__next40pxDefaultSize: true,
			__nextHasNoMarginBottom: true,
		} );
	}

	registerBlockType( 'core-index/csv', {
		edit: function Edit( { attributes, setAttributes } ) {
			const { slug, showFilters, showColumnFilters, caption } = attributes;
			const blockProps = useBlockProps();

			return h(
				'div',
				blockProps,
				h(
					InspectorControls,
					null,
					h(
						PanelBody,
						{ title: 'CSV Preview', initialOpen: true },
						h( CsvPicker, {
							value: slug,
							onChange: ( v ) => setAttributes( { slug: v || '' } ),
						} ),
						h( ToggleControl, {
							label: 'Show global filter',
							checked: !! showFilters,
							onChange: ( v ) => setAttributes( { showFilters: v } ),
							__nextHasNoMarginBottom: true,
						} ),
						h( ToggleControl, {
							label: 'Show per-column filters',
							checked: !! showColumnFilters,
							onChange: ( v ) => setAttributes( { showColumnFilters: v } ),
							__nextHasNoMarginBottom: true,
						} ),
						h( TextControl, {
							label: 'Caption (optional)',
							value: caption,
							onChange: ( v ) => setAttributes( { caption: v } ),
							__next40pxDefaultSize: true,
							__nextHasNoMarginBottom: true,
						} )
					)
				),
				slug
					? h(
							'div',
							{ className: 'os-csv-block-preview' },
							h( ServerSideRender, {
								block: 'core-index/csv',
								attributes,
							} )
					  )
					: h(
							Placeholder,
							{
								icon: 'editor-table',
								label: 'CSV Preview',
								instructions: 'Pick a CSV file in the sidebar to embed it here.',
							},
							h( Notice, { status: 'info', isDismissible: false }, 'Choose a CSV from the inspector.' )
					  )
			);
		},
		save: () => null,
	} );
} )( window.wp );
