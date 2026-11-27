// The example plugin's main module: runs in its own process, started when the plugin is switched on.
// Docs: docs/plugins.md
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

let timer
let linked = new Set() // the projects the plugin applies to
let letters = '' // only projects whose title starts with one of these letters; empty = all
const settingsFile = (host) => join(host.dataDir, 'settings.json')

export async function activate(host) {
  host.log.info('activated', host.plugin.id, host.plugin.version, 'in', host.plugin.dir)
  letters = await fs.readFile(settingsFile(host), 'utf8').then((t) => JSON.parse(t).letters ?? '', () => '')

  /** host.projects.setLinked: the plugin's views, panels and commands appear on exactly these projects */
  async function relink(extra = {}) {
    const projects = await host.projects.list()
    const wanted = new Set(projects.filter((p) => !letters || letters.includes(p.title.trim().charAt(0).toLowerCase())).map((p) => p.slug))
    // Projects linked or unlinked by hand (the commands) stay that way across a refresh
    if (extra.keep) for (const s of linked) if (projects.some((p) => p.slug === s)) wanted.add(s)
    if (extra.add) wanted.add(extra.add)
    for (const s of extra.remove ?? []) wanted.delete(s)
    linked = wanted
    await host.projects.setLinked([...linked])
  }
  await relink()
  // Projects added, renamed or edited: link again
  host.projects.onChange(() => void relink({ keep: true }))

  host.handle('settings', () => ({ letters, linked: [...linked] }))
  host.handle('setLetters', async (params) => {
    letters = String(params?.letters ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    await fs.mkdir(host.dataDir, { recursive: true })
    await fs.writeFile(settingsFile(host), JSON.stringify({ letters }))
    await relink()
    return { letters, linked: [...linked] }
  })

  // Commands (plugin.json "commands"): the handler is command:<id>; { toast } shows as a notice in Waypoint
  host.handle('command:count', async ({ project }) => {
    const tasks = await host.tasks.list(project)
    const open = tasks.filter((t) => t.status !== 'done' && !t.archived)
    return { toast: `${open.length} open task${open.length === 1 ? '' : 's'} in ${project}` }
  })
  host.handle('command:link-all', async () => {
    letters = ''
    await relink()
    return { toast: `Linked ${linked.size} projects` }
  })
  host.handle('command:unlink', async ({ project }) => {
    await relink({ keep: true, remove: [project] })
    return { toast: `Unlinked ${project}` }
  })
  host.handle('command:link', async ({ project }) => {
    await relink({ keep: true, add: project })
    return { toast: `Linked ${project}` }
  })

  // The tasks view: tasks come with `data` (their whole front matter); create takes extra keys of its own
  host.handle('tasks', async ({ project }) => (await host.tasks.list(project)).map((t) => ({ id: t.id, title: t.title, status: t.status, data: t.data })))
  host.handle('addTask', async ({ project }) => {
    const task = await host.tasks.create(project, { title: 'From the example plugin' }, 'Made by the example plugin.', { exampleStamp: new Date().toISOString() })
    return { id: task.id }
  })
  // host.attachments.add(file) is left out here: it needs the absolute path of a picture on disk

  // The page's "Ask the main module" button: waypoint.call('summary')
  host.handle('summary', async () => {
    const tasks = await host.tasks.list()
    return {
      tasks: tasks.length,
      vault: host.vault.root,
      appVersion: host.appVersion,
      dataDir: host.dataDir,
      claudeAvailable: await host.claude.available()
    }
  })

  // The page's "Show a toast" button; clicking the toast opens the view again
  host.handle('toast', async (params) => {
    host.toast('Example plugin', params?.text ?? 'Hello from the plugin', { view: 'demo', state: { from: 'toast' } })
    return true
  })

  // An event every few seconds, which the page lists
  let n = 0
  timer = setInterval(() => host.emit('tick', { n: ++n, at: new Date().toISOString() }), 3000)
}

export function deactivate() {
  clearInterval(timer)
}
