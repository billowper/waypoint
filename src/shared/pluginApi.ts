import type { Project, Task, TaskFields } from './types'

/**
 * Everything a plugin (or a plugin's page) can see of Waypoint: the API in docs/plugins.md, version 1.
 * Types only, plus the few constants both sides must agree on. Waypoint's side lives in src/main/plugins/,
 * src/plugin-runner/ and components/PluginView.tsx.
 */

export const PLUGIN_API = 1
/** The scheme plugin pages are served from: wp-plugin://<id>/<path> */
export const PLUGIN_SCHEME = 'wp-plugin'
export const PLUGIN_ID = /^[a-z][a-z0-9-]{1,31}$/
/** Sent with every file the scheme serves, so a page can't reach the network or Waypoint */
export const PLUGIN_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
/** What openExternal accepts (host.openExternal and waypoint.openExternal) */
export const EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:', 'claude:']

export interface Disposable {
  dispose(): void
}

export type WatchEvent = { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }

/** What `activate` is given (every call that crosses to Waypoint is async) */
export interface PluginHost {
  api: 1
  plugin: { id: string; dir: string; version: string }
  appVersion: string
  /** <userData>/plugin-data/<id>/, created before activate. Caches and settings go here. */
  dataDir: string

  /** null: no vault open (the plugin is stopped on vault change) */
  vault: { root: string | null }

  projects: {
    list(): Promise<Project[]>
    get(slug: string): Promise<Project | null>
    /** The projects this plugin applies to (its views, panels and commands show on them). Replaces the last set. */
    setLinked(slugs: string[]): Promise<void>
    /** Fires when projects are added, renamed or their project.md changes (e.g. its repo), with their slugs */
    onChange(cb: (slugs: string[]) => void): Disposable
  }

  tasks: {
    /** Tasks carry `data`: their whole front matter, so plugins can keep their own keys on a task */
    list(project?: string): Promise<TaskWithData[]>
    /** By task id (e.g. "THRO-152"), across all projects; null if there's no such task */
    get(id: string): Promise<(TaskWithData & { body: string }) | null>
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

  /** Answer calls from this plugin's pages: waypoint.call(method, params) in the page */
  handle(method: string, fn: (params: any) => unknown | Promise<unknown>): Disposable
  /** Send an event to every open page of this plugin (all windows) */
  emit(event: string, data?: unknown): void

  /** chokidar on folders outside the vault, events batched over 250 ms */
  watch(paths: string[], cb: (events: WatchEvent[]) => void, opts?: { depth?: number; ignored?: string[] }): Disposable

  /** http(s), mailto and claude:// only */
  openExternal(url: string): Promise<void>
  attachments: {
    /** Copies a picture (an absolute path to an existing file) into the vault's attachments/; returns its vault path */
    add(file: string): Promise<string>
  }
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>

  claude: {
    available(): Promise<boolean>
    /** New Claude Code session in cwd with the prompt typed in, the way Waypoint's own "Send to Claude" opens it */
    open(cwd: string, prompt: string): Promise<void>
  }

  toast(title: string, body: string, open?: { view: string; state?: unknown }): void
  openView(view: string, state?: unknown): void
  /** Written to dataDir/plugin.log */
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
}

/** The shape of a plugin's main module */
export interface PluginModule {
  activate(host: PluginHost): void | Promise<void>
  /** Given 5 s, then the process is killed */
  deactivate?(): void | Promise<void>
}

/** A task as plugins get it: `data` is its whole front matter */
export type TaskWithData = Task & { data: Record<string, unknown> }

export interface PluginViewDef {
  id: string
  title: string
  /** A Waypoint icon name (see components/pluginIcons.ts); unknown names show a puzzle piece */
  icon?: string
  /** Relative to the plugin folder; may carry a #hash */
  page: string
  /** "project": listed under every linked project (sidebar, project page), state { project: <slug> }. "tab" (default): only openView opens it */
  scope?: 'project' | 'tab'
}

/** A page embedded in Home or in every linked project's page */
export interface PluginPanelDef {
  id: string
  /** The section heading Waypoint draws */
  title: string
  page: string
  where: 'home' | 'project'
}

/** An entry in a right-click menu; choosing it calls the plugin's handler `command:<id>` */
export interface PluginCommandDef {
  id: string
  title: string
  /** "project": menus of a project (sidebar row, its plugin entries, project page ⋯); "home": the panel headers on Home */
  scope: 'project' | 'home'
  /** On linked projects (default), on unlinked ones, or on all */
  when?: 'linked' | 'unlinked' | 'always'
  danger?: boolean
}

/** What a command's handler may answer with */
export interface PluginCommandResult {
  toast?: string
}

/** plugin.json */
export interface PluginManifest {
  id: string
  name: string
  version: string
  api: 1
  description: string
  main?: string
  views: PluginViewDef[]
  panels: PluginPanelDef[]
  commands: PluginCommandDef[]
}

/**
 * off: switched off · starting / running: the process (a plugin without a main is simply running) ·
 * stopped: on, but no vault is open · error: activate threw or the process exited ·
 * invalid: plugin.json is wrong · newer: it was written for a newer Waypoint
 */
export type PluginStatus = 'off' | 'starting' | 'running' | 'stopped' | 'error' | 'invalid' | 'newer'

/** One plugin as Settings, the sidebar and tabs see it */
export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  /** The plugin's folder */
  dir: string
  /** Installed under <userData>/plugins, or loaded from a dev folder (can be removed from the list) */
  source: 'installed' | 'dev'
  enabled: boolean
  status: PluginStatus
  /** Why it is not running: what is wrong with plugin.json, or the exception / exit message */
  error?: string
  views: PluginViewDef[]
  panels: PluginPanelDef[]
  commands: PluginCommandDef[]
  /** The projects the plugin applies to (host.projects.setLinked); empty while it isn't running */
  linked: string[]
}

/** The answer to a page's call. Errors travel as data so `status` survives the trip through IPC. */
export type PluginResult = { ok: true; value?: unknown } | { ok: false; error: string; status?: number }

/** Waypoint's colours as the page gets them (the --wp-* variables and light/dark) */
export interface PluginTheme {
  mode: 'light' | 'dark'
  vars: Record<string, string>
}

/** postMessage, Waypoint → page. Every message also carries `wp: 1`. */
export type ToPageMessage =
  | { type: 'init'; kind: 'view' | 'panel'; view: string; state: unknown; theme: PluginTheme }
  | { type: 'theme'; theme: PluginTheme }
  | { type: 'event'; event: string; data: unknown }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string; status?: number }
  | { type: 'menu-result'; id: number; choice: string | null }

/** postMessage, page → Waypoint. `hello` is sent once when the bridge loads, to ask for `init` (a late import would miss the first). */
export type FromPageMessage =
  | { type: 'hello' }
  | { type: 'call'; id: number; method: string; params: unknown }
  | { type: 'setState'; state: unknown }
  | { type: 'open'; what: 'view'; view: string; state?: unknown }
  | { type: 'open'; what: 'task'; id: string }
  | { type: 'open'; what: 'project'; slug: string }
  | { type: 'open'; what: 'external'; url: string }
  /** x/y in the page's CSS pixels; the parent adds the iframe's offset */
  | { type: 'menu'; id: number; x: number; y: number; items: unknown }
  /** A panel's content height */
  | { type: 'size'; height: number }

/** One entry of a menu a page asks for (waypoint.menu) */
export type PluginMenuItem = 'separator' | { id: string; label: string; checked?: boolean; disabled?: boolean; danger?: boolean }

export const MENU_MAX_ITEMS = 50
export const MENU_MAX_LABEL = 120

/** Check the items a page sent for waypoint.menu: at most 50, ids and labels strings, labels up to 120 characters. */
export function checkMenuItems(raw: unknown): { ok: true; items: PluginMenuItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'The menu items must be a list' }
  if (raw.length > MENU_MAX_ITEMS) return { ok: false, error: `A menu can have at most ${MENU_MAX_ITEMS} items` }
  const items: PluginMenuItem[] = []
  for (const [i, it] of raw.entries()) {
    if (it === 'separator') {
      items.push('separator')
      continue
    }
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { ok: false, error: `Menu item ${i} must be "separator" or an object` }
    const m = it as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id) return { ok: false, error: `Menu item ${i} needs an id (a string)` }
    if (typeof m.label !== 'string' || !m.label) return { ok: false, error: `Menu item ${i} needs a label (a string)` }
    if (m.label.length > MENU_MAX_LABEL) return { ok: false, error: `Menu item ${i}'s label is over ${MENU_MAX_LABEL} characters` }
    items.push({
      id: m.id,
      label: m.label,
      ...(typeof m.checked === 'boolean' ? { checked: m.checked } : {}),
      ...(m.disabled === true ? { disabled: true } : {}),
      ...(m.danger === true ? { danger: true } : {})
    })
  }
  return { ok: true, items }
}
