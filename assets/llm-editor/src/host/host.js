/* GENERATED from llm-editor src/host/host.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
/**
 * The host seam.
 *
 * Everything above this line is the same code everywhere. Everything below it
 * differs per host: VS Code has a workspace and a native dialog, WordPress has
 * a media library and a REST API, the shareable artifact has neither and cannot
 * be given either (strict CSP, no filesystem, no network).
 *
 * The blob had no seam, so it hardcoded a demo path in the File node and left
 * Daniel asking the obvious question: "How do you actually use the File node?"
 * You could not. There was nowhere for a picker to live.
 *
 * ---------------------------------------------------------------------------
 * WHAT GOES IN `file=` (the decision this seam exists to protect)
 * ---------------------------------------------------------------------------
 *
 * `file=` holds a URI. One attribute, three shapes:
 *
 *   file=/skills/collaborating/pipeline.llm     host-root-relative path
 *   file=https://example.com/uploads/hero.jpg   absolute
 *   file=./sibling.llm                          relative to this document
 *
 * It does NOT hold a database id. That was the tempting shape, and it is wrong:
 * `file=wp:post/567` is meaningless in a git checkout, and .llm's whole premise
 * is that the same text is legible on disk and in a DB. A URI degrades
 * gracefully; an id degrades to garbage. OKF agrees, and says so twice:
 * absolute bundle-relative links are recommended because they survive a move,
 * and "Consumers MUST tolerate broken links."
 *
 * The WordPress objection ("but I picked an attachment, I want its id back")
 * dissolves on contact with core: `attachment_url_to_postid()` resolves a local
 * URL to an attachment id. WP already stores both, and prefers the URL for
 * rendering. We copy that, minus the duplication.
 *
 * So a picker's ONLY job is to produce a good URI string. Everything else about
 * it is host-specific chrome.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} FileRef
 * @property {string} uri    what lands in `file=`. See above.
 * @property {string} [label] optional display text. Cosmetic; never persisted.
 */

/**
 * @typedef {Object} Host
 * @property {string} name
 * @property {() => Promise<string|null>} load       current document text
 * @property {(text: string) => Promise<boolean|void>} save
 *           Resolves false when a save was cancelled or not completed.
 * @property {(text: string) => void} [stage]
 *           Optional synchronous latest-text handoff for a host that can
 *           outlive the renderer (VS Code uses it to flush on panel disposal).
 * @property {(opts?: {accept?: string[]}) => Promise<FileRef|null>} pickFile
 * @property {(uri: string) => Promise<string|null>} readFile  for previewing an include
 * @property {(artifact: {text: string, fileName: string}) => Promise<boolean|object|null>} exportFile
 *           Save or download one compiled Markdown artifact.
 * @property {() => Promise<Array<{name: string, text: string}>|null>} [pickDocuments]
 *           Optional multi-source picker. Filesystem hosts implement it.
 * @property {(artifacts: Array<{text: string, fileName: string}>) => Promise<boolean|object|null>} [exportFiles]
 *           Optional batch writer paired with pickDocuments.
 * @property {(cb: (text: string) => void) => void} [onExternalChange]
 * @property {(cb: () => Promise<boolean>) => void} [onCloseRequest]
 *           Optional close handshake. Electron waits for this promise before
 *           allowing a native document tab to be destroyed.
 * @property {(label: string, busy: boolean) => void} [onSaveState]
 *           Optional. The canvas calls this whenever its save state changes, so
 *           a host that draws its own save UI can mirror it instead of guessing.
 *           The Context app uses it; VS Code and the artifact have no chrome to
 *           mirror into and omit it. See setSaveState in editor/store.js.
 * @property {string} [ext]
 *           Optional. The real file's extension, dot included (".llm" or
 *           ".md"), for hosts that back onto an actual file. A webview cannot
 *           read its own document's name, so this has to come from the host.
 *           Omitted by hosts with no real file (standalone) or none reported
 *           yet (WordPress); the doc-bar and the source tab fall back to
 *           ".llm".
 * @property {() => string|null} [sourceName]
 *           Optional current filename for compiler provenance and the default
 *           output name. Filesystem hosts know it; other hosts fall back to
 *           frontmatter name plus ext.
 * @property {boolean} [overview]
 *           True when this renderer is an app overview rather than a document.
 *           Electron uses it for its project and skill journeys. Document
 *           hosts omit it and boot directly into the editor.
 * @property {() => Promise<object|null>} [projectState]
 * @property {(capability: string, input?: unknown) => boolean} [canInvokeOverview]
 * @property {(capability: string, input?: unknown) => Promise<object|null>} [invokeOverview]
 *           Stable Overview intent dispatch. The renderer names capabilities;
 *           the host maps them to IPC, commands, REST, or an honest unavailable
 *           state without exposing those implementation names to the renderer.
 * @property {(seed: string) => Promise<boolean|object|null>} [createSkill]
 * @property {(draft: {text: string}) => Promise<boolean|object|null>} [saveSkillDraft]
 * @property {() => Promise<Array<{id: string, label: string, provider: string, model: string, available: boolean}>>} [claudeDomains]
 * @property {(request: {domain: string, messages: Array<{role: string, content: string}>}) => Promise<string>} [claudeChat]
 * @property {() => Promise<boolean>} [cancelClaudeChat]
 * @property {(relativePath: string) => Promise<boolean|object|null>} [openSkill]
 * @property {() => Promise<object|null>} [refreshProject]
 * @property {(cb: (state: object) => void) => void} [onProjectChange]
 *           Optional project journey surface. Kept on the host contract so
 *           the overview owns presentation while Electron owns filesystem
 *           access and native dialogs.
 */

/** @type {Host|null} */
let current = null;

export function setHost(h) {
  const required = ['name', 'load', 'save', 'pickFile', 'readFile'];
  const missing = required.filter((k) => !h?.[k]);
  if (missing.length) throw new Error(`setHost: missing ${missing.join(', ')}`);
  current = h;
}

export function host() {
  if (!current) throw new Error('No host set. Call setHost() before mounting.');
  return current;
}

/**
 * True when the host can actually browse. The File node's picker button hides
 * when this is false, rather than offering a button that opens nothing.
 * Honesty in the UI is cheaper than a bug report.
 */
export function canPick() {
  return Boolean(current && current.pickFile && !current.pickFile.unavailable);
}

export function canCompileMany() {
  return Boolean(current?.pickDocuments && current?.exportFiles);
}

/**
 * Has a host already been installed?
 *
 * boot.js runs in all three environments. VS Code and WordPress install their
 * host before importing it; the bundle does not. So boot asks rather than
 * assuming, and there is one boot path instead of three that drift.
 */
export function hostIsSet() { return current !== null; }
