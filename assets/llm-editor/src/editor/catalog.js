/* GENERATED from llm-editor src/editor/catalog.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
// The eight node types the editor's addNodeAt supports. Grounding the inserter
// in the real editor rather than inventing a menu.
export const BLOCKS = [
  { type: 'text',      label: 'Text',      icon: 'text',      body: 'Say the thing.' },
  { type: 'group',     label: 'Group',     icon: 'group',     body: '', group: true },
  { type: 'decision',  label: 'Decision',  icon: 'decision',  body: 'Which way?' },
  { type: 'switch',    label: 'Switch',    icon: 'switch',    body: 'Pick a case.' },
  { type: 'merge',     label: 'Merge',     icon: 'merge',     body: '' },
  { type: 'checklist', label: 'Checklist', icon: 'checklist', body: '- [ ] First\n- [ ] Second' },
  // The one code node. Daniel: "What's the diff between Code node and code
  // fence? They both appear to output the same thing." Correct, there was none,
  // so the duplicate is gone. Embeds below are language PRESETS of this node,
  // not rival types.
  { type: 'code',      label: 'Code',      icon: 'code', lang: 'bash',
    body: '```bash\necho "hi"\n```' },
  { type: 'file',      label: 'File',      icon: 'file', file: '/skills/collaborating/collaboration-pipeline.llm',
    body: 'Pulled in for the agent at read time.' },
  { type: 'table',     label: 'Table',     icon: 'schema',
    body: '| Trigger | Fires |\n|---|---|\n| --compile | compiling-canvas-to-md |\n| remember this | capturing-knowledge |' },
];

// Embeds are body content, not a new node kind. A .llm body is markdown, so a
// fence already works; the canvas just has to RENDER it as code rather than
// prose. That is why these carry type=code + lang= instead of inventing types.
//
// The XML tag is the odd one and the interesting one. An XML tag wraps content,
// so it is containment, and .llm already has containment: heading depth. Two
// ways to say the same thing would be a design bug. So a tagged SECTION carries
// tag=, renders as a group with a tag chip, and projects to <name>...</name>
// for the agent. The literal fence is there too, for when you want the tags as
// data rather than as structure.
export const EMBEDS = [
  { type: 'code', lang: 'json', label: 'JSON', icon: 'json',
    body: '```json\n{\n  "name": "docker-audit",\n  "servers": ["web-01"],\n  "readOnly": true\n}\n```' },
  { type: 'code', lang: 'yaml', label: 'YAML', icon: 'yaml',
    body: '```yaml\nservers:\n  - web-01\nread_only: true\n```' },
  { type: 'code', lang: 'xml', label: 'XML (literal)', icon: 'xml',
    body: '```xml\n<instructions>\n  Audit read-only. Never restart.\n</instructions>\n```' },
  { tag: 'instructions', label: 'XML section', icon: 'xmlsection', group: true,
    body: 'Wraps its children in the tag when projected.' },
];

// OKF is Google Cloud's Open Knowledge Format (Jun 2026). `type` is its ONLY
// required field. `title`/`description`/`resource`/`tags`/`timestamp` are
// recommended, in that priority order. Unknown keys MUST be preserved on
// round-trip, which is why these merge into the frontmatter instead of
// replacing it.
export const FRONTMATTER = [
  // Measured, not assumed: `requires:` breaks COLLISIONS between servers whose
  // tools overlap (playwright vs cleanshot both "screenshot"). It is not a
  // scope reducer; see eval_requires.py and requiresBlock() in core/project.js.
  { label: 'requires', icon: 'wrench', keys: { requires: '[playwright]' } },
  { label: 'OKF concept', icon: 'concept', keys: {
      type: 'concept', title: 'Untitled', description: 'One sentence.',
      tags: '[core, draft]', timestamp: new Date().toISOString().slice(0, 10) } },
  { label: 'OKF skill', icon: 'skill', keys: {
      type: 'skill', name: 'my-skill',
      description: 'What it does and when it fires.',
      tags: '[]', triggers: '[]', returns: '' } },
  { label: 'OKF dataset', icon: 'dataset', keys: {
      type: 'dataset', title: 'Untitled dataset',
      resource: 'bigquery://project/dataset/table', description: 'One sentence.' } },
];

// Agent SDK commands. Each is an ordinary step node carrying `tool=`, the
// CORE-26 attribute that names the exact tool a step fires — the SDKs just
// supply well-known names to point it at. Off by default (the "Agent SDK
// commands" toggle in the inserter persists per browser): a flow author who
// is not scripting a coding agent should never wade through vendor tools.
export const CLAUDE_SDK = [
  { label: 'AskUserQuestion', icon: 'help',      tool: 'AskUserQuestion', body: 'Block on a choice only the user can make.' },
  { label: 'TaskCreate',      icon: 'plus',      tool: 'TaskCreate',      body: 'Open a tracked task: subject plus description.' },
  { label: 'TaskUpdate',      icon: 'pen',       tool: 'TaskUpdate',      body: 'Move the task to in_progress, then completed.' },
  { label: 'TodoWrite',       icon: 'checklist', tool: 'TodoWrite',       body: 'Publish the working plan as a todo list.' },
  { label: 'Agent',           icon: 'group',     tool: 'Agent',           body: 'Fan this step out to a subagent.' },
  { label: 'Skill',           icon: 'skill',     tool: 'Skill',           body: 'Invoke a packaged skill by name.' },
];

export const CHATGPT_SDK = [
  { label: 'shell',        icon: 'code',      tool: 'shell',        body: 'Run a command in the workspace.' },
  { label: 'apply_patch',  icon: 'pen',       tool: 'apply_patch',  body: 'Edit files with a structured patch.' },
  { label: 'update_plan',  icon: 'checklist', tool: 'update_plan',  body: 'Publish or revise the step plan.' },
  { label: 'view_image',   icon: 'file',      tool: 'view_image',   body: 'Attach an image to the context.' },
  { label: 'web_search',   icon: 'link',      tool: 'web_search',   body: 'Search the web for fresh context.' },
];

// OKF's conventional body headings. They are headings, so in .llm they are
// simply nodes. No special case needed, which is a good sign.
export const OKF_SECTIONS = [
  { label: 'Schema', icon: 'schema', body: '| field | type | meaning |\n|---|---|---|\n| id | string | the anchor |' },
  { label: 'Examples', icon: 'examples', body: 'Concrete usage goes here.' },
  { label: 'Citations', icon: 'citations', body: '- [OKF SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)' },
];
