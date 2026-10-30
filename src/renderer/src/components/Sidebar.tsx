import { useState, type DragEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { useStore } from '../store'
import FileTree, { DRAG_TYPE } from './FileTree'
import SearchPanel from './SearchPanel'
import { projectMenu, showMenu, treeMenu } from '../menus'
import GitPanel, { GitIndicator } from './GitPanel'
import Icon from './Icon'

/** General notes live here (the Notes item); inbox.md (quick captures) is pinned at the top */
const NOTES_DIR = 'notes'
const INBOX_NOTE = 'inbox.md'
/** Project folders shown first, in this order */
const PROJECT_ORDER = ['docs', 'wiki', 'tasks', 'boards']

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.type === 'dir' && path.startsWith(n.path + '/')) return findNode(n.children ?? [], path)
  }
  return null
}

/** A project's contents for the sidebar: docs/tasks/boards first, project.md left out (it's the project page) */
function projectChildren(tree: TreeNode[], slug: string): TreeNode[] {
  const kids = (findNode(tree, `projects/${slug}`)?.children ?? []).filter((n) => n.name !== 'project.md')
  const rank = (n: TreeNode) => {
    const i = PROJECT_ORDER.indexOf(n.name)
    return n.type === 'dir' ? (i === -1 ? PROJECT_ORDER.length : i) : PROJECT_ORDER.length + 1
  }
  return [...kids].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
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
    openFile,
    tree,
    notes,
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
    openSettings
  } = useStore()
  // Finished projects drop to the bottom
  const listed = [...projects].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
  const focus = focusedProject(view)
  const [rootDrop, setRootDrop] = useState(false)
  const [dropRow, setDropRow] = useState<string | null>(null)

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

  const inboxKids = findNode(tree, NOTES_DIR)?.children ?? []
  const inboxActive = view.kind === 'file' && view.path === INBOX_NOTE

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
              title={sidebarOpen.inbox ? 'Hide notes' : 'Show notes'}
              onClick={() => toggleSection('inbox')}
            >
              <span className={`chev ${sidebarOpen.inbox ? 'open' : ''}`}>›</span>
            </button>
            <button
              className="nav-item"
              title="General notes (the notes folder)"
              onClick={() => toggleSection('inbox')}
              onContextMenu={(e) => showMenu(e, treeMenu(NOTES_DIR, 'dir'))}
            >
              <Icon path={NOTES_DIR} className="nav-glyph" fallback={<span className="nav-icon">✎</span>} /> Notes
            </button>
            <button className="icon-btn row-add" title="New note (Ctrl+N)" onClick={() => newNote(NOTES_DIR)}>
              ＋
            </button>
          </div>
          {sidebarOpen.inbox && (
            <div className="nav-tree">
              {/* Quick captures land in inbox.md: always first under Notes */}
              <button
                className={`tree-row file pinned ${inboxActive ? 'active' : ''}`}
                style={{ paddingLeft: 24 }}
                title="Quick captures land here (Ctrl+Alt+W)"
                onClick={(e) => (notes.includes(INBOX_NOTE) ? openFile(INBOX_NOTE, { newTab: e.ctrlKey }) : newNote('', 'inbox'))}
                onContextMenu={(e) => notes.includes(INBOX_NOTE) && showMenu(e, treeMenu(INBOX_NOTE, 'file'))}
              >
                <span className="chev spacer" />
                <Icon path={INBOX_NOTE} fallback={<span className="tree-icon">✉</span>} />
                Inbox
              </button>
              <FileTree nodes={inboxKids} depth={1} />
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
                  className={`nav-row ${view.kind === 'project' && view.slug === p.slug ? 'active' : ''} ${p.status === 'done' ? 'done' : ''} ${dropRow === p.slug ? 'drop-target' : ''}`}
                  {...dropInto(p.slug, `projects/${p.slug}`)}
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
                    title={`${p.title} · ${p.status}`}
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
                    <FileTree nodes={projectChildren(tree, p.slug)} depth={1} />
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
              <FileTree nodes={tree} depth={0} />
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
