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
  bindHotkey('capture', p.captureHotkey, () => h.command({ kind: 'capture' }))
  bindHotkey('search', p.searchHotkey, () => h.command({ kind: 'search' }))
}

/** Global hotkeys by purpose → the accelerator actually registered ('' if none / taken) */
const hotkeys: Record<string, string> = {}

function bindHotkey(purpose: string, accel: string, fn: () => void) {
  const current = hotkeys[purpose] ?? ''
  if (current === accel) return
  if (current) globalShortcut.unregister(current)
  hotkeys[purpose] = ''
  if (!accel) return
  try {
    if (globalShortcut.register(accel, fn)) hotkeys[purpose] = accel
    else console.warn(`[hotkey] ${purpose}: already taken by another app:`, accel)
  } catch (e) {
    console.warn(`[hotkey] ${purpose}: invalid:`, accel, e)
  }
}

function launchItem(args: string[]) {
  const l = launch(args)
  return { path: l.program, args: l.args ? l.args.split(' ') : [] }
}

export const hotkeyRegistered = (purpose: 'capture' | 'search' = 'capture') => hotkeys[purpose] ?? ''

/** Windows toast; click runs the command */
export function toast(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon(), silent: false })
  if (onClick) n.on('click', onClick)
  n.show()
}

/** Launcher-style popups: quick capture (jot into the inbox) and quick search */
const POPUPS = { capture: { width: 520, height: 190 }, search: { width: 640, height: 440 } }
const popups: Partial<Record<keyof typeof POPUPS, BrowserWindow>> = {}

export function openPopup(
  kind: keyof typeof POPUPS,
  preload: string,
  loadPage: (w: BrowserWindow, hash: string) => void,
  /** The main window, to centre over */
  over?: BrowserWindow | null
) {
  const open = popups[kind]
  if (open && !open.isDestroyed()) {
    open.show()
    open.focus()
    return
  }
  const { width, height } = POPUPS[kind]
  // Centred over Waypoint when its window is showing, otherwise on the screen under the mouse
  const area =
    over && over.isVisible() && !over.isMinimized()
      ? over.getBounds()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const w = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.max(40, area.height * 0.15)),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // A solid frameless window: Windows 11 gives it rounded corners and a real drop shadow
    // (a transparent window's CSS shadow gets clipped at the window edge)
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: '#212227',
    icon: appIcon(),
    webPreferences: { preload, contextIsolation: true, sandbox: true }
  })
  popups[kind] = w
  w.once('ready-to-show', () => w.show())
  w.on('blur', () => w.close()) // click away = cancel, like a launcher
  w.on('closed', () => {
    if (popups[kind] === w) delete popups[kind]
  })
  loadPage(w, kind)
}

export function closePopup(kind: keyof typeof POPUPS) {
  popups[kind]?.close()
}

export const preloadPath = () => join(__dirname, '../preload/index.js')
