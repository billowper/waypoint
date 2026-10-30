import { useState, type DragEvent } from 'react'
import { useStore } from '../store'
import FileTree, { DRAG_TYPE } from './FileTree'
import SearchPanel from './SearchPanel'

export default function Sidebar() {
  const { vault, view, goHome, newNote, newFolder, openVault, tree, selectedDir, sidebarMode, setSidebarMode, move } =
    useStore()
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
      ) : (
        <SearchPanel />
      )}
    </aside>
  )
}
