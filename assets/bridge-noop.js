/**
 * No-op module. Mapped in the importmap for bare specifiers that some
 * WordPress 7.0 core blocks lazy-import as script modules (e.g.
 * `@wordpress/latex-to-mathml` for the rarely-used math/LaTeX feature).
 *
 * Core injects its own importmap for these AFTER module scripts have already
 * started loading, which races and throws "Failed to resolve module
 * specifier" in the console. Pre-declaring the specifier here — in our
 * importmap, which is printed up front — makes the dynamic import resolve
 * immediately and silently. These features aren't used when composing a
 * wizard body, so a no-op is sufficient; if ever called, callers get a
 * harmless empty result rather than a crash.
 */
const noop = () => '';
export default noop;
export const latexToMathML = noop;
export const convert = noop;
