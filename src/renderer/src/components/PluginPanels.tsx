import type { MouseEvent } from 'react'
import { useStore } from '../store'
import { showMenu } from '../menus'
import { homeCommandItems, panelsOf, pluginLive, pluginsFor } from '../pluginUi'
import PluginFrame from './PluginFrame'

/**
 * The panels plugins embed in Waypoint's pages (docs/plugins.md): one section per panel, under Waypoint's own.
 * `where="home"`: every running plugin's home panels, each with a ⋯ / right-click menu of the plugin's home commands.
 * `where="project"`: the panels of the plugins linked to this project (ProjectPage puts them between overview and tasks).
 * Each panel is an iframe (PluginFrame, kind "panel") as tall as its content; it stays mounted with its page.
 */
export default function PluginPanels({ where, project }: { where: 'home' | 'project'; project?: string }) {
  const plugins = useStore((s) => s.plugins)
  const applicable = where === 'project' && project ? pluginsFor(plugins, project) : plugins.filter(pluginLive)
  return (
    <>
      {applicable.flatMap((plugin) =>
        panelsOf(plugin, where).map((panel) => {
          const commands = where === 'home' ? homeCommandItems(plugin) : []
          const open = (e: MouseEvent) => showMenu(e, homeCommandItems(plugin))
          return (
            <section
              key={`${plugin.id}/${panel.id}`}
              className={where === 'home' ? 'panel plugin-panel' : 'card plugin-panel'}
              onContextMenu={commands.length ? open : undefined}
            >
              <div className={where === 'home' ? 'panel-head' : 'card-head'}>
                <h2>{panel.title}</h2>
                {commands.length > 0 && (
                  <button className="icon-btn" title={`${plugin.name} commands`} onClick={open}>
                    ⋯
                  </button>
                )}
              </div>
              <PluginFrame
                plugin={plugin.id}
                view={panel.id}
                page={panel.page}
                kind="panel"
                state={where === 'project' ? { project } : null}
                title={panel.title}
              />
            </section>
          )
        })
      )}
    </>
  )
}
