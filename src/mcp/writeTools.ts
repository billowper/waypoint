/**
 * The connector's write tools: keep tasks, docs, the inbox and project settings up to date.
 * Nothing here deletes a file (Bill's rule). Every change is appended to .app/claude-log.jsonl.
 *
 * When Waypoint has the vault open, open editors are saved first (so an edit applies to what's on
 * screen and an unsaved editor doesn't overwrite it), and renames/moves are done by the app itself.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { existsSync, promises as fs } from 'fs'
import type { Vault } from '../main/vault'
import { createProject, readProject, saveProject } from '../main/projects'
import { createTask, updateTask } from '../main/tasks'
import { NotesIndex } from '../main/notesIndex'
import { moveIcons } from '../main/iconMap'
import { updateLinks } from '../main/relink'
import { askApp, type BridgeRequest } from '../main/bridge'
import { PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, type Priority, type ProjectSettings, type ProjectStatus, type TaskFields, type TaskStatus } from '@shared/types'
import { joinFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { findNote, findTask, openVault, pickProject, safely, taskLine, today } from './common'

const LOG = '.app/claude-log.jsonl'
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

interface LogEntry {
  tool: string
  action: 'created' | 'updated' | 'renamed' | 'moved' | 'appended'
  path: string
  from?: string
  summary: string
}

/** One JSON line per change, for the "Changed by Claude" feed (and for Bill to read) */
async function logChange(vault: Vault, e: LogEntry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...e, session: process.cwd() })
  await fs.mkdir(vault.abs('.app'), { recursive: true })
  await fs.appendFile(vault.abs(LOG), line + '\n', 'utf8')
}

/** Save the app's open editors before touching files (no-op when Waypoint isn't running) */
async function flushApp(vault: Vault) {
  await askApp(vault.root, { op: 'flush' }).catch(() => undefined)
}

/** Rename or move through the app when it's running; otherwise here, fixing links and icons the same way */
async function relocate(vault: Vault, req: Extract<BridgeRequest, { op: 'rename' | 'move' }>): Promise<string> {
  const viaApp = await askApp(vault.root, req)
  if (viaApp.running) return viaApp.result as string
  const index = new NotesIndex(vault)
  await index.rebuild()
  const before = index.paths()
  const to = req.op === 'rename' ? await vault.rename(req.path, req.name, true) : await vault.move(req.path, req.dest)
  if (to !== req.path) {
    await moveIcons(vault, req.path, to)
    await updateLinks(vault, index, before, req.path, to)
  }
  return to
}

/** Something Claude may rename, move or write into: inside the vault, not hidden/app data, not the vault root */
function checkPath(vault: Vault, rel: string, what = 'path'): string {
  const p = rel.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!p) throw new Error(`Give a ${what} inside the vault`)
  vault.abs(p) // throws if it escapes the vault
  if (p.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) {
    throw new Error(`${p} is app data, not something to change`)
  }
  return p
}

/** A project's docs folder (older projects use wiki/) */
function docsDir(vault: Vault, dir: string): string {
  return !existsSync(vault.abs(`${dir}/docs`)) && existsSync(vault.abs(`${dir}/wiki`)) ? `${dir}/wiki` : `${dir}/docs`
}

/** Insert `text` at the end of the section under `heading` (any level), adding the heading if missing */
function appendUnder(doc: string, heading: string, text: string): string {
  const lines = doc.split('\n')
  const want = heading.replace(/^#+\s*/, '').trim().toLowerCase()
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want)
  if (at === -1) return `${doc.replace(/\s*$/, '')}\n\n## ${heading.replace(/^#+\s*/, '').trim()}\n\n${text}\n`
  const level = /^#+/.exec(lines[at])![0].length
  let end = lines.length
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i])
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  // Back up over blank lines so the new text sits right after the section's last content
  let insert = end
  while (insert > at + 1 && lines[insert - 1].trim() === '') insert--
  lines.splice(insert, 0, ...(insert === at + 1 ? ['', text] : [text]))
  return lines.join('\n')
}

const dueSchema = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD, or "" to clear')
  .describe('Due date YYYY-MM-DD ("" clears it)')

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    'waypoint_create_task',
    {
      title: 'Create task',
      description: 'Add a task to a project (default: this session\'s). Gets the next ID, e.g. WR-004. Shows on the project\'s board straight away.',
      inputSchema: {
        title: z.string().min(1),
        project: z.string().optional().describe('Project slug or title; omit for this session\'s project'),
        status: z.enum(TASK_STATUSES).optional().describe('Default todo'),
        priority: z.enum(PRIORITIES).optional().describe('Default medium'),
        due: dueSchema.optional(),
        labels: z.array(z.string()).optional(),
        description: z.string().optional().describe('Markdown body: details, acceptance criteria, links')
      },
      annotations: WRITE
    },
    safely(async (a: { title: string; project?: string; status?: TaskStatus; priority?: Priority; due?: string; labels?: string[]; description?: string }) => {
      const vault = openVault()
      const p = await pickProject(server, vault, a.project)
      const rel = await createTask(vault, p.slug, { title: a.title, status: a.status, priority: a.priority, due: a.due, labels: a.labels })
      if (a.description?.trim()) {
        const { data } = splitFrontmatter(await vault.read(rel))
        await vault.write(rel, joinFrontmatter(data, `\n${a.description.trim()}\n`))
      }
      const t = await findTask(vault, rel)
      await logChange(vault, { tool: 'create_task', action: 'created', path: rel, summary: `${t.id} ${t.title}` })
      return `Created ${taskLine(t)}`
    })
  )

  server.registerTool(
    'waypoint_update_task',
    {
      title: 'Update task',
      description:
        'Change a task: move it between statuses (backlog, todo, doing, done), retitle, reprioritise, set due date or labels, ' +
        'replace its description, or add a dated progress note. Only the fields given change.',
      inputSchema: {
        task: z.string().describe('Task ID (e.g. WR-003) or path'),
        status: z.enum(TASK_STATUSES).optional(),
        title: z.string().min(1).optional(),
        priority: z.enum(PRIORITIES).optional(),
        due: dueSchema.optional(),
        labels: z.array(z.string()).optional().describe('Replaces the labels'),
        description: z.string().optional().describe('Replaces the whole description (markdown body)'),
        add_note: z.string().optional().describe('Appended to the description as a dated progress note')
      },
      annotations: WRITE
    },
    safely(async (a: { task: string; status?: TaskStatus; title?: string; priority?: Priority; due?: string; labels?: string[]; description?: string; add_note?: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const before = await findTask(vault, a.task)
      const patch: Partial<TaskFields> = {}
      for (const k of ['status', 'title', 'priority', 'due', 'labels'] as const) if (a[k] !== undefined) (patch as any)[k] = a[k]
      await updateTask(vault, before.path, patch)
      if (a.description !== undefined || a.add_note?.trim()) {
        const { data, body } = splitFrontmatter(await vault.read(before.path))
        let next = a.description !== undefined ? a.description.trim() : body.trim()
        if (a.add_note?.trim()) next = appendUnder(next, 'Progress', `- ${today()}: ${a.add_note.trim().replace(/\n/g, '\n  ')}`).trim()
        await vault.write(before.path, joinFrontmatter(data, `\n${next}\n`))
      }
      const after = await findTask(vault, before.path)
      const what = [
        before.status !== after.status ? `${before.status} → ${after.status}` : '',
        ...(['title', 'priority', 'due'] as const).filter((k) => before[k] !== after[k]).map((k) => `${k}: ${after[k] || '(none)'}`),
        a.labels ? 'labels' : '',
        a.description !== undefined ? 'description' : '',
        a.add_note ? 'progress note' : ''
      ].filter(Boolean)
      await logChange(vault, { tool: 'update_task', action: 'updated', path: after.path, summary: `${after.id}: ${what.join(', ') || 'no change'}` })
      return `Updated ${taskLine(after)}`
    })
  )

  server.registerTool(
    'waypoint_create_note',
    {
      title: 'Create note',
      description:
        'Create a markdown note or doc. Goes in `folder` if given, else the project\'s docs folder (named or this session\'s project), ' +
        'else notes/. A taken name gets a number. Link other notes with [[Note name]].',
      inputSchema: {
        name: z.string().min(1).describe('Note name (becomes the file name and "# Title")'),
        content: z.string().optional().describe('Markdown body (without the "# Title" line)'),
        folder: z.string().optional().describe('Vault-relative folder, e.g. notes/meetings or projects/x/docs/api'),
        project: z.string().optional().describe('Put it in this project\'s docs folder')
      },
      annotations: WRITE
    },
    safely(async (a: { name: string; content?: string; folder?: string; project?: string }) => {
      const vault = openVault()
      let folder: string
      if (a.folder) folder = checkPath(vault, a.folder, 'folder')
      else {
        const p = await pickProject(server, vault, a.project).catch((e) => {
          if (a.project) throw e
          return null
        })
        folder = p ? docsDir(vault, p.dir) : 'notes'
      }
      const rel = await vault.createNote(folder, a.name)
      if (a.content?.trim()) {
        const body = a.content.trim().replace(/^#\s+[^\n]*\n+/, '') // the title line is ours
        await vault.write(rel, `${(await vault.read(rel)).trimEnd()}\n\n${body}\n`)
      }
      await logChange(vault, { tool: 'create_note', action: 'created', path: rel, summary: a.name })
      return `Created ${rel}`
    })
  )

  server.registerTool(
    'waypoint_edit_note',
    {
      title: 'Edit note',
      description:
        'Change part of a note (also task files and project.md) by exact text replacement. Each old_text must appear exactly once; ' +
        'if any edit doesn\'t match, nothing is changed. Read the note first.',
      inputSchema: {
        note: z.string().describe('Vault-relative path or note name'),
        edits: z
          .array(z.object({ old_text: z.string().min(1), new_text: z.string() }))
          .min(1)
          .describe('Applied in order')
      },
      annotations: WRITE
    },
    safely(async (a: { note: string; edits: { old_text: string; new_text: string }[] }) => {
      const vault = openVault()
      await flushApp(vault)
      const path = await findNote(vault, a.note)
      checkPath(vault, path)
      // Notes may have Windows line endings; match against \n and write back what the file used
      const original = await vault.read(path)
      const crlf = original.includes('\r\n')
      let doc = crlf ? original.replace(/\r\n/g, '\n') : original
      a.edits.forEach((e, i) => {
        const old = e.old_text.replace(/\r\n/g, '\n')
        const count = doc.split(old).length - 1
        if (count !== 1) throw new Error(`Edit ${i + 1}: old_text ${count ? `appears ${count} times; include more context` : 'not found'}. Nothing was changed.`)
        doc = doc.replace(old, () => e.new_text.replace(/\r\n/g, '\n'))
      })
      await vault.write(path, crlf ? doc.replace(/\n/g, '\r\n') : doc)
      await logChange(vault, { tool: 'edit_note', action: 'updated', path, summary: `${a.edits.length} edit${a.edits.length > 1 ? 's' : ''}` })
      return `Edited ${path}`
    })
  )

  server.registerTool(
    'waypoint_append_to_note',
    {
      title: 'Append to note',
      description: 'Add text to the end of a note, or to the end of the section under a heading (the heading is added if missing).',
      inputSchema: {
        note: z.string().describe('Vault-relative path or note name'),
        text: z.string().min(1).describe('Markdown to add'),
        under_heading: z.string().optional().describe('e.g. "Decisions"; omit to append at the end')
      },
      annotations: WRITE
    },
    safely(async (a: { note: string; text: string; under_heading?: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const path = await findNote(vault, a.note)
      checkPath(vault, path)
      const doc = (await vault.read(path)).replace(/\r\n/g, '\n')
      const text = a.text.trim()
      const next = a.under_heading ? appendUnder(doc, a.under_heading, text) : `${doc.replace(/\s*$/, '')}\n\n${text}\n`
      await vault.write(path, next.endsWith('\n') ? next : next + '\n')
      await logChange(vault, { tool: 'append_to_note', action: 'appended', path, summary: a.under_heading ? `under "${a.under_heading}"` : 'at the end' })
      return `Appended to ${path}`
    })
  )

  server.registerTool(
    'waypoint_replace_note',
    {
      title: 'Rewrite note',
      description:
        'Replace a note\'s whole content. Use only for a full rewrite the user asked for; prefer waypoint_edit_note or waypoint_append_to_note. ' +
        'The old text stays in the vault\'s git history.',
      inputSchema: {
        note: z.string().describe('Vault-relative path or note name'),
        content: z.string().min(1).describe('The complete new markdown, including any "# Title" line and frontmatter')
      },
      annotations: { ...WRITE, destructiveHint: true }
    },
    safely(async (a: { note: string; content: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const path = await findNote(vault, a.note)
      checkPath(vault, path)
      await vault.write(path, a.content.endsWith('\n') ? a.content : a.content + '\n')
      await logChange(vault, { tool: 'replace_note', action: 'updated', path, summary: 'rewritten' })
      return `Rewrote ${path}`
    })
  )

  server.registerTool(
    'waypoint_add_to_inbox',
    {
      title: 'Add to inbox',
      description: 'Quick-capture a thought, idea or follow-up into the inbox (inbox.md) for the user to sort later.',
      inputSchema: { text: z.string().min(1) },
      annotations: WRITE
    },
    safely(async ({ text }: { text: string }) => {
      const vault = openVault()
      await flushApp(vault)
      await vault.appendToInbox(text)
      await logChange(vault, { tool: 'add_to_inbox', action: 'appended', path: 'inbox.md', summary: text.trim().slice(0, 80) })
      return 'Added to the inbox.'
    })
  )

  server.registerTool(
    'waypoint_create_project',
    {
      title: 'Create project',
      description: 'Create a project (projects/<slug>/ with docs, tasks and boards). Optionally link a code repo folder so sessions there find it.',
      inputSchema: {
        name: z.string().min(1),
        repo_path: z.string().optional().describe('Local folder of the project\'s code, e.g. C:\\Users\\me\\source\\repos\\x'),
        overview: z.string().optional().describe('What the project is for (markdown)')
      },
      annotations: WRITE
    },
    safely(async (a: { name: string; repo_path?: string; overview?: string }) => {
      const vault = openVault()
      const slug = await createProject(vault, a.name)
      if (a.repo_path || a.overview) await applyProjectChanges(vault, slug, { repo_path: a.repo_path, overview: a.overview })
      const p = await readProject(vault, slug)
      await logChange(vault, { tool: 'create_project', action: 'created', path: `${p.dir}/project.md`, summary: p.title })
      return `Created project ${p.title} (slug ${slug}, task prefix ${p.key}) at ${p.dir}`
    })
  )

  server.registerTool(
    'waypoint_update_project',
    {
      title: 'Update project',
      description:
        'Change a project\'s settings (status, title, tags, repo, links, bookmarks) or its overview text. Only the fields given change; ' +
        'lists given replace the old list. Default: this session\'s project.',
      inputSchema: {
        project: z.string().optional().describe('Project slug or title; omit for this session\'s project'),
        title: z.string().min(1).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        tags: z.array(z.string()).optional(),
        repo_path: z.string().optional(),
        repo_remote: z.string().optional(),
        links: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
        bookmarks: z.array(z.object({ title: z.string(), path: z.string() })).optional(),
        overview: z.string().optional().describe('Replaces the overview (project.md body under its title)')
      },
      annotations: WRITE
    },
    safely(async (a: ProjectChanges & { project?: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const p = await pickProject(server, vault, a.project)
      const changed = await applyProjectChanges(vault, p.slug, a)
      await logChange(vault, { tool: 'update_project', action: 'updated', path: `${p.dir}/project.md`, summary: changed.join(', ') || 'no change' })
      return changed.length ? `Updated ${p.title}: ${changed.join(', ')}` : 'Nothing to change.'
    })
  )

  server.registerTool(
    'waypoint_rename',
    {
      title: 'Rename',
      description: 'Rename a note, doc, board or folder. [[Links]] to it across the vault are updated, and open tabs in Waypoint follow it.',
      inputSchema: {
        path: z.string().describe('Vault-relative path of the file or folder'),
        new_name: z.string().min(1).describe('New name (the extension is kept)')
      },
      annotations: WRITE
    },
    safely(async (a: { path: string; new_name: string }) => {
      const vault = openVault()
      const from = guardMovable(vault, a.path)
      const to = await relocate(vault, { op: 'rename', path: from, name: a.new_name })
      if (to === from) return `Nothing to do: ${from} already has that name.`
      await logChange(vault, { tool: 'rename', action: 'renamed', path: to, from, summary: `${from} → ${to}` })
      return `Renamed ${from} → ${to} (links updated)`
    })
  )

  server.registerTool(
    'waypoint_move',
    {
      title: 'Move',
      description: 'Move a note, doc, board or folder into another folder (created if needed). [[Links]] are updated; open tabs follow.',
      inputSchema: {
        path: z.string().describe('Vault-relative path of the file or folder'),
        to_folder: z.string().describe('Vault-relative destination folder, e.g. projects/x/docs/archive')
      },
      annotations: WRITE
    },
    safely(async (a: { path: string; to_folder: string }) => {
      const vault = openVault()
      const from = guardMovable(vault, a.path)
      const dest = checkPath(vault, a.to_folder, 'folder')
      const to = await relocate(vault, { op: 'move', path: from, dest })
      if (to === from) return `Nothing to do: ${from} is already there.`
      await logChange(vault, { tool: 'move', action: 'moved', path: to, from, summary: `${from} → ${to}` })
      return `Moved ${from} → ${to} (links updated)`
    })
  )
}

/** Paths whose name the project model depends on can't be renamed or moved */
function guardMovable(vault: Vault, rel: string): string {
  const p = checkPath(vault, rel)
  if (!existsSync(vault.abs(p))) throw new Error(`Nothing at ${p}`)
  if (p === 'projects' || p === 'notes' || p === 'inbox.md') throw new Error(`${p} is part of the vault layout and stays where it is`)
  if (/^projects\/[^/]+\/(project\.md|tasks)$/i.test(p)) throw new Error(`${p} is part of the project and stays where it is`)
  return p
}

interface ProjectChanges {
  title?: string
  status?: ProjectStatus
  tags?: string[]
  repo_path?: string
  repo_remote?: string
  links?: { title: string; url: string }[]
  bookmarks?: { title: string; path: string }[]
  overview?: string
}

/** Apply settings and overview changes to project.md; returns what changed, for the log */
async function applyProjectChanges(vault: Vault, slug: string, a: ProjectChanges): Promise<string[]> {
  const p = await readProject(vault, slug)
  const s: ProjectSettings = {
    title: a.title?.trim() || p.title,
    status: a.status ?? p.status,
    key: p.key,
    tags: a.tags ?? p.tags,
    created: p.created,
    repo: { path: a.repo_path ?? p.repo.path, remote: a.repo_remote ?? p.repo.remote },
    links: a.links ?? p.links,
    bookmarks: a.bookmarks ?? p.bookmarks,
    colors: p.colors
  }
  const changed: string[] = (['title', 'status', 'tags', 'links', 'bookmarks'] as const).filter((k) => a[k] !== undefined && JSON.stringify(a[k]) !== JSON.stringify(p[k]))
  if (a.repo_path !== undefined && a.repo_path !== p.repo.path) changed.push('repo path')
  if (a.repo_remote !== undefined && a.repo_remote !== p.repo.remote) changed.push('repo remote')
  await saveProject(vault, slug, s)
  const rel = `${p.dir}/project.md`
  const { data, body } = splitFrontmatter(await vault.read(rel))
  let nextBody = body
  if (a.title && a.title.trim() !== p.title) nextBody = nextBody.replace(/^(\s*)#[ \t]+.*$/m, `$1# ${s.title}`)
  if (a.overview !== undefined) {
    nextBody = `# ${s.title}\n\n${a.overview.trim().replace(/^#\s+[^\n]*\n+/, '')}\n`
    changed.push('overview')
  }
  if (nextBody !== body) await vault.write(rel, joinFrontmatter(data, nextBody))
  return changed
}
