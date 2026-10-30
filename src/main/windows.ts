import { BrowserWindow, ipcMain, screen, type Rectangle, type WebContents } from 'electron'
import type { ViewRef } from '@shared/types'
import { loadConfig, saveConfig } from './config'

/**
 * Every Waypoint window beyond the main one: "content windows" that hold their own tabs (opened
 * from "Open in new window" or by dragging a tab out). Each window reports what it has open, so a
 * note is only ever edited in one place, and content windows come back after a restart.
 */

interface Reported {
  views: ViewRef[]
  /** Notes and boards open in that window (for "already open elsewhere?") */
  paths: string[]
}

interface Deps {
  main(): BrowserWindow | null
  create(opts: Electron.BrowserWindowConstructorOptions, hash: string): BrowserWindow
  quitting(): boolean
}

let deps: Deps
const reported = new Map<number, Reported>() // by webContents id, main window included
const content = new Set<BrowserWindow>()
let persistTimer: NodeJS.Timeout | null = null

export function initWindows(d: Deps) {
  deps = d
  ipcMain.on('window:state', (e, state: Reported) => {
    reported.set(e.sender.id, state)
    schedulePersist()
  })
  ipcMain.on('editors:flushed', (_e, token: string) => {
    pendingFlush.get(token)?.()
    pendingFlush.delete(token)
  })
}

/** Main window plus content windows (not the capture/search popups) */
export function appWindows(): BrowserWindow[] {
  const main = deps.main()
  return [...(main && !main.isDestroyed() ? [main] : []), ...[...content].filter((w) => !w.isDestroyed())]
}

export const isContentWindow = (w: BrowserWindow | null) => !!w && content.has(w)

export function broadcast(channel: string, args: unknown[], except?: WebContents) {
  for (const w of appWindows()) if (w.webContents !== except) w.webContents.send(channel, ...args)
}

/** The window (other than `asking`) that has this note/board open */
export function windowHolding(path: string, asking: WebContents): BrowserWindow | null {
  for (const w of appWindows()) {
    if (w.webContents === asking) continue
    if (reported.get(w.webContents.id)?.paths.includes(path)) return w
  }
  return null
}

const pendingFlush = new Map<string, () => void>()

/** Ask one window to save unsaved edits now; resolves when it has (or after a short wait) */
export function flushWindow(w: BrowserWindow): Promise<void> {
  if (w.isDestroyed() || w.webContents.isLoading()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const token = `${w.webContents.id}:${Date.now()}:${Math.random()}`
    pendingFlush.set(token, resolve)
    w.webContents.send('editors:flush', token)
    setTimeout(() => {
      pendingFlush.delete(token)
      resolve()
    }, 1500)
  })
}

/** Ask other windows to save any unsaved edits now (before a rename, move or delete) */
export async function flushOthers(except?: WebContents) {
  await Promise.all(appWindows().filter((w) => w.webContents !== except).map(flushWindow))
}

/** A new content window showing `views` (its tabs), at a screen point (tab dragged out) or saved bounds */
export function openContentWindow(views: ViewRef[], place?: { x: number; y: number } | Rectangle) {
  const main = deps.main()
  const base = main && !main.isDestroyed() ? main.getBounds() : { width: 1100, height: 760 }
  const width = place && 'width' in place ? place.width : Math.min(1000, base.width)
  const height = place && 'height' in place ? place.height : Math.min(720, base.height)
  let x: number | undefined
  let y: number | undefined
  if (place) {
    // A dragged-out tab: put the window's tab strip under the pointer
    x = 'width' in place ? place.x : Math.round(place.x - 120)
    y = 'width' in place ? place.y : Math.round(place.y - 18)
    const wa = screen.getDisplayNearestPoint({ x, y }).workArea
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - 200)
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - 100)
  }
  const w = deps.create({ width, height, x, y }, `window=${encodeURIComponent(JSON.stringify(views))}`)
  content.add(w)
  reported.set(w.webContents.id, { views, paths: [] })
  const id = w.webContents.id
  w.on('move', schedulePersist)
  w.on('resize', schedulePersist)
  w.on('closed', () => {
    content.delete(w)
    // Closed by Bill: forget it. Closed because the app is quitting: keep it for next time.
    if (!deps.quitting()) {
      reported.delete(id)
      persistNow()
    }
  })
  persistNow()
  return w
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 400)
}

function persistNow() {
  if (deps.quitting()) return
  const windows = [...content]
    .filter((w) => !w.isDestroyed())
    .map((w) => ({ views: reported.get(w.webContents.id)?.views ?? [], bounds: w.getNormalBounds() }))
    .filter((w) => w.views.length)
  saveConfig({ windows })
}

/** Reopen the content windows that were open when Waypoint last quit */
export function restoreWindows() {
  for (const w of loadConfig().windows ?? []) {
    if (w.views?.length) openContentWindow(w.views, w.bounds)
  }
}
