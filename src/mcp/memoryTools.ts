/**
 * Claude's notes for a project (M4), kept as plain notes in projects/<slug>/claude/:
 *   Memory.md              durable things worth knowing next time (conventions, decisions, gotchas)
 *   sessions/YYYY-MM-DD.md  a dated entry per piece of work: what was done, what's next
 * Bill can read and edit both like any other note. The folder only appears once Claude writes to it.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { promises as fs } from 'fs'
import type { Vault } from '../main/vault'
import type { Project } from '@shared/types'
import { appendUnder, flushApp, logChange } from './writeTools'
import { openVault, pickProject, safely } from './common'

const MEMORY_INTRO =
  'What Claude has learned about this project, read at the start of each session. Edit or prune freely.\n'

export const claudeDir = (p: Project) => `${p.dir}/claude`
export const memoryPath = (p: Project) => `${claudeDir(p)}/Memory.md`
const sessionsDir = (p: Project) => `${claudeDir(p)}/sessions`

/** Local date and time, so entries match Bill's day rather than UTC */
function localStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** The memory note's text, or '' when there isn't one yet */
export async function readMemory(vault: Vault, p: Project): Promise<string> {
  return vault.read(memoryPath(p)).catch(() => '')
}

/** Session log files, newest first */
async function sessionFiles(vault: Vault, p: Project): Promise<string[]> {
  return (await vault.notePaths(sessionsDir(p)).catch(() => [] as string[])).sort().reverse()
}

/** The newest `count` session entries ("## time · title" blocks), newest first */
export async function recentSessions(vault: Vault, p: Project, count: number): Promise<string[]> {
  const out: string[] = []
  for (const file of await sessionFiles(vault, p)) {
    const date = file.slice(file.lastIndexOf('/') + 1, -3)
    const text = (await vault.read(file).catch(() => '')).replace(/\r\n/g, '\n')
    const entries = text.split(/\n(?=## )/).filter((e) => e.startsWith('## ')).reverse()
    for (const e of entries) {
      out.push(`${date} ${e.slice(3).trim()}`)
      if (out.length >= count) return out
    }
  }
  return out
}

const list = (title: string, items?: string[]) =>
  items?.filter((i) => i.trim()).length ? `\n**${title}**\n${items.filter((i) => i.trim()).map((i) => `- ${i.trim()}`).join('\n')}\n` : ''

export function registerMemoryTools(server: McpServer) {
  server.registerTool(
    'waypoint_read_memory',
    {
      title: 'Read project memory',
      description:
        'Your notes for this project (claude/Memory.md) plus the latest session log entries. waypoint_overview already includes ' +
        'a summary; use this for the full text or older sessions.',
      inputSchema: {
        project: z.string().optional().describe('Project slug or title; omit for this session\'s project'),
        sessions: z.number().int().min(0).max(50).optional().describe('How many recent session entries (default 5)')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    safely(async (a: { project?: string; sessions?: number }) => {
      const vault = openVault()
      const p = await pickProject(server, vault, a.project)
      const memory = await readMemory(vault, p)
      const sessions = await recentSessions(vault, p, a.sessions ?? 5)
      return [
        memory ? `${memoryPath(p)}\n\n${memory.trim()}` : `No memory yet for ${p.title} (waypoint_remember starts it).`,
        '',
        sessions.length ? `Recent sessions (newest first):\n\n${sessions.join('\n\n')}` : 'No session log yet.'
      ].join('\n')
    })
  )

  server.registerTool(
    'waypoint_remember',
    {
      title: 'Remember',
      description:
        'Save something worth knowing next time to the project\'s memory (claude/Memory.md): a convention, decision, gotcha, ' +
        'command or preference. One short point per call; check the memory first so you don\'t repeat it. Not for progress ' +
        'updates (use waypoint_log_session) or task details (use the task).',
      inputSchema: {
        text: z.string().min(1).describe('The point, in a sentence or two'),
        section: z.string().optional().describe('Heading to file it under, e.g. "Conventions", "Decisions", "Gotchas" (default "Notes")'),
        project: z.string().optional().describe('Project slug or title; omit for this session\'s project')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    safely(async (a: { text: string; section?: string; project?: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const p = await pickProject(server, vault, a.project)
      const path = memoryPath(p)
      await fs.mkdir(vault.abs(claudeDir(p)), { recursive: true })
      const old = await vault.read(path).catch(() => null)
      const current = (old ?? '').replace(/\r\n/g, '\n') || `# Memory\n\n${MEMORY_INTRO}`
      const point = `- ${a.text.trim().replace(/\n+/g, ' ')}`
      await vault.write(path, appendUnder(current, a.section?.trim() || 'Notes', point).replace(/\n*$/, '\n'))
      await logChange(vault, { tool: 'remember', action: 'appended', path, summary: a.text.trim().slice(0, 80) }, old)
      return `Remembered in ${path}`
    })
  )

  server.registerTool(
    'waypoint_log_session',
    {
      title: 'Log session',
      description:
        'Add an entry to the project\'s session log (claude/sessions/<date>.md) after a meaningful piece of work: what was done, ' +
        'what\'s next, which tasks. Keep it short; it\'s for the user and for the next session to pick up from.',
      inputSchema: {
        title: z.string().min(1).describe('A few words, e.g. "Header layout fix"'),
        summary: z.string().optional().describe('A sentence or two of context'),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional().describe('Follow-ups or where to pick up'),
        tasks: z.array(z.string()).optional().describe('Task IDs worked on, e.g. ["WR-003"]'),
        project: z.string().optional().describe('Project slug or title; omit for this session\'s project')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    safely(async (a: { title: string; summary?: string; done?: string[]; next?: string[]; tasks?: string[]; project?: string }) => {
      const vault = openVault()
      await flushApp(vault)
      const p = await pickProject(server, vault, a.project)
      const { date, time } = localStamp()
      const path = `${sessionsDir(p)}/${date}.md`
      await fs.mkdir(vault.abs(sessionsDir(p)), { recursive: true })
      const old = await vault.read(path).catch(() => null)
      const current = (old ?? `# Sessions ${date}\n`).replace(/\r\n/g, '\n')
      const entry = [
        `## ${time} · ${a.title.trim()}\n`,
        a.summary?.trim() ? `\n${a.summary.trim()}\n` : '',
        list('Done', a.done),
        list('Next', a.next),
        a.tasks?.length ? `\nTasks: ${a.tasks.join(', ')}\n` : ''
      ].join('')
      await vault.write(path, `${current.trimEnd()}\n\n${entry.trimEnd()}\n`)
      await logChange(vault, { tool: 'log_session', action: 'appended', path, summary: a.title.trim() }, old)
      return `Logged in ${path}`
    })
  )
}
