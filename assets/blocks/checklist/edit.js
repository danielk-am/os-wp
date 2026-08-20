/* global wp */
( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { createElement: h } = wp.element;
	const { InnerBlocks, RichText, useBlockProps } = wp.blockEditor;

	const ALLOWED   = [ 'os/task' ];
	const TEMPLATE  = [
		[ 'os/task', { text: '' } ],
		[ 'os/task', { text: '' } ],
	];

	registerBlockType( 'os/checklist', {
		edit: function Edit( { attributes, setAttributes } ) {
			const { title } = attributes;
			const blockProps = useBlockProps( { className: 'os-checklist' } );
			return h(
				'div',
				blockProps,
				h( RichText, {
					tagName: 'h4',
					className: 'os-checklist__title',
					value: title || '',
					onChange: ( v ) => setAttributes( { title: v } ),
					placeholder: 'Checklist title (optional)…',
					allowedFormats: [ 'core/bold', 'core/italic' ],
				} ),
				h( InnerBlocks, {
					allowedBlocks:        ALLOWED,
					template:             TEMPLATE,
					templateInsertUpdatesSelection: false,
					renderAppender:       InnerBlocks.ButtonBlockAppender,
				} )
			);
		},
		save: function Save( { attributes } ) {
			const { title } = attributes;
			const blockProps = ( wp.blockEditor.useBlockProps && wp.blockEditor.useBlockProps.save )
				? wp.blockEditor.useBlockProps.save( { className: 'os-checklist' } )
				: { className: 'os-checklist' };
			return h(
				'div',
				blockProps,
				title
					? h( RichText.Content, {
						tagName: 'h4',
						className: 'os-checklist__title',
						value: title,
					} )
					: null,
				h( InnerBlocks.Content, null )
			);
		},
	} );
} )( window.wp );
