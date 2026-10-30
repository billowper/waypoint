import { promises as fs } from 'fs'
import { join } from 'path'
import type { Vault } from './vault'
import { PROJECT_STATUSES, type Project, type ProjectSettings, type ProjectStatus } from '@shared/types'
import { joinFrontmatter, objList, splitFrontmatter, str, strList } from '@shared/frontmatter'
import { sanitize, titleOf } from '@shared/names'

export const PROJECTS_DIR = 'projects'
const PROJECT_FILE = 'project.md'
/** Folders every new project starts with */
const SUBFOLDERS = ['wiki', 'tasks', 'boards']

const today = () => new Date().toISOString().slice(0, 10)

/** "Website redesign" → "website-redesign" (folder names stay readable and git-friendly) */
export function slugify(name: string): string {
  return (
    sanitize(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

/** Task ID prefix: initials of a multi-word name ("Website redesign" → "WR"), else its first letters */
export function keyFor(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? ['P']
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : words[0]
  return key.slice(0, 4) || 'P'
}

function settingsFrom(data: Record<string, unknown>, fallbackTitle: string): ProjectSettings {
  const status = str(data.status) as ProjectStatus
  const repo = (data.repo && typeof data.repo === 'object' ? data.repo : {}) as Record<string, unknown>
  const title = str(data.title, fallbackTitle) || fallbackTitle
  return {
    title,
    status: PROJECT_STATUSES.includes(status) ? status : 'active',
    key: (str(data.key) || keyFor(title)).toUpperCase(),
    tags: strList(data.tags),
    created: str(data.created),
    repo: { path: str(repo.path), remote: str(repo.remote) },
    links: objList(data.links).map((l) => ({ title: str(l.title), url: str(l.url) })).filter((l) => l.url),
    bookmarks: objList(data.bookmarks)
      .map((b) => ({ title: str(b.title), path: str(b.path) }))
      .filter((b) => b.path)
  }
}

/** Frontmatter written in a stable, readable order; empty optional sections are left out */
function dataFrom(s: ProjectSettings): Record<string, unknown> {
  const data: Record<string, unknown> = { title: s.title, status: s.status, key: s.key }
  if (s.tags.length) data.tags = s.tags
  data.created = s.created || today()
  if (s.repo.path || s.repo.remote) {
    data.repo = { ...(s.repo.path ? { path: s.repo.path } : {}), ...(s.repo.remote ? { remote: s.repo.remote } : {}) }
  }
  if (s.links.length) data.links = s.links.map((l) => ({ title: l.title || l.url, url: l.url }))
  if (s.bookmarks.length) data.bookmarks = s.bookmarks.map((b) => ({ title: b.title || b.path, path: b.path }))
  return data
}

async function newestMtime(abs: string): Promise<number> {
  let newest = 0
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else newest = Math.max(newest, (await fs.stat(p).catch(() => null))?.mtimeMs ?? 0)
    }
  }
  await walk(abs)
  return newest
}

export async function readProject(vault: Vault, slug: string): Promise<Project> {
  const dir = `${PROJECTS_DIR}/${slug}`
  const text = await vault.read(`${dir}/${PROJECT_FILE}`).catch(() => null)
  const { data, body } = splitFrontmatter(text ?? '')
  const heading = titleOf(body)
  const settings = settingsFrom(data, heading ?? slug)
  const overview = heading ? body.replace(/^#[^\n]*\n?/, '').trim() : body.trim()
  return { ...settings, slug, dir, overview, updated: await newestMtime(vault.abs(dir)), hasFile: text !== null }
}

export async function listProjects(vault: Vault): Promise<Project[]> {
  const entries = await fs.readdir(vault.abs(PROJECTS_DIR), { withFileTypes: true }).catch(() => [])
  const projects = await Promise.all(
    entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => readProject(vault, e.name))
  )
  return projects.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
}

export async function createProject(vault: Vault, name: string): Promise<string> {
  const title = name.trim() || 'New project'
  const base = slugify(title)
  let slug = base
  for (let i = 2; await fs.stat(vault.abs(`${PROJECTS_DIR}/${slug}`)).catch(() => null); i++) slug = `${base}-${i}`
  const dir = `${PROJECTS_DIR}/${slug}`
  for (const sub of SUBFOLDERS) await fs.mkdir(vault.abs(`${dir}/${sub}`), { recursive: true })
  const settings: ProjectSettings = {
    title,
    status: 'active',
    key: keyFor(title),
    tags: [],
    created: today(),
    repo: { path: '', remote: '' },
    links: [],
    bookmarks: []
  }
  const body = `# ${title}\n\nWhat this project is for, and what "done" looks like.\n`
  await fs.writeFile(vault.abs(`${dir}/${PROJECT_FILE}`), joinFrontmatter(dataFrom(settings), body), { flag: 'wx' })
  await fs.writeFile(vault.abs(`${dir}/wiki/${title} wiki.md`), `# ${title} wiki\n\n`, { flag: 'wx' }).catch(() => {})
  return slug
}

/** Replace a project's settings, keeping the rest of project.md as it is. */
export async function saveProject(vault: Vault, slug: string, settings: ProjectSettings): Promise<void> {
  const rel = `${PROJECTS_DIR}/${slug}/${PROJECT_FILE}`
  const text = await vault.read(rel).catch(() => null)
  const { data, body } = splitFrontmatter(text ?? '')
  // Keep any extra keys Bill (or another tool) added by hand
  const merged = { ...data, ...dataFrom(settings) }
  for (const k of ['tags', 'repo', 'links', 'bookmarks']) if (!(k in dataFrom(settings))) delete merged[k]
  await vault.write(rel, joinFrontmatter(merged, text === null ? `# ${settings.title}\n\n` : body))
}

/** A new, empty Excalidraw board in projects/<slug>/boards/ (or any folder); returns its path */
export async function createBoard(vault: Vault, dir: string, name: string): Promise<string> {
  await fs.mkdir(vault.abs(dir), { recursive: true })
  const base = sanitize(name) || 'Board'
  for (let i = 0; ; i++) {
    const rel = `${dir}/${i ? `${base} ${i}` : base}.excalidraw`
    const empty = { type: 'excalidraw', version: 2, source: 'waypoint', elements: [], appState: {}, files: {} }
    try {
      await fs.writeFile(vault.abs(rel), JSON.stringify(empty, null, 2), { flag: 'wx' })
      return rel
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
    }
  }
}

/** Paths a project lists (repo folder, bookmarks): the only outside-the-vault paths the app opens. */
export async function knownExternalPaths(vault: Vault): Promise<Set<string>> {
  const out = new Set<string>()
  for (const p of await listProjects(vault)) {
    if (p.repo.path) out.add(p.repo.path.toLowerCase())
    for (const b of p.bookmarks) out.add(b.path.toLowerCase())
  }
  return out
}
