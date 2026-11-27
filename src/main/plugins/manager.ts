import { app, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { basename, join, resolve } from 'path'
import type { ChangeEvent } from '@shared/types'
import { PLUGIN_ID, type PluginInfo, type PluginResult, type PluginStatus } from '@shared/pluginApi'
import type { FromRunner, ToRunner } from '../../plugin-runner/protocol'
import { loadConfig, saveConfig } from '../config'
import { broadcast } from '../windows'
import { isTaskPath } from '../tasks'
import { discoverPlugins, MANIFEST_FILE, type FoundPlugin } from './discovery'
import { hostCall, type HostDeps } from './hostApi'
import { resolveInside } from './files'

/**
 * Plugin lifecycle (docs/plugins.md): find plugins, keep their on/off flags in the config, run each enabled one in
 * its own utilityProcess (src/plugin-runner/runner.ts) while a vault is open, and answer the host calls and page
 * calls that cross between the app and the process. Nothing else in Waypoint depends on this: with no plugins
 * switched on, no process exists and nothing here runs.
 */

/** deactivate gets this long; then the process is killed */
const STOP_MS = 5000
/** A page's call waits this long for a plugin that is still starting */
const START_WAIT_MS = 15000

export type ManagerDeps = HostDeps

/** A plugin that has been started since the vault opened */
interface Run {
  found: FoundPlugin
  /** null for a plugin without a main module, and after the process has gone */
  child: UtilityProcess | null
  status: PluginStatus
  error?: string
  /** Settles when activate has finished (rejects if it failed) */
  ready: Promise<void>
  settle: { ok(): void; fail(e: Error): void }
  stopping: boolean
  /** Fired when the process has exited */
  exited: (() => void)[]
  /** Page calls waiting for the plugin's answer, by call id */
  calls: Map<number, (r: PluginResult) => void>
  nextCall: number
  /** The plugin asked to hear about task changes */
  tasksSub: boolean
  /** ... and about project changes */
  projectsSub: boolean
  /** host.projects.setLinked: the projects its views, panels and commands show on */
  linked: string[]
}

let deps: ManagerDeps
let found: FoundPlugin[] = []
let scanned = false
const runs = new Map<string, Run>()

export function initPlugins(d: ManagerDeps) {
  deps = d
}

const userData = () => app.getPath('userData')
const pluginsDir = () => join(userData(), 'plugins')
export const pluginDataDir = (id: string) => join(userData(), 'plugin-data', id)
export const pluginLogPath = (id: string) => join(pluginDataDir(id), 'plugin.log')

// ---- config ----

const settings = () => loadConfig().plugins ?? {}
const isEnabled = (id: string) => settings().enabled?.[id] === true
const devPaths = () => settings().devPaths ?? []
const savePlugins = (patch: NonNullable<ReturnType<typeof settings>>) => saveConfig({ plugins: { ...settings(), ...patch } })

const changed = () => broadcast('plugins:changed', [])

// ---- finding and describing ----

/** Look at the plugin folders again (cheap: a few small files) */
async function rescan(): Promise<FoundPlugin[]> {
  found = await discoverPlugins(pluginsDir(), devPaths())
  scanned = true
  return found
}

function describe(p: FoundPlugin): PluginInfo {
  const m = p.manifest
  const run = m ? runs.get(p.id) : undefined
  const enabled = !!m && isEnabled(p.id)
  const status: PluginStatus = p.newer ? 'newer' : !m ? 'invalid' : run ? run.status : enabled ? 'stopped' : 'off'
  return {
    id: p.id,
    name: m?.name ?? p.id,
    version: m?.version ?? '',
    description: m?.description ?? '',
    dir: p.dir,
    source: p.source,
    enabled,
    status,
    error: run?.error ?? (m ? undefined : p.error),
    views: m?.views ?? [],
    panels: m?.panels ?? [],
    commands: m?.commands ?? [],
    linked: run?.linked ?? []
  }
}

/** Every plugin found, with its switch and status (looks at the folders again) */
export async function listPlugins(): Promise<PluginInfo[]> {
  const all = await rescan()
  startNew(all) // one that was switched on earlier and has just turned up (a folder added by hand) starts now
  return all.map(describe)
}

/** Start the enabled plugins that aren't running yet (a failed one keeps its run and error until Restart) */
/** Set while every plugin is being stopped (vault change, quit), so a refresh in between doesn't start them again */
let paused = false

function startNew(all: FoundPlugin[]) {
  if (paused || !deps?.vault()) return
  for (const p of all) if (p.manifest && isEnabled(p.id) && !runs.has(p.id)) void startOne(p).catch((e) => console.error('[plugins]', e))
}

/** The folder of an enabled, valid plugin: what the wp-plugin:// scheme may serve from (null: serve nothing) */
export async function servedPluginDir(id: string): Promise<string | null> {
  if (!scanned) await rescan()
  const p = found.find((x) => x.id === id && x.manifest)
  return p && isEnabled(id) ? p.dir : null
}

// ---- running ----

/** Add to the plugin's log (its own `host.log` writes there too; this is for what the process prints) */
function logOutput(id: string, label: string, chunk: Buffer) {
  const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => `${new Date().toISOString()} [${label}] ${l}\n`)
  fs.mkdir(pluginDataDir(id), { recursive: true })
    .then(() => fs.appendFile(pluginLogPath(id), lines.join('')))
    .catch(() => undefined)
}

/** The process has gone (or never was): tell everyone waiting on it */
function ended(run: Run, why: string) {
  run.child = null
  // Nothing is linked to a plugin that isn't running
  if (run.linked.length) {
    run.linked = []
    changed()
  }
  for (const answer of run.calls.values()) answer({ ok: false, error: why })
  run.calls.clear()
  run.exited.splice(0).forEach((f) => f())
}

function fail(run: Run, error: string) {
  if (run.status === 'error') return
  run.status = 'error'
  run.error = error
  run.settle.fail(new Error(error))
  changed()
}

/** host.projects.setLinked: replaces the set, and tells the windows if it changed */
function setLinked(run: Run, slugs: unknown) {
  if (!Array.isArray(slugs) || slugs.some((s) => typeof s !== 'string' || !s || /[\\/]/.test(s) || s.startsWith('.'))) {
    throw new Error('setLinked takes a list of project slugs')
  }
  const next = [...new Set(slugs as string[])].sort()
  if (JSON.stringify(next) === JSON.stringify([...run.linked].sort())) return
  run.linked = next
  changed()
}

/** A request from the plugin for something only Waypoint can do */
async function onRequest(run: Run, id: number, method: string, params: unknown[]) {
  const answer = (m: ToRunner) => {
    try {
      run.child?.postMessage(m)
    } catch (e) {
      run.child?.postMessage({ t: 'res', id, ok: false, error: `The answer to ${method} can't be sent: ${(e as Error).message}` } satisfies ToRunner)
    }
  }
  try {
    let value: unknown
    if (method === 'tasks.subscribe') run.tasksSub = true
    else if (method === 'tasks.unsubscribe') run.tasksSub = false
    else if (method === 'projects.subscribe') run.projectsSub = true
    else if (method === 'projects.unsubscribe') run.projectsSub = false
    else if (method === 'projects.setLinked') setLinked(run, params[0])
    else value = await hostCall(deps, { id: run.found.id, dir: run.found.dir }, method, params)
    answer({ t: 'res', id, ok: true, value })
  } catch (e: any) {
    answer({ t: 'res', id, ok: false, error: e?.message ?? String(e), ...(typeof e?.status === 'number' ? { status: e.status } : {}) })
  }
}

function onMessage(run: Run, m: FromRunner) {
  if (m.t === 'ready') {
    if (run.status === 'starting') {
      run.status = 'running'
      run.settle.ok()
      changed()
    }
  } else if (m.t === 'failed') fail(run, m.error)
  else if (m.t === 'req') void onRequest(run, m.id, m.method, m.params)
  else if (m.t === 'emit') broadcast('plugin:event', [run.found.id, m.event, m.data])
  else if (m.t === 'ret') {
    const answer = run.calls.get(m.id)
    run.calls.delete(m.id)
    answer?.(m.ok ? { ok: true, value: m.value } : { ok: false, error: m.error, ...(m.status === undefined ? {} : { status: m.status }) })
  }
}

/** Start one plugin: a process for its main module (a plugin with only pages has nothing to run) */
async function startOne(p: FoundPlugin): Promise<void> {
  const vault = deps.vault()
  const m = p.manifest
  if (!vault || !m || runs.has(p.id)) return
  const run: Run = {
    found: p,
    child: null,
    status: 'starting',
    ready: Promise.resolve(),
    settle: { ok: () => undefined, fail: () => undefined },
    stopping: false,
    exited: [],
    calls: new Map(),
    nextCall: 1,
    tasksSub: false,
    projectsSub: false,
    linked: []
  }
  run.ready = new Promise<void>((ok, bad) => (run.settle = { ok, fail: bad }))
  run.ready.catch(() => undefined) // a failure shows as the status; nobody has to be waiting
  runs.set(p.id, run)
  if (!m.main) {
    run.status = 'running'
    run.settle.ok()
    return changed()
  }
  const main = resolveInside(p.dir, m.main)
  if (!main || !existsSync(main)) {
    fail(run, `The main module isn't there: ${m.main}`)
    return
  }
  changed()
  try {
    const child = utilityProcess.fork(join(__dirname, 'runner.js'), [], { serviceName: `Waypoint plugin ${p.id}`, stdio: 'pipe' })
    run.child = child
    child.stdout?.on('data', (d: Buffer) => logOutput(p.id, 'stdout', d))
    child.stderr?.on('data', (d: Buffer) => logOutput(p.id, 'stderr', d))
    child.on('message', (msg: FromRunner) => onMessage(run, msg))
    child.on('exit', (code) => {
      const why = `The plugin process exited (code ${code})`
      if (!run.stopping) fail(run, why)
      ended(run, 'The plugin stopped')
    })
    child.postMessage({
      t: 'init',
      id: p.id,
      dir: p.dir,
      version: m.version,
      main,
      appVersion: app.getVersion(),
      dataDir: pluginDataDir(p.id),
      vaultRoot: vault.root
    } satisfies ToRunner)
  } catch (e) {
    fail(run, `Couldn't start the plugin: ${(e as Error).message}`)
  }
}

/** Stop one plugin: deactivate gets 5 s, then the process is killed. Forgets the run (and any error). */
async function stopOne(id: string): Promise<void> {
  const run = runs.get(id)
  if (!run) return
  run.stopping = true
  const child = run.child
  if (child) {
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill(), STOP_MS)
      run.exited.push(() => {
        clearTimeout(timer)
        done()
      })
      try {
        child.postMessage({ t: 'stop' } satisfies ToRunner)
      } catch {
        child.kill()
      }
    })
  }
  ended(run, 'The plugin stopped')
  if (runs.get(id) === run) runs.delete(id)
  changed()
}

/** After a vault opens: start every enabled plugin */
export async function startPlugins(): Promise<void> {
  if (!deps.vault()) return
  paused = false
  for (const p of await rescan()) if (p.manifest && isEnabled(p.id)) await startOne(p)
}

/** Vault change or quit: stop every plugin (in parallel, each with its 5 s) */
export async function stopPlugins(): Promise<void> {
  paused = true
  await Promise.all([...runs.keys()].map(stopOne))
}

// ---- Settings actions ----

const pluginById = async (id: string) => {
  const p = (await rescan()).find((x) => x.id === id && x.manifest)
  if (!p) throw new Error(`There is no usable plugin "${id}"`)
  return p
}

export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const p = await pluginById(id)
  savePlugins({ enabled: { ...settings().enabled, [id]: on } })
  if (on) await startOne(p)
  else await stopOne(id)
  changed()
}

export async function restartPlugin(id: string): Promise<void> {
  const p = await pluginById(id)
  await stopOne(id)
  if (isEnabled(id)) await startOne(p)
}

/** Load a plugin from a folder in place (it starts off, like any plugin) */
export async function addDevPath(dir: string): Promise<void> {
  const path = resolve(dir)
  if (!existsSync(join(path, MANIFEST_FILE))) throw new Error(`There's no ${MANIFEST_FILE} in ${basename(path)}.`)
  const paths = devPaths()
  if (!paths.some((p) => resolve(p).toLowerCase() === path.toLowerCase())) savePlugins({ devPaths: [...paths, path] })
  startNew(await rescan()) // already switched on in the config: runs straight away, as if it had just been switched on
  changed()
}

/** Stop loading a dev folder (the folder itself is left alone) */
export async function removeDevPath(dir: string): Promise<void> {
  const path = resolve(dir).toLowerCase()
  const gone = (await rescan()).find((p) => p.source === 'dev' && p.dir.toLowerCase() === path)
  const enabled = { ...settings().enabled }
  // Forget its switch too, so a folder added again later starts off
  if (gone && !found.some((p) => p !== gone && p.id === gone.id)) delete enabled[gone.id]
  // Config first, then stop: stopping broadcasts a change, and a refresh that still saw the folder would start it again
  savePlugins({ devPaths: devPaths().filter((p) => resolve(p).toLowerCase() !== path), enabled })
  await rescan()
  if (gone) await stopOne(gone.id)
  changed()
}

/** Make sure plugin.log exists, so "Open log" has something to open */
export async function ensureLog(id: string): Promise<string> {
  if (!PLUGIN_ID.test(id)) throw new Error('That plugin has no log')
  await fs.mkdir(pluginDataDir(id), { recursive: true })
  await fs.appendFile(pluginLogPath(id), '')
  return pluginLogPath(id)
}

// ---- pages ----

/** A page's waypoint.call(method, params): answered by the plugin's host.handle function */
export async function callPlugin(id: string, method: string, params: unknown): Promise<PluginResult> {
  const run = runs.get(id)
  if (!run) return { ok: false, error: `The plugin "${id}" isn't running.` }
  if (run.status === 'starting') {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([run.ready.catch(() => undefined), new Promise((ok) => (timer = setTimeout(ok, START_WAIT_MS)))])
    clearTimeout(timer)
  }
  if (run.status !== 'running') return { ok: false, error: run.error ?? `The plugin "${id}" isn't running.` }
  if (!run.child) return { ok: false, error: `The plugin "${id}" has no code to call.` }
  return new Promise<PluginResult>((done) => {
    const callId = run.nextCall++
    run.calls.set(callId, done)
    try {
      run.child!.postMessage({ t: 'call', id: callId, method, params } satisfies ToRunner)
    } catch (e) {
      run.calls.delete(callId)
      done({ ok: false, error: `Can't send "${method}" to the plugin: ${(e as Error).message}` })
    }
  })
}

// ---- tasks.onChange and projects.onChange ----

let taskIds = new Set<string>()
let taskTimer: NodeJS.Timeout | null = null
let projectSlugs = new Set<string>()
let projectTimer: NodeJS.Timeout | null = null

/** The project a vault path says something about: its project.md, or the project folder being added/removed (rename) */
function projectOf(e: ChangeEvent): string | null {
  const file = /^projects\/([^/]+)\/project\.md$/i.exec(e.path)
  if (file) return file[1]
  const dir = /^projects\/([^/]+)$/.exec(e.path)
  return dir && (e.event === 'addDir' || e.event === 'unlinkDir') && !dir[1].startsWith('.') ? dir[1] : null
}

/** The vault's watcher reports file changes here; task and project changes are passed on (debounced) to plugins that subscribed */
export function noteVaultChanges(events: ChangeEvent[]) {
  const runList = [...runs.values()]
  if (runList.some((r) => r.tasksSub)) {
    for (const e of events) if (isTaskPath(e.path)) taskIds.add(basename(e.path).replace(/\.md$/i, ''))
    if (taskIds.size && !taskTimer) {
      taskTimer = setTimeout(() => {
        const ids = [...taskIds]
        taskIds = new Set()
        taskTimer = null
        for (const r of runs.values()) if (r.tasksSub && r.child) r.child.postMessage({ t: 'tasks-changed', ids } satisfies ToRunner)
      }, 250)
    }
  }
  if (runList.some((r) => r.projectsSub)) {
    for (const e of events) {
      const slug = projectOf(e)
      if (slug) projectSlugs.add(slug)
    }
    if (projectSlugs.size && !projectTimer) {
      projectTimer = setTimeout(() => {
        const slugs = [...projectSlugs]
        projectSlugs = new Set()
        projectTimer = null
        for (const r of runs.values()) if (r.projectsSub && r.child) r.child.postMessage({ t: 'projects-changed', slugs } satisfies ToRunner)
      }, 250)
    }
  }
}
