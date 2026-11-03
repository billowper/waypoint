import { useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { arrange, canNest, type TreeRow } from '@shared/nesting'
import { pagesFolder } from '@shared/names'
import { canRename, useStore } from '../store'
import { showMenu, treeMenu } from '../menus'
import Icon, { noteDefault } from './Icon'

export const DRAG_TYPE = 'application/x-waypoint-path'
/** Hovering a closed folder while dragging opens it after this long */
const EXPAND_DELAY = 650

interface Props {
  nodes: TreeNode[]
  /** The folder these are in ('' = vault root) */
  dir: string
  /** Names that stay first, in this order, and can't be reordered */
  pinned?: string[]
  depth: number
}

/** Where on a row a drag would land: a line above or below it, or inside it */
type Zone = 'before' | 'into' | 'after'
const TASKS_DIR = /^projects\/[^/]+\/tasks(\/|$)/

export default function FileTree({ nodes, dir, pinned, depth }: Props) {
  const { expanded, toggle, view, openFile, openCanvas, openBoard, openInNewWindow, createTask, selectedDir, selectDir, move, place, tasks, treeOrder } =
    useStore()
  const rows = arrange(nodes, treeOrder[dir], pinned)
  const taskByPath = new Map(tasks.map((t) => [t.path, t]))
  const openPath = view.kind === 'file' ? view.path : null
  const [dropOn, setDropOn] = useState<{ path: string; zone: Zone } | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const menu = (n: TreeNode) => (e: MouseEvent) => showMenu(e, treeMenu(n.path, n.type))

  // The folder a drop "into" this row means: the folder, the note's sub-pages, or (for anything else) beside it
  const destOf = (n: TreeRow) => (n.type === 'dir' ? n.path : canNest(n.path) ? (n.folder ?? pagesFolder(n.path)!) : dir)

  // Near a row's edge means between rows; its middle means inside. Pinned rows and tasks only take "inside".
  const zoneAt = (e: DragEvent, n: TreeRow): Zone => {
    if (pinned?.includes(n.name) || TASKS_DIR.test(dir)) return 'into'
    const box = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - box.top) / box.height
    if (n.type !== 'dir' && !canNest(n.path)) return y < 0.5 ? 'before' : 'after'
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into'
  }

  const dropClass = (n: TreeRow) =>
    dropOn?.path !== n.path ? '' : dropOn.zone === 'into' ? 'drop-target' : `drop-${dropOn.zone}`

  // Drag a note or folder onto a row to put it inside, or between rows to put it there
  const drag = (n: TreeRow) => ({
    draggable: canRename(n.path),
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, n.path)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const zone = zoneAt(e, n)
      if (dropOn?.path !== n.path || dropOn.zone !== zone) {
        setDropOn({ path: n.path, zone })
        if (expandTimer.current) clearTimeout(expandTimer.current)
        const opens = n.type === 'dir' ? n.path : n.folder
        if (zone === 'into' && opens && !expanded[opens]) {
          expandTimer.current = setTimeout(() => {
            if (!useStore.getState().expanded[opens]) toggle(opens)
          }, EXPAND_DELAY)
        }
      }
    },
    onDragLeave: () => {
      setDropOn(null)
      if (expandTimer.current) clearTimeout(expandTimer.current)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropOn(null)
      if (expandTimer.current) clearTimeout(expandTimer.current)
      const path = e.dataTransfer.getData(DRAG_TYPE)
      if (!path || path === n.path) return
      const zone = zoneAt(e, n)
      if (zone === 'into') move(path, destOf(n))
      else place(path, dir, { name: n.name, after: zone === 'after' })
    }
  })

  return (
    <ul className="tree">
      {rows.map((n) => {
        const pad = { paddingLeft: 10 + depth * 14 }
        // A project's tasks folder is its task board
        const boardOf = n.type === 'dir' ? /^projects\/([^/]+)\/tasks$/.exec(n.path)?.[1] : undefined
        if (boardOf) {
          return (
            <li key={n.path}>
              <button
                className={`tree-row dir task-board ${view.kind === 'board' && view.slug === boardOf ? 'active' : ''} ${dropClass(n)}`}
                style={pad}
                data-path={n.path}
                title="Open the task board"
                onClick={(e) => openBoard(boardOf, { newTab: e.ctrlKey })}
                onContextMenu={(e) =>
                  showMenu(e, [
                    { label: 'Open task board', run: () => openBoard(boardOf) },
                    { label: 'Open task board in new tab', run: () => openBoard(boardOf, { newTab: true }) },
                    { label: 'Open task board in new window', run: () => openInNewWindow({ kind: 'board', slug: boardOf }) },
                    'separator',
                    {
                      label: 'New task',
                      run: async () => {
                        const p = await createTask(boardOf, { title: 'New task' })
                        if (p) await openFile(p)
                      }
                    },
                    { label: 'Show in Explorer', run: () => window.api.reveal(n.path) }
                  ])
                }
                {...drag(n)}
              >
                <span className="chev spacer tree-icon">▦</span>
                {n.name}
                <span className="tree-count">{tasks.filter((t) => t.project === boardOf && t.status !== 'done').length || ''}</span>
              </button>
            </li>
          )
        }
        if (n.type === 'dir') {
          const isOpen = !!expanded[n.path]
          return (
            <li key={n.path}>
              <button
                className={`tree-row dir ${selectedDir === n.path ? 'selected' : ''} ${dropClass(n)}`}
                style={pad}
                data-path={n.path}
                onClick={() => {
                  toggle(n.path)
                  selectDir(n.path)
                }}
                onContextMenu={menu(n)}
                {...drag(n)}
              >
                <span className={`chev ${isOpen ? 'open' : ''}`}>›</span>
                <Icon path={n.path} />
                {n.name}
              </button>
              {isOpen && n.children && <FileTree nodes={n.children} dir={n.path} depth={depth + 1} />}
            </li>
          )
        }
        const isMd = n.name.toLowerCase().endsWith('.md')
        const isBoard = n.name.toLowerCase().endsWith('.excalidraw')
        const task = taskByPath.get(n.path) // tasks read better by title than by file name
        const pages = n.children?.length ? n.folder : undefined
        const pagesOpen = !!pages && !!expanded[pages]
        return (
          <li key={n.path}>
            <button
              className={`tree-row file ${openPath === n.path || (view.kind === 'canvas' && view.path === n.path) ? 'active' : ''} ${isMd || isBoard ? '' : 'other'} ${task?.status === 'done' ? 'done' : ''} ${dropClass(n)}`}
              style={pad}
              data-path={n.path}
              onClick={(e) =>
                isMd
                  ? openFile(n.path, { newTab: e.ctrlKey })
                  : isBoard
                    ? openCanvas(n.path, { newTab: e.ctrlKey })
                    : window.api.reveal(n.path)
              }
              onAuxClick={(e) => e.button === 1 && isMd && openFile(n.path, { newTab: true })}
              onContextMenu={menu(n)}
              title={isMd ? n.path : `${n.path} — opens in Explorer`}
              {...drag(n)}
            >
              {pages ? (
                <span
                  className={`chev ${pagesOpen ? 'open' : ''}`}
                  title={pagesOpen ? 'Hide sub-pages' : 'Show sub-pages'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(pages)
                  }}
                >
                  ›
                </span>
              ) : (
                <span className="chev spacer" />
              )}
              <Icon path={n.path} fallback={isBoard ? <span className="tree-icon">✎</span> : noteDefault(n.path, !!task)} />
              {task ? (
                <>
                  <span className="task-id">{task.id}</span>
                  <span className="tree-label">{task.title}</span>
                </>
              ) : isMd ? (
                n.name.slice(0, -3)
              ) : isBoard ? (
                n.name.slice(0, -'.excalidraw'.length)
              ) : (
                n.name
              )}
            </button>
            {pagesOpen && <FileTree nodes={n.children!} dir={pages!} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}
