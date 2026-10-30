import { useEffect } from 'react'
import { canRename, useStore } from './store'
import Sidebar from './components/Sidebar'
import { PathBar, TabBar } from './components/TopBar'
import Home from './components/Home'
import Editor from './components/Editor'
import Welcome from './components/Welcome'
import Prompt from './components/Prompt'
import ContextMenu from './components/ContextMenu'
import Picker from './components/Picker'
import Backlinks from './components/Backlinks'
import ProjectPage from './components/ProjectPage'
import Board from './components/Board'
import TaskBar from './components/TaskBar'
import History from './components/History'
import Settings from './components/Settings'
import NudgeBanner from './components/NudgeBanner'

/** F2 / Delete act on the keyboard-focused tree item, else the open note (else selected folder for F2) */
function fileTarget(fallbackToFolder: boolean): string | null {
  const { view, selectedDir } = useStore.getState()
  // Mouse clicks also focus tree buttons, invisibly; only count focus the user can see
  const focused = document.querySelector('[data-path]:focus-visible')
  const path =
    focused?.getAttribute('data-path') ?? (view.kind === 'file' ? view.path : fallbackToFolder ? selectedDir : null)
  return path && canRename(path) ? path : null
}

const inTextField = () => {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

export default function App() {
  const { vault, view, tabs, activeTab, init, refresh, prompt, menu, backlinksOpen, git, setSidebarMode } = useStore()

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    // Tree refresh on any change on disk (including our own saves — cheap at this size)
    return window.api.onChanged(() => refresh())
  }, [refresh])

  useEffect(() => {
    // Jump list, tray, toast clicks and second launches arrive here
    return window.api.onCommand((c) => {
      const s = useStore.getState()
      if ('nudge' in c && c.nudge) s.setNudge(c.nudge)
      if (c.kind === 'nudge') return
      if (c.kind === 'new-note') s.newNote('notes') // from the jump list or tray: a plain note
      else if (c.kind === 'home') s.goHome()
      else if (c.kind === 'open') s.notes.includes(c.path) && s.openFile(c.path)
      else if (c.kind === 'open-project') s.openProject(c.slug)
      else if (c.kind === 'open-board') s.openBoard(c.slug)
    })
  }, [])

  useEffect(() => {
    // Git status also changes without file edits (auto-commit, pushes from elsewhere)
    const off = window.api.onGitChanged(() => useStore.getState().refreshGit())
    const timer = setInterval(() => useStore.getState().refreshGit(), 60_000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.prompt || s.picker) return // modals handle their own keys
      const k = e.key.toLowerCase()
      const run = (fn: () => unknown) => {
        e.preventDefault()
        fn()
      }

      if (e.key === 'F2' && !e.ctrlKey && !e.altKey) {
        const target = fileTarget(true)
        if (target) run(() => s.rename(target))
        return
      }
      if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !inTextField()) {
        const target = fileTarget(false)
        if (target) run(() => s.remove(target))
        return
      }
      if (!e.ctrlKey || e.altKey) return

      if (k === 'tab' || k === 'pagedown' || k === 'pageup') {
        run(() => s.cycleTab(e.shiftKey || k === 'pageup' ? -1 : 1))
      } else if (e.shiftKey) {
        if (k === 'h') run(s.goHome)
        else if (k === 'f') {
          run(() => {
            s.setSidebarMode('search')
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search-input')?.select())
          })
        } else if (k === 'b') run(s.toggleBacklinks)
      } else if (k === ',') run(s.openSettings)
      else if (k === 'n') run(() => s.newNote())
      else if (k === 'p' || k === 'o') run(() => s.openPicker({ kind: 'notes' }))
      else if (k === 't') run(s.newTab)
      else if (k === 'w') run(() => s.closeTab(s.activeTab))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!vault) return <Welcome />

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TabBar />
        {git && git.conflicted.length > 0 && (
          <button className="conflict-banner" onClick={() => setSidebarMode('git')}>
            {git.conflicted.length} file{git.conflicted.length === 1 ? ' has' : 's have'} git conflicts after a pull. Click
            to see them.
          </button>
        )}
        <NudgeBanner />
        <PathBar />
        {view.kind === 'file' && <TaskBar path={view.path} />}
        <div className="content">
          <div className="pane">
            {view.kind === 'home' && <Home />}
            {view.kind === 'project' && <ProjectPage key={view.slug} slug={view.slug} />}
            {view.kind === 'board' && <Board key={view.slug} slug={view.slug} />}
            {view.kind === 'history' && <History key={view.path} path={view.path} />}
            {view.kind === 'settings' && <Settings />}
            {/* Every open note keeps its editor (and undo history); only the active one shows */}
            {tabs.map((t) =>
              t.view.kind === 'file' ? (
                <Editor key={t.view.docId} tabId={t.id} path={t.view.path} active={t.id === activeTab} />
              ) : null
            )}
          </div>
          {view.kind === 'file' && backlinksOpen && <Backlinks path={view.path} />}
        </div>
      </main>
      {menu && <ContextMenu {...menu} />}
      <Picker />
      {prompt && <Prompt {...prompt} />}
    </div>
  )
}
