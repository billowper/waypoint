import { promises as fs } from 'fs'
import { createHash, randomBytes } from 'crypto'
import type { Vault } from './vault'
import type { ClaudeChange } from '@shared/types'

/**
 * The log of changes made through the Claude Code connector: .app/claude-log.jsonl, one JSON line per change,
 * plus `{ undoes: id }` lines when Bill undoes one from the app. Before an edit, the connector keeps the old text in
 * .app/cache/claude-undo/<id>.md so the app can put it back (cache: disposable, not committed).
 * No Electron here: the connector writes the log, the app reads it.
 */
export const CLAUDE_LOG = '.app/claude-log.jsonl'
const UNDO_DIR = '.app/cache/claude-undo'
/** Old snapshots are dropped after this long; the change still shows, just without undo */
const KEEP_DAYS = 30

export const hashText = (text: string) => createHash('sha1').update(text).digest('hex')
export const snapshotPath = (id: string) => `${UNDO_DIR}/${id}.md`

export type NewChange = Omit<ClaudeChange, 'id' | 'at' | 'session' | 'undone' | 'afterHash' | 'hasSnapshot'>

/**
 * Record a change. `before` is the file's text before an edit (null = the file didn't exist), and makes the change
 * undoable by restoring it; leave it out for creates, renames and moves.
 */
export async function recordChange(vault: Vault, change: NewChange, before?: string | null): Promise<void> {
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const entry: ClaudeChange = { id, at: new Date().toISOString(), ...change, session: process.cwd() }
  if (before !== undefined) {
    const after = await vault.read(change.path).catch(() => null)
    if (after !== null) entry.afterHash = hashText(after)
    if (before !== null) {
      await fs.mkdir(vault.abs(UNDO_DIR), { recursive: true })
      await fs.writeFile(vault.abs(snapshotPath(id)), before, 'utf8')
      entry.hasSnapshot = true
    } else if (change.action !== 'created') {
      entry.action = 'created' // appending to a file that didn't exist yet made it
    }
  }
  await fs.mkdir(vault.abs('.app'), { recursive: true })
  await fs.appendFile(vault.abs(CLAUDE_LOG), JSON.stringify(entry) + '\n', 'utf8')
  pruneSnapshots(vault).catch(() => undefined)
}

/** Every change, newest first, with `undone` set from the undo lines */
export async function readChanges(vault: Vault): Promise<ClaudeChange[]> {
  const text = await fs.readFile(vault.abs(CLAUDE_LOG), 'utf8').catch(() => '')
  const changes: ClaudeChange[] = []
  const undone = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (typeof row.undoes === 'string') undone.add(row.undoes)
      else if (row && typeof row.path === 'string') changes.push({ ...row, id: row.id ?? `${row.at}` })
    } catch {
      /* a half-written or hand-edited line: skip it */
    }
  }
  for (const c of changes) if (undone.has(c.id)) c.undone = true
  return changes.reverse()
}

export async function markUndone(vault: Vault, id: string): Promise<void> {
  await fs.appendFile(vault.abs(CLAUDE_LOG), JSON.stringify({ undoes: id, at: new Date().toISOString() }) + '\n', 'utf8')
}

async function pruneSnapshots(vault: Vault) {
  const dir = vault.abs(UNDO_DIR)
  const cutoff = Date.now() - KEEP_DAYS * 86400000
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const stamp = parseInt(name.split('-')[0], 36)
    if (stamp && stamp < cutoff) await fs.rm(`${dir}/${name}`, { force: true })
  }
}
