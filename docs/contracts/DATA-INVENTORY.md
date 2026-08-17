# Data inventory

Every persisted identifier the plugin family registers, and where each one lands
in the `os_` namespace.

## The rule

A plugin's name is free to change. Its data is not. Repo directory, main file,
plugin slug, text domain, and `@package` are code, so they rename for the cost of
a search and replace. Post types, taxonomies, meta keys, option keys, REST bases,
cron hooks, and filter names are data, so every rename costs a migration on every
install.

So the data namespace is chosen once and frozen: **`os_`**. It carries no brand,
which is the point. When the family was called Core Index the data said `ci_`,
and that is the mistake this inventory exists to finish paying off.

`standalone-plugin.json` records the position per plugin:

- `owned_data` lists what the plugin persists.
- `data_migrations` lists each outstanding rename as `{from, to, kind}`.
- `data_namespace: "os"` is the finish line. Declaring it makes
  `tools/check-standalone-plugin.php` fail on any remaining `ci_` or `wp_` key,
  so a plugin only claims it once the migration has shipped and read back clean.

Until then the validator prints a `TODO:` line per plugin and still passes.

## Why `wp_` is not a resting place either

Five post types currently use the `wp_` prefix. WordPress reserves it: the
Plugin Handbook says not to use `wp_` as an identifier because core is using it,
and core already ships `wp_block`, `wp_navigation`, `wp_template`,
`wp_template_part`, and `wp_global_styles`. `wp_content_type` or `wp_notification`
could collide with a future core type and we would have no recourse. They move to
`os_` in the same pass as the `ci_` keys.

## Status

45 identifiers are planned across the nine product manifests, every one of them
verified against the call that registers it.

| Plugin | Owned | Planned |
|---|---|---|
| core-index-calendar | 22 | 22 |
| core-index-code | 9 | 9 |
| core-index-ai-library | 4 | 4 |
| core-index-filesystem | 3 | 3 |
| core-index-content-types | 3 | 3 |
| core-index-activity | 1 | 1 |
| core-index-graph | 1 | 1 |
| core-index-notifications | 1 | 1 |
| core-index-wizard-builder | 1 | 1 |

The rest are listed below as outstanding, most of them registered by
`os-index` itself, which owns no manifest because it is not a standalone
product plugin and `tools/build-split-suite.sh` does not validate it.

### How complete is this

Two passes produced it. A classifying scan matched registration calls
(`register_post_type`, `register_taxonomy`, `register_post_meta`, the
`*_option` family, `wp_schedule_event`, `apply_filters`, `'rest_base' =>`) and
`const` declarations, and found 74 identifiers. That scan is blind to keys
registered through a loop or an array map, which is how
`os-calendar` registers its 17 `ci_auto_*` meta keys and how
`os-index` registers `ci_section`, `ci_kind`, and `ci_builtin_id`. A second
pass over array literals caught those.

A raw scan for quoted `ci_`/`wp_` strings returns 154 distinct values, but most
of the surplus is cross-references (every plugin names the family's types in its
own type lists) and WordPress core hooks such as `wp_rest` and
`wp_abilities_api_init`. Ownership here is assigned only from a registration
site, never from a mention. Anything found later without a confirmed
registration call belongs in this document with its kind marked unknown, not in
a `data_migrations` entry.

The archived rollback shells (`reminders-for-wordpress`, `routines-for-wordpress`,
`ci-csv`, `ci-llm`, `ci-reminders`) are deliberately excluded. A rollback package
has to keep matching what is installed, so its identifiers stay frozen.

## Outstanding: options

All registered by `os-index` unless noted. Options are the cheapest migration,
a rename of one `wp_options` row, but two of them are load-bearing.

| From | To | Note |
|---|---|---|
| `ci_custom_cpts` | `os_custom_cpts` | **Holds user-defined content types.** Stranding it loses every dynamic CPT definition on the site. |
| `ci_taxonomies` | `os_taxonomies` | **Holds user-defined taxonomies.** Same exposure. |
| `ci_field_groups` | `os_field_groups` | |
| `ci_field_groups_content_types_for_wordpress` | `os_field_groups_content_types_for_wordpress` | Per-plugin suffixed variant. |
| `ci_field_groups_core_index_content_types` | `os_field_groups_core_index_content_types` | Per-plugin suffixed variant, older slug. |
| `ci_schema_overrides` | `os_schema_overrides` | |
| `ci_schema_overrides_core_index_content_types` | `os_schema_overrides_core_index_content_types` | |
| `ci_taxonomies_core_index_content_types` | `os_taxonomies_core_index_content_types` | |
| `ci_agents_overrides` | `os_agents_overrides` | |
| `ci_agents_overrides_core_index_content_types` | `os_agents_overrides_core_index_content_types` | |
| `ci_adopted_cpts` | `os_adopted_cpts` | Third-party CPTs opted into the editor. |
| `ci_anthropic_api_key` | `os_anthropic_api_key` | **Holds a credential.** Migrate by copy then delete, never leave both rows populated. |
| `ci_instance_id` | `os_instance_id` | |
| `ci_activity_log` | `os_activity_log` | |
| `ci_activity_events` | `os_activity_events` | |
| `ci_mcp_disabled_tools` | `os_mcp_disabled_tools` | |
| `ci_disabled_apps` | `os_disabled_apps` | |
| `ci_file_skills_root` | `os_file_skills_root` | |
| `ci_kernel_proposals` | `os_kernel_proposals` | |

### Running it

`inc/class-option-migration.php` moves these rows. It is registered above the
standalone-suite gate in `os-index.php`, so the command and its read shim
exist whether or not the legacy runtime boots.

```
wp ci migrate-options              # dry run, prints the plan and any unmapped key
wp ci migrate-options --execute    # apply
wp ci migrate-options --network    # every site in the network
wp ci migrate-options --rollback   # reverse
```

The copy is a raw row copy, so the stored string and its autoload flag survive
byte for byte and a serialized value never round-trips through PHP. Each move
copies, reads the new row back from the database, compares it against the
source, and only then deletes the original. A mismatch reverts the copy and
leaves the source in place. An existing target is never overwritten, it is
reported as a conflict for a human.

Prefix families are discovered by query rather than listed, so a per-slug option
minted at runtime cannot be missed. Anything else starting `ci_` is reported as
unmapped, because a migration that silently skips what it does not recognise is
worse than one that stops.

This is the middle step of expand / migrate / contract. Ship the code reading
`os_*` with a fallback first, migrate second, drop the fallback third. The
`pre_option_*` shim in the migration class is a safety net for call sites you
missed, not a substitute for the first step: it resolves legacy reads to the new
row, but it does not redirect writes. A legacy write recreates the old row,
which the next dry run reports as pending again, so drift stays visible.

Regression checks: `php tests/verify-option-migration.php`.

### Expand: done

Only three plugins own `ci_` options, so only three needed converting. Every
call site now names the canonical `os_` option and reads through a helper that
falls back to the legacy row:

| Plugin | Helper | Call sites |
|---|---|---|
| os-index | `inc/lib/class-options.php` (`Core_Index_Options`) | 57, plus 16 constant declarations |
| os-code | `inc/class-code-options.php` (`CI_Code_Options`) | 8 + the mu-plugin loader |
| os-filesystem | `inc/class-filesystem-options.php` (`CI_Filesystem_Options`) | 7 |

The helpers are deliberate copies, not a shared dependency: a standalone product
plugin must not require Core Index, which is what
`tools/check-standalone-plugin.php` enforces. Forty duplicated lines is the
price of that independence.

`os-code/inc/loader/ci-code-loader.php` gets the same behaviour as three inline
functions rather than the class, because it runs as an mu-plugin, before the
plugin that owns the class is loaded. Its `CI Code Loader Version` and
`CI_Code::LOADER_VERSION` both moved to 4, which is what triggers the installed
copy in `WPMU_PLUGIN_DIR` to be replaced.

In all three, a write goes to the new row and deletes the legacy one in the same
call. The two names can therefore never hold different values, and every write
migrates its own key, so a busy site finishes most of the job before the CLI
runs. `os-code/tests/verify-loader-state.php` asserts that retirement directly:
its fixture still seeds the legacy rows, so it exercises the fallback rather than
assuming the data has already moved.

### Contract: not yet

Delete `Core_Index_Options`, the two copies, the loader's inline functions, the
`pre_option_*` shim, and `Core_Index_Option_Migration` once every install has
run the migration. Until then they are all load-bearing.

The three suffixed families deserve a decision rather than a mechanical rename.
`ci_field_groups_core_index_content_types` and
`ci_field_groups_content_types_for_wordpress` are the same setting under two
plugin slugs, which is what a rename with no data plan leaves behind. Renaming
the plugin to `os-content-types` would mint a third. Collapse them first.

## The content model: post types, taxonomies, meta

Sixteen static post types plus every dynamic type defined in `os_custom_cpts`,
each carrying the taxonomies and meta keys attached to it. The tool is
`inc/class-type-migration.php`.

```
wp ci migrate-types              # dry run, prints every planned change
wp ci migrate-types --execute    # apply
wp ci migrate-types --network    # every site in the network
wp ci migrate-types --merge      # allow a non-empty target (resume)
wp ci migrate-types --force      # skip the registration guards
```

These three kinds move together because they only make sense together. A snippet
whose post type became `os_snippet` while its meta is still filed under `ci_tip`
is not half migrated, it is broken: the editor reads the new type and finds none
of its fields. So the unit of work is a type and everything attached to it.

Within a group the attachments move first and the post type last, which makes
the post type name the resume marker: while rows still carry `ci_snippet`, that
group is unfinished no matter what else succeeded. Every step is independently
idempotent, so a re-run picks up what is left rather than repeating what
landed.

| From | To | | From | To |
|---|---|---|---|---|
| `ci_skill` | `os_skill` | | `ci_agent` | `os_agent` |
| `ci_wiki` | `os_wiki` | | `ci_journal` | `os_journal` |
| `ci_memory` | `os_memory` | | `wp_activity` | `os_activity` |
| `ci_snippet` | `os_snippet` | | `wp_calendar_event` | `os_calendar_event` |
| `ci_wizard` | `os_wizard` | | `wp_content_type` | `os_content_type` |
| `ci_code` | `os_code` | | `wp_knowledge_node` | `os_knowledge_node` |
| `ci_csv` | `os_csv` | | `wp_notification` | `os_notification` |
| `ci_reminder` | `os_reminder` | | `ci_automation` | `os_automation` |

### Why this one cannot expand first

An option can be read through a fallback, so its code and its data move on
separate days. A post type cannot. `WP_Query` asks the database for one exact
`post_type` string and no filter makes a row answer to two names, so the flip
has to land with the registration rather than before it.

That ordering is enforced, not documented. Every pair is skipped unless the new
post type is already registered, so running this against a build whose
`register_post_type()` calls still say `ci_skill` does nothing at all, rather
than hiding every post on the site. `--force` overrides it for a deliberate
offline migration. Nothing else does.

After the flip, `redirect_legacy_query()` points a `WP_Query` for a legacy name
at its replacement, but only once the legacy type is no longer registered:
while both exist the site is mid-migration and a query for the old name still
means the old name. It covers `WP_Query`, so plugin code and REST collections.
It cannot cover raw SQL, and it deliberately ignores a query naming several
types, where guessing the intent would be worse than leaving it alone.

### What moves with the rows

- `wp_posts.post_type` is rewritten in place, so IDs, meta, term relationships,
  comments, and revisions survive. Revisions carry `post_type = 'revision'` and
  find their parent by ID, so they need nothing.
- `_menu_item_object` meta rows, which store the type name for a post type
  archive menu entry.
- The option payloads keyed BY post type: `os_field_groups*`,
  `os_schema_overrides*`, `os_agents_overrides*`, `os_custom_cpts` definitions
  (key and `slug`/`post_type` field), and the `os_adopted_cpts` list. A field
  group filed under `ci_skill` would otherwise stop applying.

Roles are untouched, because every type in this family registers with
`capability_type => 'page'`, so no capability carries a type name. Rewrite rules
are untouched for the same reason: every type registers `rewrite => false`. The
caches are still flushed, because query vars change.

Each flip reads back independently: the source must be empty and the target must
have grown by exactly what the source held. A count that merely agrees with the
`UPDATE` statement's own return value proves nothing.

Regression checks: `php tests/verify-post-type-migration.php`.

## Taxonomies and meta: folded into the type migration

Both used to be listed here as separate work. They are not separate work: they
move inside `wp ci migrate-types`, attached to the post type they belong to.

**Taxonomies.** `ci_skill_type` moves with `ci_skill`, `ci_reminder_tag` moves
with `ci_reminder`, and `ci_tag` is shared across types so it moves on its own.
A taxonomy rename rewrites `wp_term_taxonomy.taxonomy`, and carries the two core
options that embed the name: `default_term_{taxonomy}` and, for a hierarchical
taxonomy, the `{taxonomy}_children` cache. Term relationships need nothing, they
join on `term_taxonomy_id`.

**Meta.** `ci_tip`, `ci_kind`, `ci_section`, and `ci_builtin_id` move with
`ci_snippet`. The four `ci_code_*` keys move with `ci_code`. The reminder keys
move with `ci_reminder` and the 17 `ci_auto_*` keys with `ci_automation`.
`ci_language`, `ci_path`, `ci_tags`, and `ci_notif_read_at` are registered
across several types, so they are shared: they wait until at least one
replacement post type is registered, then move on their own.

A meta rename is the one kind that does not refuse a populated target. Two posts
can legitimately carry the same key, so merging is the normal case rather than a
collision, and `--merge` is not required for it.

The four snippet meta keys belong to `core-index-ai-library` in practice, since
they attach to `ci_snippet`, but `os-index` is the code that registers them.
They move when that registration moves.

The copies inside the frozen `ci-reminders` shell stay put. A rollback package
keeps its identifiers by design.

## Outstanding: cron hooks and filters

Cron hooks reschedule rather than migrate: clear the old hook, schedule the new
one, and accept one missed tick. Filters are a public extension point, so a
rename breaks any consumer, and every known consumer is inside this family.

| From | To | Kind | Registered by |
|---|---|---|---|
| `ci_reminders_cron` | `os_reminders_cron` | cron | os-index, ci-reminders |
| `ci_automation_chain_run` | `os_automation_chain_run` | cron | ci-reminders |
| `ci_five_minutes` | `os_five_minutes` | cron | ci-reminders, a schedule name |
| `ci_default_block` | `os_default_block` | filter | os-index |
| `ci_admin_search_post_types` | `os_admin_search_post_types` | filter | os-index |
| `ci_agents_for_cpt` | `os_agents_for_cpt` | filter | os-index |
| `ci_discriminator_taxonomies` | `os_discriminator_taxonomies` | filter | os-index |
| `ci_schema_for_cpt` | `os_schema_for_cpt` | filter | os-index |
| `ci_tag_object_types` | `os_tag_object_types` | filter | os-index |
| `ci_okf_type` | `os_okf_type` | filter | os-index |
| `ci_okf_key_aliases` | `os_okf_key_aliases` | filter | os-index |
| `ci_llm_post_types` | `os_llm_post_types` | filter | ci-llm (legacy) |

## Referenced but not registered here

`ci_agent`, `ci_journal`, `ci_canvas`, `ci_issue`, and `ci_project` appear in
`inc/cpt/class-cpts.php` type lists, `tools/standalone-ui/`, and
`docs/screenshots/seed.php`, but no `register_post_type` call in this tree
creates them. They read as dynamic content types defined through
`ci_custom_cpts` rather than core registrations, which is another reason that
option is the most dangerous row in this document. Confirm against a live
install before migrating, because a dynamic type's posts carry its slug in
`wp_posts.post_type` just like a registered one.

## Migration order

1. **Options.** `wp ci migrate-options`. Built and tested. Cheapest, and
   `ci_custom_cpts` plus `ci_taxonomies` define the dynamic types step 2 has to
   enumerate, so this genuinely has to be first.
2. **The content model.** `wp ci migrate-types`. Built and tested. Post types
   with their taxonomies and meta, one group at a time. Blocked until the code
   rename lands, and it enforces that itself rather than trusting the operator.
3. **The code rename.** Done, in two phases.
   `tools/rename-content-model.php` applies it.

   *Phase one, post types and taxonomies:* 504 quoted PHP literals. The routes
   were pinned first with explicit `rest_base` values so nothing moved
   underneath the assets while the internal names changed.

   *Phase two, meta keys (`--meta`):* 1,139 references across PHP, JS, and JSON.
   Meta was held back from phase one because a meta key's public surface is the
   `meta.{key}` property of every REST response and there is no `rest_base`
   equivalent to pin it. It was safe to move the assets in the same commit only
   because every consumer is inside this family; a third-party reader would have
   needed a `register_rest_field()` alias instead.

   Then 715 more references across assets and prose, 660 CSS selectors, and the
   `inc/schemas/ci-*.{schema.json,agents.md}` files, which resolve by
   `str_replace( '_', '-', $cpt )` and would have silently stopped loading.

   **A literal rename is not the whole job.** Identifiers built at runtime,
   `'ci_' . $slug` and `preg_replace( '/^ci_/', ... )`, are invisible to it. Those
   now mint `os_` and accept either prefix on read, because a site mid-migration
   holds definitions under both. Without that, every content type defined before
   the migration becomes invisible to its own editor.

4. **REST bases and filters.** Done. `rest_base` follows the post type name
   again, and `Core_Index_Type_Migration::rewrite_legacy_rest_route()` answers
   the pre-rename paths so saved agent configurations and MCP clients keep
   working. The eight renamed filters re-broadcast under their old names at a
   late priority, so a legacy consumer still fires.

5. **Cron hooks.** Done, and last, after everything they trigger had moved.
   `reschedule_cron()` clears the old entry and books an equivalent one under
   the new hook at the same timestamp and recurrence. Worst case is one missed
   tick.

6. **The plugin rename.** Done. Repo directory, main file, slug, text domain,
   `@package`, and `Plugin Name` now agree on one `os-*` string per plugin:
   `os-index`, `os-activity`, `os-calendar`, `os-code`, `os-content-types`,
   `os-filesystem`, `os-graph`, `os-notifications`, `os-wiki`, `os-wizard`.

   PHP class names were deliberately left as `Core_Index_*`. They are internal
   code identifiers, invisible to users, and `Core_Index_Legacy_Compat` already
   aliases them for companions built against the older names. Renaming them buys
   nothing and risks that machinery.

   **Renaming a plugin directory deactivates it**, because `active_plugins`, and
   `active_sitewide_plugins` on multisite, store the plugin file path. The
   cutover is: rename, `wp plugin activate` per site, then clear the stale
   serialized entries.

`wp_content_type` renames after all of them: every plugin in the family
references it.

Precedent exists. `ci_skill` replaced `wp_guideline`, `ci_wiki` replaced `wiki`,
and `ci_skill_type` replaced `wp_guideline_type`, all recorded in
`inc/cpt/class-cpts.php`. This is the same shape of change, done once more and
then never again.
