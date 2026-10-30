import { useState, type DragEvent, type MouseEvent } from 'react'
import { baseName } from '@shared/names'
import type { Project, ViewRef } from '@shared/types'
import { flushEditors, isContentWindow, toRef, useStore, type Tab } from '../store'
import { projectMenu, showMenu, tabMenu, treeMenu } from '../menus'

const SAVE_LABEL = { saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Save failed' }

// Dragging tabs between windows: the tab travels as JSON; a second type names the source window,
// because drag data can only be read on drop but the list of types is visible while hovering.
const TAB_TYPE = 'application/x-waypoint-tab'
let myWindowId = -1
window.api.windowInfo().then((w) => (myWindowId = w.id))
const fromType = (id: number) => `application/x-waypoint-from-${id}`

export function tabTitle(t: Tab, projects: Project[]): string {
  const v = t.view
  if (v.kind === 'file') return baseName(v.path)
  if (v.kind === 'canvas') return baseName(v.path).replace(/\.excalidraw$/i, '')
  if (v.kind === 'project' || v.kind === 'board') {
    const title = projects.find((p) => p.slug === v.slug)?.title ?? v.slug
    return v.kind === 'board' ? `${title} · tasks` : title
  }
  if (v.kind === 'settings') return 'Settings'
  if (v.kind === 'history') return `History · ${v.path ? baseName(v.path) : 'vault'}`
  return 'Home'
}

/** Tab strip across the top of the window (also the window's drag area) */
export function TabBar() {
  const { tabs, activeTab, activateTab, closeTab, newTab, projects, moveTabToWindow, receiveTab } = useStore()
  const [dropHere, setDropHere] = useState(false)

  const onMouseDown = (t: Tab) => (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      closeTab(t.id) // middle-click closes, like a browser
    }
  }

  const onDragStart = (t: Tab) => (e: DragEvent) => {
    e.dataTransfer.setData(TAB_TYPE, JSON.stringify(toRef(t.view)))
    e.dataTransfer.setData(fromType(myWindowId), '')
    e.dataTransfer.effectAllowed = 'move'
    void flushEditors() // whichever window it lands in reads the latest text
  }

  const onDragEnd = (t: Tab) => (e: DragEvent) => {
    // Dropped on another Waypoint window's tabs: it opened there, so let go of it here
    if (e.dataTransfer.dropEffect === 'move') return closeTab(t.id)
    // Dropped outside any Waypoint window: give it a window of its own, under the pointer
    const outside =
      (e.clientX !== 0 || e.clientY !== 0) &&
      (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight)
    if (outside) moveTabToWindow(t.id, true)
  }

  const acceptsDrop = (e: DragEvent) =>
    e.dataTransfer.types.includes(TAB_TYPE) && !e.dataTransfer.types.includes(fromType(myWindowId))

  return (
    <header
      className={`tabbar ${dropHere ? 'drop-tabs' : ''}`}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropHere(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropHere(false)}
      onDrop={(e) => {
        setDropHere(false)
        if (!acceptsDrop(e)) return
        e.preventDefault()
        try {
          receiveTab(JSON.parse(e.dataTransfer.getData(TAB_TYPE)) as ViewRef)
        } catch {
          /* not a tab after all */
        }
      }}
    >
      {isContentWindow && (
        <button className="window-home icon-btn" title="Show the main Waypoint window" onClick={() => window.api.showMain()}>
          ◆
        </button>
      )}
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTab ? 'active' : ''}`}
            title={(t.view.kind === 'file' ? t.view.path : tabTitle(t, projects)) + '\nDrag out of the window to open it in its own'}
            draggable
            onDragStart={onDragStart(t)}
            onDragEnd={onDragEnd(t)}
            onMouseDown={onMouseDown(t)}
            onContextMenu={(e) => showMenu(e, tabMenu(t))}
          >
            <button className="tab-title" onClick={() => activateTab(t.id)}>
              {t.view.kind === 'home' && <span className="tab-icon">⌂</span>}
              {t.view.kind === 'project' && <span className="tab-icon">◇</span>}
              {t.view.kind === 'board' && <span className="tab-icon">▦</span>}
              {t.view.kind === 'canvas' && <span className="tab-icon">✎</span>}
              {tabTitle(t, projects)}
            </button>
            <button className="tab-close" title="Close tab (Ctrl+W)" onClick={() => closeTab(t.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="tab-new icon-btn" title="New tab (Ctrl+T)" onClick={newTab}>
          ＋
        </button>
      </div>
    </header>
  )
}

/** Folder path, title (click to rename) and note actions for the open note */
export function PathBar() {
  const { view, activeTab, saveStates, rename, backlinksOpen, toggleBacklinks, openHistory, git, projects, openProject, openBoard, revealFolder } =
    useStore()
  if (view.kind !== 'file') return null
  const crumbs = view.path.replace(/\.md$/i, '').split('/')
  const saveState = saveStates[activeTab] ?? 'saved'
  // Folder crumbs: a project's own folder opens the project; any other folder is shown in the sidebar
  const folderAt = (i: number) => view.path.split('/').slice(0, i + 1).join('/')
  // A project's tasks folder is its task board
  const boardAt = (dir: string) => /^projects\/([^/]+)\/tasks$/.exec(dir)?.[1] ?? null
  const projectAt = (dir: string) => {
    const m = /^projects\/([^/]+)$/.exec(dir)
    return m && projects.some((p) => p.slug === m[1]) ? m[1] : null
  }

  return (
    <div className="pathbar">
      <nav className="crumbs">
        {crumbs.map((c, i) =>
          i === crumbs.length - 1 ? (
            <button key={i} className="crumb current" title="Rename (F2)" onClick={() => rename(view.path)}>
              {c}
            </button>
          ) : (
            (() => {
              const dir = folderAt(i)
              const slug = projectAt(dir)
              return (
                <button
                  key={i}
                  className="crumb link"
                  title={slug ? 'Open the project' : boardAt(dir) ? 'Open the task board' : 'Show this folder in the sidebar'}
                  onClick={(e) => {
                    const board = boardAt(dir)
                    if (slug) openProject(slug, { newTab: e.ctrlKey })
                    else if (board) openBoard(board, { newTab: e.ctrlKey })
                    else revealFolder(dir)
                  }}
                  onContextMenu={(e) => showMenu(e, slug ? projectMenu(slug) : treeMenu(dir, 'dir'))}
                >
                  {slug ? (projects.find((p) => p.slug === slug)?.title ?? c) : c}
                </button>
              )
            })()
          )
        )}
      </nav>
      <span className={`save-state ${saveState}`}>{SAVE_LABEL[saveState]}</span>
      {git?.isRepo && (
        <button className="icon-btn" title="History of this note" onClick={(e) => openHistory(view.path, { newTab: e.ctrlKey })}>
          ⟲
        </button>
      )}
      <button className="icon-btn" title="Show in Explorer" onClick={() => window.api.reveal(view.path)}>
        ⧉
      </button>
      <button
        className={`icon-btn ${backlinksOpen ? 'on' : ''}`}
        title="Linked from (Ctrl+Shift+B)"
        onClick={toggleBacklinks}
      >
        ⇠
      </button>
    </div>
  )
}
