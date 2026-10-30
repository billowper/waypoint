import { useState, type DragEvent } from 'react'
import { useStore } from '../store'
import FileTree, { DRAG_TYPE } from './FileTree'
import SearchPanel from './SearchPanel'
import GitPanel, { GitIndicator } from './GitPanel'

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
    move,
    projects,
    openProject,
    createProject,
    openSettings
  } = useStore()
  // Finished projects drop to the bottom
  const listed = [...projects].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
  const [rootDrop, setRootDrop] = useState(false)

  // Dropping on empty space below the tree moves the item to the vault root
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

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${view.kind === 'home' ? 'active' : ''}`}
          onClick={goHome}
          title="Home (Ctrl+Shift+H)"
        >
          <span className="nav-icon">⌂</span> Home
        </button>
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
        {listed.map((p) => (
          <button
            key={p.slug}
            className={`nav-item ${view.kind === 'project' && view.slug === p.slug ? 'active' : ''} ${p.status === 'done' ? 'done' : ''}`}
            title={`${p.title} · ${p.status}`}
            onClick={(e) => openProject(p.slug, { newTab: e.ctrlKey })}
          >
            <span className={`status-dot status-${p.status}`} />
            <span className="nav-label">{p.title}</span>
          </button>
        ))}
        {listed.length === 0 && (
          <button className="nav-item dim" onClick={createProject}>
            Create your first project…
          </button>
        )}
      </nav>

      <div className="section-head">
        <div className="mode-switch">
          <button className={sidebarMode === 'files' ? 'on' : ''} onClick={() => setSidebarMode('files')}>
            Files
          </button>
          <button
            className={sidebarMode === 'search' ? 'on' : ''}
            title="Search all notes (Ctrl+Shift+F)"
            onClick={() => setSidebarMode('search')}
          >
            Search
          </button>
          <button className={sidebarMode === 'git' ? 'on' : ''} title="Version history" onClick={() => setSidebarMode('git')}>
            Git
          </button>
        </div>
        {sidebarMode === 'files' && (
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

      {sidebarMode === 'files' ? (
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
      )}
      <GitIndicator />
    </aside>
  )
}
