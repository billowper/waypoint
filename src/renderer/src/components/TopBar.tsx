import type { MouseEvent } from 'react'
import { baseName } from '@shared/names'
import { useStore, type Tab } from '../store'

const SAVE_LABEL = { saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Save failed' }

/** Tab strip across the top of the window (also the window's drag area) */
export function TabBar() {
  const { tabs, activeTab, activateTab, closeTab, newTab, projects } = useStore()
  const tabTitle = (t: Tab) =>
    t.view.kind === 'file'
      ? baseName(t.view.path)
      : t.view.kind === 'project' || t.view.kind === 'board'
        ? (projects.find((p) => 'slug' in t.view && p.slug === t.view.slug)?.title ?? t.view.slug) +
          (t.view.kind === 'board' ? ' · tasks' : '')
        : t.view.kind === 'canvas'
          ? baseName(t.view.path).replace(/.excalidraw$/i, '')
          : t.view.kind === 'settings'
          ? 'Settings'
          : t.view.kind === 'history'
          ? `History · ${t.view.path ? baseName(t.view.path) : 'vault'}`
          : 'Home'
  const onMouseDown = (t: Tab) => (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      closeTab(t.id) // middle-click closes, like a browser
    }
  }
  return (
    <header className="tabbar">
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTab ? 'active' : ''}`}
            title={t.view.kind === 'file' ? t.view.path : tabTitle(t)}
            onMouseDown={onMouseDown(t)}
          >
            <button className="tab-title" onClick={() => activateTab(t.id)}>
              {t.view.kind === 'home' && <span className="tab-icon">⌂</span>}
              {t.view.kind === 'project' && <span className="tab-icon">◇</span>}
              {t.view.kind === 'board' && <span className="tab-icon">▦</span>}
              {t.view.kind === 'canvas' && <span className="tab-icon">✎</span>}
              {tabTitle(t)}
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
  const { view, activeTab, saveStates, rename, backlinksOpen, toggleBacklinks, openHistory, git } = useStore()
  if (view.kind !== 'file') return null
  const crumbs = view.path.replace(/\.md$/i, '').split('/')
  const saveState = saveStates[activeTab] ?? 'saved'

  return (
    <div className="pathbar">
      <nav className="crumbs">
        {crumbs.map((c, i) =>
          i === crumbs.length - 1 ? (
            <button key={i} className="crumb current" title="Rename (F2)" onClick={() => rename(view.path)}>
              {c}
            </button>
          ) : (
            <span key={i} className="crumb">
              {c}
            </span>
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
