# Type schema

How a content type is declared, and what one declaration is required to emit.

This document owns the declaration format, the emission contract, the storage
boundary, and the migration rule. `MODULES.md` owns what a module is.
`DATA-INVENTORY.md` owns which identifiers persist.

## The rule

**The declaration is a file. Everything in the database is a projection of it.**

A type is not a row you edit in an admin screen that happens to be backed by a
post. It is a versioned declaration that the plugin compiles, on every boot, into
a post type, a set of typed meta keys, a REST surface, a set of abilities, and an
index. The admin screen edits the declaration. It never edits the projection.

## Why this is not what we do today

Today a type is assembled from two unrelated places, neither of which is a file.

| Where | Holds | Read by |
|---|---|---|
| `os_content_type` posts | `type_key`, `singular`, `plural`, `config` | `OS_Content_Types_Dynamic_Types::register_stored_types()` at `init:30` |
| `ci_field_groups_<slug>` option | Nested field tree plus `display` | `OS_Standalone_Admin::register_dynamic_meta()` |

Four things follow from that split, and all four are the reason this document
exists.

1. **A type cannot be reviewed.** It has no diff, no history, no pull request.
   The record of why a field exists is whatever the person remembers.
2. **A type cannot move.** Copying a site's model to a second site means copying
   an option blob and a hundred posts, in the right order, with IDs intact.
3. **Fields are typed for the editor, not for the data.** `register_dynamic_meta()`
   passes a scalar `type` and `show_in_rest => true`. No schema, no enum, no
   format, no required, no item type on arrays. A date and a slug are both
   `string`, so nothing rejects a bad one.
4. **The data model and the layout are the same tree.** `section`, `row`, `group`,
   `stack`, `tab`, `heading`, `notice`, and `content` sit in `fields` beside real
   fields and get skipped by name at registration time. Presentation is deciding
   the shape of the schema.

PocketBase gets treated as a database because it fixed exactly these four. One
collection definition produces the table, the dashboard, the typed endpoint, and
the access rules together, and a schema change writes a migration file.

## Prior art: why not the Fields API

Evaluated August 2026. Rejected. Recorded here so it is not re-opened.

The PHP Fields API is a form-rendering API, not a data-modelling one. Its control
contract is `abstract public function get_content() : string;`, its control types
are widgets rather than data types, and its field arguments carry no JSON Schema
vocabulary at all. The one place it reaches REST, it passes a boolean to
`register_setting()`. Passing a schema through `show_in_rest` is already stronger
than anything it offers, so adopting it would weaken the field layer, not
strengthen it.

It is also unavailable. The project was archived in October 2024 when its lead
left, no successor took it, and no Fields API code exists in core through 7.1.

The reason it matters anyway is negative evidence. It stalled twice on the exact
confusion this document separates. In August 2015, on the core review thread, Mike
Nelson named the defect: the forms system focused on displaying HTML forms, while
the models system focused on defining the underlying data. Nobody answered it, and
the project died with it in 2016 and again in 2024. Meanwhile the data-side sibling
shipped, and `register_meta()` gained the schema support this whole design rests
on. The split between `fields` and `display` above is that unanswered objection,
answered.

Three unrelated things carry the name. Do not confuse them:

| Name | What it is | Bearing here |
|---|---|---|
| PHP Fields API | Archived admin-forms proposal | None. Rejected above |
| `@wordpress/dataviews` Field API | Shipping JavaScript field and validation model | Layer 2 compile target, see below |
| "Fields API" in the 7.1 roadmap comments | A commenter's phrasing for the Connectors API | None. Different thing, same words |

**DataForm is the layer 2 target.** WordPress 7.1 shipped the DataViews, DataForm,
and View Config APIs. That is where `display.form` should compile to, because it is
Design System native and maintained. The rule stays the same as everywhere else in
this document: `types.json` is the authority and the DataForm config is a
projection of it, never a second place a field can be defined.

## The declaration

`types.json` at the site's content root, or a `types/` directory of one file per
type once a site outgrows one file. The file is the source of truth. The option
and the `os_content_type` posts become caches of it.

```json
{
  "$schema": "https://os.danielk.am/schema/types-1.json",
  "version": 1,
  "types": [
    {
      "key": "recipe",
      "singular": "Recipe",
      "plural": "Recipes",
      "icon": "dashicons-food",
      "hierarchical": false,
      "supports": ["title", "editor", "revisions", "author"],
      "fields": [
        { "key": "servings", "type": "integer", "minimum": 1, "required": true, "index": true },
        { "key": "cook_minutes", "type": "integer", "minimum": 0, "index": true },
        { "key": "course", "type": "string", "enum": ["starter", "main", "dessert"], "index": true },
        { "key": "published_on", "type": "string", "format": "date", "index": true },
        { "key": "source_url", "type": "string", "format": "uri" },
        { "key": "tags", "type": "array", "items": { "type": "string" } },
        { "key": "base_recipe", "type": "relation", "to": "recipe", "cardinality": "one" }
      ],
      "rules": {
        "list": "author = :user OR status = 'publish'",
        "view": "author = :user OR status = 'publish'",
        "create": ":user.can('edit_posts')",
        "update": "author = :user",
        "delete": "author = :user"
      },
      "display": {
        "columns": ["title", "course", "cook_minutes"],
        "form": [
          { "section": "Timing", "fields": ["servings", "cook_minutes"] },
          { "section": "Meta", "fields": ["course", "published_on", "source_url"] }
        ]
      }
    }
  ]
}
```

Two properties of that shape are load bearing.

- **`fields` holds data only.** Every entry has a `key`, a `type`, and JSON Schema
  keywords. No layout entry can appear here.
- **`display` holds presentation only.** It references field keys and never
  defines them. Deleting `display` entirely must leave a working type.

## What one declaration emits

| Declaration part | Emits | Through |
|---|---|---|
| `key`, `singular`, `plural`, `supports`, `hierarchical` | A registered post type, `show_in_rest`, `rest_base: key` | `register_post_type()` at `init:30` |
| Each `fields` entry | A typed meta key carrying full JSON Schema | `register_post_meta()` with `show_in_rest => array( 'schema' => ... )` |
| Each `fields` entry with `"index": true` | A row in the projection table and a real SQL index | `os_field_index`, below |
| Each `fields` entry with `"type": "relation"` | A meta key holding target IDs, plus referential cleanup on delete | `register_post_meta()` plus `before_delete_post` |
| `rules` | A `WP_Query` clause on list, a capability check on the rest | `pre_get_posts` plus `rest_pre_dispatch` |
| `display` | Admin columns and the form layout | `OS_Standalone_Admin` |
| The whole type | Five CRUD abilities, `content-types/<key>-{list,read,create,update,delete}` | `wp_register_ability()` |

`register_meta()` accepts an array under `show_in_rest` with a `schema` key, so
the validation is native and applies at the REST boundary without a custom
controller. That is the single core capability this whole design rests on.

## Storage: postmeta stays the write path

Do not move field values out of `wp_postmeta`. Every WordPress tool, export,
revision, and backup understands postmeta, and abandoning it would trade a
performance problem for a portability problem.

Instead, project. `wp_postmeta` stores `meta_value` as `longtext` with indexes on
`post_id` and `meta_key` only, never on the value, so any query that filters on a
field value scans. The fix is a narrow companion table written on save.

```
os_field_index
  post_id      bigint unsigned  NOT NULL
  post_type    varchar(20)      NOT NULL
  field_key    varchar(191)     NOT NULL
  value_string varchar(191)         NULL
  value_number decimal(20,6)        NULL
  value_date   datetime             NULL
  PRIMARY KEY (post_id, field_key)
  KEY type_field_string (post_type, field_key, value_string)
  KEY type_field_number (post_type, field_key, value_number)
  KEY type_field_date   (post_type, field_key, value_date)
```

Rules:

- Only fields declared `"index": true` get a row. Everything else lives in
  postmeta alone.
- The table is derived, never authoritative. Dropping and rebuilding it from
  postmeta must produce an identical table.
- A rebuild command is required, not optional. Without it the table is a second
  source of truth and this design has failed.

## Migration on diff

A schema change writes a migration, the way PocketBase does. Nothing applies
silently.

1. On boot, hash the normalised declaration per type.
2. Compare against the hash stored in `os_type_schema_state`.
3. On a difference, compute the field-level diff and write
   `migrations/<timestamp>-<type>.json` recording added, removed, retyped, and
   reindexed fields.
4. Apply additive changes automatically. Additive means a new field, a new index,
   a widened enum, a relaxed constraint.
5. Hold destructive changes behind an explicit apply. Destructive means a removed
   field, a narrowed type, a narrowed enum, or a changed field key.

A removed field never deletes postmeta rows on apply. It stops registering the
meta key and drops the index row. The data stays until a separate, named prune.

## Authority boundaries

- **Writing `types.json`** is a filesystem action. It sits behind the same trust
  boundary as the Code module, not behind `edit_posts`.
- **Editing a type in the admin** writes the file, then recompiles. A site with a
  read-only filesystem gets a read-only type editor, and says so.
- **`rules` never grant.** A rule can only narrow what the user's capabilities
  already allow. A rule that would widen access is a validation error at compile
  time, not a runtime surprise.
- **Superuser bypass does not exist here.** PocketBase exempts superusers from
  rules. WordPress already has `manage_options` and `map_meta_cap`, so rules
  compose with capabilities rather than sitting above them.

## Invariants

1. A type key is at most 20 characters, and `post_type_exists()` wins any
   collision. The declaration is skipped, and the skip is reported, never silent.
2. Compilation is idempotent. Booting twice from the same file produces identical
   registrations.
3. `os_field_index` is derived. It is never read when postmeta and the index
   disagree, and a disagreement is a reported error.
4. A field key is stable. Renaming a key is a destructive migration, never an
   edit.
5. Presentation cannot change data. Deleting `display` changes no stored value.
6. The current cap of 100 stored definitions per site is a real limit, not a
   default. Raise it deliberately or paginate, and never let it truncate quietly.

## Out of scope

- **Realtime subscriptions.** No SSE, no websockets. Core has no primitive here,
  and a personal system gains little from it.
- **Non-post objects.** Users, terms, and comments are not declarable in v1. The
  emission contract assumes `register_post_meta` and `WP_Query`.
- **Field UI components.** `display` names a layout. It does not define new
  controls. Rendering belongs to DataForm, and a control that DataForm cannot
  express is a reason to change the field type, not to add a control here.
- **A second database.** SQLite in WordPress is still a feature plugin. This
  design assumes whatever `wpdb` is pointed at.

## Acceptance scenarios

1. Declaring a type in `types.json` and reloading registers the post type, its
   meta keys with schema, and its five abilities, with no admin action.
2. Posting an out-of-range value to `wp/v2/recipe` for a field with `"minimum": 1`
   returns a 400 from core validation, with no custom controller in the path.
3. Querying recipes by `course` uses `os_field_index` and reports zero postmeta
   value scans.
4. Deleting `os_field_index` and running the rebuild produces a byte-identical
   table.
5. Changing a field's `type` from `string` to `integer` writes a migration file
   and does not apply until explicitly applied.
6. A user without `edit_posts` listing recipes receives only published rows, and
   the same query as an author returns their drafts too.
7. Removing `display` from a type leaves every stored value readable over REST.

## Reference implementation

`content-types` is the reference module. It is taken all the way through both
interfaces so the pattern can be copied rather than re-argued.

| Source | Owns |
|---|---|
| `modules/content-types/inc/class-type-declaration.php` | Load, validate, normalise, hash. Reports every rejection, skips nothing silently |
| `modules/content-types/inc/class-type-compiler.php` | The four projections: post type args, meta args, REST args, ability schemas, plus the generated reference |
| `modules/content-types/inc/class-type-runtime.php` | Registration and the shared CRUD core both interfaces call |
| `tools/gen-api-reference.php` | Writes `api/rest-api.json` from a declaration |
| `tests/verify-type-schema.php` | 58 checks, run with `php tests/verify-type-schema.php` |
| `docs/types.example.json` | A working declaration to generate from |

The property worth protecting is checked directly: for all five operations, the
REST args and the ability input schema are asserted to accept the same keys and
enforce the same constraints. They cannot drift, because they are the same
function's output.

Declared types register at `init:25`, ahead of the stored-definition path at
`init:30`. That path already yields on `post_type_exists()`, so the file wins
without any new coordination.

The generated reference carries hand-registered routes forward under
`undeclared`. Eleven routes in this module still sit there with no declaration
and no argument schema. That number is the remaining work, and it is in the file
so it stays visible.

## Known gaps

- **Relations have no referential integrity.** Deleting a target leaves dangling
  IDs until the `before_delete_post` cleanup runs. There is no database-level
  constraint, and there cannot be one while values live in postmeta.
- **Rules are a small expression language.** Anything richer than the grammar
  above needs a PHP callback, which is not declarable and therefore not portable.
- **Uniqueness is advisory.** Enforcing it means a lookup on save, which races
  under concurrent writes. Postmeta cannot carry a unique constraint.
- **The file and the option can drift** during the transition, while the option
  still exists. The compile step must treat the file as authoritative and log
  every value it overwrites.
- **List filters still scan.** `os_field_index` is specified but not built, so
  the runtime filters through `meta_query` today. Only fields declared
  `"index": true` are offered as filters, which bounds the scan to what the
  index will later cover, but it is a scan until then.
- **Rules are declared and not enforced.** The runtime carries a declaration's
  `rules` block through untouched and applies capabilities only. A declaration
  written today stays valid once rules land, but do not read a `rules` block as
  protection yet.
- **Migration on diff is specified, not built.** `OS_Type_Declaration::hash()`
  exists and excludes `display`, so a presentation edit does not read as a schema
  change. Nothing consumes the hash yet.
