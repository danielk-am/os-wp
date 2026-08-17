# OS

Skills, wiki, memory, calendar, code, and the rest of a personal operating system, as WordPress modules an agent can read and write.

One plugin, nine modules. Install it, activate it, turn off what you do not need under **Settings → OS Modules**. Every module registers its own post types, REST namespace, and MCP abilities through the WordPress Abilities API, so an agent connected through the [MCP Adapter](https://github.com/WordPress/mcp-adapter) sees the whole system on one endpoint.

## Modules

| Module | What it owns |
|---|---|
| Wiki | Skills, wiki pages, memory, snippets. The knowledge store. |
| Calendar | Events, reminders, scheduled automations. |
| Content Types | User-defined post types with schemas and field groups. |
| Code | PHP, JS, and CSS snippets with a fatal-error circuit breaker. |
| Filesystem | A jailed disk browser. |
| Graph | Entities and relationships across your content. |
| Activity | The site activity log. |
| Notifications | A unified alert tray. |
| Wizard | Multi-step guided flows. |

## The module toggle

Every row on the modules screen is a switch. A module that is off does not boot: its post types, routes, and abilities do not exist until you turn it back on. Nothing is deleted either way. On multisite, the toggle is per site, so two sites on one network can run different module sets from one network activation.

## The circuit breaker

A module that fails to load is switched off automatically and reported with the reason, and the rest of the site carries on. Tick it and save to boot it again once it is fixed.

## Requirements

- WordPress 6.9 or newer
- PHP 8.1 or newer
- The [MCP Adapter](https://github.com/WordPress/mcp-adapter) plugin, optional, for agent access

## Install

Download the ZIP from the latest release and install it through Plugins → Add New → Upload, or drop the `os` folder into `wp-content/plugins/`.

## For agents

Every module registers abilities under its own namespace (`llm-wiki/*`, `calendar/*`, `code/*`, and so on) and REST routes under matching namespaces. Data identifiers live in one frozen namespace, `os_`, documented per module in `modules/*/module.json` and in `docs/contracts/DATA-INVENTORY.md`.

## License

GPL-2.0-or-later.
