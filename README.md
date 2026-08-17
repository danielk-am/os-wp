# OS

**Give your agents somewhere to live.** OS turns a WordPress site you own into the system of record for your skills, notes, memory, reminders, and code. Anything you store, an agent can read and write over one MCP connection.

One plugin. Nine modules. Your data, on your server.

![The OS Modules screen: nine modules, each with a switch, a status, and the data it owns.](docs/screenshots/modules.png)

## What you get

| Module | What it does for you |
|---|---|
| Wiki | A knowledge base for how you work: skills, wiki pages, memory, snippets. |
| Calendar | Reminders, events, and automations that run on your schedule. |
| Content Types | Invent your own record types, no code required. |
| Code | Small PHP, JS, and CSS changes, with a circuit breaker that catches fatals. |
| Filesystem | A jailed window onto server files. |
| Graph | The connections between everything you keep. |
| Activity | A stream of everything that happened, and who did it. |
| Notifications | One tray for every alert. |
| Wizard | Checklists that walk you through, step by step. |

Everything works together from the first activation. Reminders surface in Notifications, changes land in Activity, and nothing needs configuring to talk to anything else.

![Reminders grouped by due date inside the Calendar module.](docs/screenshots/calendar.png)

## A memory your agent keeps

Skills record how you do things, memory holds what stays true, and wiki pages carry the reference notes. Your agent reads them before acting and writes back what it learns, so every session starts warmer than the last.

![The Skills list inside the Wiki module.](docs/screenshots/wiki.png)

## One connection for every tool

Install the [MCP Adapter](https://github.com/WordPress/mcp-adapter) and every module's tools appear on a single endpoint, registered through the [WordPress Abilities API](https://developer.wordpress.org/apis/abilities-api/). Point your agent at one URL and it sees the whole system.

Underneath, it's all WordPress content: posts, revisions, users, and permissions you already understand. Back it up, export it, move it. Nothing is locked in.

## Take only what you need

Every module is a switch under Settings → OS Modules. A module that's off doesn't boot, and nothing is deleted either way. On multisite the switches are per site, so each site on a network runs its own mix.

## Breaks safely

A module that fails to load is switched off on its own, and the rest of the site carries on. The modules screen shows what tripped and why. Tick it and save once it's fixed. Recovery never needs SSH.

## Get started

1. Download `os.zip` from the [latest release](https://github.com/danielk-am/os-wp/releases/latest).
2. Go to Plugins → Add New Plugin → Upload Plugin.
3. Choose `os.zip` and click Install Now.
4. Click Activate.

Updates arrive on the Plugins screen like any other plugin. You install once.

You'll need:

- WordPress 6.9 or newer
- PHP 8.1 or newer
- [MCP Adapter](https://github.com/WordPress/mcp-adapter), optional, for agent access

Ready when you are:

**[Download the latest release](https://github.com/danielk-am/os-wp/releases/latest)**

## License

GPL-2.0-or-later. See [license.txt](license.txt). Module internals are documented in [docs/contracts/MODULES.md](docs/contracts/MODULES.md).
