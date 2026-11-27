import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { isAbsolute, join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { watch as chokidar } from 'chokidar'
import type { Disposable, PluginHost, PluginModule, WatchEvent } from '@shared/pluginApi'
import type { FromRunner, RunnerInit, ToRunner } from './protocol'

/**
 * Runs one plugin's main module inside an Electron utilityProcess, so a slow or crashing plugin can't freeze or
 * take down Waypoint. Builds the `host` object the plugin is given (docs/plugins.md): calls that need Waypoint
 * (projects, tasks, toasts…) are sent to the main process and answered; host.watch and host.log work here.
 * Built as out/main/runner.js (electron-vite entry) and started by src/main/plugins/manager.ts.
 */

const port = process.parentPort
const send = (m: FromRunner) => port.postMessage(m)

let mod: Partial<PluginModule> | null = null
let logFile = ''

/** One line in dataDir/plugin.log */
function log(level: 'info' | 'warn' | 'error', args: unknown[]) {
  const show = (a: unknown) => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.stack ?? a.message
    try {
      return JSON.stringify(a) ?? String(a)
    } catch {
      return String(a)
    }
  }
  try {
    appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${args.map(show).join(' ')}\n`)
  } catch {
    /* the log is the last thing worth failing over */
  }
}

/** Keep the log from growing for ever: past 2 MB the old one is kept as plugin.log.1 */
function rotateLog() {
  try {
    if (statSync(logFile).size > 2 * 1024 * 1024) renameSync(logFile, logFile + '.1')
  } catch {
    /* no log yet */
  }
}

// ---- calls to Waypoint ----

let nextReq = 1
const waiting = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>()

/** Ask the main process to do something (the host.* implementations in main/plugins/hostApi.ts) */
function request(method: string, ...params: unknown[]): Promise<any> {
  return new Promise((ok, fail) => {
    const id = nextReq++
    waiting.set(id, { ok, fail })
    try {
      send({ t: 'req', id, method, params })
    } catch (e) {
      waiting.delete(id)
      fail(new Error(`Can't send ${method}: ${(e as Error).message}`)) // e.g. an argument that can't be cloned
    }
  })
}

// ---- host.handle / host.emit / host.watch / tasks.onChange ----

const handlers = new Map<string, (params: any) => unknown>()
const watchers = new Set<{ close(): Promise<void> }>()
const taskListeners = new Set<(ids: string[]) => void>()
const projectListeners = new Set<(slugs: string[]) => void>()

const disposable = (fn: () => void): Disposable => ({ dispose: fn })

/** Folder and file names to leave out; an absolute path leaves out that place and everything under it */
function ignoreTest(entries: string[] | undefined): ((path: string) => boolean) | undefined {
  if (!entries?.length) return undefined
  const names = entries.filter((e) => !isAbsolute(e))
  const roots = entries.filter(isAbsolute).map((e) => resolve(e).toLowerCase())
  return (path) => {
    const lower = resolve(path).toLowerCase()
    return roots.some((r) => lower === r || lower.startsWith(r + sep)) || path.split(/[\\/]/).some((part) => names.includes(part))
  }
}

/** chokidar on outside folders; events are batched over 250 ms and handed over in one go */
function watchFolders(paths: string[], cb: (events: WatchEvent[]) => void, opts?: { depth?: number; ignored?: string[] }): Disposable {
  const ignored = ignoreTest(opts?.ignored)
  const w = chokidar(paths, { ignoreInitial: true, depth: opts?.depth, ...(ignored ? { ignored } : {}) })
  watchers.add(w)
  let batch: WatchEvent[] = []
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    timer = null
    const events = batch
    batch = []
    try {
      const r: unknown = cb(events)
      if (r instanceof Promise) r.catch((e) => log('error', ['host.watch callback failed:', e]))
    } catch (e) {
      log('error', ['host.watch callback failed:', e])
    }
  }
  w.on('all', (type, path) => {
    if (type !== 'add' && type !== 'change' && type !== 'unlink' && type !== 'addDir' && type !== 'unlinkDir') return
    batch.push({ type, path })
    timer ??= setTimeout(flush, 250)
  })
  w.on('error', (e) => log('error', ['host.watch:', e]))
  return disposable(() => {
    if (timer) clearTimeout(timer)
    watchers.delete(w)
    void w.close()
  })
}

/** The object activate(host) receives */
function buildHost(i: RunnerInit): PluginHost {
  return {
    api: 1,
    plugin: { id: i.id, dir: i.dir, version: i.version },
    appVersion: i.appVersion,
    dataDir: i.dataDir,
    vault: { root: i.vaultRoot },
    projects: {
      list: () => request('projects.list'),
      get: (slug) => request('projects.get', slug),
      setLinked: (slugs) => request('projects.setLinked', slugs),
      onChange(cb) {
        if (!projectListeners.size) void request('projects.subscribe').catch(() => undefined)
        projectListeners.add(cb)
        return disposable(() => {
          projectListeners.delete(cb)
          if (!projectListeners.size) void request('projects.unsubscribe').catch(() => undefined)
        })
      }
    },
    tasks: {
      list: (project) => request('tasks.list', project),
      get: (id) => request('tasks.get', id),
      create: (slug, fields, body, data) => request('tasks.create', slug, fields, body, data),
      update: (id, patch, summary) => request('tasks.update', id, patch, summary),
      onChange(cb) {
        if (!taskListeners.size) void request('tasks.subscribe').catch(() => undefined)
        taskListeners.add(cb)
        return disposable(() => {
          taskListeners.delete(cb)
          if (!taskListeners.size) void request('tasks.unsubscribe').catch(() => undefined)
        })
      }
    },
    handle(method, fn) {
      handlers.set(method, fn)
      return disposable(() => {
        if (handlers.get(method) === fn) handlers.delete(method)
      })
    },
    emit(event, data) {
      try {
        send({ t: 'emit', event, data })
      } catch (e) {
        log('error', [`host.emit("${event}") can't send that data:`, (e as Error).message])
      }
    },
    watch: watchFolders,
    openExternal: (url) => request('openExternal', url),
    attachments: { add: (file) => request('attachments.add', file) },
    openPath: (path) => request('openPath', path),
    showInFolder: (path) => request('showInFolder', path),
    claude: {
      available: () => request('claude.available'),
      open: (cwd, prompt) => request('claude.open', cwd, prompt)
    },
    toast: (title, body, open) => void request('toast', title, body, open).catch((e) => log('warn', ['toast failed:', e])),
    openView: (view, state) => void request('openView', view, state).catch((e) => log('warn', ['openView failed:', e])),
    log: {
      info: (...a) => log('info', a),
      warn: (...a) => log('warn', a),
      error: (...a) => log('error', a)
    }
  }
}

// ---- lifecycle ----

/** Load the main module and run activate(host); tell Waypoint how it went */
async function start(i: RunnerInit) {
  logFile = join(i.dataDir, 'plugin.log')
  mkdirSync(i.dataDir, { recursive: true })
  rotateLog()
  try {
    // import() of a file URL: the plugin is an ES module (.mjs) and this file is not
    const loaded = await import(/* @vite-ignore */ pathToFileURL(i.main).href)
    mod = typeof loaded.activate === 'function' ? loaded : (loaded.default ?? loaded)
    if (typeof mod?.activate !== 'function') throw new Error('The main module has to export an activate(host) function.')
    await mod.activate(buildHost(i))
    send({ t: 'ready' })
  } catch (e) {
    log('error', ['activate failed:', e])
    send({ t: 'failed', error: (e as Error)?.message ?? String(e) })
    setTimeout(() => process.exit(1), 100)
  }
}

/** deactivate (Waypoint kills the process if this takes over 5 s), then close watchers and exit */
async function stop() {
  try {
    await mod?.deactivate?.()
  } catch (e) {
    log('error', ['deactivate failed:', e])
  }
  await Promise.allSettled([...watchers].map((w) => w.close()))
  send({ t: 'stopped' })
  setTimeout(() => process.exit(0), 50)
}

/** A page's call, answered by the function the plugin gave host.handle */
async function answerCall(id: number, method: string, params: unknown) {
  const reply = (m: FromRunner) => {
    try {
      send(m)
    } catch (e) {
      // The answer can't be cloned (a function, a class with methods…): say so instead of leaving the page waiting
      send({ t: 'ret', id, ok: false, error: `The handler for "${method}" returned something that can't be sent: ${(e as Error).message}` })
    }
  }
  try {
    const fn = handlers.get(method)
    if (!fn) throw new Error(`The plugin has no handler for "${method}"`)
    reply({ t: 'ret', id, ok: true, value: await fn(params) })
  } catch (e: any) {
    reply({ t: 'ret', id, ok: false, error: e?.message ?? String(e), ...(typeof e?.status === 'number' ? { status: e.status } : {}) })
  }
}

port.on('message', (event) => {
  const m = event.data as ToRunner
  if (m.t === 'init') void start(m)
  else if (m.t === 'stop') void stop()
  else if (m.t === 'call') void answerCall(m.id, m.method, m.params)
  else if (m.t === 'res') {
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.ok) w?.ok(m.value)
    else w?.fail(Object.assign(new Error(m.error), m.status === undefined ? {} : { status: m.status }))
  } else if (m.t === 'projects-changed') {
    for (const cb of projectListeners) {
      try {
        const r: unknown = cb(m.slugs)
        if (r instanceof Promise) r.catch((e) => log('error', ['projects.onChange callback failed:', e]))
      } catch (e) {
        log('error', ['projects.onChange callback failed:', e])
      }
    }
  } else if (m.t === 'tasks-changed') {
    for (const cb of taskListeners) {
      try {
        const r: unknown = cb(m.ids)
        if (r instanceof Promise) r.catch((e) => log('error', ['tasks.onChange callback failed:', e]))
      } catch (e) {
        log('error', ['tasks.onChange callback failed:', e])
      }
    }
  }
})

// A stray error in a plugin's timer or promise must not take the process down; it goes in the log
process.on('uncaughtException', (e) => log('error', ['uncaught exception:', e]))
process.on('unhandledRejection', (e) => log('error', ['unhandled rejection:', e]))
