import { useEffect, useState } from 'react'
import type { DesktopInfo } from '@shared/types'
import { DEFAULT_COLORS, DEFAULT_FONTS, type Prefs } from '@shared/prefs'
import ColorPair from './ColorPair'
import FontSelect from './FontSelect'

/** Fonts that come with Windows 11 (any installed font name can be typed in too) */
const FONT_CHOICES = [
  'Segoe UI Variable Text',
  'Segoe UI',
  'Aptos',
  'Calibri',
  'Bahnschrift',
  'Georgia',
  'Cambria',
  'Constantia',
  'Palatino Linotype',
  'Verdana',
  'Trebuchet MS'
]
const MONO_CHOICES = ['Cascadia Code', 'Cascadia Mono', 'Consolas', 'Lucida Console', 'Courier New']
import { useStore } from '../store'

/** Turn a key press into an Electron accelerator, e.g. "Control+Alt+Space" */
function accelerator(e: React.KeyboardEvent): string | null {
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  if (!mods.length) return null // a global hotkey needs a modifier
  return [...mods, key].join('+')
}

/** A global hotkey: click, press the keys; warns if another app already owns them */
function HotkeySetting(p: { name: string; help: string; value: string; registered?: string; onChange(v: string): void }) {
  const [recording, setRecording] = useState(false)
  return (
    <div className="setting">
      <div>
        <div className="setting-name">{p.name}</div>
        <div className="setting-help">
          {p.help}
          {p.value && p.registered !== undefined && p.registered !== p.value && (
            <span className="warn"> Another app is already using this shortcut. Pick a different one.</span>
          )}
        </div>
      </div>
      <div className="hotkey">
        <input
          readOnly
          className={recording ? 'recording' : ''}
          value={recording ? 'Press the keys…' : p.value.replace(/\+/g, ' + ') || 'Off'}
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            e.preventDefault()
            if (e.key === 'Escape') return (e.currentTarget as HTMLInputElement).blur()
            const acc = accelerator(e)
            if (acc) {
              p.onChange(acc)
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
        {p.value && (
          <button className="btn small" onClick={() => p.onChange('')}>
            Turn off
          </button>
        )}
      </div>
    </div>
  )
}

export default function Settings() {
  const { prefs, savePrefs, vault, openVault } = useStore()
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [backingUp, setBackingUp] = useState(false)

  useEffect(() => {
    window.api.desktopInfo().then(setInfo)
  }, [prefs])

  if (!prefs) return null
  const set = (patch: Partial<Prefs>) => savePrefs({ ...prefs, ...patch })
  const nudge = (patch: Partial<Prefs['nudges']>) => set({ nudges: { ...prefs.nudges, ...patch } })
  const backup = (patch: Partial<Prefs['backup']>) => set({ backup: { ...prefs.backup, ...patch } })
  const backUpNow = async () => {
    setBackingUp(true)
    try {
      const file = await window.api.backupNow()
      // The main process stamped the time; pick it up
      useStore.setState({ prefs: await window.api.prefs() })
      alert(`Backed up to:
${file}`)
    } catch (e) {
      alert(`Backup failed.

${(e as Error).message}`)
    } finally {
      setBackingUp(false)
    }
  }
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
        <div className="setting">
          <div>
            <div className="setting-name">Colours</div>
            <div className="setting-help">
              Primary is for buttons, links and the cursor; accent for highlights. Backgrounds, text and borders are
              worked out from these. Projects can have their own (on the project page).
            </div>
          </div>
          <div className="hotkey">
            <ColorPair value={prefs.colors} onChange={(colors) => set({ colors })} />
            {(prefs.colors.primary !== DEFAULT_COLORS.primary || prefs.colors.accent !== DEFAULT_COLORS.accent) && (
              <button className="btn small" onClick={() => set({ colors: DEFAULT_COLORS })}>
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Fonts and size</h2>
        <div className="setting">
          <div>
            <div className="setting-name">Interface scale</div>
            <div className="setting-help">Makes everything bigger or smaller. Ctrl + = / Ctrl + − / Ctrl + 0 also work.</div>
          </div>
          <div className="hotkey">
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={prefs.uiScale}
              onChange={(e) => set({ uiScale: Number(e.target.value) })}
            />
            <span className="size-value">{Math.round(prefs.uiScale * 100)}%</span>
            {prefs.uiScale !== 1 && (
              <button className="btn small" onClick={() => set({ uiScale: 1 })}>
                Reset
              </button>
            )}
          </div>
        </div>
        {(
          [
            ['ui', 'Interface', FONT_CHOICES],
            ['editor', 'Notes', FONT_CHOICES],
            ['mono', 'Code', MONO_CHOICES]
          ] as const
        ).map(([key, label, choices]) => (
          <div className="setting" key={key}>
            <div className="setting-name">{label}</div>
            <FontSelect
              value={prefs.fonts[key]}
              suggested={[...choices]}
              emptyLabel={key === 'editor' ? 'Same as interface' : undefined}
              onChange={(font) => set({ fonts: { ...prefs.fonts, [key]: font } })}
            />
          </div>
        ))}
        <div className="setting">
          <div className="setting-name">Note text size</div>
          <div className="hotkey">
            <input
              type="range"
              min={12}
              max={22}
              step={0.5}
              value={prefs.fonts.size}
              onChange={(e) => set({ fonts: { ...prefs.fonts, size: Number(e.target.value) } })}
            />
            <span className="size-value">{prefs.fonts.size}px</span>
            {JSON.stringify(prefs.fonts) !== JSON.stringify(DEFAULT_FONTS) && (
              <button className="btn small" onClick={() => set({ fonts: DEFAULT_FONTS })}>
                Reset
              </button>
            )}
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
        <HotkeySetting
          name="Quick-capture hotkey"
          help="Opens a small box from anywhere that adds a line to inbox.md."
          value={prefs.captureHotkey}
          registered={info?.hotkey}
          onChange={(captureHotkey) => set({ captureHotkey })}
        />
        <HotkeySetting
          name="Search hotkey"
          help="Opens a search box from anywhere; pick a result to open it here."
          value={prefs.searchHotkey}
          registered={info?.searchHotkey}
          onChange={(searchHotkey) => set({ searchHotkey })}
        />
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
        <h2>Backups</h2>
        <div className="setting">
          <div>
            <div className="setting-name">Backup folder</div>
            <div className="setting-help">
              {prefs.backup.dir || 'Zip snapshots of the vault go here, e.g. a folder on OneDrive or another drive.'}
            </div>
          </div>
          <button
            className="btn small"
            onClick={async () => {
              const dir = await window.api.pickPath('folder')
              if (dir) backup({ dir })
            }}
          >
            {prefs.backup.dir ? 'Change…' : 'Choose…'}
          </button>
        </div>
        {prefs.backup.dir && (
          <>
            <label className="setting">
              <div className="setting-name">Back up once a day</div>
              <input type="checkbox" checked={prefs.backup.daily} onChange={(e) => backup({ daily: e.target.checked })} />
            </label>
            <div className="setting">
              <div className="setting-name">Keep</div>
              <select value={prefs.backup.keep} onChange={(e) => backup({ keep: Number(e.target.value) })}>
                {[3, 7, 14, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    newest {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting">
              <div>
                <div className="setting-name">
                  {prefs.backup.last ? `Last backup ${new Date(prefs.backup.last).toLocaleString()}` : 'Not backed up yet'}
                </div>
                <div className="setting-help">Git history (.git) isn't included; it's a backup of its own.</div>
              </div>
              <button className="btn small primary" disabled={backingUp} onClick={backUpNow}>
                {backingUp ? 'Backing up…' : 'Back up now'}
              </button>
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
  ['Ctrl Alt W', 'Quick capture from anywhere (changeable above)'],
  ['Ctrl Alt F', 'Search from anywhere (changeable above)']
]
