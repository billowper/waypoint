import { useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { canRename, useStore } from '../store'
import { showMenu, treeMenu } from '../menus'

export const DRAG_TYPE = 'application/x-waypoint-path'
/** Hovering a closed folder while dragging opens it after this long */
const EXPAND_DELAY = 650

interface Props {
  nodes: TreeNode[]
  depth: number
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export default function FileTree({ nodes, depth }: Props) {
  const { expanded, toggle, view, openFile, openCanvas, openBoard, openInNewWindow, createTask, selectedDir, selectDir, move, tasks } =
    useStore()
  const taskByPath = new Map(tasks.map((t) => [t.path, t]))
  const openPath = view.kind === 'file' ? view.path : null
  const [dropOn, setDropOn] = useState<string | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const menu = (n: TreeNode) => (e: MouseEvent) => showMenu(e, treeMenu(n.path, n.type))

  // Drag a note or folder onto a folder (or onto a note, meaning its folder) to move it there
  const drag = (n: TreeNode) => ({
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
      const target = n.type === 'dir' ? n.path : parentOf(n.path)
      if (dropOn !== target) {
        setDropOn(target)
        if (expandTimer.current) clearTimeout(expandTimer.current)
        if (n.type === 'dir' && !expanded[n.path]) {
          expandTimer.current = setTimeout(() => {
            if (!useStore.getState().expanded[n.path]) toggle(n.path)
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
      if (path) move(path, n.type === 'dir' ? n.path : parentOf(n.path))
    }
  })

  return (
    <ul className="tree">
      {nodes.map((n) => {
        const pad = { paddingLeft: 10 + depth * 14 }
        // A project's tasks folder is its task board
        const boardOf = n.type === 'dir' ? /^projects\/([^/]+)\/tasks$/.exec(n.path)?.[1] : undefined
        if (boardOf) {
          return (
            <li key={n.path}>
              <button
                className={`tree-row dir task-board ${view.kind === 'board' && view.slug === boardOf ? 'active' : ''} ${dropOn === n.path ? 'drop-target' : ''}`}
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
                className={`tree-row dir ${selectedDir === n.path ? 'selected' : ''} ${dropOn === n.path ? 'drop-target' : ''}`}
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
                {n.name}
              </button>
              {isOpen && n.children && <FileTree nodes={n.children} depth={depth + 1} />}
            </li>
          )
        }
        const isMd = n.name.toLowerCase().endsWith('.md')
        const isBoard = n.name.toLowerCase().endsWith('.excalidraw')
        const task = taskByPath.get(n.path) // tasks read better by title than by file name
        return (
          <li key={n.path}>
            <button
              className={`tree-row file ${openPath === n.path || (view.kind === 'canvas' && view.path === n.path) ? 'active' : ''} ${isMd || isBoard ? '' : 'other'} ${task?.status === 'done' ? 'done' : ''}`}
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
              <span className="chev spacer" />
              {isBoard && <span className="tree-icon">✎</span>}
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
          </li>
        )
      })}
    </ul>
  )
}
