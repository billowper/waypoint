import { PLUGIN_API, PLUGIN_ID, type PluginCommandDef, type PluginManifest, type PluginPanelDef, type PluginViewDef } from '@shared/pluginApi'

/**
 * Checking plugin.json. Pure (no Electron, no disk), so it can be tried on its own.
 * Anything wrong gives a reason Settings shows next to the plugin.
 */

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  /** `newer`: a plugin written for a later API, which is listed but never loaded */
  | { ok: false; error: string; newer?: boolean }

const VIEW_ID = /^[a-z][a-z0-9-]{0,31}$/
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** A path inside the plugin folder: relative, no drive, and no way out with ".." */
export function isRelativeInside(path: string): boolean {
  if (!path || /^([a-z]:|[\\/])/i.test(path) || path.includes('\0')) return false
  let depth = 0
  for (const part of path.split(/[\\/]/)) {
    if (part === '..') depth--
    else if (part && part !== '.') depth++
    if (depth < 0) return false
  }
  return true
}

function validateView(raw: unknown, i: number): PluginViewDef | string {
  if (!isObject(raw)) return `views[${i}] must be an object`
  const id = text(raw.id)
  if (!VIEW_ID.test(id)) return `views[${i}].id must be lower-case letters, digits and dashes`
  const title = text(raw.title)
  if (!title) return `views[${i}] ("${id}") needs a title`
  const page = text(raw.page)
  if (!isRelativeInside(page.split('#')[0].split('?')[0])) return `views[${i}] ("${id}") needs a page inside the plugin folder`
  if (raw.projectButton !== undefined) return `views[${i}] ("${id}"): "projectButton" is gone; use "scope": "project"`
  if (raw.scope !== undefined && raw.scope !== 'project' && raw.scope !== 'tab') return `views[${i}] ("${id}"): "scope" must be "project" or "tab"`
  return {
    id,
    title,
    ...(text(raw.icon) ? { icon: text(raw.icon) } : {}),
    page,
    scope: raw.scope === 'project' ? 'project' : 'tab'
  }
}

function validatePanel(raw: unknown, i: number): PluginPanelDef | string {
  if (!isObject(raw)) return `panels[${i}] must be an object`
  const id = text(raw.id)
  if (!VIEW_ID.test(id)) return `panels[${i}].id must be lower-case letters, digits and dashes`
  const title = text(raw.title)
  if (!title) return `panels[${i}] ("${id}") needs a title`
  const page = text(raw.page)
  if (!isRelativeInside(page.split('#')[0].split('?')[0])) return `panels[${i}] ("${id}") needs a page inside the plugin folder`
  if (raw.where !== 'home' && raw.where !== 'project') return `panels[${i}] ("${id}"): "where" must be "home" or "project"`
  return { id, title, page, where: raw.where }
}

function validateCommand(raw: unknown, i: number): PluginCommandDef | string {
  if (!isObject(raw)) return `commands[${i}] must be an object`
  const id = text(raw.id)
  if (!VIEW_ID.test(id)) return `commands[${i}].id must be lower-case letters, digits and dashes`
  const title = text(raw.title)
  if (!title) return `commands[${i}] ("${id}") needs a title`
  if (raw.scope !== 'project' && raw.scope !== 'home') return `commands[${i}] ("${id}"): "scope" must be "project" or "home"`
  if (raw.when !== undefined && raw.when !== 'linked' && raw.when !== 'unlinked' && raw.when !== 'always') {
    return `commands[${i}] ("${id}"): "when" must be "linked", "unlinked" or "always"`
  }
  if (raw.danger !== undefined && typeof raw.danger !== 'boolean') return `commands[${i}] ("${id}"): "danger" must be true or false`
  return {
    id,
    title,
    scope: raw.scope,
    ...(raw.when ? { when: raw.when } : {}),
    ...(raw.danger === true ? { danger: true } : {})
  }
}

/** Validate a list of definitions; ids must be unique within it */
function list<T extends { id: string }>(raw: unknown, name: string, one: (v: unknown, i: number) => T | string): T[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return `"${name}" must be a list`
  const out: T[] = []
  for (const [i, v] of raw.entries()) {
    const d = one(v, i)
    if (typeof d === 'string') return d
    if (out.some((x) => x.id === d.id)) return `Two ${name} are called "${d.id}"`
    out.push(d)
  }
  return out
}

/** Parse the contents of plugin.json (already JSON.parsed) */
export function validateManifest(raw: unknown): ManifestResult {
  if (!isObject(raw)) return { ok: false, error: 'plugin.json must hold a JSON object' }
  if (typeof raw.api === 'number' && raw.api > PLUGIN_API) {
    return { ok: false, newer: true, error: `Needs a newer Waypoint (plugin API ${raw.api}; this one has ${PLUGIN_API})` }
  }
  if (raw.api !== PLUGIN_API) return { ok: false, error: `"api" must be ${PLUGIN_API}` }
  const id = text(raw.id)
  if (!PLUGIN_ID.test(id)) return { ok: false, error: '"id" must be 2-32 characters: lower-case letters, digits and dashes, starting with a letter' }
  const name = text(raw.name)
  if (!name) return { ok: false, error: '"name" is missing' }
  const version = text(raw.version)
  if (!version) return { ok: false, error: '"version" is missing' }
  const main = text(raw.main)
  if (raw.main !== undefined && !isRelativeInside(main)) return { ok: false, error: '"main" must be a file inside the plugin folder' }
  const views = list(raw.views, 'views', validateView)
  if (typeof views === 'string') return { ok: false, error: views }
  const panels = list(raw.panels, 'panels', validatePanel)
  if (typeof panels === 'string') return { ok: false, error: panels }
  const commands = list(raw.commands, 'commands', validateCommand)
  if (typeof commands === 'string') return { ok: false, error: commands }
  // A command is answered by the main module's handler, so it can't exist without one
  if (commands.length && !main) return { ok: false, error: '"commands" need a "main" module to answer them' }
  return {
    ok: true,
    manifest: { id, name, version, api: PLUGIN_API, description: text(raw.description), ...(main ? { main } : {}), views, panels, commands }
  }
}
