/**
 * Context App — Wizard editor + runner (self-contained leaf module).
 *
 * The os_wizard author (JsonWizardEditorPage) + the front-end runner
 * (UserWizardPage at /w/:slug) lifted out of the monolith. Self-registers the
 * `wizard` editor + the /w routes on import. The /dev/wizards developer docs
 * stay in the main bundle (they ride the onboarding/design-wizard shell).
 * Shared chrome (TypeLayout / WizardShell / SectionTipsPanel) is read from the
 * registry via thin wrappers; rewriteWikilinks comes from ci/core.
 *
 * No build step — native ES module; bare specifiers resolve via the importmap.
 */
import { createElement, cloneElement, Children, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } from 'react';
import { createPortal } from 'react-dom/client';
import { useParams, useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import {
  Button as WPButton, Spinner as WPSpinner, Notice as WPNotice,
  Card as WPCard, CardBody as WPCardBody,
  Toolbar as WPToolbar, ToolbarGroup as WPToolbarGroup, ToolbarButton as WPToolbarButton,
  Dropdown as WPDropdown, ColorPalette as WPColorPalette, ColorIndicator as WPColorIndicator,
  TextControl as WPTextControl, TextareaControl as WPTextareaControl,
  FormTokenField as WPFormTokenField,
  CheckboxControl as WPCheckboxControl, SearchControl as WPSearchControl,
  TreeGrid as WPTreeGrid, TreeGridRow as WPTreeGridRow, TreeGridCell as WPTreeGridCell,
  ItemGroup as WPItemGroup, Item as WPItem, MenuGroup as WPMenuGroup, MenuItem as WPMenuItem,
  TabPanel as WPTabPanel, SlotFillProvider as WPSlotFillProvider,
} from '@wordpress/components';
import { marked } from 'marked';
import { h, BOOT, rest, restAllPages, decodeEntities, typeMeta, CIRegistry, registerEditor, registerRoute } from 'os/core';
import { Icon, WPGlyph, Card, PadCard, Button, Badge, Spinner, CI_ICONS, SelectCheckbox } from 'os/ui';
import { useToast, useDialog } from 'os/shell';
import { GutenbergComposer, useEditorFullWidth, EditorFullWidthButton } from 'os/editors';
import { rewriteWikilinks } from 'os/core';

// Shared chrome via the registry (set by the main bundle before mount).
const TypeLayout = ({ children, ...rest }) => h`<${CIRegistry.TypeLayout} ...${rest}>${children}</${CIRegistry.TypeLayout}>`;
const WizardShell = (props) => h`<${CIRegistry.WizardShell} ...${props} />`;
const SectionTipsPanel = (props) => h`<${CIRegistry.SectionTipsPanel} ...${props} />`;

// Plain-text from a REST-rendered HTML title (lost in the monolith split:
// the original lives in context-app.js, which this leaf module cannot import).
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

// Chrome glyphs used by the step composer.
const iconPlus = h`<${Icon} name="plus" />`;
const iconTrash = h`<${Icon} name="trash" />`;
const iconChevronUp = h`<${Icon} name="chevron-up" />`;
const iconChevronDown = h`<${Icon} name="chevron-down" />`;
const iconChevronRight = h`<${Icon} name="chevron-right" />`;

function emptyWizardConfig() {
  return {
    steps: [
      {
        key: 'welcome',
        label: 'Welcome',
        description: 'A quick intro to what this wizard does.',
        body: `<!-- wp:heading -->
<h2 class="wp-block-heading">Hello!</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>This is a <strong>demo step</strong>. Click anywhere here to edit, or press <kbd>/</kbd> to insert a new block (image, video, columns, list, heading, anything).</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list">
<!-- wp:list-item --><li><strong>Bold</strong>, <em>italic</em>, <code>inline code</code></li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Headings, blockquotes, lists, code blocks</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Images, video, audio, embeds (YouTube, Vimeo, Twitter…)</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Columns, groups, covers — anything block themes support</li><!-- /wp:list-item -->
</ul>
<!-- /wp:list -->`,
        tipsBody: `<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">About this step</h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Set the scene. What is this wizard for? Who is it for?</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">When you save</h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Click <strong>Next</strong> to advance to the next step.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="#/dev/wizards">Learn more about Wizards ↗</a></p>
<!-- /wp:paragraph -->`,
      },
      {
        key: 'showcase',
        label: 'Showcase',
        description: 'Walk through the wizard\'s side-panel features.',
        body: `<!-- wp:heading -->
<h2 class="wp-block-heading">Side panel demo</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The card on the right is a <code>SectionTipsPanel</code>. Edit the <strong>Tips (JSON)</strong> textarea on this step in the composer to play with the fields below.</p>
<!-- /wp:paragraph -->

<!-- wp:columns -->
<div class="wp-block-columns">

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Top fields</h3><!-- /wp:heading -->
<!-- wp:list -->
<ul class="wp-block-list">
<!-- wp:list-item --><li><strong>summary</strong> — paragraph at the top</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>findIt</strong> — string OR array (bulleted list)</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>addPattern</strong> — paragraph on adding content</li><!-- /wp:list-item -->
</ul>
<!-- /wp:list --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Bottom fields</h3><!-- /wp:heading -->
<!-- wp:list -->
<ul class="wp-block-list">
<!-- wp:list-item --><li><strong>suggestedPatterns</strong> — rows of {category, when}</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>saveBehaviour</strong> — paragraph on save</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>docs</strong> — array of {label, url}</li><!-- /wp:list-item -->
</ul>
<!-- /wp:list --></div>
<!-- /wp:column -->

</div>
<!-- /wp:columns -->`,
        tipsBody: `<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">About this step</h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The side panel is also a block editor — drop in headings, lists, callouts, even images or links.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">Suggested patterns</h4>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">
<!-- wp:list-item --><li><strong>Tips</strong> — Walk users through unfamiliar UI</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>Showcase</strong> — Demonstrate your wizard's features</li><!-- /wp:list-item -->
<!-- wp:list-item --><li><strong>Closer</strong> — Final step + thank-you</li><!-- /wp:list-item -->
</ul>
<!-- /wp:list -->`,
      },
      {
        key: 'finish',
        label: 'Finish',
        description: 'Wrap up + tell the user what to do next.',
        body: `<!-- wp:heading -->
<h2 class="wp-block-heading">You're done!</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>That's the whole wizard. To make this yours:</p>
<!-- /wp:paragraph -->

<!-- wp:list {"ordered":true} -->
<ol class="wp-block-list">
<!-- wp:list-item --><li>Edit the title at the top of the composer.</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Rename / reorder / add steps.</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Replace these blocks with your real content.</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Update the <strong>Tips (JSON)</strong> textarea per step.</li><!-- /wp:list-item -->
<!-- wp:list-item --><li>Save and visit <code>/w/&lt;your-slug&gt;</code> to share.</li><!-- /wp:list-item -->
</ol>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Need a primer? See the <a href="#/dev/wizards">Developer Reference</a>.</p>
<!-- /wp:paragraph -->`,
        tipsBody: `<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading">Wrap up</h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The last step closes the loop. Tell the user what they just learned and what to do next.</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list">
<!-- wp:list-item --><li><a href="#/dev/wizards">Developer reference</a></li><!-- /wp:list-item -->
<!-- wp:list-item --><li><a href="#/design">Design Setup wizard</a></li><!-- /wp:list-item -->
<!-- wp:list-item --><li><a href="#/quick-start">Quick Start wizard</a></li><!-- /wp:list-item -->
</ul>
<!-- /wp:list -->`,
      },
    ],
  };
}

function parseWizardConfig(raw) {
  if (!raw || !raw.trim()) return emptyWizardConfig();
  try {
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.steps)) return j;
  } catch {}
  return emptyWizardConfig();
}


function JsonWizardEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const meta = typeMeta(type);
  const isNew = id === 'new';
  const toast = useToast();
  const dialog = useDialog();
  const [fullWidth, toggleFullWidth] = useEditorFullWidth();

  const [post, setPost] = useState(isNew ? { status: 'publish' } : null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [config, setConfig] = useState(emptyWizardConfig);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) {
      setTitle('Wizard demo');
      setConfig(emptyWizardConfig());
      setDirty(true);
      return;
    }
    (async () => {
      try {
        const p = await rest(`/wp/v2/${meta.rest_base}/${id}?context=edit`);
        setPost(p);
        setTitle(p.title?.raw || '');
        setSlug(p.slug || '');
        setConfig(parseWizardConfig(p.content?.raw || ''));
        setDirty(false);
      } catch (e) {
        // 404 → the post was deleted (e.g. via Move to Trash, or by
        // hand). Bounce back to the type list with a friendly toast
        // instead of throwing the raw REST error at the user.
        const is404 = /HTTP 404|rest_post_invalid_id/i.test(e?.message || '');
        if (is404) {
          toast.error('Wizard not found', 'It may have been deleted. Returning to the list.');
          navigate(`/t/${type}`, { replace: true });
        } else {
          toast.error('Failed to load', e.message);
        }
      }
    })();
  }, [type, id, meta?.rest_base, navigate, toast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        title,
        content: JSON.stringify(config, null, 2),
        status: post?.status || 'publish',
      };
      let p;
      if (isNew) {
        p = await rest(`/wp/v2/${meta.rest_base}`, { method: 'POST', body: JSON.stringify(body) });
        toast.success('Wizard created');
        navigate(`/t/${type}/${p.id}`, { replace: true });
      } else {
        p = await rest(`/wp/v2/${meta.rest_base}/${id}`, { method: 'POST', body: JSON.stringify(body) });
        setPost(p);
        setSlug(p.slug || '');
        toast.success('Saved');
      }
      setDirty(false);
    } catch (e) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  }, [title, config, post?.status, isNew, meta?.rest_base, id, type, navigate, toast]);

  // Auto-save mirroring other CPT editors.
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || isNew) return;
    const t = setTimeout(() => { saveRef.current?.(); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, config, title, saving, isNew]);

  // Collapsed step sections (by index). Default: all expanded; the header
  // chevron toggles each. Keeps long wizards manageable, esp. on mobile.
  const [collapsedSteps, setCollapsedSteps] = useState(() => new Set());
  const toggleCollapsed = (idx) => setCollapsedSteps((prev) => {
    const n = new Set(prev);
    if (n.has(idx)) n.delete(idx); else n.add(idx);
    return n;
  });

  // Step list manipulation.
  const patchStep = (idx, patch) => {
    setConfig((c) => ({
      ...c,
      steps: c.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
    setDirty(true);
  };
  const addStep = () => {
    setConfig((c) => ({
      ...c,
      steps: [...c.steps, {
        key: 'step' + (c.steps.length + 1),
        label: 'Step ' + (c.steps.length + 1),
        description: '',
        body: '',
        tips: { summary: '', findIt: '', saveBehaviour: 'Click **Next** to continue.', docs: [] },
      }],
    }));
    setDirty(true);
  };
  const removeStep = (idx) => {
    if (config.steps.length <= 1) {
      toast.error('A wizard needs at least one step.');
      return;
    }
    setConfig((c) => ({ ...c, steps: c.steps.filter((_, i) => i !== idx) }));
    setDirty(true);
  };
  const moveStep = (idx, dir) => {
    setConfig((c) => {
      const swap = idx + dir;
      if (swap < 0 || swap >= c.steps.length) return c;
      const arr = c.steps.slice();
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...c, steps: arr };
    });
    setDirty(true);
  };

  if (!meta) return h`<${TypeLayout} type=${type}><div className="p-10 text-muted-foreground">Unknown type</div></${TypeLayout}>`;
  if (!isNew && !post) return h`<${TypeLayout} type=${type}><div className="p-10"><${Spinner} /></div></${TypeLayout}>`;

  const mountUrl = slug ? `#/w/${slug}/${config.steps[0]?.key || ''}` : null;
  const EditorHeader = CIRegistry.EditorHeader;
  const EditorTitleField = CIRegistry.EditorTitleField;
  const PageFooter = CIRegistry.PageFooter;

  return h`<${TypeLayout} type=${type} activeId=${id} mainClassName="absolute inset-y-0 right-0 left-0 overflow-hidden bg-card">
   <div className="flex flex-col h-full bg-card pt-14">
    <${EditorHeader}
      title=${title} setTitle=${(v) => { setTitle(v); setDirty(true); }}
      placeholder="Wizard title…"
      dirty=${dirty} isNew=${isNew} saving=${saving} onSave=${save}
      onClose=${() => { if (dirty && !confirm('Discard unsaved changes and close?')) return; navigate(`/t/${type}`, { replace: true }); }}
      hideTitlebar=${true}
    />
    <div className="flex-1 min-h-0 overflow-y-auto">
    <div className=${'p-6 md:p-10 mx-auto w-full space-y-8 pb-32 mb-24 ' + (fullWidth ? 'max-w-none' : 'max-w-5xl')}>
      <header className="space-y-2">
        ${EditorTitleField ? h`<${EditorTitleField}
          title=${title}
          setTitle=${(v) => { setTitle(v); setDirty(true); }}
          placeholder="Wizard title…"
        />` : null}
        <p className="text-xs text-muted-foreground">Edits save to <code className="font-mono bg-muted px-1 rounded">post_content</code> as JSON. Mounts at <code className="font-mono bg-muted px-1 rounded">/w/${slug || '<slug>'}/${'<step>'}</code> once published.</p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps (${config.steps.length})</h2>
          <${WPButton} variant="secondary" icon=${iconPlus} onClick=${addStep}>Add step</${WPButton}>
        </div>
        <div className="space-y-4">
          ${config.steps.map((s, i) => {
            const isCollapsed = collapsedSteps.has(i);
            const isLast = i === config.steps.length - 1;
            return h`<${WPCard} key=${i}>
            <div className=${'flex items-center gap-2 px-3 py-2 ' + (isCollapsed ? '' : 'border-b border-border')}>
              <button
                type="button"
                onClick=${() => toggleCollapsed(i)}
                aria-expanded=${!isCollapsed}
                className="flex items-center gap-2 flex-1 min-w-0 text-left bg-transparent"
              >
                <${Icon} name=${isCollapsed ? 'chevron-right' : 'chevron-down'} className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-semibold shrink-0">${i + 1}</span>
                <span className="font-medium truncate">${s.label || `Step ${i + 1}`}</span>
              </button>
              <div className="flex flex-col shrink-0">
                <${WPButton} size="small" icon=${h`<${Icon} name="chevron-up" className="w-3 h-3" />`} onClick=${() => moveStep(i, -1)} disabled=${i === 0} label="Move step up" showTooltip=${true} />
                <${WPButton} size="small" icon=${h`<${Icon} name="chevron-down" className="w-3 h-3" />`} onClick=${() => moveStep(i, 1)} disabled=${isLast} label="Move step down" showTooltip=${true} />
              </div>
            </div>
            ${isCollapsed ? null : h`<${WPCardBody}><div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 os-wpds-fields">
                <${WPTextControl}
                  __nextHasNoMarginBottom
                  __next40pxDefaultSize
                  label="Label"
                  hideLabelFromVision=${true}
                  value=${s.label}
                  onChange=${(value) => patchStep(i, { label: value })}
                  placeholder="Step label (display name)"
                />
                <${WPTextControl}
                  __nextHasNoMarginBottom
                  __next40pxDefaultSize
                  label="Key"
                  hideLabelFromVision=${true}
                  value=${s.key}
                  onChange=${(value) => patchStep(i, { key: value.replace(/[^a-z0-9\-]/gi, '').toLowerCase() })}
                  placeholder="step-key (url slug)"
                  className="os-mono-field"
                />
                <${WPTextControl}
                  __nextHasNoMarginBottom
                  __next40pxDefaultSize
                  label="Description"
                  hideLabelFromVision=${true}
                  value=${s.description}
                  onChange=${(value) => patchStep(i, { description: value })}
                  placeholder="Short description (shown under H1)"
                />
              </div>
              <div className="os-wpds-fields">
                <${WPCheckboxControl}
                  __nextHasNoMarginBottom
                  checked=${!!s.wide}
                  onChange=${(value) => patchStep(i, { wide: value })}
                  label="Full-width"
                  help="Drop the readable max-width cap. Best for iframes, image-heavy steps, or block-layout content."
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Body</div>
                <${GutenbergComposer}
                  value=${s.body || ''}
                  onChange=${(next) => patchStep(i, { body: next })}
                  minHeight=${400}
                />
                <p className="text-[10px] text-muted-foreground mt-2">Block editor — type <kbd className="font-mono bg-muted px-1 rounded">/</kbd> to insert image, video, columns, headings, lists, anything. Saved as block markup; rendered server-side on mount.</p>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Side panel</div>
                <${GutenbergComposer}
                  value=${s.tipsBody || ''}
                  onChange=${(next) => patchStep(i, { tipsBody: next })}
                  minHeight=${400}
                />
                <p className="text-[10px] text-muted-foreground mt-2">Renders in the right-side rail. Use the same block editor as the body — add headings, lists, links, images, anything.</p>
              </div>
              <div className="pt-2 border-t border-border">
                <${WPButton} variant="tertiary" isDestructive=${true} icon=${iconTrash} onClick=${() => removeStep(i)}>Delete step</${WPButton}>
              </div>
            </div></${WPCardBody}>`}
          </${WPCard}>`;
          })}
        </div>
      </section>

      ${PageFooter ? h`<${PageFooter}>
        ${mountUrl ? h`<${PageFooter.Link} href=${mountUrl}>Open wizard</${PageFooter.Link}>` : null}
        <${PageFooter.Action} onClick=${toggleFullWidth}>${fullWidth ? 'Use readable width' : 'Switch to full width'}</${PageFooter.Action}>
      </${PageFooter}>` : null}
    </div>
    </div>
   </div>
  </${TypeLayout}>`;
}


// ---------------------------------------------------------------------------
// UserWizardPage — mounts a user-authored wizard at /w/:slug/:step.
//
// Fetches the os_wizard CPT by slug, parses its JSON, then renders the
// generic WizardShell with the user's steps + tips. Step bodies are
// rendered as markdown via the existing `marked` import.
// ---------------------------------------------------------------------------

function UserWizardPage() {
  const { slug, step } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [config, setConfig] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // `context=edit` is required so REST returns `content.raw`. Without
        // it we'd only get `content.rendered` — wpautop-processed HTML
        // that mangles our JSON (wraps in <p>, escapes braces, etc.).
        const list = await rest(`/wp/v2/os_wizard?slug=${encodeURIComponent(slug || '')}&context=edit&status=publish,draft,private`);
        const found = Array.isArray(list) && list[0];
        if (!found) { setErr('Wizard not found: ' + slug); return; }
        setPost(found);
        setConfig(parseWizardConfig(found.content?.raw || ''));
      } catch (e) { setErr(e.message || 'Failed to load wizard'); }
    })();
  }, [slug]);

  // If step param is missing, redirect to the first step once config loads.
  useEffect(() => {
    if (config && !step && config.steps?.length > 0) {
      navigate(`/w/${slug}/${config.steps[0].key}`, { replace: true });
    }
  }, [config, step, slug, navigate]);

  if (err) {
    return h`<div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="p-10 mx-auto w-full max-w-5xl">
        <${Card} className="p-5 border-destructive/40 bg-destructive/5 text-sm text-foreground">${err}</${Card}>
      </div>
    </div>`;
  }
  if (!config || !step) {
    return h`<div className="absolute inset-0 flex items-center justify-center"><${Spinner} /></div>`;
  }
  const current = config.steps.find((s) => s.key === step);
  if (!current) {
    return h`<div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="p-10 mx-auto w-full max-w-5xl">
        <${Card} className="p-5 text-sm text-foreground">Step not found: <code className="font-mono bg-muted px-1 rounded">${step}</code></${Card}>
      </div>
    </div>`;
  }
  return h`<${WizardShell}
    stepKey=${step}
    steps=${config.steps}
    basePath=${`/w/${slug}`}
    title=${stripHtml(post?.title?.rendered || post?.title?.raw || slug)}
    wide=${!!current.wide}
    aside=${current.tipsBody
      ? h`<${UserWizardStepBody} body=${current.tipsBody} variant="tips" />`
      : current.tips
        ? h`<${SectionTipsPanel} stepKey=${step} tips=${current.tips} url="" />`
        : null}
  >
    <${UserWizardStepBody} body=${current.body || ''} variant="body" />
  </${WizardShell}>`;
}

// Renders a step body. Bodies authored in the composer are block
// markup; bodies authored before the block editor existed are plain
// markdown. Detect by leading `<!-- wp:` and route accordingly:
//   • block markup → POST /preview/render (server-side do_blocks),
//     return rendered HTML, drop into an iframe so block CSS is
//     sandboxed.
//   • markdown     → marked.parse() inline (existing behaviour).
function UserWizardStepBody({ body, variant = 'body' }) {
  const isBlockMarkup = typeof body === 'string' && /^\s*<!--\s*wp:/.test(body);
  const isTips = variant === 'tips';
  const [html, setHtml] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!isBlockMarkup) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await rest('/activity/v1/preview/render', {
          method: 'POST',
          body: JSON.stringify({ content: body }),
        });
        if (!cancelled) setHtml(res?.html || '');
      } catch (e) { if (!cancelled) setErr(e.message || 'Render failed'); }
    })();
    return () => { cancelled = true; };
  }, [body, isBlockMarkup]);
  if (isBlockMarkup) {
    // Both tips and body render INLINE (no iframe) — the server already
    // ran the block markup through do_blocks() (same pipeline as
    // content.rendered), so we drop the rendered HTML straight into the
    // page. Strip the full-document wrapper the preview endpoint returns
    // and keep just the block HTML. `.wp-block-content` scopes the block
    // base styles (see app CSS) so they don't bleed into the app chrome.
    const stripped = (html || '').replace(/<!DOCTYPE[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    if (isTips) {
      return h`<${Card} className="p-5 space-y-3 sticky top-6">
        ${err
          ? h`<div className="text-sm text-foreground bg-destructive/5 border border-destructive/40 rounded-md p-3">${err}</div>`
          : html === null
            ? h`<div className="p-6 flex items-center justify-center"><${Spinner} /></div>`
            : h`<div className="wp-block-content prose-content text-[15px] leading-relaxed text-foreground" dangerouslySetInnerHTML=${{ __html: stripped }} />`}
      </${Card}>`;
    }
    return h`<div className="overflow-hidden">
      ${err
        ? h`<div className="p-6 text-sm text-foreground bg-destructive/5 border border-destructive/40 rounded-md">${err}</div>`
        : html === null
          ? h`<div className="p-10 flex items-center justify-center"><${Spinner} /></div>`
          : h`<div className="wp-block-content prose-content text-base text-foreground" dangerouslySetInnerHTML=${{ __html: stripped }} />`}
    </div>`;
  }
  // Markdown fallback for legacy/plain bodies.
  const bodyHtml = marked.parse(rewriteWikilinks(body || ''));
  if (isTips) {
    return h`<${Card} className="p-5 space-y-3 sticky top-6 text-[15px] leading-relaxed text-foreground prose-content">
      <div dangerouslySetInnerHTML=${{ __html: bodyHtml }} />
    </${Card}>`;
  }
  return h`<div className="text-base text-foreground prose-content">
    <div dangerouslySetInnerHTML=${{ __html: bodyHtml }} />
  </div>`;
}

// ---------------------------------------------------------------------------
// Structure screen — an ACF/SCF-style field + taxonomy manager for a managed
// CPT. Field definitions are stored server-side (ci_field_groups) and
// registered as real post meta; taxonomies are CI-registered (ci_taxonomies).
// Phase 1: core field types (text/textarea/number/checkbox/select/date/url),
// taxonomy create/attach, and term management via core /wp/v2/<tax> routes.
// ---------------------------------------------------------------------------
// Term manager for one taxonomy — list / add / delete via core REST.

// Self-register the wizard editor + the front-end runner routes.
registerEditor('wizard', () => h`<${JsonWizardEditorPage} />`, {
  selectable: true, title: 'Wizard (steps)', description: 'Multi-step guided flow with block-editor bodies.',
  newFile: { label: 'New wizard', desc: 'Composer with steps, body + tips block editors.' },
});
registerRoute('/w/:slug', h`<${UserWizardPage} />`);
registerRoute('/w/:slug/:step', h`<${UserWizardPage} />`);
