/**
 * Generic source editors for Content Types.
 *
 * Both modes edit the selected post type's title and post_content through the
 * native WordPress REST API. They are content-type editor choices, not separate
 * products or menus.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { h, rest, registerEditor, CIRegistry } from 'ci/core';
import { Spinner } from 'ci/ui';
import { useToast } from 'ci/shell';
import { CodeEditor } from 'ci/editors';

function SourceEditor( { type, id, isNew, meta, mode } ) {
  const navigate = useNavigate();
  const toast = useToast();
  const TypeLayout = CIRegistry.TypeLayout;
  const EditorHeader = CIRegistry.EditorHeader;
  const restBase = `/wp/v2/${ meta?.rest_base || meta?.cpt || type }`;
  const [ title, setTitle ] = useState( '' );
  const [ content, setContent ] = useState( '' );
  const [ loading, setLoading ] = useState( ! isNew );
  const [ saving, setSaving ] = useState( false );
  const [ dirty, setDirty ] = useState( false );

  useEffect( () => {
    if ( isNew ) return;
    setLoading( true );
    rest( `${ restBase }/${ id }?context=edit` )
      .then( ( post ) => {
        setTitle( post.title?.raw ?? '' );
        setContent( post.content?.raw ?? '' );
        setDirty( false );
      } )
      .catch( ( error ) => toast?.error( 'Load failed', String( error.message || error ) ) )
      .finally( () => setLoading( false ) );
  }, [ id, isNew, restBase, toast ] );

  const save = useCallback( async () => {
    setSaving( true );
    try {
      const payload = JSON.stringify( {
        title: title || `(untitled ${ meta?.singular?.toLowerCase() || 'item' })`,
        content,
        status: 'publish',
      } );
      const post = isNew
        ? await rest( restBase, { method: 'POST', body: payload } )
        : await rest( `${ restBase }/${ id }`, { method: 'POST', body: payload } );
      setDirty( false );
      toast?.success( 'Saved', `${ mode === 'code' ? 'Code' : 'Plain text' } content updated.` );
      if ( isNew ) navigate( `/t/${ type }/${ post.id }` );
    } catch ( error ) {
      toast?.error( 'Save failed', String( error.message || error ) );
    } finally {
      setSaving( false );
    }
  }, [ content, id, isNew, meta, mode, navigate, restBase, title, toast, type ] );

  if ( loading ) {
    return h`<${ TypeLayout } type=${ type } activeId=${ id } mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
      <div className="p-10"><${ Spinner } /></div>
    </${ TypeLayout }>`;
  }

  return h`<${ TypeLayout } type=${ type } activeId=${ id } mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
    <div className="flex flex-col h-full bg-card pt-14">
      <${ EditorHeader }
        title=${ title }
        setTitle=${ ( value ) => { setTitle( value ); setDirty( true ); } }
        placeholder=${ `${ meta?.singular || 'Item' } title…` }
        dirty=${ dirty }
        isNew=${ isNew }
        saving=${ saving }
        onSave=${ save }
        onClose=${ () => navigate( `/t/${ type }` ) }
        hideTitlebar=${ true }
      />
      ${ CIRegistry.EditorTitleField ? h`<${ CIRegistry.EditorTitleField }
        title=${ title }
        setTitle=${ ( value ) => { setTitle( value ); setDirty( true ); } }
        placeholder=${ `${ meta?.singular || 'Item' } title…` }
        className="mx-4 md:mx-6 pt-4 shrink-0"
      />` : null }
      <div className="flex-1 min-h-0 relative mx-4 md:mx-6 my-4 border border-border rounded-md overflow-hidden">
        <${ CodeEditor }
          value=${ content }
          onChange=${ ( value ) => { setContent( value ); setDirty( true ); } }
          language=${ mode === 'code' ? 'javascript' : 'plaintext' }
        />
      </div>
    </div>
  </${ TypeLayout }>`;
}

registerEditor( 'code', ( context ) => h`<${ SourceEditor } ...${ context } mode="code" />`, {
  selectable: true,
  title: 'Code',
  description: 'A source editor for code stored in the content body.',
} );

registerEditor( 'plain', ( context ) => h`<${ SourceEditor } ...${ context } mode="plain" />`, {
  selectable: true,
  title: 'Plain text',
  description: 'A distraction-free plain-text source editor.',
} );
