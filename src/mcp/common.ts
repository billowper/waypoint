/** Helpers shared by the connector's read and write tools: which vault, which project, formatting. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync, readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { homedir } from 'os'
import { Vault } from '../main/vault'
import { listProjects } from '../main/projects'
import { listTasks } from '../main/tasks'
import { readLinked } from '../main/linkedDocs'
import { baseName } from '@shared/names'
import { TASK_STATUSES, TASK_STATUS_LABEL, type LinkedDoc, type Project, type Task } from '@shared/types'

// --- Which vault ---------------------------------------------------------------------------

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

/** Waypoint's own settings file, to follow whichever vault the app has open */
export function appConfigVault(): string | undefined {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  try {
    return JSON.parse(readFileSync(join(appData, 'Waypoint', 'config.json'), 'utf8')).vaultPath
  } catch {
    return undefined
  }
}

export function openVault(): Vault {
  const path = argValue('--vault') ?? process.env.WAYPOINT_VAULT ?? appConfigVault()
  if (!path || !existsSync(path)) {
    throw new Error('No Waypoint vault found. Open one in Waypoint, or start this server with --vault <folder>.')
  }
  return new Vault(path)
}

// --- Which project ---------------------------------------------------------------------------

export const norm = (p: string) => resolve(p).toLowerCase().replace(/[\\/]+$/, '')

/** The project whose repo folder contains `folder` (deepest match wins) */
export function projectForFolder(projects: Project[], folder: string): Project | null {
  const f = norm(folder)
  let best: Project | null = null
  for (const p of projects) {
    if (!p.repo.path) continue
    const r = norm(p.repo.path)
    if ((f === r || f.startsWith(r + sep)) && (!best || r.length > norm(best.repo.path).length)) best = p
  }
  return best
}

/** Folders the session is working in: the folder Claude Code started us in, plus any roots it reports */
export async function sessionFolders(server: McpServer): Promise<string[]> {
  const folders = [process.cwd()]
  try {
    if (server.server.getClientCapabilities()?.roots) {
      const { roots } = await server.server.listRoots()
      for (const r of roots) if (r.uri.startsWith('file:')) folders.push(decodeURIComponent(new URL(r.uri).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
    }
  } catch {
    /* the client doesn't do roots: the start folder is enough */
  }
  return folders
}

/** Resolve a project argument (slug or title, any case), or the session's own project when omitted */
export async function pickProject(server: McpServer, vault: Vault, arg?: string): Promise<Project> {
  const projects = await listProjects(vault)
  if (arg) {
    const a = arg.trim().toLowerCase()
    const found = projects.find((p) => p.slug.toLowerCase() === a || p.title.toLowerCase() === a)
    if (found) return found
    throw new Error(`No project "${arg}". Projects: ${projects.map((p) => `${p.title} (${p.slug})`).join(', ') || 'none'}`)
  }
  for (const folder of await sessionFolders(server)) {
    const p = projectForFolder(projects, folder)
    if (p) return p
  }
  throw new Error(
    'This session isn\'t linked to a Waypoint project (no project has this folder as its repo). ' +
      'Pass a project name, or set the repo folder on the project page in Waypoint. ' +
      `Projects: ${projects.map((p) => `${p.title} (${p.slug})`).join(', ') || 'none'}`
  )
}

// --- Formatting ------------------------------------------------------------------------------

export const today = () => new Date().toISOString().slice(0, 10)

export function taskLine(t: Task): string {
  const bits = [`${t.id}`, t.title, `[${TASK_STATUS_LABEL[t.status]}]`]
  if (t.priority !== 'medium') bits.push(`priority ${t.priority}`)
  if (t.due) bits.push(t.due < today() && t.status !== 'done' ? `OVERDUE (due ${t.due})` : `due ${t.due}`)
  if (t.labels.length) bits.push(`labels: ${t.labels.join(', ')}`)
  return `- ${bits.join(' · ')}  (${t.path})`
}

export function projectSummary(p: Project, tasks: Task[]): string {
  const mine = tasks.filter((t) => t.project === p.slug)
  const counts = TASK_STATUSES.map((s) => `${TASK_STATUS_LABEL[s]} ${mine.filter((t) => t.status === s).length}`).join(', ')
  const overdue = mine.filter((t) => t.status !== 'done' && t.due && t.due < today()).length
  return `${p.title} (slug: ${p.slug}, status: ${p.status})${p.tags.length ? ` tags: ${p.tags.join(', ')}` : ''}\n  tasks: ${counts}${overdue ? `, ${overdue} overdue` : ''}${p.repo.path ? `\n  repo: ${p.repo.path}` : ''}`
}

export const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
export const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true })

/** Run a tool body, turning thrown errors into readable tool errors */
export const safely =
  <A>(fn: (args: A) => Promise<string>) =>
  async (args: A) => {
    try {
      return text(await fn(args))
    } catch (e) {
      return fail(e)
    }
  }


// --- Finding things --------------------------------------------------------------------------

/** A note by vault-relative path, or by name when that's unique */
export async function findNote(vault: Vault, note: string): Promise<string> {
  const path = note.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (vault.isNote(path)) {
    if (!existsSync(vault.abs(path))) throw new Error(`No note at ${path}`)
    return path
  }
  // A name rather than a path: find it
  const name = path.replace(/\.md$/i, '').toLowerCase()
  const matches = (await vault.notePaths()).filter((p) => baseName(p).toLowerCase() === name)
  if (matches.length > 1) throw new Error(`Several notes are called "${note}": ${matches.join(', ')}`)
  if (!matches[0]) throw new Error(`No note "${note}"`)
  return matches[0]
}

/** A linked doc as the read tools return it: the repo file's text, marked as linked and read-only */
export function linkedNoteText(path: string, d: LinkedDoc): string {
  const when = d.modified ? `, last changed ${new Date(d.modified).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''
  return [
    `${path}\n[Linked doc, read-only here: it shows ${d.file || d.source}${when}. To change it, edit that file in the repo.]`,
    d.note ? `Note kept on the doc:\n${d.note}` : '',
    d.content ?? `Nothing to show: ${d.problem}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Linked docs show a file from the repo; writing to the doc itself would change nothing anyone sees */
export async function refuseLinked(vault: Vault, path: string): Promise<void> {
  const d = await readLinked(vault, path)
  if (!d) return
  throw new Error(
    `${path} is a linked doc: it shows ${d.file || d.source} and can't be edited here. Edit that file in the repo instead. ` +
      "(Which file it shows is the `source` in its frontmatter; the user can change that in Waypoint's markdown view.)"
  )
}

/** A task by ID (WR-003) or path */
export async function findTask(vault: Vault, task: string): Promise<Task> {
  const key = task.trim().replace(/\\/g, '/')
  const t = (await listTasks(vault)).find((x) => x.id.toLowerCase() === key.toLowerCase() || x.path === key)
  if (!t) throw new Error(`No task "${task}"`)
  return t
}
