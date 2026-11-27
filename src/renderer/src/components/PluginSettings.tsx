import { useStore } from '../store'
import type { PluginInfo, PluginStatus } from '@shared/pluginApi'

/** Settings → Plugins: every plugin found, with its switch, version, folder, status and the actions for it (docs/plugins.md) */

const STATUS: Record<PluginStatus, string> = {
  off: 'Off',
  starting: 'Starting…',
  running: 'Running',
  stopped: 'On (starts when a vault is open)',
  error: 'Error',
  invalid: "Can't be loaded",
  newer: 'Needs a newer Waypoint'
}

/** An error from an IPC call without the "Error invoking remote method" wrapper */
const message = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fail = (what: string) => (e: unknown) => alert(`${what}\n\n${message(e)}`)

function PluginRow({ p }: { p: PluginInfo }) {
  const usable = p.status !== 'invalid' && p.status !== 'newer'
  return (
    <div className="setting plugin-row">
      <div className="plugin-info">
        <div className="setting-name">
          {p.name} {p.version && <span className="plugin-version">{p.version}</span>}
          {p.source === 'dev' && <span className="plugin-tag">dev folder</span>}
        </div>
        {p.description && <div className="setting-help">{p.description}</div>}
        <div className="setting-help plugin-dir" title={p.dir}>
          {p.dir}
        </div>
        <div className={`setting-help plugin-status status-${p.status}`}>
          {STATUS[p.status]}
          {p.error ? `: ${p.error}` : ''}
        </div>
        <div className="actions">
          {usable && p.enabled && (
            <button className="btn small" onClick={() => window.api.pluginRestart(p.id).catch(fail("Couldn't restart the plugin."))}>
              Restart
            </button>
          )}
          {usable && (
            <button className="btn small" onClick={() => window.api.pluginOpenLog(p.id).catch(fail("Couldn't open the log."))}>
              Open log
            </button>
          )}
          {p.source === 'dev' && (
            <button className="btn small" onClick={() => window.api.pluginRemoveDevPath(p.dir).catch(fail("Couldn't remove the folder."))}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        type="checkbox"
        title={usable ? 'Switch this plugin on or off' : 'This plugin can’t be switched on'}
        checked={p.enabled}
        disabled={!usable}
        onChange={(e) => window.api.pluginEnable(p.id, e.target.checked).catch(fail("Couldn't change the plugin."))}
      />
    </div>
  )
}

export function PluginSettings() {
  const plugins = useStore((s) => s.plugins)

  const load = async () => {
    const dir = await window.api.pickPath('folder')
    if (dir) await window.api.pluginAddDevPath(dir).catch(fail("Couldn't load that folder."))
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Plugins</h2>
        <button className="btn small" onClick={load}>
          Load from folder…
        </button>
      </div>
      <p className="card-sub">
        A plugin is trusted local code: its main module runs with full access to this PC, in a process of its own. They stay off until you switch them on.
      </p>
      {plugins.length === 0 ? (
        <p className="empty">
          No plugins found. Put a folder with a plugin.json in the plugins folder of Waypoint's data folder, or load one from a folder.
        </p>
      ) : (
        plugins.map((p) => <PluginRow key={p.dir} p={p} />)
      )}
    </section>
  )
}
