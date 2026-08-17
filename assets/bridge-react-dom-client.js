/**
 * Bridge: react-dom + react-dom/client → wp.element.
 * wp.element bundles ReactDOM alongside React. We expose enough of the
 * ReactDOM surface that third-party libs (React Flow, Floating UI, etc.)
 * can import bare `react-dom` and get a working module.
 */
const e = window.wp && window.wp.element;

export const createRoot = e?.createRoot;
export const hydrateRoot = e?.hydrateRoot;
export const createPortal = e?.createPortal;
export const flushSync = e?.flushSync;
export const findDOMNode = e?.findDOMNode;
export const render = e?.render;
// Legacy ReactDOM.hydrate — imported by @wordpress/element's `react-dom`
// re-export inside the vendored DataViews bundle. Undefined-safe.
export const hydrate = e?.hydrate;
export const unmountComponentAtNode = e?.unmountComponentAtNode;
export const version = e?.version;

export default {
  createRoot: e?.createRoot,
  hydrateRoot: e?.hydrateRoot,
  createPortal: e?.createPortal,
  flushSync: e?.flushSync,
  findDOMNode: e?.findDOMNode,
  render: e?.render,
  hydrate: e?.hydrate,
  unmountComponentAtNode: e?.unmountComponentAtNode,
  version: e?.version,
};
