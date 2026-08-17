# Modules

OS is one plugin made of modules. This document is why, and what a module owes.

## Why one plugin

It was nine standalone plugins plus a hub, split out of a monolith in July 2026
so each could be independently useful. That goal changed. This is one person's
operating system, and the people who want it want the whole thing, not one
piece of it. Independence was being enforced for a user who does not exist.

The contract cost 93 MB of duplicated runtime across 985 files, a sync script to
keep ten copies of the admin runtime in step, a validator to police the
duplication, and a build script to assemble the suite. All of that is deleted.

What the split was actually buying, and what is rebuilt here:

| Split gave | Merged keeps it as |
|---|---|
| Install only what you want | A per-module toggle |
| A failure stays inside one plugin | A circuit breaker per module |
| Each plugin owns its data | `module.json`, read by uninstall and the migrations |
| Separate ability and REST namespaces | Unchanged, they were never the problem |

## What a module is

A directory under `modules/` containing:

- `module.json` — name, label, the ability and REST namespaces it owns, the data
  it owns, and any outstanding `data_migrations`.
- `module.php` — boots it. Registers post types, abilities, REST routes, and its
  admin app through `OS_Standalone_Admin::boot()`.
- `inc/` — its own classes. Nothing shared lives here any more.

A module may enrich another through WordPress hooks. It may not load another
module's code. That rule survived the merge because it was never about plugin
boundaries: it is what keeps a module switchable.

## The toggle

`os_disabled_modules` holds what an administrator switched off. A disabled
module does not boot, so its post types never register and its routes never
exist. Nothing is deleted; switching it back on restores it on the next request.

This is the answer to "I only want Calendar". One install, then turn off eight
modules. Better than choosing four plugins out of ten and discovering the order
mattered.

## The circuit breaker

A module that breaks should not take the OS down with it. Two layers, because
PHP fails in two different ways:

1. `Throwable` is caught around each module's boot. Most runtime failures arrive
   as `Error`, so a module with a missing function or a type error is skipped
   while everything else carries on.
2. A hard fatal kills the request before any catch runs. So a marker option is
   written before a module boots and cleared after. A stale marker on the next
   request means that module did not survive booting, and it is switched off
   until a human turns it back on.

Either way the module lands in `os_tripped_modules` with the reason, and an
admin notice says what was switched off and why. Same pattern the code module
uses on PHP snippets, for the same reason: recovering should not need SSH.

## What a module owes

1. It boots with no other module active.
2. Its data identifiers stay inside the `os_` namespace.
3. `module.json` declares every identifier it persists, because that list is
   what uninstall is allowed to remove on someone else's site.
4. It reaches other modules only through hooks, and works when nobody answers.
