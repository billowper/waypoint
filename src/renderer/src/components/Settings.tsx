import { useEffect, useState } from 'react'
import type { DesktopInfo } from '@shared/types'
import type { Prefs } from '@shared/prefs'
import { useStore } from '../store'

/** Turn a key press into an Electron accelerator, e.g. "Control+Alt+Space" */
function accelerator(e: React.KeyboardEvent): string | null {
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  if (!mods.length) return null // a global hotkey needs a modifier
  return [...mods, key].join('+')
}

export default function Settings() {
  const { prefs, savePrefs, vault, openVault } = useStore()
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    window.api.desktopInfo().then(setInfo)
  }, [prefs])

  if (!prefs) return null
  const set = (patch: Partial<Prefs>) => savePrefs({ ...prefs, ...patch })
  const nudge = (patch: Partial<Prefs['nudges']>) => set({ nudges: { ...prefs.nudges, ...patch } })
  const hours = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div className="project-page settings-page">
      <h1 className="settings-title">Settings</h1>

      <section className="card">
        <h2>Vault</h2>
        <div className="setting">
          <div>
            <div className="setting-name">{vault?.name}</div>
            <div className="setting-help">{vault?.path}</div>
          </div>
          <button className="btn small" onClick={openVault}>
            Open another vault…
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Appearance</h2>
        <div className="setting">
          <div className="setting-name">Theme</div>
          <div className="segmented">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} className={prefs.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Windows</h2>
        <label className="setting">
          <div>
            <div className="setting-name">Keep running in the tray when the window is closed</div>
            <div className="setting-help">Needed for the quick-capture hotkey and nudges. Quit from the tray icon.</div>
          </div>
          <input type="checkbox" checked={prefs.closeToTray} onChange={(e) => set({ closeToTray: e.target.checked })} />
        </label>
        <label className="setting">
          <div>
            <div className="setting-name">Start with Windows</div>
            <div className="setting-help">
              Starts quietly in the tray when you sign in.
              {info && !info.packaged && ' (Takes effect in the installed app, not this dev build.)'}
            </div>
          </div>
          <input
            type="checkbox"
            checked={prefs.startWithWindows}
            onChange={(e) => set({ startWithWindows: e.target.checked })}
          />
        </label>
        <div className="setting">
          <div>
            <div className="setting-name">Quick-capture hotkey</div>
            <div className="setting-help">
              Opens a small box from anywhere that adds a line to inbox.md.
              {prefs.captureHotkey && info && info.hotkey !== prefs.captureHotkey && (
                <span className="warn"> Another app is already using this shortcut. Pick a different one.</span>
              )}
            </div>
          </div>
          <div className="hotkey">
            <input
              readOnly
              className={recording ? 'recording' : ''}
              value={recording ? 'Press the keys…' : prefs.captureHotkey.replace(/\+/g, ' + ') || 'Off'}
              onFocus={() => setRecording(true)}
              onBlur={() => setRecording(false)}
              onKeyDown={(e) => {
                e.preventDefault()
                if (e.key === 'Escape') return (e.currentTarget as HTMLInputElement).blur()
                const acc = accelerator(e)
                if (acc) {
                  set({ captureHotkey: acc })
                  ;(e.currentTarget as HTMLInputElement).blur()
                }
              }}
            />
            {prefs.captureHotkey && (
              <button className="btn small" onClick={() => set({ captureHotkey: '' })}>
                Turn off
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Nudges</h2>
        <label className="setting">
          <div>
            <div className="setting-name">Nudge me to work on things</div>
            <div className="setting-help">
              A Windows notification about an overdue or due-soon task, a project gone quiet, or something to pick up.
            </div>
          </div>
          <input type="checkbox" checked={prefs.nudges.enabled} onChange={(e) => nudge({ enabled: e.target.checked })} />
        </label>
        {prefs.nudges.enabled && (
          <>
            <div className="setting">
              <div className="setting-name">At most every</div>
              <select value={prefs.nudges.everyMinutes} onChange={(e) => nudge({ everyMinutes: Number(e.target.value) })}>
                {[30, 60, 120, 180, 240, 480].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting">
              <div className="setting-name">Only between</div>
              <div className="hotkey">
                <select value={prefs.nudges.startHour} onChange={(e) => nudge({ startHour: Number(e.target.value) })}>
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                and
                <select value={prefs.nudges.endHour} onChange={(e) => nudge({ endHour: Number(e.target.value) })}>
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="setting">
              <div className="setting-name">Weekdays only</div>
              <input
                type="checkbox"
                checked={prefs.nudges.weekdaysOnly}
                onChange={(e) => nudge({ weekdaysOnly: e.target.checked })}
              />
            </label>
            <div className="setting">
              <div className="setting-name">A project counts as stale after</div>
              <select value={prefs.nudges.staleDays} onChange={(e) => nudge({ staleDays: Number(e.target.value) })}>
                {[7, 14, 21, 30, 60].map((d) => (
                  <option key={d} value={d}>
                    {d} days without changes
                  </option>
                ))}
              </select>
            </div>
            <div className="setting">
              <div>
                <div className="setting-name">
                  {prefs.nudges.snoozedUntil > Date.now()
                    ? `Snoozed until ${new Date(prefs.nudges.snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Snooze'}
                </div>
                {prefs.nudges.muted.length > 0 && (
                  <div className="setting-help">{prefs.nudges.muted.length} item(s) muted with "don't nag about this".</div>
                )}
              </div>
              <div className="hotkey">
                {prefs.nudges.snoozedUntil > Date.now() ? (
                  <button className="btn small" onClick={() => nudge({ snoozedUntil: 0 })}>
                    Resume now
                  </button>
                ) : (
                  [60, 240].map((m) => (
                    <button key={m} className="btn small" onClick={() => nudge({ snoozedUntil: Date.now() + m * 60_000 })}>
                      {m / 60} h
                    </button>
                  ))
                )}
                {prefs.nudges.muted.length > 0 && (
                  <button className="btn small" onClick={() => nudge({ muted: [] })}>
                    Unmute all
                  </button>
                )}
                <button className="btn small" onClick={() => window.api.nudgeNow()}>
                  Nudge me now
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Keyboard shortcuts</h2>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl N', 'New note'],
  ['Ctrl P', 'Find or create a note'],
  ['Ctrl Shift F', 'Search all notes'],
  ['Ctrl F', 'Find in this note'],
  ['F2', 'Rename'],
  ['Del', 'Delete the focused tree item'],
  ['Ctrl T / Ctrl W', 'New tab / close tab'],
  ['Ctrl Tab', 'Next tab (Shift for previous)'],
  ['Ctrl Shift B', 'Linked-from panel'],
  ['Ctrl Shift H', 'Home'],
  ['Ctrl ,', 'Settings'],
  ['Ctrl S', 'Save now (it autosaves anyway)'],
  ['Ctrl Alt W', 'Quick capture from anywhere (changeable above)']
]
