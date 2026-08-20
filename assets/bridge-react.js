/**
 * Bridge: re-export `window.wp.element` (Gutenberg's React wrapper) as
 * the `react` module. Necessary because @wordpress/components is built
 * against `wp.element`'s React instance — if our app pulled in a different
 * React copy, context, refs, and hooks wouldn't share state.
 *
 * Activated two ways:
 *   1. via the importmap in class-context-app.php (for the app code)
 *   2. via esbuild `alias` in setup/build-vendor.mjs (for vendor bundles
 *      like xyflow/react that internally `import "react"`)
 *
 * IMPORTANT: enumerate every React API a bundled vendor might call.
 * `use-sync-external-store` (used by xyflow/react) calls
 * `useDebugValue`; missing exports show up at runtime as cryptic
 * "X is not a function" errors deep inside a minified vendor bundle.
 */
const e = window.wp && window.wp.element;
if (!e) {
  console.error('[os] window.wp.element not available — wp-element script not enqueued?');
}

// Core
export const createElement = e?.createElement;
export const cloneElement = e?.cloneElement;
export const Children = e?.Children;
export const Component = e?.Component;
export const PureComponent = e?.PureComponent;
export const Fragment = e?.Fragment;
export const StrictMode = e?.StrictMode;
export const Suspense = e?.Suspense;
export const isValidElement = e?.isValidElement;

// Context / refs
export const createContext = e?.createContext;
export const createRef = e?.createRef;
export const forwardRef = e?.forwardRef;

// Code-splitting
export const lazy = e?.lazy;
export const memo = e?.memo;

// Hooks — full React 18 surface so vendor bundles that call any of
// these via window.wp.element resolve cleanly.
export const useCallback = e?.useCallback;
export const useContext = e?.useContext;
export const useDebugValue = e?.useDebugValue;
export const useDeferredValue = e?.useDeferredValue;
export const useEffect = e?.useEffect;
export const useId = e?.useId;
export const useImperativeHandle = e?.useImperativeHandle;
export const useInsertionEffect = e?.useInsertionEffect;
export const useLayoutEffect = e?.useLayoutEffect;
export const useMemo = e?.useMemo;
export const useReducer = e?.useReducer;
export const useRef = e?.useRef;
export const useState = e?.useState;
export const useSyncExternalStore = e?.useSyncExternalStore;
export const useTransition = e?.useTransition;

// Concurrency
export const startTransition = e?.startTransition;

// Version constant — some libraries branch on it.
export const version = e?.version;

// __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED — yes, really.
// react-dom probes this to verify a single React instance; without it
// some packages refuse to mount.
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  e?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default e;
