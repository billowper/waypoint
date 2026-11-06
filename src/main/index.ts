import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen, shell, nativeTheme } from 'electron'
import { basename, join, posix } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, rmdir, stat } from 'fs/promises'
import { watch, type FSWatcher } from 'chokidar'
import { Vault } from './vault'
import { dropFromTreeOrder, moveInTreeOrder, readTreeOrder, saveTreeOrder } from './treeOrder'
import { NotesIndex } from './notesIndex'
import {
  createBoard,
  createProject,
  knownExternalPaths,
  listProjects,
  readProject,
  renameInProjectOrder,
  saveProject,
  saveProjectOrder
} from './projects'
import { CLI_NOT_FOUND, claudeStatus, connectClaude, disconnectClaude, openInClaudeApp, openInClaudeTerminal, taskPrompt, writeInstructions } from './claudeCode'
import { createTask, isTaskPath, listTasks, updateTask } from './tasks'
import { VaultGit } from './git'
import type { ProjectSettings, TaskFields, VaultSettings } from '@shared/types'
import { loadConfig, prefs, saveConfig } from './config'
import {
  applyPrefs,
  appIcon,
  closePopup,
  commandFromArgv,
  hotkeyRegistered,
  openPopup,
  preloadPath,
  setupTray,
  toast,
  updateJumpList
} from './desktop'
import { withDefaults, type Prefs } from '@shared/prefs'
import { startNudges } from './nudges'
import { backupNow } from './backups'
import { installedFonts } from './fonts'
import { IMAGE_EXT, fixRelativeLinks, saveAttachment, serveAttachments } from './attachments'
import { dropIcons, iconFromFile, iconFromUrl, moveIcons, readIcons, registerIconScheme, serveIcons, setIcon } from './icons'
import {
  appWindows,
  broadcast,
  flushOthers,
  flushWindow,
  initWindows,
  isContentWindow,
  openContentWindow,
  restoreWindows,
  windowHolding
} from './windows'
import type { ViewRef } from '@shared/types'
import type { AppCommand, DesktopInfo } from '@shared/types'
import type { ChangeEvent, VaultInfo } from '@shared/types'
import { IDEAS_DIR, movedPath } from '@shared/names'
import { updateLinks } from './relink'
import { serveBridge, type BridgeRequest } from './bridge'
import { hashText, markUndone, readChanges, snapshotPath } from './claudeLog'
import type { Server } from 'net'

let win: BrowserWindow | null = null
let vault: Vault | null = null
let notes: NotesIndex | null = null
let git: VaultGit | null = null
let watcher: FSWatcher | null = null
let bridge: Server | null = null

const MAX_RECENT = 20

function info(): VaultInfo | null {
  return vault ? { path: vault.root, name: vault.name } : null
}

function requireVault(): Vault {
  if (!vault) throw new Error('No vault open')
  return vault
}

function requireIndex(): NotesIndex {
  if (!notes) throw new Error('No vault open')
  return notes
}

function requireGit(): VaultGit {
  if (!git) throw new Error('No vault open')
  return git
}

/** How the last push went, shown in the Git panel. Reset when the vault changes. */
let pushState: { pushError?: string; lastPush?: string } = {}
let pushing: Promise<void> | null = null

/** One push at a time; asking during a push joins it. Throws on failure, after recording why. */
function pushVault(g: VaultGit, background: boolean): Promise<void> {
  pushing ??= g
    .push(background)
    .then(
      () => {
        if (git === g) pushState = { lastPush: new Date().toISOString() }
      },
      (e) => {
        if (git === g) pushState = { ...pushState, pushError: (e as Error).message }
        throw e
      }
    )
    .finally(() => {
      pushing = null
      if (git === g) broadcast('git:changed', [])
    })
  return pushing
}

/** Push whatever is waiting. A failure (offline, signed out) shows in the panel and is tried again next time. */
async function pushIfNeeded(g: VaultGit) {
  try {
    if (await g.needsPush()) await pushVault(g, true)
    else if (git === g && pushState.pushError) {
      pushState = { ...pushState, pushError: undefined } // e.g. pushed from a terminal instead
      broadcast('git:changed', [])
    }
  } catch (e) {
    console.error('[auto-push]', (e as Error).message)
  }
}

/** Optional auto-commit and auto-push (both off by default), every N minutes. */
let autoCommitTimer: NodeJS.Timeout | null = null
async function scheduleAutoCommit() {
  if (autoCommitTimer) clearInterval(autoCommitTimer)
  autoCommitTimer = null
  const v = vault
  if (!v) return
  const { git: g } = await v.settings()
  if (!g.autoCommit && !g.autoPush) return
  autoCommitTimer = setInterval(async () => {
    const repo = git
    if (vault !== v || !repo?.isRepo()) return
    if (g.autoCommit) {
      try {
        if (await repo.commitIfChanged(`Auto-commit ${new Date().toLocaleString('en-GB')}`)) {
          broadcast('git:changed', [])
        }
      } catch (e) {
        console.error('[auto-commit]', e) // e.g. conflicts: leave it for Bill to sort out
      }
    }
    if (g.autoPush) await pushIfNeeded(repo)
  }, g.intervalMinutes * 60_000)
}

async function setVault(path: string | undefined) {
  await watcher?.close()
  watcher = null
  bridge?.close()
  bridge = null
  vault = path ? new Vault(path) : null
  notes = vault ? new NotesIndex(vault) : null
  git = vault ? new VaultGit(vault.root) : null
  pushState = {}
  saveConfig({ vaultPath: path })
  if (vault) {
    notes!.rebuild()
    startWatching(vault)
    bridge = serveBridge(vault.root, answerConnector)
    await moveCapturesToIdeas(vault).catch((e) => console.error('[ideas]', e)) // tried again next time
  }
  scheduleAutoCommit()
}

/** Once per vault: quick captures used to live in notes/Captures and inbox.md */
async function moveCapturesToIdeas(v: Vault) {
  const settings = await v.settings()
  if (settings.ideasMoved || !v.isSetUp()) return
  const toIdeas = (rel: string) => relocate(rel, (vv) => vv.move(rel, IDEAS_DIR))
  const captures = 'notes/Captures'
  // Notes first: each brings its sub-pages folder along
  const nodes = await v.tree(captures)
  for (const n of [...nodes.filter((x) => x.type === 'file'), ...nodes.filter((x) => x.type === 'dir')]) {
    if (existsSync(v.abs(n.path))) await toIdeas(n.path)
  }
  if (existsSync(v.abs(captures))) {
    await withFolderUnlocked(v, captures, () => rmdir(v.abs(captures)).catch(() => undefined)) // hidden files stay put
    await dropFromTreeOrder(v, captures)
    await dropIcons(v, captures)
  }
  const inbox = await v.read('inbox.md').catch(() => null)
  // Nothing but the heading and the old starter text: to the Recycle Bin. Anything else is kept, as one idea.
  if (inbox !== null && /^# inbox\s*((quick captures land here|things to sort)[^\n]*\s*)?$/i.test(inbox)) {
    await shell.trashItem(v.abs('inbox.md'))
    await dropIcons(v, 'inbox.md')
    updateRecent(v, (r) => (r === 'inbox.md' ? null : r))
    await requireIndex().remove('inbox.md')
    broadcast('vault:removed', ['inbox.md'])
    notify([{ event: 'unlink', path: 'inbox.md' }])
  } else if (inbox !== null) {
    await toIdeas('inbox.md')
  }
  await v.saveSettings({ ...settings, ideasMoved: true })
}

/** File changes go to every Waypoint window (each has its own tree, editors, search) */
function notify(events: ChangeEvent[]) {
  if (events.length) broadcast('vault:changed', [events])
}

function startWatching(v: Vault) {
  // Batch filesystem events so bulk changes (git pull, copy-paste) cause one refresh
  let pending: ChangeEvent[] = []
  let timer: NodeJS.Timeout | null = null
  watcher = watch(v.root, {
    ignoreInitial: true,
    ignored: (p) => /[\\/](\.git|node_modules|\.app[\\/]cache)([\\/]|$)/.test(p),
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 }
  })
  watcher.on('all', (event, p) => {
    const rel = v.rel(p)
    if (notes && v === vault) {
      if (event === 'unlinkDir') notes.remove(rel)
      else if (v.isNote(rel)) event === 'unlink' ? notes.remove(rel) : notes.update(rel)
    }
    pending.push({ event: event as ChangeEvent['event'], path: rel })
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      await notes?.idle() // so backlinks/search asked for after this event are up to date
      notify(pending)
      pending = []
    }, 120)
  })
}

/**
 * On Windows the watcher holds open handles on every folder it watches, which blocks renaming,
 * moving or deleting a folder (EPERM). Run `op` with the watcher paused when `rel` is a folder.
 */
async function withFolderUnlocked<T>(v: Vault, rel: string, op: () => Promise<T>): Promise<T> {
  // A note can bring a folder with it (its sub-pages) or leave one to be removed (its parent's, now empty)
  const parent = posix.dirname(rel)
  const locks =
    (await stat(v.abs(rel))).isDirectory() || !!v.pagesOf(rel) || (parent !== '.' && v.isPagesFolder(parent))
  if (locks) {
    await watcher?.close()
    watcher = null
  }
  try {
    return await op()
  } finally {
    if (locks && vault === v && !watcher) startWatching(v)
  }
}

function updateRecent(v: Vault, map: (r: string) => string | null) {
  const cfg = loadConfig()
  const list = (cfg.recent[v.root] ?? []).map(map).filter((r): r is string => r !== null)
  saveConfig({ recent: { ...cfg.recent, [v.root]: list } })
}

/** Rename or move: pause the watcher for folders, then fix up recent list, links and index. */
async function relocate(rel: string, op: (v: Vault) => Promise<string>, sender?: Electron.WebContents): Promise<string> {
  const v = requireVault()
  const index = requireIndex()
  await flushOthers(sender) // unsaved edits in other windows land before anything moves
  await index.idle()
  const before = index.paths()
  const to = await withFolderUnlocked(v, rel, () => op(v))
  if (to === rel) return to
  updateRecent(v, (r) => movedPath(r, rel, to) ?? r)
  broadcast('vault:moved', [rel, to], sender) // other windows' editors and tabs follow
  if (await moveIcons(v, rel, to)) broadcast('icons:changed', [])
  await renameInProjectOrder(v, rel, to)
  await moveInTreeOrder(v, rel, to)
  const changed = await updateLinks(v, index, before, rel, to)
  for (const p of await fixRelativeLinks(v, before, rel, to)) if (!changed.includes(p)) changed.push(p)
  await index.rebuild()
  notify(changed.map((path) => ({ event: 'change', path })))
  return to
}

/** Requests from the Claude Code connector (src/mcp) while this vault is open */
async function answerConnector(req: BridgeRequest): Promise<unknown> {
  switch (req.op) {
    case 'flush':
      return flushOthers() // so the connector edits what's on screen, and editors don't overwrite it
    case 'rename':
      return relocate(req.path, (v) => v.rename(req.path, req.name, true))
    case 'move':
      return relocate(req.path, (v) => v.move(req.path, req.dest))
    default:
      throw new Error('Unknown request')
  }
}

/**
 * Ask, then move a file or folder to the Recycle Bin. `except` is a window that tidies up its own tabs;
 * every other window is told it's gone.
 */
async function trashPath(rel: string, asker: BrowserWindow, except?: Electron.WebContents, why?: string): Promise<boolean> {
  const v = requireVault()
  const abs = v.abs(rel)
  if (abs === v.root) throw new Error('Cannot delete the vault itself')
  const isDir = (await stat(abs)).isDirectory()
  const pages = v.pagesOf(rel)
  const { response } = await dialog.showMessageBox(asker, {
    type: 'warning',
    buttons: ['Move to Recycle Bin', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Delete',
    message: `Move "${basename(abs)}" to the Recycle Bin?`,
    detail: [
      why,
      pages ? 'Its sub-pages go too.' : '',
      isDir ? 'The folder and everything in it can be restored from the Recycle Bin.' : 'You can restore it from the Recycle Bin.'
    ]
      .filter(Boolean)
      .join(' ')
  })
  if (response !== 0) return false
  // Other windows stop editing (and saving) it before it goes
  await flushOthers(except)
  broadcast('vault:removed', [rel], except)
  await withFolderUnlocked(v, rel, async () => {
    await shell.trashItem(abs)
    if (pages) await shell.trashItem(v.abs(pages))
    if (rel.includes('/')) await v.pruneEmptyPages(posix.dirname(rel))
  })
  await dropFromTreeOrder(v, rel)
  if (await dropIcons(v, rel)) broadcast('icons:changed', [])
  updateRecent(v, (r) => (movedPath(r, rel, rel) ? null : r))
  await requireIndex().remove(rel)
  if (pages) await requireIndex().remove(pages)
  notify([{ event: isDir ? 'unlinkDir' : 'unlink', path: rel }])
  return true
}

/**
 * Undo a change made through the Claude Code connector: put an edited file's old text back (asking first if it has
 * changed since), rename/move back, or offer to bin something Claude created. Returns false if Bill cancelled.
 */
async function undoClaudeChange(id: string, asker: BrowserWindow): Promise<boolean> {
  const v = requireVault()
  const c = (await readChanges(v)).find((x) => x.id === id)
  if (!c) throw new Error('That change is no longer in the log.')
  if (c.undone) return true
  const exists = existsSync(v.abs(c.path))
  if (c.action === 'renamed' || c.action === 'moved') {
    if (!c.from) throw new Error("The log doesn't say where it was before.")
    if (!exists) throw new Error(`${c.path} isn't there any more.`)
    if (existsSync(v.abs(c.from))) throw new Error(`Something else is already at ${c.from}.`)
    const from = c.from
    await relocate(c.path, (vv) =>
      c.action === 'renamed' ? vv.rename(c.path, posix.basename(from), true) : vv.move(c.path, posix.dirname(from))
    )
  } else if (c.action === 'created') {
    if (exists && !(await trashPath(c.path, asker, undefined, 'Claude created it; undoing removes it.'))) return false
  } else {
    const old = c.hasSnapshot ? await readFile(v.abs(snapshotPath(c.id)), 'utf8').catch(() => null) : null
    if (old === null) throw new Error("The version from before this change wasn't kept (undo keeps them for 30 days).")
    const now = exists ? await v.read(c.path) : null
    if (now !== null && c.afterHash && hashText(now) !== c.afterHash) {
      const { response } = await dialog.showMessageBox(asker, {
        type: 'warning',
        buttons: ['Undo anyway', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Undo',
        message: `"${basename(c.path)}" has changed since Claude edited it.`,
        detail: "Undoing puts back the version from before Claude's change, so the later changes go too."
      })
      if (response !== 0) return false
    }
    await flushOthers() // open editors save first, then pick up the restored text
    await mkdir(v.abs(posix.dirname(c.path)), { recursive: true })
    await v.write(c.path, old)
    await requireIndex().update(c.path)
  }
  await markUndone(v, c.id)
  return true
}

/** Load the UI into a window; `hash` picks a mode (e.g. "capture" for the quick-capture window) */
function loadPage(w: BrowserWindow, hash = '') {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    w.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

/** Window chrome colours to match the app's theme (the caption buttons are drawn by Windows) */
function chrome() {
  const light = !nativeTheme.shouldUseDarkColors
  return light
    ? { background: '#f8f7f4', overlay: { color: '#f8f7f4', symbolColor: '#34322d', height: 38 } }
    : { background: '#17181b', overlay: { color: '#17181b', symbolColor: '#c9c6bf', height: 38 } }
}

function applyTheme() {
  nativeTheme.themeSource = prefs().theme
  const c = chrome()
  for (const w of appWindows()) {
    w.setBackgroundColor(c.background)
    w.setTitleBarOverlay(c.overlay)
  }
}

/** UI scale: zoom the page; the Windows caption strip has to grow with it to line up */
const chromeColors = new Map<number, { color: string; symbolColor: string }>() // per window (project colours)
function applyScale(w?: BrowserWindow | null) {
  const all = appWindows()
  // Only windows with the Windows caption overlay (never the popups)
  const targets = w ? all.filter((x) => x === w) : all
  const scale = Math.min(2, Math.max(0.6, prefs().uiScale || 1))
  for (const t of targets) {
    if (t.isDestroyed()) continue
    t.webContents.setZoomFactor(scale)
    try {
      t.setTitleBarOverlay({ ...chrome().overlay, ...(chromeColors.get(t.id) ?? {}), height: Math.round(38 * scale) })
    } catch (e) {
      console.warn('[chrome]', e) // never worth crashing over
    }
  }
}

/** Common setup for the main window and content windows */
function makeAppWindow(opts: Electron.BrowserWindowConstructorOptions, hash = ''): BrowserWindow {
  const c = chrome()
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 520,
    minHeight: 360,
    ...opts,
    show: false,
    backgroundColor: c.background,
    icon: appIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: c.overlay,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true }
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.on('did-finish-load', () => applyScale(w))
  // Let the page save what's being typed before the window goes (registered first, so it runs
  // before the main window's close-to-tray handler)
  let flushed = false
  w.on('close', (e) => {
    if (flushed || quitting) return // quitting saves every window up front (see before-quit)
    e.preventDefault()
    flushWindow(w).finally(() => {
      flushed = true
      if (!w.isDestroyed()) w.close()
      setImmediate(() => (flushed = false)) // still open (hidden to the tray): flush again next time
    })
  })
  // Open external links in the default browser, never inside the app
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.on('closed', () => chromeColors.delete(w.id))
  loadPage(w, hash)
  return w
}

function createWindow() {
  const cfg = loadConfig()
  const b = cfg.bounds ?? { width: 1280, height: 820 }
  nativeTheme.themeSource = prefs().theme

  win = makeAppWindow({ ...b, minWidth: 720, minHeight: 480 })
  if (b.maximized) win.maximize()

  const persist = () => {
    if (!win) return
    saveConfig({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } })
  }
  win.on('close', (e) => {
    persist()
    // Close-to-tray: hide instead, so the tray, hotkey and nudges keep working
    if (!quitting && prefs().closeToTray) {
      e.preventDefault()
      win?.hide()
      if (!loadConfig().trayHintShown) {
        saveConfig({ trayHintShown: true })
        toast('Waypoint is still running', 'It lives in the tray now. Right-click the ◆ icon to quit.', showMain)
      }
    }
  })
  win.on('closed', () => (win = null))
}

function registerIpc() {
  ipcMain.handle('vault:get', () => info())

  ipcMain.handle('vault:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Open or create a vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return info()
    const v = new Vault(r.filePaths[0])
    if (!v.isSetUp()) {
      const choice = await dialog.showMessageBox(win!, {
        type: 'question',
        buttons: ['Set up vault', 'Just open', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Set up this folder?',
        message: `Set up "${v.name}" as a Waypoint vault?`,
        detail:
          'Adds notes/, ideas/, projects/ and a small .app/ settings folder. Existing files are never changed.'
      })
      if (choice.response === 2) return info()
      if (choice.response === 0) await v.setUp()
    }
    await setVault(v.root)
    return info()
  })

  ipcMain.handle('vault:tree', () => requireVault().tree())
  ipcMain.handle('tree:order', () => readTreeOrder(requireVault()))
  ipcMain.handle('tree:saveOrder', (_e, dir: string, names: string[]) => saveTreeOrder(requireVault(), dir, names))
  ipcMain.handle('vault:stats', () => requireVault().stats())
  ipcMain.handle('file:read', (_e, rel: string) => requireVault().read(rel))
  ipcMain.handle('file:write', (_e, rel: string, content: string) => requireVault().write(rel, content))
  ipcMain.handle('file:createNote', async (_e, dir: string, name?: string) => {
    const rel = await requireVault().createNote(dir, name)
    await requireIndex().update(rel) // so a [[link]] to it resolves straight away
    return rel
  })
  ipcMain.handle('file:createFolder', (_e, dir: string, name: string) =>
    requireVault().createFolder(dir, name)
  )
  ipcMain.handle('file:rename', (e, rel: string, name: string, syncHeading: boolean) =>
    relocate(rel, (v) => v.rename(rel, name, syncHeading), e.sender)
  )
  ipcMain.handle('file:move', (e, rel: string, destDir: string) => relocate(rel, (v) => v.move(rel, destDir), e.sender))
  ipcMain.handle('file:duplicate', async (_e, rel: string) => {
    const to = await requireVault().duplicate(rel)
    await requireIndex().rebuild()
    return to
  })
  ipcMain.handle('file:trash', (e, rel: string) =>
    trashPath(rel, BrowserWindow.fromWebContents(e.sender) ?? win!, e.sender)
  )
  ipcMain.handle('index:search', async (_e, query: string) => {
    await requireIndex().idle()
    return requireIndex().find(query)
  })
  ipcMain.handle('index:backlinks', async (_e, rel: string) => {
    await requireIndex().idle()
    return requireIndex().backlinks(rel)
  })
  ipcMain.handle('settings:get', () => requireVault().settings())
  ipcMain.handle('settings:save', async (_e, settings: VaultSettings) => {
    await requireVault().saveSettings(settings)
    scheduleAutoCommit()
  })
  ipcMain.handle('git:status', async () => ({ ...(await requireGit().status()), ...pushState }))
  ipcMain.handle('git:init', () => requireGit().init())
  ipcMain.handle('git:commit', async (_e, message: string) => {
    const g = requireGit()
    const committed = await g.commitIfChanged(message.trim() || `Update ${new Date().toLocaleString('en-GB')}`)
    if (committed && (await requireVault().settings()).git.autoPush) void pushIfNeeded(g)
    return committed
  })
  ipcMain.handle('git:pull', async () => {
    const g = requireGit()
    const summary = await g.pull()
    if ((await requireVault().settings()).git.autoPush) void pushIfNeeded(g)
    return summary
  })
  ipcMain.handle('git:push', () => pushVault(requireGit(), false))
  ipcMain.handle('git:connectRemote', async (_e, url: string) => {
    const v = requireVault()
    const g = requireGit()
    await g.setRemote(url)
    const settings = await v.settings()
    await v.saveSettings({ ...settings, git: { ...settings.git, autoCommit: true, autoPush: true } })
    await scheduleAutoCommit()
    await g.commitIfChanged(`Update ${new Date().toLocaleString('en-GB')}`)
    await pushVault(g, false) // the user is here, so this one may ask them to sign in
  })
  ipcMain.handle('git:log', (_e, file?: string) => requireGit().log(file))
  ipcMain.handle('git:diff', (_e, hash: string, file?: string) =>
    hash === 'working' ? requireGit().workingDiff(file) : requireGit().diff(hash, file)
  )
  ipcMain.handle('tasks:list', (_e, project?: string) => listTasks(requireVault(), project))
  ipcMain.handle('tasks:create', async (_e, project: string, fields: Partial<TaskFields>) => {
    const rel = await createTask(requireVault(), project, fields)
    await requireIndex().update(rel)
    return rel
  })
  ipcMain.handle('tasks:update', (_e, rel: string, patch: Partial<TaskFields>) => {
    if (!isTaskPath(rel)) throw new Error('Not a task')
    return updateTask(requireVault(), rel, patch)
  })
  ipcMain.handle('boards:create', (_e, dir: string, name: string) => createBoard(requireVault(), dir, name))
  ipcMain.handle('projects:list', () => listProjects(requireVault()))
  ipcMain.handle('projects:order', (_e, slugs: string[]) => saveProjectOrder(requireVault(), slugs))
  ipcMain.handle('projects:create', async (_e, name: string) => {
    const slug = await createProject(requireVault(), name)
    await requireIndex().rebuild()
    return slug
  })
  ipcMain.handle('projects:save', (_e, slug: string, settings: ProjectSettings) =>
    saveProject(requireVault(), slug, settings)
  )

  // Paths outside the vault come from project settings; refuse anything a project doesn't list,
  // so the UI can never be used to open arbitrary files (openPath would run an .exe)
  const allowedExternal = async (path: string) => {
    if (!(await knownExternalPaths(requireVault())).has(path.toLowerCase())) {
      throw new Error('That path is not listed in any project')
    }
    return path
  }
  ipcMain.handle('ext:open', async (_e, path: string) => {
    const err = await shell.openPath(await allowedExternal(path))
    if (err) throw new Error(err)
  })
  ipcMain.handle('ext:reveal', async (_e, path: string) => shell.showItemInFolder(await allowedExternal(path)))
  ipcMain.handle('ext:code', async (_e, path: string) => {
    await shell.openExternal(`vscode://file/${encodeURI((await allowedExternal(path)).replace(/\\/g, '/'))}`)
  })
  ipcMain.handle('ext:pick', async (_e, kind: 'file' | 'folder') => {
    const r = await dialog.showOpenDialog(win!, {
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile']
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  // Optional Claude Code integration: repo folders come from the project file, never from the page
  const repoOf = async (slug: string) => {
    const p = await readProject(requireVault(), slug)
    if (!p.repo.path) throw new Error("Set the project's code repository folder first.")
    return p
  }
  ipcMain.handle('claude:status', async (_e, slug?: string) =>
    claudeStatus(slug && vault ? (await readProject(vault, slug)).repo.path || undefined : undefined)
  )
  ipcMain.handle('claude:connect', () => connectClaude())
  // "Changed by Claude": a project's changes (or all), newest first
  ipcMain.handle('claude:changes', async (_e, slug?: string, limit = 50) => {
    const all = vault ? await readChanges(vault) : []
    const dir = slug ? `projects/${slug}` : ''
    const inProject = (p?: string) => !!p && (p === dir || p.startsWith(dir + '/'))
    return (slug ? all.filter((c) => inProject(c.path) || inProject(c.from)) : all).slice(0, limit)
  })
  ipcMain.handle('claude:undo', (e, id: string) => undoClaudeChange(id, BrowserWindow.fromWebContents(e.sender) ?? win!))
  ipcMain.handle('claude:disconnect', () => disconnectClaude())
  ipcMain.handle('claude:instructions', async (_e, slug: string) => {
    const p = await repoOf(slug)
    await writeInstructions(p.repo.path, p.title, p.slug)
  })
  ipcMain.handle('claude:open', async (_e, slug: string, where: 'app' | 'terminal') => {
    const p = await repoOf(slug)
    await (where === 'app' ? openInClaudeApp(p.repo.path, `Let's work on ${p.title}. What's open?`) : openInClaudeTerminal(p.repo.path))
  })
  // A new session in the project's repo that starts on this task; offers to set the project up first if it isn't
  ipcMain.handle('claude:send-task', async (e, rel: string, where: 'app' | 'terminal') => {
    const task = (await listTasks(requireVault())).find((t) => t.path === rel)
    if (!task) throw new Error(`Couldn't find the task ${rel}.`)
    const p = await repoOf(task.project)
    const status = await claudeStatus(p.repo.path)
    if (!status.cli) throw new Error(CLI_NOT_FOUND)
    if (status.connector !== 'connected' || !status.instructions) {
      const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender) ?? win!, {
        type: 'question',
        buttons: ['Set up and send', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Claude Code',
        message: `Set up ${p.title} for Claude Code first?`,
        detail: 'The session needs Waypoint connected to read the task, and instructions for this project in the repo (CLAUDE.local.md, kept out of git).'
      })
      if (response !== 0) return
      if (status.connector !== 'connected') await connectClaude()
      await writeInstructions(p.repo.path, p.title, p.slug)
    }
    const prompt = taskPrompt(task.id, task.title)
    await (where === 'app' ? openInClaudeApp(p.repo.path, prompt) : openInClaudeTerminal(p.repo.path, prompt))
  })

  ipcMain.handle('file:reveal', (_e, rel: string) => shell.showItemInFolder(requireVault().abs(rel)))

  ipcMain.handle('recent:get', () => (vault ? (loadConfig().recent[vault.root] ?? []) : []))
  ipcMain.handle('recent:touch', (_e, rel: string) => {
    const v = requireVault()
    const cfg = loadConfig()
    const list = [rel, ...(cfg.recent[v.root] ?? []).filter((r) => r !== rel)].slice(0, MAX_RECENT)
    saveConfig({ recent: { ...cfg.recent, [v.root]: list } })
    updateJumpList(list)
    return list
  })

  ipcMain.handle('prefs:get', () => prefs())
  ipcMain.handle('prefs:save', (_e, p: Prefs) => {
    saveConfig({ prefs: withDefaults(p) })
    applyPrefs(prefs(), desktopHooks)
    applyTheme()
    applyScale()
    broadcast('prefs:changed', [prefs()]) // theme, fonts, scale follow in every window
    onPrefsChanged()
    return prefs()
  })
  ipcMain.handle('desktop:info', (): DesktopInfo => ({
    packaged: app.isPackaged,
    hotkey: hotkeyRegistered('capture'),
    searchHotkey: hotkeyRegistered('search')
  }))
  ipcMain.handle('capture:add', async (_e, text: string) => {
    await requireVault().addIdea(text)
    closePopup('capture')
  })
  ipcMain.on('capture:close', () => closePopup('capture'))
  ipcMain.on('search:close', () => closePopup('search'))
  ipcMain.on('popup:height', (e, px: number) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w === win || !Number.isFinite(px)) return
    const [width] = w.getSize()
    w.setResizable(true)
    w.setSize(width, Math.round(Math.min(Math.max(px, 60), 520)))
    w.setResizable(false)
  })
  // A pick in the search popup opens in the main window
  ipcMain.on('search:open', (_e, c: AppCommand) => {
    closePopup('search')
    if (c.kind === 'open' && vault && vault.isNote(c.path)) runCommand(c)
  })
  ipcMain.handle('fonts:list', () => installedFonts())

  // Icons for notes, boards, folders, tasks and projects
  const iconChanged = () => broadcast('icons:changed', [])
  ipcMain.handle('icons:get', () => readIcons(requireVault()))
  ipcMain.handle('icons:set', async (_e, path: string, icon: string | null) => {
    await setIcon(requireVault(), path, icon)
    iconChanged()
  })
  ipcMain.handle('icons:fromFile', async (e, path: string) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? win!, {
      title: 'Choose an image for the icon',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const icon = await iconFromFile(requireVault(), r.filePaths[0])
    await setIcon(requireVault(), path, icon)
    iconChanged()
    return icon
  })
  ipcMain.handle('icons:fromUrl', async (_e, path: string, url: string) => {
    const icon = await iconFromUrl(requireVault(), url)
    await setIcon(requireVault(), path, icon)
    iconChanged()
    return icon
  })
  // Pictures in notes: saved to attachments/, returned as vault-relative paths
  ipcMain.handle('attachments:save', (_e, name: string, data: Uint8Array) =>
    saveAttachment(requireVault(), name, Buffer.from(data))
  )
  ipcMain.handle('attachments:pick', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? win!, {
      title: 'Add a picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: IMAGE_EXT }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    return saveAttachment(requireVault(), basename(file), await readFile(file))
  })
  // Windows' own emoji panel (Win+.); it types into whatever has focus
  ipcMain.on('icons:emojiPanel', () => app.showEmojiPanel())

  // Windows: open content in a window of its own; one editor per note across all windows
  ipcMain.handle('window:open', (_e, views: ViewRef[], atCursor?: boolean) => {
    if (views.length) openContentWindow(views, atCursor ? screen.getCursorScreenPoint() : undefined)
  })
  ipcMain.handle('window:info', (e) => ({ id: e.sender.id, main: e.sender === win?.webContents }))
  ipcMain.handle('window:claim', (e, path: string) => {
    const other = windowHolding(path, e.sender)
    if (!other) return false
    if (other.isMinimized()) other.restore()
    other.show()
    other.focus()
    other.webContents.send('app:command', { kind: 'open', path } satisfies AppCommand)
    return true
  })
  ipcMain.on('window:showMain', () => showMain())
  ipcMain.on('window:revealInMain', (_e, path: string) => runCommand({ kind: 'reveal', path }))
  ipcMain.on('edit:action', (e, action: string) => {
    if (action === 'cut') e.sender.cut()
    else if (action === 'copy') e.sender.copy()
    else if (action === 'paste') e.sender.paste()
    else if (action === 'selectAll') e.sender.selectAll()
  })
  ipcMain.on('window:close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && isContentWindow(w)) w.close()
  })
  ipcMain.on('theme:chrome', (e, background: string, symbols: string) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed() || !/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(symbols)) return
    w.setBackgroundColor(background)
    // Popups (quick capture/search) have no title-bar buttons to restyle or scale
    if (!appWindows().includes(w)) return
    chromeColors.set(w.id, { color: background, symbolColor: symbols })
    applyScale(w)
  })
  // The UI asks for this once it's listening, so launch commands (jump list) aren't lost
  ipcMain.on('app:ready', (e) => {
    if (pendingCommand && e.sender === win?.webContents) {
      e.sender.send('app:command', pendingCommand)
      pendingCommand = null
    }
  })
}

/** Called when preferences change (nudges hook in here) */
let onPrefsChanged = () => {}
export const setOnPrefsChanged = (fn: () => void) => (onPrefsChanged = fn)

let quitting = false
let pendingCommand: AppCommand | null = null

function showMain() {
  if (!win || win.isDestroyed()) createWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

/** Run a command from the jump list, tray, a toast or a second launch */
function runCommand(c: AppCommand) {
  if (c.kind === 'capture') {
    if (!vault) return showMain() // nowhere to capture to yet
    return openPopup('capture', preloadPath(), loadPage, win)
  }
  if (c.kind === 'search') {
    if (!vault) return showMain()
    return openPopup('search', preloadPath(), loadPage, win)
  }
  if (c.kind === 'snooze') {
    const p = prefs()
    saveConfig({ prefs: { ...p, nudges: { ...p.nudges, snoozedUntil: Date.now() + c.minutes * 60_000 } } })
    return toast('Nudges snoozed', `No nudges for ${c.minutes >= 60 ? `${c.minutes / 60} hour(s)` : `${c.minutes} minutes`}.`)
  }
  showMain()
  if (win && !win.webContents.isLoading()) win.webContents.send('app:command', c)
  else pendingCommand = c
}

const desktopHooks = {
  showMain,
  command: runCommand,
  quit: () => {
    quitting = true
    app.quit()
  }
}

registerIconScheme() // before the app is ready
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const c = commandFromArgv(argv)
    if (c) runCommand(c)
    else showMain()
  })

  // Save what's being typed in every window, then quit (holding a window's close would cancel it)
  let quitFlushed = false
  app.on('before-quit', (e) => {
    quitting = true
    if (quitFlushed) return
    e.preventDefault()
    flushOthers().finally(() => {
      quitFlushed = true
      app.quit()
    })
  })
  nativeTheme.on('updated', () => applyTheme()) // Windows switched light/dark while on "system"

  app.whenReady().then(async () => {
    // Windows picks taskbar icons and toast identity by this id. Dev builds get their own, or they
    // claim the installed app's id (Electron then makes an "Electron" Start-menu shortcut for it,
    // and the installed Waypoint shows Electron's icon in the taskbar)
    app.setAppUserModelId(app.isPackaged ? 'com.billlowe.waypoint' : 'com.billlowe.waypoint.dev')
    // The default menu's accelerators (Ctrl+R reload, Ctrl+W close) fight the app's own
    // shortcuts and a reload can drop an unsaved edit. Keep them in dev for reload/DevTools.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    registerIpc()
    serveIcons(() => vault)
    serveAttachments(() => vault)
    initWindows({
      main: () => win,
      create: (opts, hash) => makeAppWindow(opts, hash),
      quitting: () => quitting
    })
    const last = loadConfig().vaultPath
    await setVault(last && existsSync(last) ? last : undefined)
    setupTray(desktopHooks)
    applyPrefs(prefs(), desktopHooks)
    const nudges = startNudges({
      vault: () => vault,
      prefs,
      lastNudge: () => ({ at: loadConfig().lastNudge ?? 0, key: loadConfig().lastNudgeKey ?? '' }),
      setLastNudge: (at, key) => saveConfig({ lastNudge: at, lastNudgeKey: key }),
      show: (n) => {
        // In front: say it in the app. Otherwise a Windows notification (the installed app only:
        // Windows drops toasts from apps without a Start-menu entry, e.g. this dev build)
        if (win && win.isVisible() && win.isFocused()) {
          win.webContents.send('app:command', {
            kind: 'nudge',
            nudge: { key: n.key, title: n.title, message: n.body, open: n.command }
          } satisfies AppCommand)
        } else toast(n.title, n.body, () => runCommand(n.command))
      },
      nothing: () => toast('Nothing to nudge about', 'No overdue, due-soon or waiting tasks, and no quiet projects. Nice.')
    })
    ipcMain.handle('nudge:now', () => nudges.now())

    // Backups: on demand, and daily (checked at start and every few hours) when set up
    const runBackup = async () => {
      const v = requireVault()
      const p = prefs()
      const file = await backupNow(v, p.backup.dir, p.backup.keep)
      saveConfig({ prefs: { ...p, backup: { ...p.backup, last: Date.now() } } })
      return file
    }
    ipcMain.handle('backup:now', runBackup)
    const dailyBackup = () => {
      const { backup } = prefs()
      if (vault && backup.dir && backup.daily && Date.now() - backup.last > 24 * 3600_000) {
        runBackup().catch((e) => toast('Backup failed', (e as Error).message))
      }
    }
    setTimeout(dailyBackup, 2 * 60_000)
    setInterval(dailyBackup, 3 * 3600_000)
    if (vault) updateJumpList(loadConfig().recent[vault.root] ?? [])
    const hidden = process.argv.includes('--hidden') // started with Windows: tray only
    pendingCommand = commandFromArgv(process.argv)
    if (pendingCommand?.kind === 'capture') {
      const c = pendingCommand
      pendingCommand = null
      runCommand(c)
    } else if (!hidden || !prefs().closeToTray) {
      createWindow()
    }
    if (vault && !hidden) restoreWindows() // content windows open at last quit
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.on('window-all-closed', () => {
    // With close-to-tray, the app keeps running (tray icon, hotkey, nudges) until Quit
    if (quitting || !prefs().closeToTray) {
      watcher?.close()
      app.quit()
    }
  })
}
