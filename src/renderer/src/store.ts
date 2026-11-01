import { create } from 'zustand'
import type { ViewRef } from '@shared/types'
import type { GitStatus, NudgeInfo, Project, Task, TaskFields, TreeNode, VaultInfo, VaultSettings, VaultStats } from '@shared/types'
import { baseName, movedPath } from '@shared/names'
import type { Prefs } from '@shared/prefs'

/** `docId` stays the same when the open file is renamed, so the editor isn't recreated. */
export type View =
  | { kind: 'home' }
  | { kind: 'file'; path: string; docId: number }
  | { kind: 'project'; slug: string }
  | { kind: 'board'; slug: string }
  /** Git history of one note, or of the whole vault when path is '' */
  | { kind: 'history'; path: string }
  | { kind: 'settings' }
  /** An Excalidraw board file (.excalidraw) */
  | { kind: 'canvas'; path: string }

export interface Tab {
  id: number
  view: View
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

interface PromptState {
  title: string
  placeholder?: string
  initial?: string
  action?: string
  resolve: (value: string | null) => void
}

export type MenuItem =
  | { label: string; run: () => unknown; kbd?: string; danger?: boolean; disabled?: boolean }
  | 'separator'

/** A right-click menu at a point (items built by menus.ts) */
export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** Ctrl+P note switcher, or the folder chooser for "Move to…" */
export type PickerState = { kind: 'notes' } | { kind: 'move'; path: string }

/** Where to put the cursor when a note opens (from search results or backlinks) */
export interface Reveal {
  path: string
  line: number
  query?: string
}

interface State {
  vault: VaultInfo | null
  tree: TreeNode[]
  /** Every .md note in the vault, for links, Ctrl+P and autocomplete */
  notes: string[]
  /** Every .excalidraw board in the vault */
  boards: string[]
  folders: string[]
  projects: Project[]
  tasks: Task[]
  stats: VaultStats
  recent: string[]
  tabs: Tab[]
  activeTab: number
  /** The active tab's view */
  view: View
  saveStates: Record<number, SaveState>
  /** Folder that "new note / new folder" targets */
  selectedDir: string
  expanded: Record<string, boolean>
  sidebarMode: 'files' | 'search' | 'git'
  /** Icons by vault path (emoji or "img:<file>"), from .app/icons.json */
  icons: Record<string, string>
  /** The icon chooser, when open: for which item, and where */
  iconPicker: { path: string; x: number; y: number } | null
  /** Where the last right-click menu was, so things it opens appear in the same place */
  lastMenuPos: { x: number; y: number }
  /** Which sidebar sections are open (remembered between launches) */
  sidebarOpen: SidebarOpen
  git: GitStatus | null
  gitBusy: string | null
  vaultSettings: VaultSettings | null
  prefs: Prefs | null
  /** The nudge Bill clicked through, shown as a banner until dismissed */
  nudge: NudgeInfo | null
  backlinksOpen: boolean
  prompt: PromptState | null
  menu: MenuState | null
  picker: PickerState | null
  reveal: Reveal | null

  init(): Promise<void>
  openVault(): Promise<void>
  refresh(): Promise<void>
  /** Opens in the current tab, or a new one; switches to the tab if the note is already open. */
  openFile(path: string, opts?: { newTab?: boolean; reveal?: Omit<Reveal, 'path'>; force?: boolean }): Promise<void>
  goHome(): void
  openProject(slug: string, opts?: { newTab?: boolean }): void
  createProject(): Promise<void>
  openBoard(slug: string, opts?: { newTab?: boolean }): void
  createTask(project: string, fields: Partial<TaskFields>): Promise<string | null>
  updateTask(path: string, patch: Partial<TaskFields>): Promise<void>
  refreshGit(): Promise<void>
  /** Run a git action with a busy label; errors are shown to the user */
  runGit(label: string, fn: () => Promise<unknown>): Promise<boolean>
  saveVaultSettings(settings: VaultSettings): Promise<void>
  openHistory(path: string, opts?: { newTab?: boolean }): void
  openSettings(): void
  openCanvas(path: string, opts?: { newTab?: boolean; force?: boolean }): Promise<void>
  createBoard(dir: string): Promise<void>
  savePrefs(prefs: Prefs): Promise<void>
  setNudge(nudge: NudgeInfo | null): void
  newTab(): void
  closeTab(id: number): void
  closeOtherTabs(id: number): void
  closeTabsToRight(id: number): void
  /** Pop a tab out into a window of its own (at a screen point when dragged out) */
  moveTabToWindow(id: number, atCursor?: boolean): Promise<void>
  openInNewWindow(ref: ViewRef): Promise<void>
  /** A tab dropped here from another window */
  receiveTab(ref: ViewRef): void
  activateTab(id: number): void
  cycleTab(step: 1 | -1): void
  toggle(dir: string): void
  selectDir(dir: string): void
  newNote(dir?: string, name?: string): Promise<string>
  newFolder(dir?: string): Promise<void>
  /** Ask for a new name, then rename. */
  rename(path: string): Promise<void>
  renameTo(path: string, name: string): Promise<string>
  move(path: string, destDir: string): Promise<void>
  duplicate(path: string): Promise<void>
  remove(path: string): Promise<void>
  ask(title: string, opts?: { placeholder?: string; initial?: string; action?: string }): Promise<string | null>
  setSaveState(tabId: number, s: SaveState): void
  openMenu(menu: MenuState): void
  closeMenu(): void
  openPicker(picker: PickerState): void
  closePicker(): void
  setSidebarMode(mode: State['sidebarMode']): void
  toggleSection(section: 'files' | 'inbox'): void
  /** Open the icon chooser for a path (at a point, or where the last menu was) */
  openIconPicker(path: string, at?: { x: number; y: number }): void
  closeIconPicker(): void
  setIcon(path: string, icon: string | null): Promise<void>
  /** Show a folder in the sidebar: open its section, expand down to it, scroll to it */
  revealFolder(path: string): void
  /** Open or close a project's tree in the sidebar */
  setProjectOpen(slug: string, open: boolean): void
  /** Set the projects' order (all slugs, first to last); saved for every window */
  reorderProjects(slugs: string[]): Promise<void>
  toggleBacklinks(): void
  clearReveal(): void
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** The vault root and the top-level projects/ folder are relied on by name */
export const canRename = (p: string) => p !== '' && p !== 'projects'

let nextId = 0
let prefsTimer: ReturnType<typeof setTimeout> | null = null

/** Sidebar sections: the file tree starts hidden; projects open while you're in them unless set */
export interface SidebarOpen {
  files: boolean
  inbox: boolean
  /** Explicit choice per project; missing = open only while that project is in focus */
  projects: Record<string, boolean>
}
const SIDEBAR_KEY = 'waypoint:sidebar'
function loadSidebar(): SidebarOpen {
  try {
    const s = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'null')
    return { files: !!s?.files, inbox: s?.inbox !== false, projects: s?.projects ?? {} }
  } catch {
    return { files: false, inbox: true, projects: {} }
  }
}
function saveSidebar(s: SidebarOpen) {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
const homeTab = (): Tab => ({ id: ++nextId, view: { kind: 'home' } })

// Saves and file operations run one at a time, in order, so a save never lands on a path that
// a rename has just moved away from.
let io: Promise<unknown> = Promise.resolve()
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = io.then(fn, fn)
  io = run.catch(() => undefined)
  return run
}

// Editors register here so file operations can coordinate with what's open:
// flush unsaved text first, follow renames, and stop saving notes that were deleted.
interface EditorHooks {
  flush(): Promise<void>
  renamed(from: string, to: string): void
  removed(path: string): void
}
const editors = new Set<EditorHooks>()
export function registerEditor(hooks: EditorHooks): () => void {
  editors.add(hooks)
  return () => editors.delete(hooks)
}
export const flushEditors = () => Promise.all([...editors].map((e) => e.flush()))

function flatten(nodes: TreeNode[], notes: string[], folders: string[], boards: string[]) {
  for (const n of nodes) {
    if (n.type === 'dir') {
      folders.push(n.path)
      flatten(n.children ?? [], notes, folders, boards)
    } else if (n.name.toLowerCase().endsWith('.md')) {
      notes.push(n.path)
    } else if (n.name.toLowerCase().endsWith('.excalidraw')) {
      boards.push(n.path)
    }
  }
}

// Open tabs are remembered per vault between launches (best effort: storage may be unavailable)
/**
 * This window's role: the main window (sidebar, remembered tabs) or a content window opened for
 * a note/board/etc. (its first tabs arrive in the URL; the main process remembers it).
 */
const windowHash = location.hash.startsWith('#window=') ? location.hash.slice('#window='.length) : null
export const isContentWindow = windowHash !== null
const initialViews: ViewRef[] = (() => {
  try {
    return windowHash ? (JSON.parse(decodeURIComponent(windowHash)) as ViewRef[]) : []
  } catch {
    return []
  }
})()

export function toRef(v: View): ViewRef {
  return v.kind === 'file' ? { kind: 'file', path: v.path } : v
}
function fromRef(r: ViewRef): View {
  return r.kind === 'file' ? { kind: 'file', path: r.path, docId: ++nextId } : r
}
/** The note or board a view edits, if any (only one window may edit it at a time) */
export const viewPath = (v: View | ViewRef): string | null => (v.kind === 'file' || v.kind === 'canvas' ? v.path : null)

const tabsKey = (vault: string) => `waypoint:tabs:${vault}`
function saveTabs(vault: string | undefined, tabs: Tab[], activeTab: number) {
  if (!vault || isContentWindow) return // content windows are remembered by the main process
  try {
    const paths = tabs.map((t) =>
      t.view.kind === 'file'
        ? t.view.path
        : t.view.kind === 'project' || t.view.kind === 'board'
          ? `${t.view.kind}:${t.view.slug}`
          : t.view.kind === 'settings'
            ? 'settings'
            : t.view.kind === 'canvas'
              ? `canvas:${t.view.path}`
              : null
    )
    localStorage.setItem(tabsKey(vault), JSON.stringify({ paths, active: tabs.findIndex((t) => t.id === activeTab) }))
  } catch {
    /* ignore */
  }
}
function loadTabs(vault: string, notes: string[], projects: Project[]): { tabs: Tab[]; activeTab: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(tabsKey(vault)) ?? 'null') as {
      paths: (string | null)[]
      active: number
    } | null
    if (!saved?.paths?.length) return null
    const tabs = saved.paths.map((p): Tab => {
      if (p === 'settings') return { id: ++nextId, view: { kind: 'settings' } }
      if (p?.startsWith('canvas:')) return { id: ++nextId, view: { kind: 'canvas', path: p.slice(7) } }
      const [, kind, slug] = /^(project|board):(.+)$/.exec(p ?? '') ?? []
      if (slug && projects.some((x) => x.slug === slug)) {
        return { id: ++nextId, view: { kind: kind as 'project' | 'board', slug } }
      }
      return p && notes.includes(p) ? { id: ++nextId, view: { kind: 'file', path: p, docId: ++nextId } } : homeTab()
    })
    return { tabs, activeTab: (tabs[saved.active] ?? tabs[0]).id }
  } catch {
    return null
  }
}

export const useStore = create<State>((set, get) => {
  /** Set tabs and keep `view` in step with the active one. */
  const setTabs = (tabs: Tab[], activeTab: number, extra: Partial<State> = {}) => {
    if (!tabs.length) tabs = [homeTab()]
    const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]
    set({ tabs, activeTab: active.id, view: active.view, ...extra })
    saveTabs(get().vault?.path, tabs, active.id)
    window.api.reportWindowState({
      views: tabs.map((t) => toRef(t.view)),
      paths: tabs.map((t) => viewPath(t.view)).filter((p): p is string => !!p)
    })
  }

  /** Point every open tab (and tree state) at where things moved to. */
  const applyMove = (from: string, to: string) => {
    const s = get()
    const expanded: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(s.expanded)) expanded[movedPath(k, from, to) ?? k] = v
    const tabs = s.tabs.map((t): Tab => {
      if (t.view.kind === 'project' || t.view.kind === 'board') {
        const moved = movedPath(`projects/${t.view.slug}`, from, to)
        if (!moved) return t
        // Still a project folder → follow its new name; moved somewhere else → it's no longer a project
        return /^projects\/[^/]+$/.test(moved)
          ? { ...t, view: { kind: t.view.kind, slug: moved.slice('projects/'.length) } }
          : { ...t, view: { kind: 'home' } }
      }
      if (t.view.kind !== 'file' && t.view.kind !== 'canvas') return t
      const moved = movedPath(t.view.path, from, to)
      return moved ? { ...t, view: { ...t.view, path: moved } } : t
    })
    setTabs(tabs, s.activeTab, { expanded, selectedDir: movedPath(s.selectedDir, from, to) ?? s.selectedDir })
  }

  const isOpen = (path: string) => get().tabs.some((t) => t.view.kind === 'file' && t.view.path === path)

  /** Follow renames, moves and deletes made in other windows; save when they ask */
  let listening = false
  const listenToOtherWindows = () => {
    if (listening) return
    listening = true
    window.api.onMoved((from, to) => {
      editors.forEach((e) => e.renamed(from, to))
      applyMove(from, to)
    })
    window.api.onRemoved((path) => {
      editors.forEach((e) => e.removed(path))
      const { tabs, activeTab } = get()
      const keep = tabs.filter((t) => {
        const p = viewPath(t.view)
        return !(p && movedPath(p, path, path))
      })
      if (!keep.length && isContentWindow) return window.api.closeWindow()
      setTabs(keep, keep.some((t) => t.id === activeTab) ? activeTab : (keep[0]?.id ?? 0))
    })
    window.api.onFlushRequest(async () => {
      await flushEditors()
    })
    window.api.onPrefsChanged((prefs) => set({ prefs }))
    window.api.onIconsChanged(async () => set({ icons: await window.api.icons().catch(() => get().icons) }))
  }

  /** Show a project page or board: switch to its tab if open, else replace the current tab or add one */
  const openView = (view: Extract<View, { slug: string }>, newTab?: boolean) => {
    const { tabs, activeTab } = get()
    const existing = tabs.find((t) => t.view.kind === view.kind && 'slug' in t.view && t.view.slug === view.slug)
    if (existing) return setTabs(tabs, existing.id)
    if (newTab || !tabs.length) {
      const tab = { id: ++nextId, view }
      const at = tabs.findIndex((t) => t.id === activeTab) + 1
      return setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
    }
    setTabs(
      tabs.map((t) => (t.id === activeTab ? { ...t, view } : t)),
      activeTab
    )
  }

  return {
    vault: null,
    tree: [],
    notes: [],
    boards: [],
    folders: [],
    projects: [],
    tasks: [],
    stats: { notes: 0, projects: 0 },
    recent: [],
    tabs: [],
    activeTab: 0,
    view: { kind: 'home' },
    saveStates: {},
    selectedDir: 'notes',
    expanded: { notes: true },
    sidebarMode: 'files',
    sidebarOpen: loadSidebar(),
    icons: {},
    iconPicker: null,
    lastMenuPos: { x: 200, y: 120 },
    git: null,
    gitBusy: null,
    vaultSettings: null,
    prefs: null,
    nudge: null,
    backlinksOpen: true,
    prompt: null,
    menu: null,
    picker: null,
    reveal: null,

    async init() {
      const [vault, prefs] = await Promise.all([window.api.getVault(), window.api.prefs()])
      set({ vault, prefs })
      if (!vault) return
      await get().refresh()
      listenToOtherWindows()
      if (isContentWindow) {
        const tabs = initialViews.map((r) => ({ id: ++nextId, view: fromRef(r) }))
        return setTabs(tabs, tabs[0]?.id ?? 0)
      }
      const restored = loadTabs(vault.path, get().notes, get().projects)
      if (restored) setTabs(restored.tabs, restored.activeTab)
      else setTabs([homeTab()], 0)
    },

    async openVault() {
      const vault = await window.api.openVault()
      if (vault?.path === get().vault?.path) return
      set({ vault, tree: [], recent: [] })
      if (!vault) return
      await get().refresh()
      listenToOtherWindows()
      if (isContentWindow) {
        const tabs = initialViews.map((r) => ({ id: ++nextId, view: fromRef(r) }))
        return setTabs(tabs, tabs[0]?.id ?? 0)
      }
      const restored = loadTabs(vault.path, get().notes, get().projects)
      if (restored) setTabs(restored.tabs, restored.activeTab)
      else setTabs([homeTab()], 0)
    },

    async refresh() {
      if (!get().vault) return
      const [tree, stats, recent, projects, tasks, icons] = await Promise.all([
        window.api.tree(),
        window.api.stats(),
        window.api.recent(),
        window.api.projects(),
        window.api.tasks(),
        window.api.icons().catch(() => ({}))
      ])
      const notes: string[] = []
      const folders: string[] = []
      const boards: string[] = []
      flatten(tree, notes, folders, boards)
      set({ tree, stats, recent, notes, folders, boards, projects, tasks, icons })
      get().refreshGit()
    },

    async openFile(path, opts = {}) {
      // Expand the parent folders so the file is visible in the tree
      const expanded = { ...get().expanded }
      for (let dir = parentOf(path); dir; dir = parentOf(dir)) expanded[dir] = true
      const extra: Partial<State> = { selectedDir: parentOf(path), expanded }
      if (opts.reveal) extra.reveal = { path, ...opts.reveal }

      const { tabs, activeTab } = get()
      const existing = tabs.find((t) => t.view.kind === 'file' && t.view.path === path)
      if (existing) {
        setTabs(tabs, existing.id, extra)
      } else if (!opts.force && (await window.api.claimOpen(path))) {
        return // already open in another window, which has been brought forward
      } else {
        const view: View = { kind: 'file', path, docId: ++nextId }
        const current = tabs.find((t) => t.id === activeTab)
        if (opts.newTab || !current) {
          const tab = { id: ++nextId, view }
          const at = current ? tabs.indexOf(current) + 1 : tabs.length
          setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id, extra)
        } else {
          setTabs(
            tabs.map((t) => (t.id === activeTab ? { ...t, view } : t)),
            activeTab,
            extra
          )
        }
      }
      set({ recent: await window.api.touchRecent(path) })
    },

    goHome() {
      const { tabs, activeTab } = get()
      setTabs(
        tabs.map((t) => (t.id === activeTab ? { ...t, view: { kind: 'home' } } : t)),
        activeTab
      )
    },

    openProject(slug, opts = {}) {
      openView({ kind: 'project', slug }, opts.newTab)
    },

    openBoard(slug, opts = {}) {
      openView({ kind: 'board', slug }, opts.newTab)
    },

    async createTask(project, fields) {
      try {
        const path = await enqueue(() => window.api.createTask(project, fields))
        await get().refresh()
        return path
      } catch (e) {
        alert(`Couldn't create the task.

${(e as Error).message}`)
        return null
      }
    },

    async updateTask(path, patch) {
      // Optimistic, so dragging a card feels instant; the refresh confirms from disk
      set((s) => ({ tasks: s.tasks.map((t) => (t.path === path ? { ...t, ...patch } : t)) }))
      try {
        await flushEditors() // an open task note's unsaved text must not overwrite the change
        await enqueue(() => window.api.updateTask(path, patch))
      } catch (e) {
        alert(`Couldn't update the task.

${(e as Error).message}`)
      }
      await get().refresh()
    },

    async refreshGit() {
      if (!get().vault) return
      const [git, vaultSettings] = await Promise.all([
        window.api.gitStatus().catch((e): GitStatus => ({
          isRepo: false, branch: '', files: [], conflicted: [], ahead: 0, behind: 0, hasRemote: false,
          lastCommit: null, error: (e as Error).message
        })),
        window.api.vaultSettings().catch(() => null)
      ])
      set({ git, vaultSettings })
    },

    async runGit(label, fn) {
      if (get().gitBusy) return false
      set({ gitBusy: label })
      try {
        await flushEditors() // commit what's on screen, and don't let a pull fight unsaved text
        await enqueue(fn)
        return true
      } catch (e) {
        alert(`${label} failed.

${(e as Error).message}`)
        return false
      } finally {
        set({ gitBusy: null })
        await get().refresh()
      }
    },

    async saveVaultSettings(settings) {
      set({ vaultSettings: settings })
      await window.api.saveVaultSettings(settings)
    },

    openHistory(path, opts = {}) {
      const { tabs, activeTab } = get()
      const existing = tabs.find((t) => t.view.kind === 'history' && t.view.path === path)
      if (existing) return setTabs(tabs, existing.id)
      const tab = { id: ++nextId, view: { kind: 'history', path } as View }
      if (!opts.newTab && tabs.find((t) => t.id === activeTab)?.view.kind === 'history') {
        return setTabs(tabs.map((t) => (t.id === activeTab ? { ...t, view: tab.view } : t)), activeTab)
      }
      const at = tabs.findIndex((t) => t.id === activeTab) + 1
      setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
    },

    openSettings() {
      const { tabs, activeTab } = get()
      const existing = tabs.find((t) => t.view.kind === 'settings')
      if (existing) return setTabs(tabs, existing.id)
      const tab = { id: ++nextId, view: { kind: 'settings' } as View }
      const at = tabs.findIndex((t) => t.id === activeTab) + 1
      setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
    },

    setNudge: (nudge) => set({ nudge }),

    async openCanvas(path, opts = {}) {
      const { tabs, activeTab } = get()
      const existing = tabs.find((t) => t.view.kind === 'canvas' && t.view.path === path)
      if (existing) return setTabs(tabs, existing.id)
      if (!opts.force && (await window.api.claimOpen(path))) return // open in another window
      const view: View = { kind: 'canvas', path }
      if (opts.newTab || !tabs.length) {
        const tab = { id: ++nextId, view }
        const at = tabs.findIndex((t) => t.id === activeTab) + 1
        return setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
      }
      setTabs(
        tabs.map((t) => (t.id === activeTab ? { ...t, view } : t)),
        activeTab
      )
    },

    async createBoard(dir) {
      const name = await get().ask('New board', { placeholder: 'Board name', action: 'Create' })
      if (!name) return
      try {
        const path = await window.api.createBoard(dir, name)
        await get().refresh()
        get().openCanvas(path)
      } catch (e) {
        alert(`Couldn't create the board.

${(e as Error).message}`)
      }
    },

    async savePrefs(prefs) {
      // Show the change at once; write it once the colour picker / slider stops moving
      set({ prefs })
      if (prefsTimer) clearTimeout(prefsTimer)
      prefsTimer = setTimeout(async () => {
        const saved = await window.api.savePrefs(prefs)
        if (get().prefs === prefs) set({ prefs: saved })
      }, 300)
    },

    async createProject() {
      const name = await get().ask('New project', { placeholder: 'Project name', action: 'Create' })
      if (!name) return
      try {
        const slug = await window.api.createProject(name)
        set((s) => ({ expanded: { ...s.expanded, projects: true } }))
        await get().refresh()
        get().openProject(slug)
      } catch (e) {
        alert(`Couldn't create the project.

${(e as Error).message}`)
      }
    },

    newTab() {
      const { tabs, activeTab } = get()
      const tab = homeTab()
      const at = tabs.findIndex((t) => t.id === activeTab) + 1
      setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
    },

    closeTab(id) {
      const { tabs, activeTab } = get()
      const i = tabs.findIndex((t) => t.id === id)
      if (i === -1) return
      const rest = tabs.filter((t) => t.id !== id)
      if (!rest.length && isContentWindow) {
        set({ tabs: [] })
        window.api.reportWindowState({ views: [], paths: [] })
        return window.api.closeWindow()
      }
      const next = id === activeTab ? (rest[i] ?? rest[i - 1])?.id : activeTab
      setTabs(rest, next ?? 0)
    },

    closeOtherTabs(id) {
      const keep = get().tabs.filter((t) => t.id === id)
      if (keep.length) setTabs(keep, id)
    },

    closeTabsToRight(id) {
      const { tabs, activeTab } = get()
      const i = tabs.findIndex((t) => t.id === id)
      const keep = tabs.slice(0, i + 1)
      setTabs(keep, keep.some((t) => t.id === activeTab) ? activeTab : id)
    },

    async moveTabToWindow(id, atCursor) {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      // A content window's only tab is already its own window
      if (isContentWindow && get().tabs.length === 1 && !atCursor) return
      const ref = toRef(tab.view)
      await flushEditors()
      get().closeTab(id) // its editor saves and lets go of the note first
      await window.api.openWindow([ref], atCursor)
    },

    async openInNewWindow(ref) {
      const p = viewPath(ref)
      const here = get().tabs.find((t) => p && viewPath(t.view) === p)
      if (here) return get().moveTabToWindow(here.id)
      if (p && (await window.api.claimOpen(p))) return // already in a window of its own
      await window.api.openWindow([ref])
    },

    receiveTab(ref) {
      // The window it came from closes its tab once the drop lands, so don't send it back there
      if (ref.kind === 'file') return get().openFile(ref.path, { newTab: true, force: true })
      if (ref.kind === 'canvas') return get().openCanvas(ref.path, { newTab: true, force: true })
      const { tabs, activeTab } = get()
      const tab = { id: ++nextId, view: fromRef(ref) }
      const at = tabs.findIndex((t) => t.id === activeTab) + 1
      setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)], tab.id)
    },

    activateTab: (id) => setTabs(get().tabs, id),

    cycleTab(step) {
      const { tabs, activeTab } = get()
      const i = tabs.findIndex((t) => t.id === activeTab)
      setTabs(tabs, tabs[(i + step + tabs.length) % tabs.length].id)
    },

    toggle: (dir) => set((s) => ({ expanded: { ...s.expanded, [dir]: !s.expanded[dir] } })),
    selectDir: (dir) => set({ selectedDir: dir }),

    async newNote(dir, name) {
      const target = dir ?? get().selectedDir
      // "New note" while in a project's tasks folder means a new task there
      const taskFolder = /^projects\/([^/]+)\/tasks(\/|$)/.exec(target)
      if (taskFolder && !name) {
        const task = await get().createTask(taskFolder[1], { title: 'New task' })
        if (task) await get().openFile(task)
        return task ?? ''
      }
      const path = await window.api.createNote(target, name)
      await get().refresh()
      await get().openFile(path)
      return path
    },

    async newFolder(dir) {
      const target = dir ?? get().selectedDir
      const name = await get().ask('New folder', { placeholder: 'Folder name', action: 'Create' })
      if (!name) return
      const path = await window.api.createFolder(target, name)
      set((s) => ({ expanded: { ...s.expanded, [target]: true, [path]: true }, selectedDir: path }))
      await get().refresh()
    },

    async rename(path) {
      const name = await get().ask('Rename', { initial: baseName(path), action: 'Rename' })
      if (!name) return
      try {
        await get().renameTo(path, name)
      } catch (e) {
        alert(`Couldn't rename "${baseName(path)}".\n\n${(e as Error).message}`)
      }
    },

    async renameTo(path, name) {
      await flushEditors() // so link updates in other notes don't fight unsaved edits
      const to = await enqueue(async () => {
        // An open note's editor rewrites its own title; otherwise the main process does it
        const to = await window.api.rename(path, name, !isOpen(path))
        if (to === path) return to
        editors.forEach((e) => e.renamed(path, to))
        applyMove(path, to)
        return to
      })
      await get().refresh()
      return to
    },

    async move(path, destDir) {
      if (parentOf(path) === destDir || destDir === path || destDir.startsWith(path + '/')) return
      try {
        await flushEditors()
        await enqueue(async () => {
          const to = await window.api.move(path, destDir)
          if (to === path) return
          editors.forEach((e) => e.renamed(path, to))
          applyMove(path, to)
          set((s) => ({ expanded: { ...s.expanded, [destDir]: true } }))
        })
        await get().refresh()
      } catch (e) {
        alert(`Couldn't move "${baseName(path)}".\n\n${(e as Error).message}`)
      }
    },

    async duplicate(path) {
      try {
        await flushEditors()
        const to = await enqueue(() => window.api.duplicate(path))
        await get().refresh()
        if (to.toLowerCase().endsWith('.md')) await get().openFile(to)
      } catch (e) {
        alert(`Couldn't duplicate "${baseName(path)}".\n\n${(e as Error).message}`)
      }
    },

    async remove(path) {
      try {
        await flushEditors() // nothing left pending that could write the file back afterwards
        const done = await enqueue(() => window.api.trash(path))
        if (!done) return
        editors.forEach((e) => e.removed(path))
        const { tabs, activeTab } = get()
        const keep = tabs.filter((t) => !(t.view.kind === 'file' && movedPath(t.view.path, path, path)))
        setTabs(keep, keep.some((t) => t.id === activeTab) ? activeTab : (keep[0]?.id ?? 0))
        await get().refresh()
      } catch (e) {
        alert(`Couldn't delete "${baseName(path)}".\n\n${(e as Error).message}`)
      }
    },

    ask(title, opts = {}) {
      return new Promise((resolve) => {
        set({
          prompt: {
            title,
            ...opts,
            resolve: (v) => {
              set({ prompt: null })
              resolve(v)
            }
          }
        })
      })
    },

    setSaveState: (tabId, s) => set((st) => ({ saveStates: { ...st.saveStates, [tabId]: s } })),
    openMenu: (menu) => set({ menu }),
    closeMenu: () => set({ menu: null }),
    openPicker: (picker) => set({ picker, menu: null }),
    closePicker: () => set({ picker: null }),
    // Search and Git live in the Files section, so choosing them opens it
    setSidebarMode(sidebarMode) {
      const sidebarOpen = { ...get().sidebarOpen, files: true }
      saveSidebar(sidebarOpen)
      set({ sidebarMode, sidebarOpen })
    },

    revealFolder(path) {
      if (isContentWindow) return window.api.revealInMain(path) // no sidebar here
      const s = get()
      const expanded = { ...s.expanded }
      for (let dir = path; dir; dir = parentOf(dir)) expanded[dir] = true
      const sidebarOpen = { ...s.sidebarOpen, projects: { ...s.sidebarOpen.projects } }
      const project = /^projects\/([^/]+)/.exec(path)?.[1]
      let mode = s.sidebarMode
      if (project && path !== `projects/${project}`) sidebarOpen.projects[project] = true
      else if (path === 'notes' || path.startsWith('notes/')) sidebarOpen.inbox = true
      else {
        sidebarOpen.files = true
        mode = 'files'
      }
      saveSidebar(sidebarOpen)
      set({ expanded, sidebarOpen, sidebarMode: mode, selectedDir: path })
      // Once it's drawn: scroll to the folder's row and flash it
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const rows = document.querySelectorAll<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
          const row = rows[0]
          if (!row) return
          row.scrollIntoView({ block: 'nearest' })
          row.classList.remove('flash')
          void row.offsetWidth // restart the animation
          row.classList.add('flash')
        })
      )
    },

    openIconPicker(path, at) {
      set({ iconPicker: { path, ...(at ?? get().lastMenuPos) }, menu: null })
    },

    closeIconPicker: () => set({ iconPicker: null }),

    async setIcon(path, icon) {
      // Show it at once; the main process writes .app/icons.json and tells every window
      set((s) => {
        const icons = { ...s.icons }
        if (icon) icons[path] = icon
        else delete icons[path]
        return { icons }
      })
      await window.api.setIcon(path, icon)
    },

    toggleSection(section) {
      const cur = get().sidebarOpen
      const sidebarOpen = { ...cur, [section]: !cur[section] }
      saveSidebar(sidebarOpen)
      set({ sidebarOpen })
    },

    async reorderProjects(slugs) {
      const rank = (slug: string) => (slugs.includes(slug) ? slugs.indexOf(slug) : slugs.length)
      set({ projects: [...get().projects].sort((a, b) => rank(a.slug) - rank(b.slug)) })
      await window.api.saveProjectOrder(slugs)
    },

    setProjectOpen(slug, open) {
      const cur = get().sidebarOpen
      const sidebarOpen = { ...cur, projects: { ...cur.projects, [slug]: open } }
      saveSidebar(sidebarOpen)
      set({ sidebarOpen })
    },
    toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),
    clearReveal: () => set({ reveal: null })
  }
})
