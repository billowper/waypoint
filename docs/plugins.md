# Waypoint plugins: API v1

The contract between Waypoint and its plugins. Waypoint's side (`src/main/plugins/`, `src/plugin-runner/`,
`PluginView.tsx`) and every plugin are built against this file. Change it here first.

A plugin is trusted local code, like an Obsidian plugin: its main module runs with full Node access. Waypoint
keeps it **off** until the user turns it on in Settings → Plugins, and it runs in its own process so a slow or
crashing plugin can't freeze or take down the app. Claude stays optional: nothing here calls Claude unless a
plugin asks the host to (`host.claude`), and that reports "not available" when Claude Code isn't installed.

## Where plugins come from

- `<userData>/plugins/<id>/` (installed), and
- every folder in config `plugins.devPaths` (Settings → Plugins → "Load from folder…"), for developing in place.

A folder is a plugin if it has `plugin.json`. If two have the same id, the dev path wins. Config also holds
`plugins.enabled: { [id]: boolean }` (missing = off).

## `plugin.json`

```json
{
  "id": "leg",
  "name": "LEG",
  "version": "0.1.0",
  "api": 1,
  "description": "Feedback inbox and telemetry for LEG Godot projects",
  "main": "main.mjs",
  "views": [
    { "id": "feedback", "title": "Feedback", "icon": "bug", "page": "web/index.html", "scope": "project" },
    { "id": "telemetry", "title": "Telemetry", "icon": "chart", "page": "web/index.html", "scope": "project" },
    { "id": "releases", "title": "Releases", "icon": "tag", "page": "web/index.html", "scope": "project" }
  ],
  "panels": [
    { "id": "overview", "title": "LEG", "page": "web/panel.html", "where": "home" },
    { "id": "project", "title": "Game", "page": "web/panel.html", "where": "project" }
  ],
  "commands": [
    { "id": "pull", "title": "Pull feedback", "scope": "project" },
    { "id": "pull-all", "title": "Pull feedback for all games", "scope": "home" },
    { "id": "link", "title": "Link to a LEG game…", "scope": "project", "when": "unlinked" },
    { "id": "unlink", "title": "Unlink LEG game", "scope": "project" }
  ]
}
```

A plugin adds to Waypoint's own pages; it has no section of its own. Which projects it applies to is the plugin's
call: it says so with `host.projects.setLinked` (below). For those projects ("linked"):

- **Project views** (`scope: "project"`) appear in the project's sidebar tree, after its folders (as the gallery does),
  and as links on the project page. They open as tabs with state `{ "project": "<slug>" }`; the tab title is
  `<view title> · <project title>`. A view with `scope: "tab"` (the default) is only opened by the plugin itself
  (`openView`), never listed.
- **Panels** are pages embedded in a Waypoint page: `where: "home"` on Home (one section per panel, under Waypoint's own
  sections), `where: "project"` on every linked project's page (between the overview and the tasks). Panel state is
  `{ "project": "<slug>" }` on a project page, `null` on Home. A panel is as tall as its content (the bridge reports
  its height) and has no scrolling of its own.
- **Commands** appear in right-click menus: `scope: "project"` on a linked project's sidebar row, its plugin entries
  and the project page's ⋯ menu (`when: "unlinked"`: on unlinked projects instead, `"always"`: on all);
  `scope: "home"` on the panel headers on Home. Choosing one calls the handler `command:<id>` with
  `{ project: "<slug>" }` (or `{}`). It can answer with nothing, or `{ toast: "text" }`, which Waypoint shows as a
  brief in-app notice (an error from the handler shows the same way, in red). `when` doesn't apply to `scope: "home"`.

- `id`: `^[a-z][a-z0-9-]{1,31}$`. `api` must be `1`, or the plugin is listed as "needs a newer Waypoint" and not loaded.
- `main` (optional): an ES module, relative to the plugin folder.
- `views`: pages Waypoint can show as tabs. `page` is relative to the plugin folder (may carry a `#hash`).
  `icon` is a Waypoint icon name (unknown names fall back to a puzzle piece; the names are in
  `components/pluginIcons.ts`: puzzle, inbox, chart, list, table, calendar, clock, folder, file, note, book, search,
  settings, star, flag, bug, bolt, bell, mail, link, globe, tag, image, code, terminal, heart, home, user, chat,
  tool, database, map). `scope`: `"project"` or `"tab"` (above).
- `panels`: `id`, `title` (the section heading Waypoint draws), `page`, `where`: `"home"` or `"project"`.
- `commands`: `id`, `title`, `scope`: `"project"` or `"home"`, optional `when`: `"linked"` (default), `"unlinked"`,
  `"always"`, optional `danger: true`. Commands are answered by the main module, so they need `main`.
- The old `views[].projectButton` is rejected with a reason: use `scope: "project"`.
- A plugin's project views, panels and commands show only while it is switched on and running; its linked set is
  cleared when it stops.
- Anything invalid: the plugin shows in Settings with the reason, and isn't loaded.

## Main module

Runs in an Electron `utilityProcess` (one per plugin), started after the vault opens when the plugin is enabled,
stopped on disable, vault change and quit.

```js
export async function activate(host) { /* register handlers, start watchers */ }
export async function deactivate() { /* optional; given 5 s, then the process is killed */ }
```

An exception from `activate`, or the process exiting, shows in Settings → Plugins as the plugin's status with the
message. The plugin can be restarted from there.

### `host` (every call that crosses to Waypoint is async)

```ts
interface PluginHost {
  api: 1
  plugin: { id: string; dir: string; version: string }
  appVersion: string
  /** <userData>/plugin-data/<id>/, created before activate. Caches and settings go here. */
  dataDir: string

  vault: { root: string | null }           // null: no vault open (the plugin is stopped on vault change)

  projects: {
    list(): Promise<Project[]>             // Waypoint's Project (src/shared/types.ts)
    get(slug: string): Promise<Project | null>
    /** The projects this plugin applies to (its views, panels and commands show on them). Replaces the last set. */
    setLinked(slugs: string[]): Promise<void>
    /** Fires when projects are added, renamed or their project.md changes (e.g. its repo), with their slugs */
    onChange(cb: (slugs: string[]) => void): Disposable
  }

  tasks: {
    /** Tasks carry `data`: their whole front matter, so plugins can keep their own keys on a task */
    list(project?: string): Promise<(Task & { data: Record<string, unknown> })[]>
    /** By task id (e.g. "THRO-152"), across all projects; null if there's no such task */
    get(id: string): Promise<(Task & { body: string; data: Record<string, unknown> }) | null>
    /**
     * Creates projects/<slug>/tasks/<KEY>-NNN.md. body is the markdown below the front matter. `data`: extra
     * front-matter keys (the task's own keys always win), kept by every later update.
     */
    create(slug: string, fields: Partial<TaskFields>, body?: string, data?: Record<string, unknown>): Promise<Task>
    /** Front-matter patch via tasks.ts updateTask: status → done sets completed, reopening clears completed/archived */
    update(id: string, patch: Partial<TaskFields>, summary?: string): Promise<Task>
    /** Fires (debounced) when task files change, with their ids */
    onChange(cb: (ids: string[]) => void): Disposable
  }
  // tasks.create and tasks.update are recorded in Waypoint's history (.app/claude-log.jsonl) with
  // tool "plugin:<id>" and the given summary, the same way the Claude connector's changes are.

  /** Answer calls from this plugin's pages: waypoint.call(method, params) in the page */
  handle(method: string, fn: (params: any) => unknown | Promise<unknown>): Disposable
  /** Send an event to every open page of this plugin (all windows) */
  emit(event: string, data?: unknown): void

  /** chokidar on folders outside the vault, events batched over 250 ms. `ignored`: names (matched against every
   *  path segment, e.g. "node_modules") or absolute paths (that place and everything under it); no globs */
  watch(paths: string[], cb: (events: { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }[]) => void,
        opts?: { depth?: number; ignored?: string[] }): Disposable

  openExternal(url: string): Promise<void>    // http(s), mailto and claude:// only
  attachments: {
    /** Copies a picture into the vault's attachments/ (attachments.ts saveAttachment); returns its vault path */
    add(file: string): Promise<string>
  }

  openPath(path: string): Promise<void>       // shell.openPath
  showInFolder(path: string): Promise<void>

  claude: {
    available(): Promise<boolean>
    /** New Claude Code session in cwd with the prompt typed in, the way Waypoint's own "Send to Claude" opens it
     *  (the terminal or the desktop app, as chosen in Settings; the terminal route only gets plain text, as task prompts do) */
    open(cwd: string, prompt: string): Promise<void>
  }

  toast(title: string, body: string, open?: { view: string; state?: unknown }): void
  openView(view: string, state?: unknown): void
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }  // dataDir/plugin.log
}
interface Disposable { dispose(): void }
```

A handler's thrown `Error` reaches the page as a rejected promise with the same `message`; if the error has a
numeric `status` it is passed along too (`err.status`). Values cross by structured clone, so `Uint8Array` works
(use it for file bytes; the page makes a Blob URL).

## Pages

A view is an `<iframe>` in a Waypoint tab, loaded from `wp-plugin://<id>/<page>`.

- The scheme serves only enabled plugins, and only files inside the plugin folder (paths checked like `vault.ts`), plus
  `wp-plugin://<id>/_waypoint/bridge.mjs` (below). Responses carry
  `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'`,
  so a page can't reach the network or Waypoint: all data goes through the bridge.
- `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"`. The origin `wp-plugin://<id>` is not
  Waypoint's, so `allow-same-origin` only gives the page its own storage. The preload doesn't run in subframes:
  the page has no `window.api`.
- Waypoint's renderer CSP gains `frame-src wp-plugin:`.

### The bridge

```js
import { waypoint } from '/_waypoint/bridge.mjs'

await waypoint.ready                       // resolves after Waypoint sent the view's state and theme
waypoint.view                              // "inbox"
waypoint.state                             // the tab's state (from openView, a project view or setState), or null
waypoint.setState(s)                       // saved with the tab, restored on next launch
const data = await waypoint.call('reports', { project: 'throne' })
const off = waypoint.on('changed', data => {})
waypoint.openView('telemetry', { project: 'throne' })   // a new tab (or focuses one with equal state)
waypoint.openTask('THRO-152')              // opens the task note in Waypoint
waypoint.openProject('throne')
waypoint.openExternal('https://…')
waypoint.kind                              // "view" or "panel"
// Waypoint's own right-click menu, at the event's position: resolves to the chosen item's id, or null
const choice = await waypoint.menu(event, [
  { id: 'todo', label: 'To do', checked: true }, 'separator',
  { id: 'claude', label: 'Send to Claude' }, { id: 'drop', label: 'Delete', danger: true, disabled: false }
])
```

A panel's height follows its content: the bridge watches `document.documentElement` with a ResizeObserver and sends
`{type: 'size', height}`; the parent sets the iframe height (no inner scrollbar). Views fill their tab.

The bridge also sets Waypoint's theme on the page's `<html>` as CSS variables, and updates them live:
`--wp-bg --wp-bg-2 --wp-panel --wp-fg --wp-muted --wp-border --wp-accent --wp-accent-fg --wp-danger --wp-font
--wp-mono`, and `data-theme="light|dark"`.

Wire format (`postMessage`, every message has `wp: 1`). The parent checks `event.source` is that iframe and the
origin is `wp-plugin://<id>`; the bridge checks `event.source === window.parent`.

| direction | message |
| --- | --- |
| parent → page | `{type: 'init', kind, view, state, theme}` · `{type: 'theme', theme}` · `{type: 'event', event, data}` · `{type: 'result', id, ok, value?, error?, status?}` · `{type: 'menu-result', id, choice}` |
| page → parent | `{type: 'hello'}` · `{type: 'call', id, method, params}` · `{type: 'setState', state}` · `{type: 'open', what: 'view'\|'task'\|'project'\|'external', ...}` · `{type: 'menu', id, x, y, items}` (x/y in the page's CSS pixels; the parent adds the iframe's offset) · `{type: 'size', height}` |

For a panel, `view` is the panel id and `setState` is ignored. `waypoint.menu` items: `id` and `label` strings (label up
to 120 characters), `checked` (boolean; when any item has it, every row leaves room for the tick), `disabled`, `danger`;
at most 50 items. Items that fail the check are not shown and the menu resolves to `null`.

`theme` is `{ mode: 'light'|'dark', vars: { '--wp-bg': …, … } }`. The parent sends `init` when the frame loads, and again
when the bridge says `hello` (it does so as soon as it is imported, so a page that imports it late still gets `init`).
`open` carries `view`+`state`, `id`, `slug` or `url` respectively.

The renderer forwards calls to main (`window.api.pluginCall(id, method, params)`), main to the plugin process,
and events back the other way (`plugin:event`, sent to every window). `pluginCall` resolves to
`{ ok: true, value } | { ok: false, error, status? }` rather than rejecting, so `status` survives IPC; the renderer
turns that into the `result` message. A call made while the plugin is still starting waits (up to 15 s) for `activate`.

## In the app

- `ViewRef` gains `{ kind: 'plugin'; plugin: string; view: string; state?: unknown }`, so plugin tabs move between
  windows and come back on launch. A tab whose plugin is off or missing shows that, with a button to Settings.
- `AppCommand` gains `{ kind: 'open-plugin'; plugin: string; view: string; state?: unknown }` (toasts).
- No "Plugins" section: views, panels and commands appear in Waypoint's own sidebar tree, Home, project pages and
  menus, as described under `plugin.json`.
- `ViewRef` for a panel is never created: panels live inside Home and ProjectPage, one iframe each, kept mounted with
  their page.
- Settings → Plugins: each plugin with name, version, folder, on/off switch, status (running / stopped / error with
  the message), Restart, Open log, and "Load from folder…" / "Remove" for dev paths.
