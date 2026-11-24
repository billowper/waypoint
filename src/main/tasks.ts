import { promises as fs } from 'fs'
import type { Vault } from './vault'
import { PROJECTS_DIR, readProject } from './projects'
import {
  PRIORITIES,
  TASK_STATUSES,
  type Priority,
  type Task,
  type TaskFields,
  type TaskStatus
} from '@shared/types'
import { joinFrontmatter, splitFrontmatter, str, strList } from '@shared/frontmatter'
import { baseName } from '@shared/names'

const TASKS = 'tasks'
const today = () => new Date().toISOString().slice(0, 10)
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

function taskFrom(path: string, project: string, text: string): Task {
  const { data } = splitFrontmatter(text)
  const status = str(data.status) as TaskStatus
  const priority = str(data.priority) as Priority
  const due = str(data.due)
  // `archived: 2026-11-24` normally; `archived: true` (typed by hand) counts too
  const archived = data.archived === true ? ARCHIVED_UNDATED : data.archived === false ? '' : str(data.archived).trim()
  return {
    path,
    project,
    id: str(data.id) || baseName(path),
    title: str(data.title) || baseName(path),
    status: TASK_STATUSES.includes(status) ? status : 'todo',
    priority: PRIORITIES.includes(priority) ? priority : 'medium',
    due: isDate(due) ? due : '',
    labels: strList(data.labels),
    created: str(data.created),
    completed: str(data.completed),
    archived
  }
}

/** Stands for `archived: true` (no date), so writing the task back keeps it as it was */
const ARCHIVED_UNDATED = 'yes'

/** Every task in every project (or one project), read from projects/<slug>/tasks/*.md */
export async function listTasks(vault: Vault, project?: string): Promise<Task[]> {
  const slugs = project
    ? [project]
    : (await fs.readdir(vault.abs(PROJECTS_DIR), { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
  const out: Task[] = []
  for (const slug of slugs) {
    const dir = `${PROJECTS_DIR}/${slug}/${TASKS}`
    for (const rel of await vault.notePaths(dir).catch(() => [])) {
      const text = await vault.read(rel).catch(() => null)
      if (text !== null) out.push(taskFrom(rel, slug, text))
    }
  }
  return out
}

/** Frontmatter in a stable order; keeps any extra keys added by hand */
function writeFields(data: Record<string, unknown>, t: TaskFields & { id: string; created: string; completed: string }) {
  const out: Record<string, unknown> = { id: t.id, title: t.title, status: t.status, priority: t.priority }
  if (t.due) out.due = t.due
  if (t.labels.length) out.labels = t.labels
  out.created = t.created || today()
  if (t.completed) out.completed = t.completed
  if (t.archived) out.archived = t.archived === ARCHIVED_UNDATED ? true : t.archived
  for (const [k, v] of Object.entries(data))
    if (!(k in out) && !['due', 'labels', 'completed', 'archived'].includes(k)) out[k] = v
  return out
}

export async function createTask(vault: Vault, slug: string, fields: Partial<TaskFields>): Promise<string> {
  const project = await readProject(vault, slug)
  const key = project.key || 'TASK'
  const dir = `${PROJECTS_DIR}/${slug}/${TASKS}`
  await fs.mkdir(vault.abs(dir), { recursive: true })
  // Next number after the highest existing ID with this key (gaps from deleted tasks aren't reused)
  const existing = await listTasks(vault, slug)
  const pattern = new RegExp(`^${key}-(\\d+)$`, 'i')
  const max = Math.max(0, ...existing.map((t) => Number(pattern.exec(t.id)?.[1] ?? 0)))
  for (let n = max + 1; ; n++) {
    const id = `${key}-${String(n).padStart(3, '0')}`
    const rel = `${dir}/${id}.md`
    const status = fields.status ?? 'todo'
    const data = writeFields(
      {},
      {
        id,
        title: fields.title?.trim() || 'New task',
        status,
        priority: fields.priority ?? 'medium',
        due: fields.due ?? '',
        labels: fields.labels ?? [],
        archived: '',
        created: today(),
        completed: status === 'done' ? today() : ''
      }
    )
    try {
      await fs.writeFile(vault.abs(rel), joinFrontmatter(data, '\n'), { flag: 'wx' })
      return rel
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
    }
  }
}

export async function updateTask(vault: Vault, rel: string, patch: Partial<TaskFields>): Promise<Task> {
  const text = await vault.read(rel)
  const { data, body } = splitFrontmatter(text)
  const project = rel.split('/')[1]
  const cur = taskFrom(rel, project, text)
  const next = { ...cur, ...patch }
  if (patch.status && patch.status !== cur.status) next.completed = patch.status === 'done' ? today() : ''
  // Archiving stamps today's date (whatever the caller sent); un-archiving clears it; already archived keeps its date
  if (patch.archived !== undefined) next.archived = patch.archived ? cur.archived || today() : ''
  await vault.write(rel, joinFrontmatter(writeFields(data, next), body))
  return taskFrom(rel, project, await vault.read(rel))
}

/** Archive (or bring back) several tasks at once, e.g. everything in Done. Returns how many changed */
export async function archiveTasks(vault: Vault, rels: string[], on: boolean): Promise<number> {
  let n = 0
  for (const rel of rels) {
    const text = isTaskPath(rel) ? await vault.read(rel).catch(() => null) : null
    if (text === null || !!taskFrom(rel, rel.split('/')[1], text).archived === on) continue
    await updateTask(vault, rel, { archived: on ? today() : '' })
    n++
  }
  return n
}

export const isTaskPath =(rel: string) => /^projects\/[^/]+\/tasks\/.+\.md$/i.test(rel)
