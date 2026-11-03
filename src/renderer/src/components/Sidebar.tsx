import { useState, type DragEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { findNode } from '@shared/nesting'
import { IDEAS_DIR } from '@shared/names'
import { useStore } from '../store'
import FileTree, { DRAG_TYPE } from './FileTree'
import SearchPanel from './SearchPanel'
import { projectMenu, showMenu, treeMenu } from '../menus'
import GitPanel, { GitIndicator } from './GitPanel'
import Icon from './Icon'

/** General notes live here (the Notes item) */
const NOTES_DIR = 'notes'
/** Project folders shown first, in this order */
const PROJECT_ORDER = ['docs', 'wiki', 'tasks', 'boards']
/** Dragging a project row to put it somewhere else in the list */
const PROJECT_DRAG = 'application/x-waypoint-project'

/** A project's contents for the sidebar: project.md left out (it's the project page) */
function projectChildren(tree: TreeNode[], slug: string): TreeNode[] {
  return (findNode(tree, `projects/${slug}`)?.children ?? []).filter((n) => n.name !== 'project.md')
}

/** The project the current tab belongs to, if any */
function focusedProject(view: ReturnType<typeof useStore.getState>['view']): string | null {
  if (view.kind === 'project' || view.kind === 'board') return view.slug
  if ((view.kind === 'file' || view.kind === 'canvas' || view.kind === 'history') && view.path.startsWith('projects/')) {
    return view.path.split('/')[1] ?? null
  }
  return null
}

export default function Sidebar() {
  const {
    vault,
    view,
    goHome,
    newNote,
    newFolder,
    openVault,
    tree,
    selectedDir,
    sidebarMode,
    setSidebarMode,
    sidebarOpen,
    toggleSection,
    setProjectOpen,
    move,
    projects,
    openProject,
    createProject,
    openSettings,
    reorderProjects
  } = useStore()
  // Finished projects drop to the bottom
  const listed = [...projects].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
  const focus = focusedProject(view)
  const [rootDrop, setRootDrop] = useState(false)
  const [dropRow, setDropRow] = useState<string | null>(null)
  /** Where a dragged project would land: before or after this one */
  const [dropLine, setDropLine] = useState<{ slug: string; after: boolean } | null>(null)

  // Dropping on empty space below the file tree moves the item to the vault root
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE) || e.target !== e.currentTarget) return setRootDrop(false)
    e.preventDefault()
    setRootDrop(true)
  }
  const onDrop = (e: DragEvent) => {
    setRootDrop(false)
    const path = e.dataTransfer.getData(DRAG_TYPE)
    if (path && e.target === e.currentTarget) move(path, '')
  }

  /** Notes and project rows accept notes dragged onto them: move them into that place */
  const dropInto = (key: string, dir: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropRow(key)
    },
    onDragLeave: () => setDropRow(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDropRow(null)
      const path = e.dataTransfer.getData(DRAG_TYPE)
      if (path) move(path, dir)
    }
  })

  /** Project rows can be dragged up and down the list; notes dropped on them still move into the project */
  const reorder = (slug: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(PROJECT_DRAG, slug)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(PROJECT_DRAG)) return dropInto(slug, `projects/${slug}`).onDragOver(e)
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const box = e.currentTarget.getBoundingClientRect()
      setDropLine({ slug, after: e.clientY > box.top + box.height / 2 })
    },
    onDragLeave: () => {
      setDropRow(null)
      setDropLine(null)
    },
    onDrop: (e: DragEvent) => {
      const dragged = e.dataTransfer.getData(PROJECT_DRAG)
      if (!dragged) return dropInto(slug, `projects/${slug}`).onDrop(e)
      e.preventDefault()
      const after = dropLine?.slug === slug && dropLine.after
      setDropLine(null)
      if (dragged === slug) return
      const order = listed.map((p) => p.slug).filter((s) => s !== dragged)
      order.splice(order.indexOf(slug) + (after ? 1 : 0), 0, dragged)
      reorderProjects(order)
    },
    onDragEnd: () => setDropLine(null)
  })

  const noteKids = findNode(tree, NOTES_DIR)?.children ?? []
  const ideaKids = findNode(tree, IDEAS_DIR)?.children ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand-mark small">◆</span>
        <button className="vault-name no-drag" title={vault?.path} onClick={openVault}>
          {vault?.name}
        </button>
        <button className="icon-btn settings-btn" title="Settings (Ctrl+,)" onClick={openSettings}>
          ⚙
        </button>
      </div>

      <div className={`sidebar-scroll ${sidebarOpen.files ? 'shared' : ''}`}>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${view.kind === 'home' ? 'active' : ''}`}
            onClick={goHome}
            title="Home (Ctrl+Shift+H)"
          >
            <span className="nav-icon">⌂</span> Home
          </button>

          <div className={`nav-row ${dropRow === 'notes' ? 'drop-target' : ''}`} {...dropInto('notes', NOTES_DIR)}>
            <button
              className="nav-chev"
              title={sidebarOpen.notes ? 'Hide notes' : 'Show notes'}
              onClick={() => toggleSection('notes')}
            >
              <span className={`chev ${sidebarOpen.notes ? 'open' : ''}`}>›</span>
            </button>
            <button
              className="nav-item"
              title="General notes (the notes folder)"
              onClick={() => toggleSection('notes')}
              onContextMenu={(e) => showMenu(e, treeMenu(NOTES_DIR, 'dir'))}
            >
              <Icon path={NOTES_DIR} className="nav-glyph" fallback={<span className="nav-icon">✎</span>} /> Notes
            </button>
            <button className="icon-btn row-add" title="New note (Ctrl+N)" onClick={() => newNote(NOTES_DIR)}>
              ＋
            </button>
          </div>
          {sidebarOpen.notes && (
            <div className="nav-tree">
              <FileTree nodes={noteKids} dir={NOTES_DIR} depth={1} />
            </div>
          )}

          <div className={`nav-row ${dropRow === 'ideas' ? 'drop-target' : ''}`} {...dropInto('ideas', IDEAS_DIR)}>
            <button
              className="nav-chev"
              title={sidebarOpen.ideas ? 'Hide ideas' : 'Show ideas'}
              onClick={() => toggleSection('ideas')}
            >
              <span className={`chev ${sidebarOpen.ideas ? 'open' : ''}`}>›</span>
            </button>
            <button
              className="nav-item"
              title="Quick captures land here (Ctrl+Alt+W)"
              onClick={() => toggleSection('ideas')}
              onContextMenu={(e) => showMenu(e, treeMenu(IDEAS_DIR, 'dir'))}
            >
              <Icon path={IDEAS_DIR} className="nav-glyph" fallback={<span className="nav-icon">💡</span>} /> Ideas
            </button>
            <button className="icon-btn row-add" title="New idea" onClick={() => newNote(IDEAS_DIR)}>
              ＋
            </button>
          </div>
          {sidebarOpen.ideas && (
            <div className="nav-tree">
              <FileTree nodes={ideaKids} dir={IDEAS_DIR} depth={1} />
            </div>
          )}
        </nav>

        <div className="section-head">
          <span>Projects</span>
          <span className="section-target" />
          <div className="section-actions">
            <button className="icon-btn" title="New project" onClick={createProject}>
              ＋
            </button>
          </div>
        </div>
        <nav className="sidebar-nav projects-nav">
          {listed.map((p) => {
            // Open if you said so; otherwise open while you're working in it
            const open = sidebarOpen.projects[p.slug] ?? p.slug === focus
            return (
              <div key={p.slug}>
                <div
                  className={`nav-row ${view.kind === 'project' && view.slug === p.slug ? 'active' : ''} ${p.status === 'done' ? 'done' : ''} ${dropRow === p.slug ? 'drop-target' : ''} ${dropLine?.slug === p.slug ? (dropLine.after ? 'drop-after' : 'drop-before') : ''}`}
                  {...reorder(p.slug)}
                >
                  <button
                    className="nav-chev"
                    title={open ? 'Hide contents' : 'Show contents'}
                    onClick={() => setProjectOpen(p.slug, !open)}
                  >
                    <span className={`chev ${open ? 'open' : ''}`}>›</span>
                  </button>
                  <button
                    className="nav-item"
                    title={`${p.title} · ${p.status}
Drag to reorder`}
                    onClick={(e) => openProject(p.slug, { newTab: e.ctrlKey })}
                    onContextMenu={(e) => showMenu(e, projectMenu(p.slug))}
                  >
                    <span className={`status-dot status-${p.status}`} />
                    <Icon path={`projects/${p.slug}`} />
                    <span className="nav-label">{p.title}</span>
                  </button>
                </div>
                {open && (
                  <div className="nav-tree">
                    <FileTree nodes={projectChildren(tree, p.slug)} dir={`projects/${p.slug}`} pinned={PROJECT_ORDER} depth={1} />
                  </div>
                )}
              </div>
            )
          })}
          {listed.length === 0 && (
            <button className="nav-item dim" onClick={createProject}>
              Create your first project…
            </button>
          )}
        </nav>
      </div>

      <div className={`files-section ${sidebarOpen.files ? 'open' : ''}`}>
        <div className="section-head">
          <button className="nav-chev" title={sidebarOpen.files ? 'Hide' : 'Show'} onClick={() => toggleSection('files')}>
            <span className={`chev ${sidebarOpen.files ? 'open' : ''}`}>›</span>
          </button>
          <div className="mode-switch">
            <button
              className={sidebarOpen.files && sidebarMode === 'files' ? 'on' : ''}
              onClick={() => (sidebarOpen.files && sidebarMode === 'files' ? toggleSection('files') : setSidebarMode('files'))}
            >
              Files
            </button>
            <button
              className={sidebarOpen.files && sidebarMode === 'search' ? 'on' : ''}
              title="Search all notes (Ctrl+Shift+F)"
              onClick={() => setSidebarMode('search')}
            >
              Search
            </button>
            <button
              className={sidebarOpen.files && sidebarMode === 'git' ? 'on' : ''}
              title="Version history"
              onClick={() => setSidebarMode('git')}
            >
              Git
            </button>
          </div>
          {sidebarOpen.files && sidebarMode === 'files' && (
            <>
              <span className="section-target" title="New items go here">
                {selectedDir || 'vault root'}
              </span>
              <div className="section-actions">
                <button className="icon-btn" title="New note (Ctrl+N)" onClick={() => newNote()}>
                  ＋
                </button>
                <button className="icon-btn" title="New folder" onClick={() => newFolder()}>
                  ▤
                </button>
              </div>
            </>
          )}
        </div>

        {sidebarOpen.files &&
          (sidebarMode === 'files' ? (
            <div
              className={`tree-scroll ${rootDrop ? 'drop-root' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={() => setRootDrop(false)}
              onDrop={onDrop}
            >
              <FileTree nodes={tree} dir="" depth={0} />
            </div>
          ) : sidebarMode === 'search' ? (
            <SearchPanel />
          ) : (
            <GitPanel />
          ))}
      </div>
      <GitIndicator />
    </aside>
  )
}
