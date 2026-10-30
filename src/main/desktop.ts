import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Notification, Tray, screen } from 'electron'
import { join } from 'path'
import { APP_ICON_PNG, TRAY_ICON_PNG, TRAY_ICON_PNG_2X } from './iconData'
import type { AppCommand } from '@shared/types'
import type { Prefs } from '@shared/prefs'

// Windows 11 integration: tray, jump list, toasts, start with Windows, global quick capture.

export const appIcon = () => nativeImage.createFromDataURL(APP_ICON_PNG)

function trayIcon() {
  const img = nativeImage.createFromDataURL(TRAY_ICON_PNG)
  img.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_PNG_2X })
  return img
}

/** How a jump-list entry or login item re-launches the app (dev needs the app folder too) */
function launch(args: string[]): { program: string; args: string } {
  const prefix = app.isPackaged ? [] : [`"${app.getAppPath()}"`]
  return { program: process.execPath, args: [...prefix, ...args].join(' ') }
}

/** Read a command from the command line (jump list, tray, toasts and second launches use these) */
export function commandFromArgv(argv: string[]): AppCommand | null {
  for (const a of argv) {
    if (a === '--new-note') return { kind: 'new-note' }
    if (a === '--home') return { kind: 'home' }
    if (a === '--capture') return { kind: 'capture' }
    if (a.startsWith('--open=')) return { kind: 'open', path: a.slice('--open='.length).replace(/^"|"$/g, '') }
  }
  return null
}

interface Hooks {
  showMain(): void
  command(c: AppCommand): void
  quit(): void
}

let tray: Tray | null = null
let captureWin: BrowserWindow | null = null
let registeredHotkey = ''

export function setupTray(h: Hooks) {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Waypoint')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Waypoint', click: h.showMain },
      { label: 'Quick capture…', click: () => h.command({ kind: 'capture' }) },
      { label: 'New note', click: () => h.command({ kind: 'new-note' }) },
      { type: 'separator' },
      { label: 'Snooze nudges for 1 hour', click: () => h.command({ kind: 'snooze', minutes: 60 }) },
      { type: 'separator' },
      { label: 'Quit Waypoint', click: h.quit }
    ])
  )
  tray.on('click', h.showMain)
}

/** Taskbar jump list: common actions plus recent notes */
export function updateJumpList(recent: string[]) {
  if (process.platform !== 'win32') return
  const task = (title: string, args: string[], description: string) => ({
    type: 'task' as const,
    title,
    description,
    ...launch(args),
    iconPath: process.execPath,
    iconIndex: 0
  })
  try {
    app.setJumpList([
      {
        type: 'tasks',
        items: [
          task('New note', ['--new-note'], 'Create a note in the open vault'),
          task('Quick capture', ['--capture'], 'Jot something into the inbox'),
          task('Open Home', ['--home'], 'Go to the Home page')
        ]
      },
      {
        type: 'custom',
        name: 'Recent notes',
        items: recent.slice(0, 8).map((rel) =>
          task(rel.split('/').pop()!.replace(/\.md$/i, ''), [`"--open=${rel}"`], rel)
        )
      }
    ])
  } catch (e) {
    console.error('[jump list]', e)
  }
}

/** Login item and global hotkey follow the preferences */
export function applyPrefs(p: Prefs, h: Hooks) {
  if (app.isPackaged) {
    // Only the installed app registers itself; a dev build at login would be confusing
    app.setLoginItemSettings({ openAtLogin: p.startWithWindows, ...launchItem(['--hidden']) })
  }
  if (registeredHotkey && registeredHotkey !== p.captureHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = ''
  }
  if (p.captureHotkey && !registeredHotkey) {
    try {
      if (globalShortcut.register(p.captureHotkey, () => h.command({ kind: 'capture' }))) {
        registeredHotkey = p.captureHotkey
      } else {
        console.warn('[hotkey] already taken by another app:', p.captureHotkey)
      }
    } catch (e) {
      console.warn('[hotkey] invalid:', p.captureHotkey, e)
    }
  }
}

function launchItem(args: string[]) {
  const l = launch(args)
  return { path: l.program, args: l.args ? l.args.split(' ') : [] }
}

export const hotkeyRegistered = () => registeredHotkey

/** Windows toast; click runs the command */
export function toast(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon(), silent: false })
  if (onClick) n.on('click', onClick)
  n.show()
}

/** Small always-on-top window for jotting into the inbox from anywhere */
export function openCapture(preload: string, loadPage: (w: BrowserWindow, hash: string) => void) {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.show()
    captureWin.focus()
    return
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 520
  const height = 190
  captureWin = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height * 0.25),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#212227',
    icon: appIcon(),
    webPreferences: { preload, contextIsolation: true, sandbox: true }
  })
  captureWin.once('ready-to-show', () => captureWin?.show())
  captureWin.on('blur', () => captureWin?.close()) // click away = cancel, like a launcher
  captureWin.on('closed', () => (captureWin = null))
  loadPage(captureWin, 'capture')
}

export function closeCapture() {
  captureWin?.close()
}

export const preloadPath = () => join(__dirname, '../preload/index.js')
