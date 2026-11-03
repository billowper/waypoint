import { app, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { ClaudeStatus } from '@shared/types'

/**
 * Optional Claude Code integration (M3). Nothing in Waypoint depends on it: these helpers only register
 * the connector (src/mcp) with Claude Code, write per-repo instructions, and open Claude Code in a folder.
 * If Claude Code isn't installed they report that and do nothing.
 */

const run = promisify(execFile)
/** Dev builds register under their own name so they never replace the installed app's connector */
const SERVER = app.isPackaged ? 'waypoint' : 'waypoint-dev'
const START = '<!-- waypoint:start -->'
const END = '<!-- waypoint:end -->'
/** Testing only: point Claude Code's config somewhere else (Electron won't start with a different USERPROFILE) */
const HOME = process.env.WAYPOINT_CLAUDE_HOME || homedir()
const cliOpts = { windowsHide: true, env: { ...process.env, USERPROFILE: HOME } }

/** claude.exe on PATH, or where its installer puts it */
async function findCli(): Promise<string | null> {
  try {
    const { stdout } = await run('where.exe', ['claude'], { windowsHide: true })
    const first = stdout.split(/\r?\n/).find((l) => /\.(exe|cmd)$/i.test(l.trim()))
    if (first) return first.trim()
  } catch {
    /* not on PATH */
  }
  const local = join(homedir(), '.local', 'bin', 'claude.exe')
  return existsSync(local) ? local : null
}

/** How Claude Code should start the connector: this exe in node mode, running out/main/mcp.js */
function serverConfig() {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [join(app.getAppPath(), 'out', 'main', 'mcp.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

/** The connector entry in Claude Code's user config (~/.claude.json), read only */
async function registered(): Promise<{ command?: string; args?: string[] } | null> {
  try {
    const cfg = JSON.parse(await fs.readFile(join(HOME, '.claude.json'), 'utf8'))
    return cfg?.mcpServers?.[SERVER] ?? null
  } catch {
    return null
  }
}

const instructionsFile = (repo: string) => join(repo, 'CLAUDE.local.md')

export async function claudeStatus(repo?: string): Promise<ClaudeStatus> {
  const [cli, entry] = await Promise.all([findCli(), registered()])
  const want = serverConfig()
  const connector = !entry
    ? 'missing'
    : entry.command?.toLowerCase() === want.command.toLowerCase() && entry.args?.[0]?.toLowerCase() === want.args[0].toLowerCase()
      ? 'connected'
      : 'outdated' // e.g. Waypoint reinstalled somewhere else
  let instructions = false
  if (repo && existsSync(repo)) {
    instructions = (await fs.readFile(instructionsFile(repo), 'utf8').catch(() => '')).includes(START)
  }
  return { cli: !!cli, connector, instructions, serverName: SERVER }
}

/** Register (or re-point) the connector for every Claude Code session: the desktop app's Code tab and the terminal */
export async function connectClaude(): Promise<void> {
  const cli = await findCli()
  if (!cli) throw new Error('Claude Code isn\'t installed (no "claude" command found).')
  if (await registered()) await run(cli, ['mcp', 'remove', SERVER, '--scope', 'user'], cliOpts).catch(() => undefined)
  await run(cli, ['mcp', 'add-json', SERVER, JSON.stringify(serverConfig()), '--scope', 'user'], cliOpts)
}

export async function disconnectClaude(): Promise<void> {
  const cli = await findCli()
  if (!cli) throw new Error('Claude Code isn\'t installed (no "claude" command found).')
  await run(cli, ['mcp', 'remove', SERVER, '--scope', 'user'], cliOpts)
}

function instructionsBlock(title: string, slug: string): string {
  return [
    START,
    '## Waypoint project',
    '',
    `This repo is the code for the Waypoint project **${title}** (slug \`${slug}\`). Its tasks, docs and notes live in`,
    'the user\'s Waypoint vault and are reached through the `waypoint` MCP tools (only when those tools are available;',
    'if they aren\'t, carry on without them).',
    '',
    '- At the start of a session, call `waypoint_overview`: open tasks, your memory for this project and the last session.',
    '- When you start on a task, move it to `doing`; when it\'s finished, move it to `done` with a short progress note.',
    '- Add tasks for follow-ups and bugs you find but don\'t fix now.',
    '- Record decisions, designs and how-tos in the project\'s docs (small edits, not rewrites).',
    '- Save things worth knowing next time (conventions, gotchas, preferences) with `waypoint_remember`.',
    '- After a meaningful piece of work, add a short entry with `waypoint_log_session` (done, next, tasks).',
    '- Never try to delete anything in the vault. Ask the user before big reorganisations (renames/moves).',
    '',
    'This section is managed by Waypoint (Project page → Claude Code). Notes of your own can go outside it.',
    END
  ].join('\n')
}

/**
 * Write (or refresh) Waypoint's section of the repo's CLAUDE.local.md, keeping anything else in the file.
 * CLAUDE.local.md is personal, so it's also listed in the repo's .git/info/exclude (never committed).
 */
export async function writeInstructions(repo: string, title: string, slug: string): Promise<void> {
  if (!existsSync(repo)) throw new Error(`The repo folder doesn't exist: ${repo}`)
  const file = instructionsFile(repo)
  const current = await fs.readFile(file, 'utf8').catch(() => '')
  const block = instructionsBlock(title, slug)
  const at = current.indexOf(START)
  const end = current.indexOf(END)
  const next =
    at !== -1 && end > at
      ? current.slice(0, at) + block + current.slice(end + END.length)
      : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  await fs.writeFile(file, next, 'utf8')
  const exclude = join(repo, '.git', 'info', 'exclude')
  if (existsSync(join(repo, '.git'))) {
    const ex = await fs.readFile(exclude, 'utf8').catch(() => '')
    if (!ex.split(/\r?\n/).some((l) => l.trim() === 'CLAUDE.local.md' || l.trim() === '/CLAUDE.local.md')) {
      await fs.mkdir(join(repo, '.git', 'info'), { recursive: true })
      await fs.writeFile(exclude, `${ex.trimEnd()}${ex.trim() ? '\n' : ''}/CLAUDE.local.md\n`, 'utf8')
    }
  }
}

/**
 * What a task's session starts with. Plain characters only, because the terminal route passes it through
 * command lines (wt.exe splits on ";", cmd.exe acts on & | % and quotes) and task titles can hold anything.
 */
export function taskPrompt(id: string, title: string): string {
  const plain = (s: string) => s.replace(/[^\p{L}\p{N} .,_-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `Work on Waypoint task ${plain(id)}: ${plain(title)}. Read it with waypoint_get_task, move it to doing, do the work, then move it to done with a short progress note.`
}

/** A new Code-tab session in the Claude desktop app, in the repo folder. The app asks to confirm the folder and never sends the prompt itself */
export async function openInClaudeApp(repo: string, prompt: string): Promise<void> {
  await shell.openExternal(`claude://code/new?folder=${encodeURIComponent(repo)}&q=${encodeURIComponent(prompt)}`)
}

/** Claude Code in a terminal at the repo folder (Windows Terminal if there, else a console window); a prompt starts work straight away */
export async function openInClaudeTerminal(repo: string, prompt?: string): Promise<void> {
  const cli = await findCli()
  if (!cli) throw new Error('Claude Code isn\'t installed (no "claude" command found).')
  // wt.exe is a Store app alias: "where" finds it, existsSync can't see it
  const hasWt = await run('where.exe', ['wt'], { windowsHide: true }).then(() => true, () => false)
  const q = (s: string) => `"${s}"`
  const child = hasWt
    ? spawn('wt.exe', ['-d', repo, cli, ...(prompt ? [prompt] : [])], { detached: true, stdio: 'ignore' })
    : // Verbatim, because start needs its quotes as written: Node would escape them and it would lose the title and command
      spawn('cmd.exe', ['/c', 'start', q('Claude Code'), '/d', q(repo), q(cli), ...(prompt ? [q(prompt)] : [])], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true
      })
  child.unref()
}
