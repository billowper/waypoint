import type { PluginInfo } from '@shared/pluginApi'
import { useStore } from '../store'
import PluginFrame from './PluginFrame'

/**
 * A tab that shows a plugin's page (docs/plugins.md). The wire to the page is PluginFrame; this adds what a tab
 * needs: the placeholder when the plugin is missing, off, broken or lacks the view, and keeping the page's
 * setState with the tab.
 */

/** What a tab shows in place of the page when its plugin is missing, off, broken or lacks the view */
function placeholder(plugin: string, view: string, info: PluginInfo | undefined): string | null {
  if (!info) return `The plugin "${plugin}" isn't installed.`
  if (info.status === 'invalid' || info.status === 'newer') return `"${info.name}" can't be loaded: ${info.error ?? 'its plugin.json is wrong'}`
  if (!info.enabled) return `"${info.name}" is switched off.`
  if (info.status === 'error') return `"${info.name}" isn't running: ${info.error ?? 'it stopped'}`
  if (!info.views.some((v) => v.id === view)) return `"${info.name}" has no view called "${view}".`
  return null
}

export default function PluginView(p: { tabId: number; plugin: string; view: string; state: unknown; active: boolean }) {
  const info = useStore((s) => s.plugins.find((x) => x.id === p.plugin && x.status !== 'invalid' && x.status !== 'newer'))
  const loaded = useStore((s) => s.pluginsLoaded)
  const openSettings = useStore((s) => s.openSettings)
  const def = info?.views.find((v) => v.id === p.view)
  const problem = loaded ? placeholder(p.plugin, p.view, info) : null

  if (!loaded) return <div className="plugin-view" hidden={!p.active} />
  if (!def || problem) {
    return (
      <div className="plugin-view" hidden={!p.active}>
        <div className="plugin-missing">
          <p>{problem}</p>
          <div className="actions">
            <button className="btn small primary" onClick={openSettings}>
              Open Settings
            </button>
            {info?.status === 'error' && (
              <button className="btn small" onClick={() => window.api.pluginRestart(p.plugin).catch((e) => alert((e as Error).message))}>
                Restart it
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="plugin-view" hidden={!p.active}>
      <PluginFrame
        plugin={p.plugin}
        view={p.view}
        page={def.page}
        kind="view"
        state={p.state}
        title={def.title}
        onState={(state) => useStore.getState().setPluginState(p.tabId, state)}
      />
    </div>
  )
}
