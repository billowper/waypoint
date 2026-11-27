import type { PluginCommandDef, PluginCommandResult, PluginInfo, PluginPanelDef, PluginViewDef } from '@shared/pluginApi'
import { useStore, type MenuItem } from './store'

/**
 * Where plugins show up in Waypoint's own pages (docs/plugins.md): which plugins apply to a project, the
 * views / panels / commands they add there, and running a command. Used by the sidebar, Home, project pages and menus.
 */

/** A plugin that can show things: switched on and starting or running (an off or broken plugin has nothing to offer) */
export const pluginLive = (p: PluginInfo) => p.enabled && (p.status === 'running' || p.status === 'starting')

/** Plugins that applied themselves to this project (host.projects.setLinked) */
export const pluginsFor = (plugins: PluginInfo[], slug: string) => plugins.filter((p) => pluginLive(p) && p.linked.includes(slug))

/** The project views of a linked plugin (listed in the sidebar tree and on the project page) */
export const projectViews = (p: PluginInfo): PluginViewDef[] => p.views.filter((v) => v.scope === 'project')

/** Panels of a plugin for Home or for a project page */
export const panelsOf = (p: PluginInfo, where: PluginPanelDef['where']) => p.panels.filter((x) => x.where === where)

/** The tab title of a project view: "<view title> · <project title>" */
export const projectViewTitle = (view: string, project: string) => `${view} · ${project}`

/** Does a project command show on this project? ("linked" is the default) */
function commandApplies(p: PluginInfo, c: PluginCommandDef, slug: string): boolean {
  const linked = p.linked.includes(slug)
  const when = c.when ?? 'linked'
  return when === 'always' || (when === 'linked' ? linked : !linked)
}

/** Run a plugin's command: its handler `command:<id>` gets { project } (or {}); an answer {toast} shows as an in-app notice */
export async function runPluginCommand(p: PluginInfo, c: PluginCommandDef, project?: string): Promise<void> {
  const s = useStore.getState()
  try {
    const r = await window.api.pluginCall(p.id, `command:${c.id}`, project ? { project } : {})
    if (!r.ok) return s.showNotice(`${p.name}: ${r.error}`, true)
    const toast = (r.value as PluginCommandResult | null | undefined)?.toast
    if (typeof toast === 'string' && toast) s.showNotice(toast)
  } catch (e) {
    s.showNotice(`${p.name}: ${(e as Error).message}`, true)
  }
}

/** One plugin's project commands as menu items, for one project */
export function projectCommandItems(p: PluginInfo, slug: string): MenuItem[] {
  if (!pluginLive(p)) return []
  return p.commands
    .filter((c) => c.scope === 'project' && commandApplies(p, c, slug))
    .map((c) => ({ label: c.title, ...(c.danger ? { danger: true } : {}), run: () => runPluginCommand(p, c, slug) }))
}

/** Every plugin's project commands for one project (the sidebar row menu, the project page ⋯ menu) */
export function allProjectCommandItems(plugins: PluginInfo[], slug: string): MenuItem[] {
  return plugins.flatMap((p) => projectCommandItems(p, slug))
}

/** A plugin's home commands (the menu on its panel headers on Home) */
export function homeCommandItems(p: PluginInfo): MenuItem[] {
  if (!pluginLive(p)) return []
  return p.commands.filter((c) => c.scope === 'home').map((c) => ({ label: c.title, ...(c.danger ? { danger: true } : {}), run: () => runPluginCommand(p, c) }))
}
