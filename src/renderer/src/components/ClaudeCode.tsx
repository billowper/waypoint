import { useCallback, useEffect, useState } from 'react'
import type { ClaudeChange, ClaudeStatus } from '@shared/types'
import type { Prefs } from '@shared/prefs'
import { useStore } from '../store'
import { noteMenu, showMenu } from '../menus'
import { baseName } from '@shared/names'

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
          <div className="setting-help">On project pages, tasks and here. Turning this off hides them; nothing else changes.</div>
        </div>
        <input type="checkbox" checked={prefs.claudeCode} onChange={(e) => set({ claudeCode: e.target.checked })} />
      </label>
      {prefs.claudeCode && (
        <label className="setting">
          <div>
            <div className="setting-name">Send tasks to</div>
            <div className="setting-help">
              A terminal starts work straight away. The Claude app fills in the prompt, then you confirm the folder and press Enter.
              The other one stays on the right-click menu.
            </div>
          </div>
          <select value={prefs.claudeSendTo} onChange={(e) => set({ claudeSendTo: e.target.value as Prefs['claudeSendTo'] })}>
            <option value="terminal">Terminal</option>
            <option value="app">Claude app</option>
          </select>
        </label>
      )}
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

/** Claude's notes for the project (claude/Memory.md and claude/sessions/<date>.md), newest sessions first */
function ClaudeNotes({ dir }: { dir: string }) {
  const { notes, openFile } = useStore()
  const memory = notes.find((n) => n === `${dir}/claude/Memory.md`)
  const sessions = notes
    .filter((n) => n.startsWith(`${dir}/claude/sessions/`))
    .sort()
    .reverse()
  const others = notes.filter((n) => n.startsWith(`${dir}/claude/`) && n !== memory && !sessions.includes(n))
  if (!memory && !sessions.length && !others.length) return null
  const item = (path: string, label: string) => (
    <li key={path}>
      <button onClick={(e) => openFile(path, { newTab: e.ctrlKey })} onContextMenu={(e) => showMenu(e, noteMenu(path))}>
        {label}
      </button>
    </li>
  )
  return (
    <>
      <h3 className="card-sub">Claude's notes</h3>
      <ul className="page-list">
        {memory && item(memory, 'Memory')}
        {sessions.slice(0, 5).map((s) => item(s, `Session log ${baseName(s)}`))}
        {others.map((n) => item(n, baseName(n)))}
      </ul>
      {sessions.length > 5 && <p className="empty">{sessions.length - 5} older session logs in claude/sessions.</p>}
    </>
  )
}

/** Project page card: connect, write the repo's CLAUDE.local.md, open Claude Code in the repo, Claude's notes */
export function ClaudeProjectCard({ slug, repo, dir }: { slug: string; repo: string; dir: string }) {
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
      <ClaudeNotes dir={dir} />
    </section>
  )
}

const VERB: Record<ClaudeChange['action'], string> = {
  created: 'Created',
  updated: 'Updated',
  appended: 'Added to',
  renamed: 'Renamed',
  moved: 'Moved'
}

/** "just now", "5 min ago", "3 h ago", then the date */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** How a changed path reads in the feed: session logs by their date, everything else by name */
function changedName(path: string): string {
  const log = /\/claude\/sessions\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)
  if (log) return `session log ${new Date(log[1]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  return baseName(path)
}

/** Edits need the kept old text; creates, renames and moves can always be undone */
const canUndo = (c: ClaudeChange) => c.action === 'created' || c.action === 'renamed' || c.action === 'moved' || !!c.hasSnapshot

/**
 * "Changed by Claude": what the connector changed, newest first, each with Undo. For one project (project page)
 * or all of them (Home). Updates when Claude logs another change.
 */
export function ClaudeFeed({ slug, limit, panel }: { slug?: string; limit: number; panel?: boolean }) {
  const { openFile, openProject, openCanvas, projects } = useStore()
  const [changes, setChanges] = useState<ClaudeChange[]>([])
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    window.api.claudeChanges(slug, 200).then(setChanges, () => setChanges([]))
  }, [slug])
  useEffect(() => {
    load()
    return window.api.onChanged((events) => {
      if (events.some((e) => e.path === '.app/claude-log.jsonl')) load()
    })
  }, [load])
  if (!changes.length) return null

  const open = (c: ClaudeChange, newTab: boolean) => {
    const project = /^projects\/([^/]+)$/.exec(c.path)
    if (project) openProject(project[1], { newTab })
    else if (c.path.endsWith('.excalidraw')) openCanvas(c.path, { newTab })
    else if (c.path.endsWith('.md')) openFile(c.path, { newTab })
  }
  const undo = (c: ClaudeChange) => async () => {
    setBusy(c.id)
    try {
      await window.api.claudeUndo(c.id)
    } catch (e) {
      alert(`Couldn't undo that.\n\n${(e as Error).message}`)
    } finally {
      setBusy('')
      load()
    }
  }
  const shown = showAll ? changes : changes.slice(0, limit)
  const projectTitle = (path: string) => projects.find((p) => path === p.dir || path.startsWith(p.dir + '/'))?.title

  return (
    <section className={panel ? 'panel' : 'card'}>
      <h2>Changed by Claude</h2>
      <ul className="recent claude-feed">
        {shown.map((c) => (
          <li key={c.id} className={c.undone ? 'undone' : ''}>
            <button onClick={(e) => open(c, e.ctrlKey)} title={`${c.path}\nfrom a session in ${c.session}`}>
              <span className="recent-name">
                {VERB[c.action]} {changedName(c.path)}
              </span>
              <span className="recent-path">
                {[
                  c.summary !== baseName(c.path) && !c.summary.includes(' → ') ? c.summary : '',
                  slug ? '' : projectTitle(c.path)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="feed-when">{ago(c.at)}</span>
            </button>
            {c.undone ? (
              <span className="feed-undone">Undone</span>
            ) : !canUndo(c) ? (
              <span className="feed-undone" title="The old version wasn't kept (undo keeps them for 30 days)">—</span>
            ) : (
              <button className="btn small" disabled={!!busy} onClick={undo(c)} title="Put it back the way it was before this change">
                {busy === c.id ? 'Undoing…' : 'Undo'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {changes.length > limit && (
        <button className="link-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${changes.length}`}
        </button>
      )}
    </section>
  )
}
