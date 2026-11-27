import { shell } from 'electron'
import { promises as fs } from 'fs'
import { basename, isAbsolute } from 'path'
import {
  PRIORITIES,
  TASK_STATUSES,
  type AppCommand,
  type Project,
  type Task,
  type TaskFields
} from '@shared/types'
import type { Vault } from '../vault'
import { PROJECTS_DIR, listProjects, readProject } from '../projects'
import { createTask, getTask, getTaskWithData, listTasksWithData, readTask, updateTask } from '../tasks'
import { MAX as MAX_PICTURE, saveAttachment } from '../attachments'
import { recordChange } from '../claudeLog'
import { CLI_NOT_FOUND, claudeAvailable, openInClaudeApp, openInClaudeTerminal, plainPrompt } from '../claudeCode'
import { prefs } from '../config'
import { toast } from '../desktop'
import { flushOthers } from '../windows'
import { externalUrlOk } from './files'

/**
 * What a plugin's `host.*` calls do in Waypoint (docs/plugins.md). The plugin process sends a method name and its
 * arguments; `hostCall` runs it here, in the main process, and returns the answer. The plugin is trusted code, but
 * the arguments still get checked: a typo shouldn't write a bad task file or open an odd URL.
 */

export interface HostDeps {
  vault(): Vault | null
  /** Keep the note index current after a file was written (so a [[link]] to it resolves straight away) */
  indexUpdate(rel: string): Promise<void>
  /** Run a command in the main window (open a view) */
  command(c: AppCommand): void
}

/** The plugin a call comes from */
export interface Caller {
  id: string
  dir: string
}

const needVault = (deps: HostDeps): Vault => {
  const v = deps.vault()
  if (!v) throw new Error('No vault is open')
  return v
}

const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`${what} must be a non-empty string`)
  return v
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** The fields a plugin may set on a task, each checked; anything else is ignored */
function taskFields(raw: unknown): Partial<TaskFields> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The task fields must be an object')
  const r = raw as Record<string, unknown>
  const out: Partial<TaskFields> = {}
  if (r.title !== undefined) {
    if (typeof r.title !== 'string' || !r.title.trim()) throw new Error('title must be a non-empty string')
    out.title = r.title
  }
  if (r.status !== undefined) {
    if (!TASK_STATUSES.includes(r.status as never)) throw new Error(`status must be one of ${TASK_STATUSES.join(', ')}`)
    out.status = r.status as TaskFields['status']
  }
  if (r.priority !== undefined) {
    if (!PRIORITIES.includes(r.priority as never)) throw new Error(`priority must be one of ${PRIORITIES.join(', ')}`)
    out.priority = r.priority as TaskFields['priority']
  }
  if (r.due !== undefined) {
    if (typeof r.due !== 'string' || (r.due && !isDate(r.due))) throw new Error('due must be YYYY-MM-DD, or "" for none')
    out.due = r.due
  }
  if (r.labels !== undefined) {
    if (!Array.isArray(r.labels) || r.labels.some((l) => typeof l !== 'string')) throw new Error('labels must be a list of strings')
    out.labels = r.labels as string[]
  }
  if (r.archived !== undefined) out.archived = r.archived ? (typeof r.archived === 'string' ? r.archived : 'yes') : ''
  return out
}

const slugOk = (slug: unknown): slug is string => typeof slug === 'string' && /^[^/\\]+$/.test(slug) && !slug.startsWith('.')

async function projectGet(v: Vault, slug: unknown): Promise<Project | null> {
  if (!slugOk(slug)) return null
  const dir = await fs.stat(v.abs(`${PROJECTS_DIR}/${slug}`)).catch(() => null)
  return dir?.isDirectory() ? readProject(v, slug) : null
}

async function tasksCreate(deps: HostDeps, who: Caller, slug: unknown, fields: unknown, body: unknown, data: unknown): Promise<Task> {
  const v = needVault(deps)
  if (!(await projectGet(v, slug))) throw new Error(`No project "${String(slug)}"`)
  if (body !== undefined && typeof body !== 'string') throw new Error('The task body must be a string')
  if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new Error('The task data must be an object')
  const rel = await createTask(v, slug as string, taskFields(fields), body as string | undefined, (data ?? {}) as Record<string, unknown>)
  await deps.indexUpdate(rel)
  const task = await readTask(v, rel)
  await recordChange(v, { tool: `plugin:${who.id}`, action: 'created', path: rel, summary: `Created ${task.id}: ${task.title}`, session: who.dir })
  return task
}

async function tasksUpdate(deps: HostDeps, who: Caller, id: unknown, patch: unknown, summary: unknown): Promise<Task> {
  const v = needVault(deps)
  const found = await getTask(v, text(id, 'The task id'))
  if (!found) throw new Error(`No task "${String(id)}"`)
  const fields = taskFields(patch)
  // Reopening a finished task brings it back to the board too (the task menu's "Move to" does the same through the UI)
  if (fields.status && fields.status !== 'done' && found.status === 'done' && fields.archived === undefined) fields.archived = ''
  await flushOthers() // an open editor's unsaved text lands first, so it can't overwrite the change
  const before = await v.read(found.path)
  const task = await updateTask(v, found.path, fields)
  const said = typeof summary === 'string' && summary.trim() ? summary.trim() : `Updated ${task.id}`
  await recordChange(v, { tool: `plugin:${who.id}`, action: 'updated', path: found.path, summary: said, session: who.dir }, before)
  return task
}

/** host.attachments.add: copy a picture from disk into the vault's attachments/; returns its vault path */
async function attachmentAdd(deps: HostDeps, file: unknown): Promise<string> {
  const v = needVault(deps)
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('The file must be an absolute path')
  const info = await fs.stat(file).catch(() => null)
  if (!info?.isFile()) throw new Error(`Not a file: ${file}`)
  if (info.size > MAX_PICTURE) throw new Error('That picture is over 25 MB')
  return saveAttachment(v, basename(file), await fs.readFile(file))
}

/** Open Claude Code in `cwd` the way Send to Claude does (the terminal or the desktop app, as chosen in Settings) */
async function claudeOpen(cwd: unknown, prompt: unknown): Promise<void> {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || !(await fs.stat(cwd).catch(() => null))?.isDirectory()) {
    throw new Error(`Not a folder: ${String(cwd)}`)
  }
  if (typeof prompt !== 'string') throw new Error('The prompt must be a string')
  if (!(await claudeAvailable())) throw new Error(CLI_NOT_FOUND)
  // The terminal route passes the prompt through command lines, so it only gets plain text there (as task prompts do)
  if (prefs().claudeSendTo === 'app') await openInClaudeApp(cwd, prompt)
  else await openInClaudeTerminal(cwd, plainPrompt(prompt, 600))
}

/** Run one host call from a plugin. `params` are the arguments as the plugin passed them. */
export async function hostCall(deps: HostDeps, who: Caller, method: string, params: unknown[]): Promise<unknown> {
  const [a, b, c] = params
  switch (method) {
    case 'projects.list':
      return listProjects(needVault(deps))
    case 'projects.get':
      return projectGet(needVault(deps), a)
    case 'tasks.list':
      return listTasksWithData(needVault(deps), slugOk(a) ? a : undefined)
    case 'tasks.get':
      return getTaskWithData(needVault(deps), text(a, 'The task id'))
    case 'attachments.add':
      return attachmentAdd(deps, a)
    case 'tasks.create':
      return tasksCreate(deps, who, a, b, c, params[3])
    case 'tasks.update':
      return tasksUpdate(deps, who, a, b, c)
    case 'openExternal':
      if (!externalUrlOk(a)) throw new Error('openExternal only opens http(s), mailto and claude:// links')
      return shell.openExternal(a)
    case 'openPath': {
      const err = await shell.openPath(text(a, 'The path'))
      if (err) throw new Error(err)
      return
    }
    case 'showInFolder':
      return shell.showItemInFolder(text(a, 'The path'))
    case 'claude.available':
      return claudeAvailable()
    case 'claude.open':
      return claudeOpen(a, b)
    case 'toast': {
      const open = c && typeof c === 'object' ? (c as { view?: unknown; state?: unknown }) : null
      const view = typeof open?.view === 'string' ? open.view : null
      toast(String(a ?? ''), String(b ?? ''), view ? () => deps.command({ kind: 'open-plugin', plugin: who.id, view, state: open?.state }) : undefined)
      return
    }
    case 'openView':
      deps.command({ kind: 'open-plugin', plugin: who.id, view: text(a, 'The view id'), state: b })
      return
    default:
      throw new Error(`Unknown host call "${method}"`)
  }
}
