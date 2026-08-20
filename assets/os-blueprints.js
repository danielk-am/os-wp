/**
 * ci/blueprints — the content-type blueprint catalog (pure data module).
 *
 * Extracted from the os-type monolith (the ongoing "os-type split") so the
 * blueprint recipes are authored and read as data, not tangled in the editor
 * UI. Each entry is a recipe consumed by CreateTypePage (/structure/new?bp=<id>
 * in os-type.js): it seeds starter `fields` + an `editor`, and — for lifecycle
 * recipes — an optional JSON `schema` (a `status` enum + an `x-os-lifecycle`
 * state machine) that is POSTed as a schema-override on create so os-schema-get
 * orients agents to the legal transitions.
 *
 * No imports, no side effects. Icons are string names resolved against CI_ICONS
 * at render time, so this module stays dependency-free and safe to read/write
 * from tooling (e.g. the type self-learning skill).
 */

export const CI_BLUEPRINTS = [
  {
    id: 'tracker', label: 'Tracker', plural: 'Trackers', icon: 'clipboard', editor: 'cpt',
    description: 'Items with status, priority, and a due date — a Kanban-ish list.',
    fields: [
      { type: 'tab', label: 'Details' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [{ value: 'todo', label: 'To do' }, { value: 'doing', label: 'In progress' }, { value: 'done', label: 'Done' }] },
      { type: 'select', key: 'priority', label: 'Priority', width: 50, options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { type: 'date', key: 'due', label: 'Due date', width: 50 },
      { type: 'textarea', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:status', 'meta:priority', 'meta:due'], filters: ['meta:status', 'meta:priority'], sort: 'recent' },
  },
  {
    id: 'notes', label: 'Note', plural: 'Notes', icon: 'file-lines', editor: 'cpt',
    description: 'A rich-text body with a tag list — a lightweight knowledge note.',
    fields: [
      { type: 'richtext', key: 'body', label: 'Body' },
      { type: 'list', key: 'tags', label: 'Tags' },
    ],
  },
  {
    id: 'catalog', label: 'Catalog item', plural: 'Catalog', icon: 'store', editor: 'cpt',
    description: 'Products/assets with price, description, link, and a featured flag.',
    fields: [
      { type: 'tab', label: 'Item' },
      { type: 'number', key: 'price', label: 'Price', width: 50 },
      { type: 'checkbox', key: 'featured', label: 'Featured' },
      { type: 'url', key: 'link', label: 'Link', width: 50 },
      { type: 'richtext', key: 'description', label: 'Description' },
    ],
    display: { columns: ['meta:price', 'meta:featured'], filters: ['meta:featured'] },
  },
  {
    id: 'log', label: 'Log entry', plural: 'Log', icon: 'calendar', editor: 'cpt',
    description: 'Dated entries with a mood/level and a rich body — journal/standup style.',
    fields: [
      { type: 'date', key: 'entry_date', label: 'Date', width: 50 },
      { type: 'select', key: 'mood', label: 'Level', width: 50, options: [{ value: 'great', label: 'Great' }, { value: 'okay', label: 'Okay' }, { value: 'low', label: 'Low' }] },
      { type: 'richtext', key: 'entry', label: 'Entry' },
    ],
    display: { columns: ['meta:entry_date', 'meta:mood'], sort: 'recent' },
  },
  {
    id: 'bookmark', label: 'Bookmark', plural: 'Bookmarks', icon: 'globe', editor: 'cpt',
    description: 'Saved links with notes and tags — a personal read-it-later / link library.',
    fields: [
      { type: 'url', key: 'url', label: 'URL', required: true },
      { type: 'list', key: 'tags', label: 'Tags' },
      { type: 'textarea', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:url'], sort: 'recent' },
  },
  {
    id: 'contact', label: 'Contact', plural: 'Contacts', icon: 'star', editor: 'cpt',
    description: 'A lightweight CRM — people/orgs with email, phone, pipeline stage, and notes.',
    fields: [
      { type: 'tab', label: 'Contact' },
      { type: 'text', key: 'email', label: 'Email', width: 50 },
      { type: 'text', key: 'phone', label: 'Phone', width: 50 },
      { type: 'text', key: 'company', label: 'Company', width: 50 },
      { type: 'url', key: 'website', label: 'Website', width: 50 },
      { type: 'select', key: 'stage', label: 'Stage', options: [{ value: 'lead', label: 'Lead' }, { value: 'active', label: 'Active' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
      { type: 'richtext', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:company', 'meta:stage'], filters: ['meta:stage'] },
  },
  {
    id: 'event', label: 'Event', plural: 'Events', icon: 'calendar', editor: 'cpt',
    description: 'Dated events with start/end, location, and status — meetups, launches, sessions.',
    fields: [
      { type: 'tab', label: 'Event' },
      { type: 'date', key: 'start', label: 'Start', width: 50 },
      { type: 'date', key: 'end', label: 'End', width: 50 },
      { type: 'text', key: 'location', label: 'Location', width: 50 },
      { type: 'url', key: 'url', label: 'Link', width: 50 },
      { type: 'select', key: 'status', label: 'Status', options: [{ value: 'upcoming', label: 'Upcoming' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' }] },
      { type: 'richtext', key: 'details', label: 'Details' },
    ],
    display: { columns: ['meta:start', 'meta:location', 'meta:status'], filters: ['meta:status'], sort: 'recent' },
  },
  {
    id: 'habit', label: 'Habit', plural: 'Habits', icon: 'seedling', editor: 'cpt', hierarchical: true,
    description: 'Habits with a frequency, streak count, and last-done date. Group sub-habits under a routine.',
    fields: [
      { type: 'select', key: 'frequency', label: 'Frequency', width: 50, options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }] },
      { type: 'number', key: 'streak', label: 'Streak', integer: true, width: 50 },
      { type: 'date', key: 'last_done', label: 'Last done', width: 50 },
      { type: 'checkbox', key: 'active', label: 'Active' },
      { type: 'textarea', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:frequency', 'meta:streak', 'meta:last_done'], filters: ['meta:frequency'] },
  },
  {
    id: 'recipe', label: 'Recipe', plural: 'Recipes', icon: 'utensils', editor: 'cpt',
    description: 'Recipes with servings, prep time, difficulty, and rich ingredients + steps.',
    fields: [
      { type: 'tab', label: 'Recipe' },
      { type: 'number', key: 'servings', label: 'Servings', integer: true, width: 50 },
      { type: 'number', key: 'prep_minutes', label: 'Prep (min)', integer: true, width: 50 },
      { type: 'select', key: 'difficulty', label: 'Difficulty', width: 50, options: [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }] },
      { type: 'list', key: 'tags', label: 'Tags', width: 50 },
      { type: 'tab', label: 'Method' },
      { type: 'richtext', key: 'ingredients', label: 'Ingredients' },
      { type: 'richtext', key: 'steps', label: 'Steps' },
    ],
    display: { columns: ['meta:servings', 'meta:difficulty'], filters: ['meta:difficulty'] },
  },
  {
    id: 'snippet_lib', label: 'Code snippet', plural: 'Snippet library', icon: 'scroll', editor: 'cpt',
    description: 'Structured code snippets — language, the code, a description, and tags.',
    fields: [
      { type: 'select', key: 'language', label: 'Language', width: 50, options: [{ value: 'js', label: 'JavaScript' }, { value: 'ts', label: 'TypeScript' }, { value: 'php', label: 'PHP' }, { value: 'python', label: 'Python' }, { value: 'css', label: 'CSS' }, { value: 'html', label: 'HTML' }, { value: 'bash', label: 'Bash' }, { value: 'sql', label: 'SQL' }, { value: 'other', label: 'Other' }] },
      { type: 'list', key: 'tags', label: 'Tags', width: 50 },
      { type: 'textarea', key: 'code', label: 'Code' },
      { type: 'richtext', key: 'description', label: 'Description' },
    ],
    display: { columns: ['meta:language'], filters: ['meta:language'] },
  },
  {
    id: 'issue', label: 'Issue', plural: 'Issues', icon: 'flag', editor: 'cpt',
    description: 'Bug/feature/task tracker — status, severity, type, assignee, repro steps.',
    fields: [
      { type: 'tab', label: 'Issue' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }] },
      { type: 'select', key: 'severity', label: 'Severity', width: 50, options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }] },
      { type: 'select', key: 'kind', label: 'Type', width: 50, options: [{ value: 'bug', label: 'Bug' }, { value: 'feature', label: 'Feature' }, { value: 'task', label: 'Task' }] },
      { type: 'text', key: 'assignee', label: 'Assignee', width: 50 },
      { type: 'richtext', key: 'description', label: 'Description' },
      { type: 'textarea', key: 'steps', label: 'Steps to reproduce' },
    ],
    display: { columns: ['meta:status', 'meta:severity', 'meta:kind'], filters: ['meta:status', 'meta:severity', 'meta:kind'], sort: 'recent' },
  },
  {
    // Gamification: a rally (parent) groups the stamps (children) you collect by
    // completing activities. Showcases hierarchy — one shared field group, so the
    // Rally tab applies to the parent card and the Stamp tab to each child stamp.
    id: 'stamp_rally', label: 'Stamp rally', plural: 'Stamp rallies', icon: 'trophy', editor: 'cpt', hierarchical: true,
    description: 'A collectible card of stamps. Group stamps under a rally and check them off — great for habit streaks and gamification.',
    fields: [
      { type: 'tab', label: 'Rally' },
      { type: 'progress', label: 'Completion' },
      { type: 'number', key: 'goal', label: 'Stamps to complete', integer: true, width: 50 },
      { type: 'text', key: 'reward', label: 'Reward', width: 50 },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [{ value: 'active', label: 'Active' }, { value: 'complete', label: 'Complete' }] },
      { type: 'date', key: 'start', label: 'Starts', width: 50 },
      { type: 'date', key: 'end', label: 'Ends', width: 50 },
      { type: 'tab', label: 'Stamp' },
      { type: 'image', key: 'image', label: 'Stamp image' },
      { type: 'checkbox', key: 'collected', label: 'Collected' },
      { type: 'date', key: 'collected_on', label: 'Collected on', width: 50 },
      { type: 'number', key: 'points', label: 'Points', integer: true, width: 50 },
      { type: 'textarea', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:collected', 'meta:points', 'meta:status'], filters: ['meta:status'] },
  },

  // ── Lifecycle recipes ──────────────────────────────────────────────────
  // Each composes the kernel primitives (docs/TYPE-LAYER-SPEC.md +
  // docs/RELATIONS-PRIMITIVE.md): lifecycle = a `status` select whose options
  // are the board columns in order, plus an `x-os-lifecycle` state machine in
  // `schema`; relations = child-owned `relationship` fields (inverse resolved
  // via os-backlinks, never stored); scheduling = date fields; assignment =
  // an owner text field. The blueprint `id` doubles as the default slug on
  // create, so default-slug types wire the x-os-relations targets
  // (ci_project, ci_workitem, …) with no extra setup. `schema` is POSTed as a
  // schema override on create so os-schema-get orients agents to the legal
  // transitions and the type graph.
  {
    // Work item (Linear/Jira). What the deprecated os-tracker's ci_issue was:
    // lifecycle + assignment (owner) + relations (project/module/milestone/
    // cycle containment, blocks/blocked-by/related links, hierarchical
    // sub-items) + scheduling (due).
    id: 'workitem', label: 'Work item', plural: 'Work items', icon: 'list-view', editor: 'cpt', hierarchical: true,
    description: 'Linear/Jira-style issues: Backlog → Todo → In Progress → In Review → Done/Canceled, with an assignee, sub-items, and project/module/milestone/cycle links.',
    fields: [
      { type: 'tab', label: 'Work item' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'todo', label: 'Todo' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'in_review', label: 'In Review' },
        { value: 'done', label: 'Done' },
        { value: 'canceled', label: 'Canceled' },
      ] },
      { type: 'select', key: 'priority', label: 'Priority', width: 50, options: [{ value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
      { type: 'text', key: 'owner', label: 'Assignee', width: 50 },
      { type: 'date', key: 'due', label: 'Due date', width: 50 },
      { type: 'richtext', key: 'description', label: 'Description' },
      { type: 'tab', label: 'Relations' },
      { type: 'relationship', key: 'project', label: 'Project', width: 50, target_cpt: 'ci_project' },
      { type: 'relationship', key: 'module', label: 'Module', width: 50, target_cpt: 'ci_module' },
      { type: 'relationship', key: 'milestone', label: 'Milestone', width: 50, target_cpt: 'ci_milestone' },
      { type: 'relationship', key: 'cycle', label: 'Cycle', width: 50, target_cpt: 'ci_cycle' },
      { type: 'relationship', key: 'blocks', label: 'Blocks', multiple: true, target_cpt: 'ci_workitem' },
      { type: 'relationship', key: 'blocked_by', label: 'Blocked by', multiple: true, target_cpt: 'ci_workitem' },
      { type: 'relationship', key: 'related', label: 'Related to', multiple: true, target_cpt: 'ci_workitem' },
    ],
    display: { columns: ['meta:status', 'meta:priority', 'meta:owner', 'meta:due'], filters: ['meta:status', 'meta:priority'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Work item',
      description: 'A Linear/Jira-style work item. Set `status` only along a legal transition declared in x-os-lifecycle; states are ordered as board columns (left→right). Containment/link fields are declared in x-os-relations — the inverse of every edge is resolved via os-backlinks, never stored.',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current lifecycle state. Change only via a legal transition (see x-os-lifecycle).', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'backlog',
        final: ['done', 'canceled'],
        states: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'],
        transitions: {
          backlog: ['todo', 'canceled'],
          todo: ['backlog', 'in_progress', 'canceled'],
          in_progress: ['todo', 'in_review', 'done', 'canceled'],
          in_review: ['in_progress', 'done', 'canceled'],
          done: ['in_progress'],
          canceled: ['backlog'],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'project', target: 'ci_project', cardinality: 'one', role: 'belongs-to' },
          { field: 'module', target: 'ci_module', cardinality: 'one', role: 'grouped-in' },
          { field: 'milestone', target: 'ci_milestone', cardinality: 'one', role: 'targets' },
          { field: 'cycle', target: 'ci_cycle', cardinality: 'one', role: 'scheduled-in' },
          { field: 'blocks', target: 'ci_workitem', cardinality: 'many', role: 'blocks', inverse: 'blocked_by' },
          { field: 'blocked_by', target: 'ci_workitem', cardinality: 'many', role: 'blocked-by', inverse: 'blocks' },
          { field: 'related', target: 'ci_workitem', cardinality: 'many', role: 'relates-to' },
        ],
      },
    },
  },
  {
    // Project (PMBOK process groups). The containment root work items,
    // modules, milestones, and cycles point back at (child-owned edges);
    // its own lifecycle runs on a different axis from its work items'.
    id: 'project', label: 'Project (PMBOK)', plural: 'Projects', icon: 'compass', editor: 'cpt', hierarchical: true,
    description: 'PMBOK process groups: Initiation → Planning → Execution → Monitoring → Closing, with start/end dates, nestable sub-projects, and an initiative link.',
    fields: [
      { type: 'tab', label: 'Project' },
      { type: 'select', key: 'status', label: 'Phase', width: 50, options: [
        { value: 'initiation', label: 'Initiation' },
        { value: 'planning', label: 'Planning' },
        { value: 'execution', label: 'Execution' },
        { value: 'monitoring', label: 'Monitoring' },
        { value: 'closing', label: 'Closing' },
      ] },
      { type: 'text', key: 'owner', label: 'Project manager', width: 50 },
      { type: 'date', key: 'start', label: 'Start', width: 50 },
      { type: 'date', key: 'end', label: 'Target end', width: 50 },
      { type: 'relationship', key: 'initiative', label: 'Initiative', width: 50, target_cpt: 'ci_initiative' },
      { type: 'richtext', key: 'charter', label: 'Charter / notes' },
    ],
    display: { columns: ['meta:status', 'meta:owner', 'meta:start', 'meta:end'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Project (PMBOK)',
      description: 'A PMBOK-managed project. `status` is the current process group; advance it only along the legal transitions in x-os-lifecycle (Monitoring and Execution loop). Work items, modules, milestones, and cycles point AT this project — list them via os-backlinks.',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Phase', description: 'Current PMBOK process group. Change only via a legal transition (see x-os-lifecycle).', enum: ['initiation', 'planning', 'execution', 'monitoring', 'closing'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'initiation',
        final: ['closing'],
        states: ['initiation', 'planning', 'execution', 'monitoring', 'closing'],
        transitions: {
          initiation: ['planning'],
          planning: ['execution'],
          execution: ['monitoring', 'closing'],
          monitoring: ['execution', 'closing'],
          closing: [],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'initiative', target: 'ci_initiative', cardinality: 'one', role: 'belongs-to' },
        ],
      },
    },
  },
  {
    // Product lifecycle: lifecycle (stage) + assignment (product lead) +
    // scheduling (target date) + relations (milestone, related products).
    id: 'product', label: 'Product', plural: 'Products', icon: 'gem', editor: 'cpt',
    description: 'Product stages: idea → discovery → delivery → launch → iterate → sunset, with a product lead, target date, and milestone link.',
    fields: [
      { type: 'tab', label: 'Product' },
      { type: 'select', key: 'status', label: 'Stage', width: 50, options: [
        { value: 'idea', label: 'Idea' },
        { value: 'discovery', label: 'Discovery' },
        { value: 'delivery', label: 'Delivery' },
        { value: 'launch', label: 'Launch' },
        { value: 'iterate', label: 'Iterate' },
        { value: 'sunset', label: 'Sunset' },
      ] },
      { type: 'text', key: 'owner', label: 'Product lead', width: 50 },
      { type: 'date', key: 'target', label: 'Target date', width: 50 },
      { type: 'list', key: 'tags', label: 'Tags', width: 50 },
      { type: 'relationship', key: 'milestone', label: 'Milestone', width: 50, target_cpt: 'ci_milestone' },
      { type: 'relationship', key: 'related', label: 'Related products', multiple: true, target_cpt: 'ci_product' },
      { type: 'richtext', key: 'description', label: 'Description' },
    ],
    display: { columns: ['meta:status', 'meta:owner', 'meta:target'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Product',
      description: 'A product moving through its lifecycle. `status` is the current stage; change only along the legal transitions in x-os-lifecycle (iterate can loop back to delivery; any active stage can sunset).',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Stage', description: 'Current product stage. Change only via a legal transition (see x-os-lifecycle).', enum: ['idea', 'discovery', 'delivery', 'launch', 'iterate', 'sunset'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'idea',
        final: ['sunset'],
        states: ['idea', 'discovery', 'delivery', 'launch', 'iterate', 'sunset'],
        transitions: {
          idea: ['discovery', 'sunset'],
          discovery: ['delivery', 'sunset'],
          delivery: ['launch', 'sunset'],
          launch: ['iterate', 'sunset'],
          iterate: ['delivery', 'sunset'],
          sunset: [],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'milestone', target: 'ci_milestone', cardinality: 'one', role: 'targets' },
          { field: 'related', target: 'ci_product', cardinality: 'many', role: 'relates-to' },
        ],
      },
    },
  },
  {
    // SDLC: lifecycle (phase) + scheduling (target release) + relations
    // (milestone, blocks/blocked-by, hierarchical components). test loops to
    // build; maintain feeds back into design for the next iteration.
    id: 'sdlc', label: 'SDLC item', plural: 'SDLC items', icon: 'terminal', editor: 'cpt', hierarchical: true,
    description: 'Software delivery phases: requirements → design → build → test → deploy → maintain, with a target release, milestone link, and nestable components.',
    fields: [
      { type: 'tab', label: 'SDLC' },
      { type: 'select', key: 'status', label: 'Phase', width: 50, options: [
        { value: 'requirements', label: 'Requirements' },
        { value: 'design', label: 'Design' },
        { value: 'build', label: 'Build' },
        { value: 'test', label: 'Test' },
        { value: 'deploy', label: 'Deploy' },
        { value: 'maintain', label: 'Maintain' },
      ] },
      { type: 'text', key: 'owner', label: 'Owner', width: 50 },
      { type: 'date', key: 'release', label: 'Target release', width: 50 },
      { type: 'relationship', key: 'milestone', label: 'Milestone', width: 50, target_cpt: 'ci_milestone' },
      { type: 'relationship', key: 'blocks', label: 'Blocks', multiple: true, target_cpt: 'ci_sdlc' },
      { type: 'relationship', key: 'blocked_by', label: 'Blocked by', multiple: true, target_cpt: 'ci_sdlc' },
      { type: 'richtext', key: 'description', label: 'Description' },
    ],
    display: { columns: ['meta:status', 'meta:owner', 'meta:release'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'SDLC item',
      description: 'A unit of software delivery. `status` is the current SDLC phase; change only along the legal transitions in x-os-lifecycle (test can bounce back to build; maintain re-enters design for the next cycle).',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Phase', description: 'Current SDLC phase. Change only via a legal transition (see x-os-lifecycle).', enum: ['requirements', 'design', 'build', 'test', 'deploy', 'maintain'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'requirements',
        final: ['maintain'],
        states: ['requirements', 'design', 'build', 'test', 'deploy', 'maintain'],
        transitions: {
          requirements: ['design'],
          design: ['build'],
          build: ['test'],
          test: ['build', 'deploy'],
          deploy: ['maintain'],
          maintain: ['design'],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'milestone', target: 'ci_milestone', cardinality: 'one', role: 'targets' },
          { field: 'blocks', target: 'ci_sdlc', cardinality: 'many', role: 'blocks', inverse: 'blocked_by' },
          { field: 'blocked_by', target: 'ci_sdlc', cardinality: 'many', role: 'blocked-by', inverse: 'blocks' },
        ],
      },
    },
  },
  {
    // Goal / Plan — the domain-neutral proof that primitives aren't
    // software-only ("lose weight", "travel planning"). lifecycle + scheduling
    // (target date) + relations into personal types: milestones as
    // checkpoints, habits (→ci_habit, the habit blueprint's default slug) as
    // the recurring behavior, journal entries backlink to it.
    id: 'goal', label: 'Goal', plural: 'Goals', icon: 'trophy', editor: 'cpt',
    description: 'A personal goal or plan: not started → active → achieved/abandoned, with a target date, milestone checkpoints, and linked habits.',
    fields: [
      { type: 'tab', label: 'Goal' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'not_started', label: 'Not started' },
        { value: 'active', label: 'Active' },
        { value: 'achieved', label: 'Achieved' },
        { value: 'abandoned', label: 'Abandoned' },
      ] },
      { type: 'date', key: 'target', label: 'Target date', width: 50 },
      { type: 'relationship', key: 'milestones', label: 'Milestones', multiple: true, target_cpt: 'ci_milestone' },
      { type: 'relationship', key: 'habits', label: 'Habits', multiple: true, target_cpt: 'ci_habit' },
      { type: 'relationship', key: 'related', label: 'Related goals', multiple: true, target_cpt: 'ci_goal' },
      { type: 'richtext', key: 'plan', label: 'Plan / notes' },
    ],
    display: { columns: ['meta:status', 'meta:target'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Goal',
      description: 'A personal goal or plan. `status` moves not_started → active → achieved/abandoned (an abandoned goal can be resumed). Milestones are dated checkpoints; habits are the recurring behaviors that serve the goal; journal entries can point at the goal and are read back via os-backlinks.',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current goal state. Change only via a legal transition (see x-os-lifecycle).', enum: ['not_started', 'active', 'achieved', 'abandoned'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'not_started',
        final: ['achieved'],
        states: ['not_started', 'active', 'achieved', 'abandoned'],
        transitions: {
          not_started: ['active', 'abandoned'],
          active: ['achieved', 'abandoned'],
          achieved: [],
          abandoned: ['active'],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'milestones', target: 'ci_milestone', cardinality: 'many', role: 'targets' },
          { field: 'habits', target: 'ci_habit', cardinality: 'many', role: 'served-by' },
          { field: 'related', target: 'ci_goal', cardinality: 'many', role: 'relates-to' },
        ],
      },
    },
  },

  // ── Container recipes ─────────────────────────────────────────────────
  // The grouping types work items (and goals/products) point at. Each has a
  // small lifecycle of its own and a child-owned edge up to its project.
  {
    id: 'initiative', label: 'Initiative', plural: 'Initiatives', icon: 'crown', editor: 'cpt',
    description: 'Top of the containment tree: a strategic theme grouping projects. Planned → active → done/abandoned.',
    fields: [
      { type: 'tab', label: 'Initiative' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'planned', label: 'Planned' },
        { value: 'active', label: 'Active' },
        { value: 'done', label: 'Done' },
        { value: 'abandoned', label: 'Abandoned' },
      ] },
      { type: 'text', key: 'owner', label: 'Owner', width: 50 },
      { type: 'date', key: 'start', label: 'Start', width: 50 },
      { type: 'date', key: 'end', label: 'Target end', width: 50 },
      { type: 'richtext', key: 'brief', label: 'Brief' },
    ],
    display: { columns: ['meta:status', 'meta:owner', 'meta:end'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Initiative',
      description: 'A strategic theme grouping projects. Projects point AT this initiative via their `initiative` field — list them via os-backlinks.',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current initiative state. Change only via a legal transition (see x-os-lifecycle).', enum: ['planned', 'active', 'done', 'abandoned'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'planned',
        final: ['done'],
        states: ['planned', 'active', 'done', 'abandoned'],
        transitions: {
          planned: ['active', 'abandoned'],
          active: ['done', 'abandoned'],
          done: [],
          abandoned: ['planned'],
        },
      },
    },
  },
  {
    id: 'module', label: 'Module', plural: 'Modules', icon: 'cube', editor: 'cpt',
    description: 'A feature grouping of work items within a project (Plane-style). Planned → active → done.',
    fields: [
      { type: 'tab', label: 'Module' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'planned', label: 'Planned' },
        { value: 'active', label: 'Active' },
        { value: 'done', label: 'Done' },
      ] },
      { type: 'text', key: 'owner', label: 'Lead', width: 50 },
      { type: 'relationship', key: 'project', label: 'Project', width: 50, target_cpt: 'ci_project' },
      { type: 'richtext', key: 'scope', label: 'Scope' },
    ],
    display: { columns: ['meta:status', 'meta:owner'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Module',
      description: 'A feature grouping of work items within a project. Work items point AT this module via their `module` field — list them via os-backlinks.',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current module state. Change only via a legal transition (see x-os-lifecycle).', enum: ['planned', 'active', 'done'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'planned',
        final: ['done'],
        states: ['planned', 'active', 'done'],
        transitions: {
          planned: ['active'],
          active: ['done', 'planned'],
          done: [],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'project', target: 'ci_project', cardinality: 'one', role: 'belongs-to' },
        ],
      },
    },
  },
  {
    id: 'milestone', label: 'Milestone', plural: 'Milestones', icon: 'flag', editor: 'cpt',
    description: 'A dated checkpoint work items and goals target (Linear-style). Open → hit/missed; a missed milestone can be re-targeted.',
    fields: [
      { type: 'tab', label: 'Milestone' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'open', label: 'Open' },
        { value: 'hit', label: 'Hit' },
        { value: 'missed', label: 'Missed' },
      ] },
      { type: 'date', key: 'target', label: 'Target date', width: 50 },
      { type: 'relationship', key: 'project', label: 'Project', width: 50, target_cpt: 'ci_project' },
      { type: 'textarea', key: 'notes', label: 'Notes' },
    ],
    display: { columns: ['meta:status', 'meta:target'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Milestone',
      description: 'A dated checkpoint. Work items, products, and goals point AT this milestone — completion is the share of backlinked items in a final state (computed via os-backlinks, never stored here).',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current milestone state. Change only via a legal transition (see x-os-lifecycle).', enum: ['open', 'hit', 'missed'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'open',
        final: ['hit'],
        states: ['open', 'hit', 'missed'],
        transitions: {
          open: ['hit', 'missed'],
          hit: [],
          missed: ['open'],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'project', target: 'ci_project', cardinality: 'one', role: 'belongs-to' },
        ],
      },
    },
  },
  {
    id: 'cycle', label: 'Cycle', plural: 'Cycles', icon: 'calendar', editor: 'cpt',
    description: 'A time-box / sprint work items are scheduled into. Upcoming → active → closed.',
    fields: [
      { type: 'tab', label: 'Cycle' },
      { type: 'select', key: 'status', label: 'Status', width: 50, options: [
        { value: 'upcoming', label: 'Upcoming' },
        { value: 'active', label: 'Active' },
        { value: 'closed', label: 'Closed' },
      ] },
      { type: 'date', key: 'start', label: 'Start', width: 50 },
      { type: 'date', key: 'end', label: 'End', width: 50 },
      { type: 'relationship', key: 'project', label: 'Project', width: 50, target_cpt: 'ci_project' },
      { type: 'textarea', key: 'goals', label: 'Cycle goals' },
    ],
    display: { columns: ['meta:status', 'meta:start', 'meta:end'], filters: ['meta:status'], sort: 'recent' },
    schema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Cycle',
      description: 'A time-box (sprint). Work items point AT this cycle via their `cycle` field — the burndown is backlinked work items grouped by `status` (computed via os-backlinks, never stored here).',
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', title: 'Status', description: 'Current cycle state. Change only via a legal transition (see x-os-lifecycle).', enum: ['upcoming', 'active', 'closed'] },
      },
      'x-os-lifecycle': {
        field: 'status',
        initial: 'upcoming',
        final: ['closed'],
        states: ['upcoming', 'active', 'closed'],
        transitions: {
          upcoming: ['active'],
          active: ['closed'],
          closed: [],
        },
      },
      'x-os-relations': {
        edges: [
          { field: 'project', target: 'ci_project', cardinality: 'one', role: 'belongs-to' },
        ],
      },
    },
  },
];
