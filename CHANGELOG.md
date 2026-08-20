# Changelog

What changed in each release, from a user's point of view. Started at 3.4.0.
Earlier releases are on the [releases page](https://github.com/danielk-am/os-wp/releases).

## 3.4.0

### Content types can be declared in a file

Put a `types.json` beside your content and OS builds the type from it. One
declaration gives you the record type, its fields, its REST API, and the tools
your agent sees. There is nothing to click, and the file is the truth: copy it to
another site and you get the same model.

`docs/types.example.json` is a working example to start from.

### Fields have real types now

A field can say what it accepts: a number with a floor, a date, a list of allowed
values, a list of strings, or a link to another record. WordPress enforces it when
anything writes, so a bad value is rejected at the door instead of stored and
found later.

Layout moved out of the field list. Fields describe data, `display` describes how
it looks, and deleting the whole `display` block leaves every value readable.

### Your agent knows what it will get back

Every content type publishes five tools: list, read, create, update, and delete.
They now describe both what they accept and what they return, so an agent can plan
against a real answer rather than guess. The API and the agent tools are generated
from the same declaration and run the same code, so they can never drift apart or
let one do something the other cannot.

### A problem in a declaration tells you

A field with a layout type, an unknown type, a name that is too long, a duplicate,
a layout referencing a field that does not exist, or a link with no target: each
one is reported on screen, by name. Nothing is skipped quietly.

### Releases are reproducible

`tools/build-zip.sh` builds the plugin zip from a tagged commit, refuses a dirty
tree or a version that disagrees with itself, and runs every test first. Verified
against 3.3.0, which it rebuilds byte for byte.

### Known limits

- Filtering a list still reads through post meta. The index that makes it fast is
  designed, not built, so only fields marked for indexing can be filtered on.
- The `rules` block in a declaration is accepted and kept, but not yet enforced.
  Permissions are still ordinary WordPress capabilities. Do not treat a `rules`
  block as protection.
- Changing a declaration takes effect immediately. The migration file that would
  hold a destructive change back is specified but not built.
