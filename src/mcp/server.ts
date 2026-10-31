/**
 * Waypoint's MCP server: lets Claude Code sessions read (and, from M2, keep up to date) the projects,
 * tasks and notes in a Waypoint vault. It works on the vault files directly, so the app doesn't need
 * to be open, and the app picks up any changes through its file watcher.
 *
 * Runs over stdio. Started by Claude Code as:
 *   Waypoint.exe <path-to>/out/main/mcp.js        (with ELECTRON_RUN_AS_NODE=1, so no Node install needed)
 * Which vault: --vault <path>, else WAYPOINT_VAULT, else the vault Waypoint itself last opened.
 * Which project a session is in: the session's folder matched against each project's repo path.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { homedir } from 'os'
import { Vault } from '../main/vault'
import { listProjects, readProject } from '../main/projects'
import { listTasks } from '../main/tasks'
import { NotesIndex } from '../main/notesIndex'
import { TASK_STATUSES, TASK_STATUS_LABEL, type Project, type Task, type TaskStatus } from '@shared/types'
import { baseName } from '@shared/names'
import { splitFrontmatter } from '@shared/frontmatter'

const VERSION = '0.1.0'

// --- Which vault ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

/** Waypoint's own settings file, to follow whichever vault the app has open */
function appConfigVault(): string | undefined {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  try {
    return JSON.parse(readFileSync(join(appData, 'Waypoint', 'config.json'), 'utf8')).vaultPath
  } catch {
    return undefined
  }
}

function openVault(): Vault {
  const path = argValue('--vault') ?? process.env.WAYPOINT_VAULT ?? appConfigVault()
  if (!path || !existsSync(path)) {
    throw new Error('No Waypoint vault found. Open one in Waypoint, or start this server with --vault <folder>.')
  }
  return new Vault(path)
}

// --- Which project ---------------------------------------------------------------------------

const norm = (p: string) => resolve(p).toLowerCase().replace(/[\\/]+$/, '')

/** The project whose repo folder contains `folder` (deepest match wins) */
function projectForFolder(projects: Project[], folder: string): Project | null {
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
async function sessionFolders(server: McpServer): Promise<string[]> {
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
async function pickProject(server: McpServer, vault: Vault, arg?: string): Promise<Project> {
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

const today = () => new Date().toISOString().slice(0, 10)

function taskLine(t: Task): string {
  const bits = [`${t.id}`, t.title, `[${TASK_STATUS_LABEL[t.status]}]`]
  if (t.priority !== 'medium') bits.push(`priority ${t.priority}`)
  if (t.due) bits.push(t.due < today() && t.status !== 'done' ? `OVERDUE (due ${t.due})` : `due ${t.due}`)
  if (t.labels.length) bits.push(`labels: ${t.labels.join(', ')}`)
  return `- ${bits.join(' · ')}  (${t.path})`
}

function projectSummary(p: Project, tasks: Task[]): string {
  const mine = tasks.filter((t) => t.project === p.slug)
  const counts = TASK_STATUSES.map((s) => `${TASK_STATUS_LABEL[s]} ${mine.filter((t) => t.status === s).length}`).join(', ')
  const overdue = mine.filter((t) => t.status !== 'done' && t.due && t.due < today()).length
  return `${p.title} (slug: ${p.slug}, status: ${p.status})${p.tags.length ? ` tags: ${p.tags.join(', ')}` : ''}\n  tasks: ${counts}${overdue ? `, ${overdue} overdue` : ''}${p.repo.path ? `\n  repo: ${p.repo.path}` : ''}`
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true })

/** Run a tool body, turning thrown errors into readable tool errors */
const safely =
  <A>(fn: (args: A) => Promise<string>) =>
  async (args: A) => {
    try {
      return text(await fn(args))
    } catch (e) {
      return fail(e)
    }
  }

// --- Server ----------------------------------------------------------------------------------

const server = new McpServer(
  { name: 'waypoint', version: VERSION },
  {
    instructions:
      'Waypoint is the user\'s notes/projects/tasks app. Its vault is plain markdown: projects live in projects/<slug>/ ' +
      '(project.md = settings + overview, docs/, tasks/<KEY>-NNN.md, boards/). Start with waypoint_overview to see the ' +
      'project this session belongs to and what is open. Task statuses: backlog, todo, doing, done.'
  }
)
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }

server.registerTool(
  'waypoint_overview',
  {
    title: 'Waypoint overview',
    description:
      'Start here. The project this coding session belongs to (matched by repo folder) with its open tasks, plus a short list of all projects.',
    inputSchema: {},
    annotations: READ_ONLY
  },
  safely(async () => {
    const vault = openVault()
    const [projects, tasks] = await Promise.all([listProjects(vault), listTasks(vault)])
    let current: Project | null = null
    for (const folder of await sessionFolders(server)) current ??= projectForFolder(projects, folder)
    const lines = [`Vault: ${vault.root}`, '']
    if (current) {
      const open = tasks
        .filter((t) => t.project === current!.slug && t.status !== 'done' && t.status !== 'backlog')
        .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
      lines.push(`This session's project: ${projectSummary(current, tasks)}`)
      if (current.overview) lines.push('', 'Overview:', current.overview.slice(0, 1200))
      lines.push('', open.length ? 'Open tasks (To do / Doing):' : 'No open tasks.', ...open.map(taskLine))
    } else {
      lines.push(`This session's folder (${process.cwd()}) isn't the repo of any Waypoint project.`)
    }
    lines.push('', 'All projects:', ...projects.map((p) => `- ${projectSummary(p, tasks)}`))
    return lines.join('\n')
  })
)

server.registerTool(
  'waypoint_list_projects',
  {
    title: 'List projects',
    description: 'All Waypoint projects with status, tags, task counts and repo folder.',
    inputSchema: {},
    annotations: READ_ONLY
  },
  safely(async () => {
    const vault = openVault()
    const [projects, tasks] = await Promise.all([listProjects(vault), listTasks(vault)])
    return projects.length ? projects.map((p) => `- ${projectSummary(p, tasks)}`).join('\n') : 'No projects yet.'
  })
)

server.registerTool(
  'waypoint_get_project',
  {
    title: 'Get project',
    description:
      'A project\'s settings (status, tags, repo, links, bookmarks), overview, docs, boards and task counts. Defaults to this session\'s project.',
    inputSchema: { project: z.string().optional().describe('Project slug or title; omit for this session\'s project') },
    annotations: READ_ONLY
  },
  safely(async ({ project }: { project?: string }) => {
    const vault = openVault()
    const p = await readProject(vault, (await pickProject(server, vault, project)).slug)
    const tasks = await listTasks(vault, p.slug)
    const notes = await vault.notePaths(p.dir)
    const boards: string[] = []
    const walk = (nodes: Awaited<ReturnType<Vault['tree']>>) => {
      for (const n of nodes) n.type === 'dir' ? walk(n.children ?? []) : n.name.endsWith('.excalidraw') && boards.push(n.path)
    }
    walk(await vault.tree(p.dir))
    const docs = notes.filter((n) => !/\/tasks\//.test(n) && !n.endsWith('/project.md'))
    return [
      projectSummary(p, tasks),
      `created: ${p.created || 'unknown'} · task prefix: ${p.key}`,
      p.repo.remote ? `remote: ${p.repo.remote}` : '',
      p.links.length ? `links:\n${p.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')}` : '',
      p.bookmarks.length ? `bookmarks:\n${p.bookmarks.map((b) => `- ${b.title}: ${b.path}`).join('\n')}` : '',
      `\nOverview (${p.dir}/project.md):\n${p.overview || '(empty)'}`,
      `\nDocs and notes:\n${docs.map((d) => `- ${d}`).join('\n') || '(none)'}`,
      boards.length ? `\nBoards:\n${boards.map((b) => `- ${b}`).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  })
)

server.registerTool(
  'waypoint_list_tasks',
  {
    title: 'List tasks',
    description:
      'Tasks for a project (default: this session\'s) or every project. Done tasks are left out unless asked for. Sorted by due date.',
    inputSchema: {
      project: z.string().optional().describe('Project slug or title; omit for this session\'s project; "*" for all projects'),
      status: z.array(z.enum(TASK_STATUSES)).optional().describe('Only these statuses'),
      include_done: z.boolean().optional().describe('Include Done tasks (default false)'),
      due_within_days: z.number().int().optional().describe('Only tasks due within this many days (overdue included)')
    },
    annotations: READ_ONLY
  },
  safely(
    async (a: { project?: string; status?: TaskStatus[]; include_done?: boolean; due_within_days?: number }) => {
      const vault = openVault()
      const all = a.project === '*'
      const slug = all ? undefined : (await pickProject(server, vault, a.project)).slug
      let tasks = await listTasks(vault, slug)
      if (a.status?.length) tasks = tasks.filter((t) => a.status!.includes(t.status))
      else if (!a.include_done) tasks = tasks.filter((t) => t.status !== 'done')
      if (a.due_within_days !== undefined) {
        const limit = new Date(Date.now() + a.due_within_days * 86400000).toISOString().slice(0, 10)
        tasks = tasks.filter((t) => t.due && t.due <= limit)
      }
      tasks.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999') || x.id.localeCompare(y.id, undefined, { numeric: true }))
      if (!tasks.length) return 'No matching tasks.'
      return (all ? tasks.map((t) => taskLine(t).replace('- ', `- [${t.project}] `)) : tasks.map(taskLine)).join('\n')
    }
  )
)

server.registerTool(
  'waypoint_get_task',
  {
    title: 'Get task',
    description: 'One task in full (fields and description), by ID like WR-003 or by its path.',
    inputSchema: { task: z.string().describe('Task ID (e.g. WR-003) or vault path') },
    annotations: READ_ONLY
  },
  safely(async ({ task }: { task: string }) => {
    const vault = openVault()
    const tasks = await listTasks(vault)
    const t = tasks.find((x) => x.id.toLowerCase() === task.trim().toLowerCase() || x.path === task.trim())
    if (!t) throw new Error(`No task "${task}"`)
    const { body } = splitFrontmatter(await vault.read(t.path))
    return `${taskLine(t)}\nproject: ${t.project} · created ${t.created || '?'}${t.completed ? ` · completed ${t.completed}` : ''}\n\n${body.trim() || '(no description)'}`
  })
)

server.registerTool(
  'waypoint_read_note',
  {
    title: 'Read note',
    description: 'The full markdown of a note (any .md in the vault), by vault-relative path or by note name.',
    inputSchema: { note: z.string().describe('Vault-relative path (e.g. projects/x/docs/Plan.md) or a note name') },
    annotations: READ_ONLY
  },
  safely(async ({ note }: { note: string }) => {
    const vault = openVault()
    let path = note.trim().replace(/\\/g, '/')
    if (!vault.isNote(path)) {
      // A name rather than a path: find it
      const name = path.replace(/\.md$/i, '').toLowerCase()
      const matches = (await vault.notePaths()).filter((p) => baseName(p).toLowerCase() === name)
      if (matches.length > 1) throw new Error(`Several notes are called "${note}": ${matches.join(', ')}`)
      if (!matches[0]) throw new Error(`No note "${note}"`)
      path = matches[0]
    }
    return `${path}\n\n${await vault.read(path)}`
  })
)

server.registerTool(
  'waypoint_list_notes',
  {
    title: 'List notes',
    description: 'Notes under a folder (default: the whole vault), as vault-relative paths.',
    inputSchema: { folder: z.string().optional().describe('Vault-relative folder, e.g. projects/x/docs or notes') },
    annotations: READ_ONLY
  },
  safely(async ({ folder }: { folder?: string }) => {
    const vault = openVault()
    const notes = await vault.notePaths((folder ?? '').replace(/\\/g, '/').replace(/\/$/, ''))
    return notes.length ? notes.join('\n') : 'No notes there.'
  })
)

server.registerTool(
  'waypoint_search',
  {
    title: 'Search notes',
    description: 'Full-text search across notes (names, titles, text). Returns matching notes with the lines that matched.',
    inputSchema: {
      query: z.string().describe('Words to search for'),
      project: z.string().optional().describe('Limit to a project (slug or title)'),
      limit: z.number().int().optional().describe('Most notes to return (default 15)')
    },
    annotations: READ_ONLY
  },
  safely(async ({ query, project, limit }: { query: string; project?: string; limit?: number }) => {
    const vault = openVault()
    const index = new NotesIndex(vault)
    await index.rebuild()
    let hits = index.find(query)
    if (project) {
      const p = await pickProject(server, vault, project)
      hits = hits.filter((h) => h.path.startsWith(`${p.dir}/`))
    }
    hits = hits.slice(0, limit ?? 15)
    if (!hits.length) return `Nothing matches "${query}".`
    return hits.map((h) => `${h.path}\n${h.lines.map((l) => `  ${l.line}: ${l.text.trim()}`).join('\n')}`).join('\n\n')
  })
)

server.registerTool(
  'waypoint_read_inbox',
  {
    title: 'Read inbox',
    description: 'The inbox (inbox.md): quick captures waiting to be sorted into notes, projects or tasks.',
    inputSchema: {},
    annotations: READ_ONLY
  },
  safely(async () => {
    const vault = openVault()
    return vault.read('inbox.md').catch(() => 'The inbox is empty (no inbox.md).')
  })
)

server.connect(new StdioServerTransport()).catch((e) => {
  console.error('[waypoint-mcp]', e) // stderr: stdout is the protocol channel
  process.exit(1)
})
