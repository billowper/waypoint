import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ViewRef } from '@shared/types'
import { linkTextFor } from '@shared/links'
import { canRename, useStore, type MenuItem, type Tab } from './store'

// Right-click menus. Each builder returns the items for one kind of thing; `showMenu` opens them.

const store = useStore.getState
const sep = 'separator' as const

export function showMenu(e: ReactMouseEvent | MouseEvent, items: MenuItem[]) {
  e.preventDefault()
  e.stopPropagation()
  const clean = items.filter((it, i, all) => it !== sep || (i > 0 && all[i - 1] !== sep && i < all.length - 1))
  if (clean.length) store().openMenu({ x: e.clientX, y: e.clientY, items: clean })
}

const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => undefined)

/** Open / new tab / new window for anything that can be a tab */
function openItems(ref: ViewRef): MenuItem[] {
  const s = store()
  const open = (newTab: boolean) => {
    if (ref.kind === 'file') return s.openFile(ref.path, { newTab })
    if (ref.kind === 'canvas') return s.openCanvas(ref.path, { newTab })
    if (ref.kind === 'project') return s.openProject(ref.slug, { newTab })
    if (ref.kind === 'board') return s.openBoard(ref.slug, { newTab })
    if (ref.kind === 'history') return s.openHistory(ref.path, { newTab })
    if (ref.kind === 'settings') return s.openSettings()
    return s.goHome()
  }
  return [
    { label: 'Open', run: () => open(false) },
    { label: 'Open in new tab', kbd: 'Ctrl click', run: () => open(true) },
    { label: 'Open in new window', run: () => s.openInNewWindow(ref) }
  ]
}

/** Items about a note/board file itself: links, paths, history, Explorer */
function fileItems(path: string): MenuItem[] {
  const s = store()
  const isNote = path.toLowerCase().endsWith('.md')
  return [
    ...(isNote ? [{ label: 'Copy link', run: () => copy(`[[${linkTextFor(path, s.notes)}]]`) }] : []),
    { label: 'Copy path', run: () => copy(path) },
    ...(s.git?.isRepo ? [{ label: 'History', run: () => s.openHistory(path) }] : []),
    { label: 'Show in Explorer', run: () => window.api.reveal(path) }
  ]
}

/** A note, board or other file anywhere it's listed (Home, search, backlinks, cards…) */
export function noteMenu(path: string): MenuItem[] {
  const ref: ViewRef = path.toLowerCase().endsWith('.excalidraw') ? { kind: 'canvas', path } : { kind: 'file', path }
  return [...openItems(ref), sep, ...fileItems(path)]
}

/** A file or folder in the tree */
export function treeMenu(path: string, type: 'file' | 'dir'): MenuItem[] {
  const s = store()
  const editable = canRename(path)
  const lower = path.toLowerCase()
  const openable = lower.endsWith('.md') || lower.endsWith('.excalidraw')
  return [
    ...(openable ? [...noteMenu(path), sep] : []),
    ...(type === 'dir'
      ? [
          { label: 'New note here', run: () => s.newNote(path) },
          { label: 'New board here', run: () => s.createBoard(path) },
          { label: 'New folder here', run: () => s.newFolder(path) },
          sep
        ]
      : []),
    ...(editable
      ? [
          { label: 'Rename', kbd: 'F2', run: () => s.rename(path) },
          { label: 'Move to…', run: () => s.openPicker({ kind: 'move', path }) },
          { label: 'Duplicate', run: () => s.duplicate(path) }
        ]
      : []),
    ...(type === 'dir' || !openable
      ? [
          { label: 'Copy path', run: () => copy(path) },
          { label: 'Show in Explorer', run: () => window.api.reveal(path) }
        ]
      : []),
    ...(editable ? [sep, { label: 'Delete', kbd: 'Del', danger: true, run: () => s.remove(path) }] : [])
  ]
}

/** A tab in the tab bar */
export function tabMenu(tab: Tab): MenuItem[] {
  const s = store()
  const i = s.tabs.findIndex((t) => t.id === tab.id)
  const path = tab.view.kind === 'file' || tab.view.kind === 'canvas' ? tab.view.path : null
  return [
    { label: 'Move to new window', run: () => s.moveTabToWindow(tab.id) },
    sep,
    { label: 'Close', kbd: 'Ctrl W', run: () => s.closeTab(tab.id) },
    { label: 'Close other tabs', disabled: s.tabs.length < 2, run: () => s.closeOtherTabs(tab.id) },
    { label: 'Close tabs to the right', disabled: i === s.tabs.length - 1, run: () => s.closeTabsToRight(tab.id) },
    ...(path
      ? [
          sep,
          ...(tab.view.kind === 'file' && canRename(path) ? [{ label: 'Rename', kbd: 'F2', run: () => s.rename(path) }] : []),
          ...fileItems(path)
        ]
      : [])
  ]
}

/** A project in the sidebar, on Home, etc. */
export function projectMenu(slug: string): MenuItem[] {
  const s = store()
  const dir = `projects/${slug}`
  return [
    ...openItems({ kind: 'project', slug }),
    sep,
    { label: 'Open task board', run: () => s.openBoard(slug) },
    { label: 'Open task board in new window', run: () => s.openInNewWindow({ kind: 'board', slug }) },
    { label: 'New task', run: async () => {
        const p = await s.createTask(slug, { title: 'New task' })
        if (p) await s.openFile(p)
      } },
    { label: 'New doc', run: () => s.newNote(`${dir}/docs`) },
    { label: 'New board', run: () => s.createBoard(`${dir}/boards`) },
    sep,
    { label: 'Copy path', run: () => copy(dir) },
    { label: 'Show in Explorer', run: () => window.api.reveal(dir) }
  ]
}

/** Cut / copy / paste for text boxes and the editor (Electron has no built-in menu for these) */
export function editMenu(hasSelection: boolean, editable: boolean): MenuItem[] {
  return [
    ...(editable ? [{ label: 'Cut', kbd: 'Ctrl X', disabled: !hasSelection, run: () => window.api.editAction('cut') }] : []),
    { label: 'Copy', kbd: 'Ctrl C', disabled: !hasSelection, run: () => window.api.editAction('copy') },
    ...(editable ? [{ label: 'Paste', kbd: 'Ctrl V', run: () => window.api.editAction('paste') }] : []),
    sep,
    { label: 'Select all', kbd: 'Ctrl A', run: () => window.api.editAction('selectAll') }
  ]
}

