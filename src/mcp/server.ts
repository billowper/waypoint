/**
 * Waypoint's MCP server: lets Claude Code sessions read and keep up to date the projects,
 * tasks and notes in a Waypoint vault. It works on the vault files directly, so the app doesn't need
 * to be open; when it is, renames/moves and saves go through it (see src/main/bridge.ts).
 *
 * Runs over stdio. Started by Claude Code as:
 *   Waypoint.exe <path-to>/out/main/mcp.js        (with ELECTRON_RUN_AS_NODE=1, so no Node install needed)
 * Which vault: --vault <path>, else WAYPOINT_VAULT, else the vault Waypoint itself last opened.
 * Which project a session is in: the session's folder matched against each project's repo path.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Vault } from '../main/vault'
import { listProjects, readProject } from '../main/projects'
import { listTasks } from '../main/tasks'
import { readLinked, sourceOf } from '../main/linkedDocs'
import { NotesIndex } from '../main/notesIndex'
import { CLAUDE_LABEL, TASK_STATUSES, isForClaude, type Project, type TaskStatus } from '@shared/types'
import { splitFrontmatter } from '@shared/frontmatter'
import { IDEAS_DIR } from '@shared/names'
import { findNote, findTask, linkedNoteText, openVault, pickProject, projectForFolder, projectSummary, safely, sessionFolders, taskLine } from './common'
import { registerWriteTools } from './writeTools'
import { memoryPath, readMemory, recentSessions, registerMemoryTools } from './memoryTools'

const VERSION = '0.4.0'

// --- Server ----------------------------------------------------------------------------------

const server = new McpServer(
  { name: 'waypoint', version: VERSION },
  {
    instructions:
      'Waypoint is the user\'s notes/projects/tasks app. Its vault is plain markdown: projects live in projects/<slug>/ ' +
      '(project.md = settings + overview, docs/, tasks/<KEY>-NNN.md, boards/). Start with waypoint_overview to see the ' +
      'project this session belongs to and what is open. Task statuses: backlog, todo, doing, done. ' +
      'You can also keep things up to date: move tasks as work progresses (doing when you start, done when finished), ' +
      'tasks labelled "claude" are the ones the user assigned to you; ' +
      'add tasks for follow-ups, and record decisions and docs in the project\'s docs. Edit notes with small exact edits ' +
      'rather than rewrites. Keep a memory per project: save durable learnings with waypoint_remember, and after a meaningful ' +
      'piece of work add a short entry with waypoint_log_session. Nothing can be deleted through these tools; every change is ' +
      'logged for the user.'
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
      // Tasks the user assigned to Claude (the "claude" label), whatever column they're in
      const yours = tasks.filter((t) => t.project === current!.slug && t.status !== 'done' && isForClaude(t))
      if (yours.length) lines.push('', `Assigned to you (label "${CLAUDE_LABEL}"):`, ...yours.map(taskLine))
      // Claude's own notes for the project (M4): memory in full while it's short, plus the last session
      const memory = (await readMemory(vault, current)).trim()
      const last = await recentSessions(vault, current, 1)
      if (memory) {
        const shown = memory.length > 3000 ? `${memory.slice(0, 3000)}\n… (more: waypoint_read_memory)` : memory
        lines.push('', `Your memory for this project (${memoryPath(current)}):`, shown)
      }
      if (last[0]) lines.push('', 'Last session:', last[0])
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
    const docs = notes.filter((n) => !/\/(tasks|claude)\//.test(n) && !n.endsWith('/project.md'))
    // Linked docs say which repo file they show
    const shows = new Map<string, string>()
    for (const d of docs) {
      const source = sourceOf(await vault.read(d).catch(() => ''))
      if (source) shows.set(d, source)
    }
    return [
      projectSummary(p, tasks),
      `created: ${p.created || 'unknown'} · task prefix: ${p.key}`,
      p.repo.remote ? `remote: ${p.repo.remote}` : '',
      p.links.length ? `links:\n${p.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')}` : '',
      p.bookmarks.length ? `bookmarks:\n${p.bookmarks.map((b) => `- ${b.title}: ${b.path}`).join('\n')}` : '',
      `\nOverview (${p.dir}/project.md):\n${p.overview || '(empty)'}`,
      `\nDocs and notes:\n${docs.map((d) => `- ${d}${shows.has(d) ? ` (linked doc, shows ${shows.get(d)} from the repo)` : ''}`).join('\n') || '(none)'}`,
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
      label: z.string().optional().describe('Only tasks with this label, e.g. "claude" for the ones assigned to you'),
      include_done: z.boolean().optional().describe('Include Done tasks (default false)'),
      due_within_days: z.number().int().optional().describe('Only tasks due within this many days (overdue included)')
    },
    annotations: READ_ONLY
  },
  safely(
    async (a: { project?: string; status?: TaskStatus[]; label?: string; include_done?: boolean; due_within_days?: number }) => {
      const vault = openVault()
      const all = a.project === '*'
      const slug = all ? undefined : (await pickProject(server, vault, a.project)).slug
      let tasks = await listTasks(vault, slug)
      if (a.status?.length) tasks = tasks.filter((t) => a.status!.includes(t.status))
      else if (!a.include_done) tasks = tasks.filter((t) => t.status !== 'done')
      const label = a.label?.trim().toLowerCase()
      if (label) tasks = tasks.filter((t) => t.labels.some((l) => l.trim().toLowerCase() === label))
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
    const t = await findTask(vault, task)
    const { body } = splitFrontmatter(await vault.read(t.path))
    return `${taskLine(t)}\nproject: ${t.project} · created ${t.created || '?'}${t.completed ? ` · completed ${t.completed}` : ''}\n\n${body.trim() || '(no description)'}`
  })
)

server.registerTool(
  'waypoint_read_note',
  {
    title: 'Read note',
    description:
      'The full markdown of a note (any .md in the vault), by vault-relative path or by note name. ' +
      'A linked doc returns the repo file it shows, marked as linked and read-only.',
    inputSchema: { note: z.string().describe('Vault-relative path (e.g. projects/x/docs/Plan.md) or a note name') },
    annotations: READ_ONLY
  },
  safely(async ({ note }: { note: string }) => {
    const vault = openVault()
    const path = await findNote(vault, note)
    const linked = await readLinked(vault, path)
    return linked ? linkedNoteText(path, linked) : `${path}\n\n${await vault.read(path)}`
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
  'waypoint_list_ideas',
  {
    title: 'List ideas',
    description: 'The notes in ideas/: quick captures, one note each, waiting to be sorted into notes, projects or tasks.',
    inputSchema: {},
    annotations: READ_ONLY
  },
  safely(async () => {
    const ideas = await openVault().notePaths(IDEAS_DIR)
    return ideas.length ? ideas.join('\n') : 'No ideas yet.'
  })
)

registerWriteTools(server)
registerMemoryTools(server)

server.connect(new StdioServerTransport()).catch((e) => {
  console.error('[waypoint-mcp]', e) // stderr: stdout is the protocol channel
  process.exit(1)
})
