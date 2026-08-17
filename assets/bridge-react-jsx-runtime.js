/**
 * Bridge: react/jsx-runtime → wp.element. Some libraries (htm doesn't, but
 * react-router-dom internals might) import jsx-runtime — wire it back to
 * the same React instance via the standard jsx() / jsxs() / Fragment API.
 */
const e = window.wp && window.wp.element;
export const jsx = e?.createElement;
export const jsxs = e?.createElement;
export const jsxDEV = e?.createElement;
export const Fragment = e?.Fragment;
