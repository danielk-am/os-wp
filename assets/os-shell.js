/**
 * Context Shell — app-wide overlay services: the toast system and the async
 * confirm/prompt Dialog system, plus their React-context hooks. These wrap the
 * whole app (mounted in App()) and are consumed everywhere via `useToast()` /
 * `useDialog()`, so they're the foundation the Type layer + feature apps build
 * on. Sits above `ci/ui` (DialogModal uses the WPDS-backed Button) — dependency
 * DAG: core ← ui ← shell ← {engine, type} ← apps.
 *
 * No build step — hand-authored native ES module; bare specifiers resolve via
 * the importmap.
 */
import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import { Modal, SnackbarList, TextControl } from '@wordpress/components';
import { h } from 'os/core';
import { Button } from 'os/ui';

// ---------------------------------------------------------------------------
// Toast system
// ---------------------------------------------------------------------------
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((toast) => {
    const id = ++idRef.current;
    const next = { id, ttl: 4000, variant: 'info', ...toast };
    setItems((it) => [...it, next]);
    if (next.ttl > 0) {
      setTimeout(() => setItems((it) => it.filter((x) => x.id !== id)), next.ttl);
    }
    return id;
  }, []);
  const dismiss = useCallback((id) => setItems((it) => it.filter((x) => x.id !== id)), []);

  // One api object for the provider's lifetime. Consumers put `toast` in
  // dependency arrays, so a per-render identity refires their effects on every
  // toast — the Filesystem app, for one, re-ran its whole boot fetch (and
  // swapped to the full-page spinner) each time a toast fired.
  const api = useMemo(() => ({
    push, dismiss,
    success: (title, body) => push({ variant: 'success', title, body }),
    error: (title, body) => push({ variant: 'error', title, body, ttl: 7000 }),
    info: (title, body) => push({ variant: 'info', title, body }),
  }), [push, dismiss]);

  // WPDS Snackbar has no per-variant colour, so keep a leading glyph as the
  // success/error/info signal. Title + optional body become the content node;
  // the toast action maps to a Snackbar action. Our `push` TTL stays the single
  // source of truth for auto-dismiss (the item unmounts before Snackbar's own
  // fallback timer fires).
  const glyph = { success: '✓ ', error: '! ', info: '' };
  const notices = items.map((t) => ({
    id: String(t.id),
    content: h`<span>${(glyph[t.variant] || '') + (t.title || '')}${t.body ? h`<span className="block opacity-80 mt-0.5">${t.body}</span>` : null}</span>`,
    explicitDismiss: true,
    actions: t.action ? [{ label: t.action.label, onClick: t.action.onClick }] : undefined,
  }));

  return h`<${ToastCtx.Provider} value=${api}>
    ${children}
    <div className="fixed bottom-4 right-4 z-[100000] max-w-sm">
      <${SnackbarList} notices=${notices} onRemove=${(id) => dismiss(Number(id))} />
    </div>
  </${ToastCtx.Provider}>`;
}

export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Dialog system — async confirm/prompt replacements for window.confirm /
// window.prompt. The browser-native popups blocked the JS thread, broke
// the WP admin bar position on mobile, and looked like they came from
// the browser rather than the app. Modal-based replacement lets us
// style, label, and dismiss cleanly.
// ---------------------------------------------------------------------------
const DialogCtx = createContext(null);

export function DialogProvider({ children }) {
  const [state, setState] = useState(null);
  const close = () => setState(null);
  const api = useMemo(() => ({
    // confirm() resolves to true (OK) or false (Cancel / dismiss).
    confirm: (title, body, opts = {}) => new Promise((resolve) => {
      setState({
        kind: 'confirm', title, body: body || '',
        confirmLabel: opts.confirmLabel || 'OK',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        danger: !! opts.danger,
        resolve,
      });
    }),
    // prompt() resolves to the entered string, or null if cancelled.
    prompt: (title, body, opts = {}) => new Promise((resolve) => {
      setState({
        kind: 'prompt', title, body: body || '',
        defaultValue: opts.defaultValue || '',
        placeholder:  opts.placeholder  || '',
        confirmLabel: opts.confirmLabel || 'OK',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        resolve,
      });
    }),
  }), []);

  const handleCancel = () => {
    if (!state) return;
    state.resolve(state.kind === 'prompt' ? null : false);
    close();
  };
  const handleConfirm = (value) => {
    if (!state) return;
    state.resolve(state.kind === 'prompt' ? (value == null ? '' : value) : true);
    close();
  };

  return h`<${DialogCtx.Provider} value=${api}>
    ${children}
    ${state ? h`<${DialogModal} state=${state} onCancel=${handleCancel} onConfirm=${handleConfirm} />` : null}
  </${DialogCtx.Provider}>`;
}

export const useDialog = () => useContext(DialogCtx);

function DialogModal({ state, onCancel, onConfirm }) {
  const [value, setValue] = useState(state.kind === 'prompt' ? (state.defaultValue || '') : '');
  const submit = () => onConfirm(state.kind === 'prompt' ? value : true);
  // WPDS Modal owns the backdrop, focus trap, ESC-to-close (→ onCancel), and
  // the title + close button in its header. focusOnMount lands on the first
  // focusable, so the prompt field is focused without a manual ref.
  return h`<${Modal}
    title=${state.title || ''}
    onRequestClose=${onCancel}
    className="os-dialog-modal"
    size="small"
  >
    ${state.body ? h`<p className="mt-0 text-sm text-muted-foreground whitespace-pre-line">${state.body}</p>` : null}
    ${state.kind === 'prompt' ? h`<${TextControl}
      label=${state.title || 'Value'}
      hideLabelFromVision=${true}
      value=${value}
      onChange=${setValue}
      placeholder=${state.placeholder}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      __nextHasNoMarginBottom=${true}
      __next40pxDefaultSize=${true}
    />` : null}
    <div className="mt-4 flex items-center justify-end gap-2">
      <${Button} size="sm" variant="ghost" onClick=${onCancel}>${state.cancelLabel}</${Button}>
      <${Button}
        size="sm"
        variant=${state.danger ? 'danger' : 'primary'}
        onClick=${submit}
      >${state.confirmLabel}</${Button}>
    </div>
  </${Modal}>`;
}
