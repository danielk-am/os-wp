/* global wp */
( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { createElement: h, useEffect } = wp.element;
	const { InspectorControls, RichText, useBlockProps } = wp.blockEditor;
	const { PanelBody, TextControl, Dropdown, MenuItem, ToggleControl } = wp.components;
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

	// dueDate attr packs "YYYY-MM-DD" or "YYYY-MM-DD HH:MM". Split/join so
	// the inspector can offer separate date + time controls without a
	// schema change.
	function splitDue( v ) {
		const parts = String( v || '' ).trim().split( /\s+/ );
		return { date: parts[ 0 ] || '', time: parts[ 1 ] || '' };
	}
	function joinDue( date, time ) {
		date = ( date || '' ).trim();
		time = ( time || '' ).trim();
		if ( ! date ) return '';
		return time ? date + ' ' + time : date;
	}

	function genId() {
		if ( window.crypto?.randomUUID ) {
			return 't_' + window.crypto.randomUUID().replace( /-/g, '' ).slice( 0, 12 );
		}
		return 't_' + Math.random().toString( 36 ).slice( 2, 14 );
	}

	registerBlockType( 'core-index/task', {
		edit: function Edit( { attributes, setAttributes } ) {
			const { taskId, text, checked, dueDate, priority } = attributes;
			const blockProps = useBlockProps( {
				className: 'ci-task' + ( checked ? ' is-checked' : '' ),
			} );

			// Ensure every task has a stable id (used by view.js to persist state).
			useEffect( () => {
				if ( ! taskId ) {
					setAttributes( { taskId: genId() } );
				}
			}, [ taskId, setAttributes ] );

			const statusEmoji = checked ? '✅' : '⬜';
			const statusLabel = checked ? 'Done' : 'Pending';
			return h(
				'div',
				{ ...blockProps, className: ( blockProps.className || '' ) + ' wp-block-ci-task' + ( checked ? ' is-checked' : '' ) },
				h(
					InspectorControls,
					null,
					h(
						PanelBody,
						{ title: 'Task', initialOpen: true },
						h( TextControl, {
							label: 'Due date',
							type: 'date',
							value: splitDue( dueDate ).date,
							onChange: ( v ) => setAttributes( { dueDate: joinDue( v, splitDue( dueDate ).time ) } ),
							__next40pxDefaultSize: true,
							__nextHasNoMarginBottom: true,
						} ),
						h( TextControl, {
							label: 'Due time',
							type: 'time',
							value: splitDue( dueDate ).time,
							onChange: ( v ) => setAttributes( { dueDate: joinDue( splitDue( dueDate ).date, v ) } ),
							help: 'Optional — leave blank for an all-day reminder.',
							__next40pxDefaultSize: true,
							__nextHasNoMarginBottom: true,
						} ),
						h( PopoverSelectControl, {
							label: 'Priority',
							value: priority || '',
							options: [
								{ value: '',       label: '—' },
								{ value: 'low',    label: 'Low' },
								{ value: 'medium', label: 'Medium' },
								{ value: 'high',   label: 'High' },
							],
							onChange: ( v ) => setAttributes( { priority: v || '' } ),
							__next40pxDefaultSize: true,
							__nextHasNoMarginBottom: true,
						} ),
						h( ToggleControl, {
							label: 'Checked',
							checked: !! checked,
							onChange: ( v ) => setAttributes( { checked: !! v } ),
							__nextHasNoMarginBottom: true,
						} )
					)
				),
				h( 'div', { className: 'wp-block-ci-task__status' },
					h( 'span', { className: 'wp-block-ci-task__emoji-status', title: statusLabel }, statusEmoji + ' ' ),
					h( 'div', { className: 'wp-block-ci-task__checkbox-wrapper' },
						h( 'span', {
							className: 'wp-block-ci-task__checkbox' + ( checked ? ' is-aria-checked-true' : ' is-aria-checked-false' ),
							role: 'checkbox',
							tabIndex: 0,
							title: statusLabel,
							'aria-checked': checked ? 'true' : 'false',
							onClick: () => setAttributes( { checked: !checked } ),
							onKeyDown: ( e ) => {
								if ( e.key === ' ' || e.key === 'Enter' ) {
									e.preventDefault();
									setAttributes( { checked: !checked } );
								}
							},
						} )
					)
				),
				h( 'div', { className: 'wp-block-ci-task__main' },
					h( 'div', { className: 'wp-block-ci-task__left' },
						h( 'div', { className: 'wp-block-ci-task__content-wrapper' },
							h( RichText, {
								tagName: 'span',
								className: 'wp-block-ci-task__content',
								value: text || '',
								onChange: ( v ) => setAttributes( { text: v } ),
								placeholder: 'Task description…',
								allowedFormats: [ 'core/bold', 'core/italic', 'core/link', 'core/code' ],
							} )
						),
						h( 'div', { className: 'wp-block-ci-task__dates' },
							splitDue( dueDate ).date ? h( 'span', {
								className: 'wp-block-ci-task__date wp-block-ci-task__date--due',
								'data-iso': dueDate,
							}, splitDue( dueDate ).date ) : null,
							splitDue( dueDate ).time ? h( 'span', {
								className: 'wp-block-ci-task__date wp-block-ci-task__date--time',
							}, splitDue( dueDate ).time ) : null,
							priority ? h( 'span', {
								className: 'wp-block-ci-task__priority wp-block-ci-task__priority--' + priority,
							}, priority ) : null
						)
					),
					h( 'div', { className: 'wp-block-ci-task__right' },
						h( 'div', { className: 'wp-block-ci-task__assignees-avatars' } )
					)
				)
			);
		},
		// Dynamic block: server renders via Core_Index_Task_Blocks::render_task().
		// Sidesteps save/parse markup-validation pain — attrs in the
		// comment delimiter are the canonical source of truth.
		save: () => null,
	} );
} )( window.wp );
