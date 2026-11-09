import { lazy, Suspense, useEffect } from 'react'
import { canRename, isContentWindow, useStore } from './store'
import { editMenu, noteMenu, showMenu } from './menus'
import { resolveLink } from '@shared/links'
import { tabTitle } from './components/TopBar'
import { useApplyTheme } from './theme'
import Sidebar from './components/Sidebar'
import { PathBar, TabBar } from './components/TopBar'
import Home from './components/Home'
import DocTab from './components/LinkedDoc'
import Welcome from './components/Welcome'
import Prompt from './components/Prompt'
import ContextMenu from './components/ContextMenu'
import Picker from './components/Picker'
import Backlinks from './components/Backlinks'
import ProjectPage from './components/ProjectPage'
import IconPicker from './components/IconPicker'
import Board from './components/Board'
import Gallery from './components/Gallery'
import TaskBar from './components/TaskBar'
import History from './components/History'
import Settings from './components/Settings'
import NudgeBanner from './components/NudgeBanner'

// Excalidraw is large; only load it when a board is opened
const Canvas = lazy(() => import('./components/Canvas'))

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

  // A project's own colours apply while you're in it (its page, board, notes, tasks)
  const prefsNow = useStore((s) => s.prefs)
  const projectColors = useStore((s) => {
    const v = s.view
    const slug =
      v.kind === 'project' || v.kind === 'board' || v.kind === 'gallery'
        ? v.slug
        : (v.kind === 'file' || v.kind === 'canvas' || v.kind === 'history') && v.path.startsWith('projects/')
          ? v.path.split('/')[1]
          : null
    return slug ? (s.projects.find((p) => p.slug === slug)?.colors ?? null) : null
  })
  useApplyTheme(prefsNow?.theme, projectColors ?? prefsNow?.colors, prefsNow?.fonts)

  useEffect(() => {
    init()
  }, [init])

  // The OS window title (taskbar, Alt+Tab) follows the active tab
  const title = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTab)
    return t ? tabTitle(t, s.projects) : ''
  })
  useEffect(() => {
    document.title = title ? `${title} — Waypoint` : 'Waypoint'
  }, [title])

  useEffect(() => {
    // Right-click anywhere nothing else handles: links in notes, then Cut/Copy/Paste for text
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement
      const s = useStore.getState()
      const wiki = target.closest('[data-wikilink]')?.getAttribute('data-wikilink')
      const from = s.view.kind === 'file' ? s.view.path : ''
      const linked = wiki ? resolveLink(wiki, from, s.notes) : null
      const editable = !!target.closest('input, textarea, [contenteditable="true"]')
      const selection = (window.getSelection()?.toString() ?? '').length > 0 ||
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? (target.selectionEnd ?? 0) > (target.selectionStart ?? 0)
          : false)
      const items = [...(linked ? [...noteMenu(linked), 'separator' as const] : []), ...(editable || selection ? editMenu(selection, editable) : [])]
      if (items.length) showMenu(e, items)
    }
    window.addEventListener('contextmenu', onContext)
    return () => window.removeEventListener('contextmenu', onContext)
  }, [])

  useEffect(() => {
    // Refresh the tree, projects and tasks when files appear, vanish or project data changes.
    // Plain edits to notes (every autosave) change none of that, so they're skipped; bursts
    // (git pull, link rewrites) are coalesced into one refresh.
    let timer: ReturnType<typeof setTimeout> | null = null
    let gitTimer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onChanged((events) => {
      const structural = events.some((e) => e.event !== 'change' || e.path.startsWith('projects/') || e.path === '.app/project-order.json' || e.path === '.app/tree-order.json')
      if (!structural) {
        // Only the git "N changes" count can move; check it once typing settles
        if (gitTimer) clearTimeout(gitTimer)
        gitTimer = setTimeout(() => useStore.getState().refreshGit(), 1500)
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refresh(), 150)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
      if (gitTimer) clearTimeout(gitTimer)
    }
  }, [refresh])

  useEffect(() => {
    // Jump list, tray, toast clicks and second launches arrive here
    return window.api.onCommand((c) => {
      const s = useStore.getState()
      if ('nudge' in c && c.nudge) s.setNudge(c.nudge)
      if (c.kind === 'nudge') return
      if (c.kind === 'new-note') s.newNote('notes') // from the jump list or tray: a plain note
      else if (c.kind === 'home') s.goHome()
      else if (c.kind === 'open') s.notes.includes(c.path) && s.openFile(c.path, { newTab: c.newTab, reveal: c.reveal })
      else if (c.kind === 'open-project') s.openProject(c.slug)
      else if (c.kind === 'open-board') s.openBoard(c.slug)
      else if (c.kind === 'reveal') s.revealFolder(c.path)
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
        else if (k === 'o') run(s.toggleToc)
        else if (k === 'm' && s.view.kind === 'file') {
          const docId = s.view.docId
          run(() => s.toggleRaw(docId))
        }
      } else if ((k === '=' || k === '+' || k === '-' || k === '0') && s.prefs) {
        const p = s.prefs
        const next = k === '0' ? 1 : Math.round((p.uiScale + (k === '-' ? -0.1 : 0.1)) * 100) / 100
        run(() => s.savePrefs({ ...p, uiScale: Math.min(1.5, Math.max(0.75, next)) }))
      } else if (k === ',') run(s.openSettings)
      else if (k === 'n') run(() => s.newNote())
      else if (k === 'p' || k === 'o') run(() => s.openPicker({ kind: 'notes' }))
      else if (k === 't') run(s.newTab)
      else if (k === 'w') run(() => s.closeTab(s.activeTab))
    }
    // Back and forward, like a browser: Alt+arrows (ahead of the editor, which binds them too) and the mouse's side buttons
    const onNavKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || s.prompt || s.picker) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      e.stopPropagation()
      s.navigate(e.key === 'ArrowLeft' ? -1 : 1)
    }
    const onNavMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      useStore.getState().navigate(e.button === 3 ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onNavKey, true)
    window.addEventListener('mouseup', onNavMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onNavKey, true)
      window.removeEventListener('mouseup', onNavMouse)
    }
  }, [])

  if (!vault) return <Welcome />

  return (
    <div className={`app ${isContentWindow ? 'content-window' : ''}`}>
      {!isContentWindow && <Sidebar />}
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
            {view.kind === 'gallery' && <Gallery key={view.slug} slug={view.slug} />}
            {view.kind === 'history' && <History key={view.path} path={view.path} />}
            {view.kind === 'settings' && <Settings />}
            {tabs.some((t) => t.view.kind === 'canvas') && (
              <Suspense fallback={<p className="empty pad">Loading board…</p>}>
                {/* Boards stay mounted like editors, so switching tabs keeps their state */}
                {tabs.map((t) =>
                  t.view.kind === 'canvas' ? (
                    <Canvas key={t.view.path} path={t.view.path} active={t.id === activeTab} />
                  ) : null
                )}
              </Suspense>
            )}
            {/* Every open note keeps its editor (and undo history); only the active one shows */}
            {tabs.map((t) =>
              t.view.kind === 'file' ? (
                <DocTab key={t.view.docId} tabId={t.id} docId={t.view.docId} path={t.view.path} active={t.id === activeTab} />
              ) : null
            )}
          </div>
          {view.kind === 'file' && backlinksOpen && <Backlinks path={view.path} />}
        </div>
      </main>
      {menu && <ContextMenu {...menu} />}
      <Picker />
      <IconPicker />
      {prompt && <Prompt {...prompt} />}
    </div>
  )
}
