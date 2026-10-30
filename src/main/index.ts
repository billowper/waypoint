import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, shell, nativeTheme } from 'electron'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { watch, type FSWatcher } from 'chokidar'
import { Vault } from './vault'
import { NotesIndex } from './notesIndex'
import { createProject, knownExternalPaths, listProjects, saveProject } from './projects'
import { createTask, isTaskPath, listTasks, updateTask } from './tasks'
import { VaultGit } from './git'
import type { ProjectSettings, TaskFields, VaultSettings } from '@shared/types'
import { loadConfig, prefs, saveConfig } from './config'
import {
  applyPrefs,
  appIcon,
  closeCapture,
  commandFromArgv,
  hotkeyRegistered,
  openCapture,
  preloadPath,
  setupTray,
  toast,
  updateJumpList
} from './desktop'
import { withDefaults, type Prefs } from '@shared/prefs'
import { startNudges } from './nudges'
import type { AppCommand, DesktopInfo } from '@shared/types'
import type { ChangeEvent, VaultInfo } from '@shared/types'
import { movedPath } from '@shared/names'
import { formatLink, linkTextFor, parseLinks, resolveLink } from '@shared/links'

let win: BrowserWindow | null = null
let vault: Vault | null = null
let notes: NotesIndex | null = null
let git: VaultGit | null = null
let watcher: FSWatcher | null = null

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

/** Optional auto-commit (off by default): commits any changes every N minutes. */
let autoCommitTimer: NodeJS.Timeout | null = null
async function scheduleAutoCommit() {
  if (autoCommitTimer) clearInterval(autoCommitTimer)
  autoCommitTimer = null
  const v = vault
  if (!v) return
  const { git: g } = await v.settings()
  if (!g.autoCommit) return
  autoCommitTimer = setInterval(async () => {
    if (vault !== v || !git?.isRepo()) return
    try {
      if (await git.commitIfChanged(`Auto-commit ${new Date().toLocaleString('en-GB')}`)) {
        win?.webContents.send('git:changed')
      }
    } catch (e) {
      console.error('[auto-commit]', e) // e.g. conflicts: leave it for Bill to sort out
    }
  }, g.intervalMinutes * 60_000)
}

async function setVault(path: string | undefined) {
  await watcher?.close()
  watcher = null
  vault = path ? new Vault(path) : null
  notes = vault ? new NotesIndex(vault) : null
  git = vault ? new VaultGit(vault.root) : null
  saveConfig({ vaultPath: path })
  if (vault) {
    notes!.rebuild()
    startWatching(vault)
  }
  scheduleAutoCommit()
}

function notify(events: ChangeEvent[]) {
  if (events.length) win?.webContents.send('vault:changed', events)
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
  const isDir = (await stat(v.abs(rel))).isDirectory()
  if (isDir) {
    await watcher?.close()
    watcher = null
  }
  try {
    return await op()
  } finally {
    if (isDir && vault === v && !watcher) startWatching(v)
  }
}

function updateRecent(v: Vault, map: (r: string) => string | null) {
  const cfg = loadConfig()
  const list = (cfg.recent[v.root] ?? []).map(map).filter((r): r is string => r !== null)
  saveConfig({ recent: { ...cfg.recent, [v.root]: list } })
}

/** Rewrite [[links]] that pointed at notes under `from` so they point at `to` instead. */
async function updateLinks(v: Vault, before: string[], from: string, to: string): Promise<string[]> {
  const moved = new Map<string, string>()
  for (const p of before) {
    const dest = movedPath(p, from, to)
    if (dest) moved.set(p, dest)
  }
  if (!moved.size) return []
  const after = before.map((p) => moved.get(p) ?? p)
  const changed: string[] = []
  for (const oldPath of requireIndex().linkersOf(new Set(moved.keys()), before)) {
    const path = moved.get(oldPath) ?? oldPath
    const text = await v.read(path).catch(() => null)
    if (text === null) continue
    let out = text
    for (const l of parseLinks(text).reverse()) {
      const target = resolveLink(l.target, oldPath, before)
      const dest = target ? moved.get(target) : undefined
      // Name-only links usually still work after a folder move; only rewrite the ones that break
      if (!dest || resolveLink(l.target, path, after) === dest) continue
      out = out.slice(0, l.from) + formatLink(linkTextFor(dest, after), l.heading, l.alias) + out.slice(l.to)
    }
    if (out !== text) {
      await v.write(path, out)
      changed.push(path)
    }
  }
  return changed
}

/** Rename or move: pause the watcher for folders, then fix up recent list, links and index. */
async function relocate(rel: string, op: (v: Vault) => Promise<string>): Promise<string> {
  const v = requireVault()
  const index = requireIndex()
  await index.idle()
  const before = index.paths()
  const to = await withFolderUnlocked(v, rel, () => op(v))
  if (to === rel) return to
  updateRecent(v, (r) => movedPath(r, rel, to) ?? r)
  const changed = await updateLinks(v, before, rel, to)
  await index.rebuild()
  notify(changed.map((path) => ({ event: 'change', path })))
  return to
}

/** Load the UI into a window; `hash` picks a mode (e.g. "capture" for the quick-capture window) */
function loadPage(w: BrowserWindow, hash = '') {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    w.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow() {
  const cfg = loadConfig()
  const b = cfg.bounds ?? { width: 1280, height: 820 }
  nativeTheme.themeSource = 'dark'

  win = new BrowserWindow({
    ...b,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#17181b',
    icon: appIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#17181b', symbolColor: '#c9c6bf', height: 38 },
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true
    }
  })
  if (b.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

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

  // Open external links in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  loadPage(win)
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
          'Adds notes/, projects/, inbox.md and a small .app/ settings folder. Existing files are never changed.'
      })
      if (choice.response === 2) return info()
      if (choice.response === 0) await v.setUp()
    }
    await setVault(v.root)
    return info()
  })

  ipcMain.handle('vault:tree', () => requireVault().tree())
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
  ipcMain.handle('file:rename', (_e, rel: string, name: string, syncHeading: boolean) =>
    relocate(rel, (v) => v.rename(rel, name, syncHeading))
  )
  ipcMain.handle('file:move', (_e, rel: string, destDir: string) => relocate(rel, (v) => v.move(rel, destDir)))
  ipcMain.handle('file:duplicate', async (_e, rel: string) => {
    const to = await requireVault().duplicate(rel)
    await requireIndex().rebuild()
    return to
  })
  ipcMain.handle('file:trash', async (_e, rel: string) => {
    const v = requireVault()
    const abs = v.abs(rel)
    if (abs === v.root) throw new Error('Cannot delete the vault itself')
    const isDir = (await stat(abs)).isDirectory()
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Delete',
      message: `Move "${basename(abs)}" to the Recycle Bin?`,
      detail: isDir
        ? 'The folder and everything in it can be restored from the Recycle Bin.'
        : 'You can restore it from the Recycle Bin.'
    })
    if (response !== 0) return false
    await withFolderUnlocked(v, rel, () => shell.trashItem(abs))
    updateRecent(v, (r) => (movedPath(r, rel, rel) ? null : r))
    await requireIndex().remove(rel)
    notify([{ event: isDir ? 'unlinkDir' : 'unlink', path: rel }])
    return true
  })
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
  ipcMain.handle('git:status', () => requireGit().status())
  ipcMain.handle('git:init', () => requireGit().init())
  ipcMain.handle('git:commit', (_e, message: string) =>
    requireGit().commitIfChanged(message.trim() || `Update ${new Date().toLocaleString('en-GB')}`)
  )
  ipcMain.handle('git:pull', () => requireGit().pull())
  ipcMain.handle('git:push', () => requireGit().push())
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
  ipcMain.handle('projects:list', () => listProjects(requireVault()))
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
    onPrefsChanged()
    return prefs()
  })
  ipcMain.handle('desktop:info', (): DesktopInfo => ({ packaged: app.isPackaged, hotkey: hotkeyRegistered() }))
  ipcMain.handle('capture:add', async (_e, text: string) => {
    await requireVault().appendToInbox(text)
    closeCapture()
  })
  ipcMain.on('capture:close', () => closeCapture())
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
    return openCapture(preloadPath(), loadPage)
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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const c = commandFromArgv(argv)
    if (c) runCommand(c)
    else showMain()
  })

  app.on('before-quit', () => (quitting = true))

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.billlowe.waypoint')
    // The default menu's accelerators (Ctrl+R reload, Ctrl+W close) fight the app's own
    // shortcuts and a reload can drop an unsaved edit. Keep them in dev for reload/DevTools.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    registerIpc()
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
