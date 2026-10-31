import { useCallback, useEffect, useState } from 'react'
import type { ClaudeStatus } from '@shared/types'
import type { Prefs } from '@shared/prefs'
import { useStore } from '../store'

/**
 * Optional Claude Code controls. Everything in Waypoint works without them; Settings → Claude Code
 * hides them entirely.
 */

function useClaudeStatus(slug?: string) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const load = useCallback(() => {
    window.api.claudeStatus(slug).then(setStatus, () => setStatus(null))
  }, [slug])
  useEffect(load, [load])
  return [status, load] as const
}

/** Run an action, show its error, then re-check the status */
function useAction(reload: () => void) {
  const [busy, setBusy] = useState(false)
  const act = (fn: () => Promise<unknown>, what: string) => async () => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      alert(`${what}\n\n${(e as Error).message}`)
    } finally {
      setBusy(false)
      reload()
    }
  }
  return [busy, act] as const
}

const NOT_INSTALLED = (
  <>
    Claude Code isn't installed on this PC, so there's nothing to connect. Waypoint works the same without it.
  </>
)

/** Settings → Claude Code: show/hide the controls, and connect or disconnect the connector */
export function ClaudeSettings() {
  const { prefs, savePrefs } = useStore()
  const [status, reload] = useClaudeStatus()
  const [busy, act] = useAction(reload)
  if (!prefs) return null
  const set = (patch: Partial<Prefs>) => savePrefs({ ...prefs, ...patch })

  return (
    <section className="card">
      <h2>Claude Code (optional)</h2>
      <label className="setting">
        <div>
          <div className="setting-name">Show Claude Code controls</div>
          <div className="setting-help">On project pages and here. Turning this off hides them; nothing else changes.</div>
        </div>
        <input type="checkbox" checked={prefs.claudeCode} onChange={(e) => set({ claudeCode: e.target.checked })} />
      </label>
      {prefs.claudeCode && status && (
        <div className="setting">
          <div>
            <div className="setting-name">
              {!status.cli
                ? 'Claude Code not found'
                : status.connector === 'connected'
                  ? 'Connected'
                  : status.connector === 'outdated'
                    ? 'Connected to an older copy of Waypoint'
                    : 'Not connected'}
            </div>
            <div className="setting-help">
              {!status.cli
                ? NOT_INSTALLED
                : `Lets Claude Code sessions (the desktop app's Code tab and the terminal) read and update this vault's projects, ` +
                  `tasks and docs. Claude can't delete anything, and every change it makes is logged. Registered as "${status.serverName}".`}
            </div>
          </div>
          {status.cli && (
            <div className="actions">
              {status.connector !== 'connected' && (
                <button className="btn small primary" disabled={busy} onClick={act(() => window.api.claudeConnect(), "Couldn't connect.")}>
                  {status.connector === 'outdated' ? 'Reconnect' : 'Connect'}
                </button>
              )}
              {status.connector !== 'missing' && (
                <button className="btn small" disabled={busy} onClick={act(() => window.api.claudeDisconnect(), "Couldn't disconnect.")}>
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Project page card: connect, write the repo's CLAUDE.local.md, open Claude Code in the repo */
export function ClaudeProjectCard({ slug, repo }: { slug: string; repo: string }) {
  const [status, reload] = useClaudeStatus(slug)
  const [busy, act] = useAction(reload)
  useEffect(reload, [repo, reload])
  if (!status) return null

  const setUp = act(async () => {
    if (status.connector !== 'connected') await window.api.claudeConnect()
    await window.api.claudeInstructions(slug)
  }, "Couldn't set up Claude Code.")

  return (
    <section className="card">
      <h2>Claude Code</h2>
      {!status.cli ? (
        <p className="empty">{NOT_INSTALLED}</p>
      ) : !repo ? (
        <p className="empty">Set the code repository folder above, then Claude Code sessions there will know this project.</p>
      ) : (
        <>
          <p className="empty">
            {status.connector === 'connected' && status.instructions
              ? 'Set up. Sessions in the repo folder see this project, keep its tasks moving and record docs here.'
              : 'Connect Waypoint to Claude Code and add instructions for this project to the repo (CLAUDE.local.md, kept out of git).'}
          </p>
          <div className="actions">
            {status.connector === 'connected' && status.instructions ? (
              <button className="btn small" disabled={busy} onClick={setUp} title="Rewrite Waypoint's section of CLAUDE.local.md">
                Refresh instructions
              </button>
            ) : (
              <button className="btn small primary" disabled={busy} onClick={setUp}>
                Connect to Claude Code
              </button>
            )}
            <button className="btn small" disabled={busy} onClick={act(() => window.api.claudeOpen(slug, 'app'), "Couldn't open the Claude app.")}>
              Open in Claude
            </button>
            <button className="btn small" disabled={busy} onClick={act(() => window.api.claudeOpen(slug, 'terminal'), "Couldn't open a terminal.")}>
              Open in terminal
            </button>
          </div>
        </>
      )}
    </section>
  )
}
