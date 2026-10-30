import { create } from 'zustand'
import type { Project, Task, TaskFields, TreeNode, VaultInfo, VaultStats } from '@shared/types'
import { baseName, movedPath } from '@shared/names'

/** `docId` stays the same when the open file is renamed, so the editor isn't recreated. */
export type View =
  | { kind: 'home' }
  | { kind: 'file'; path: string; docId: number }
  | { kind: 'project'; slug: string }
  | { kind: 'board'; slug: string }

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

export interface MenuState {
  x: number
  y: number
  path: string
  type: 'file' | 'dir'
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
  sidebarMode: 'files' | 'search'
  backlinksOpen: boolean
  prompt: PromptState | null
  menu: MenuState | null
  picker: PickerState | null
  reveal: Reveal | null

  init(): Promise<void>
  openVault(): Promise<void>
  refresh(): Promise<void>
  /** Opens in the current tab, or a new one; switches to the tab if the note is already open. */
  openFile(path: string, opts?: { newTab?: boolean; reveal?: Omit<Reveal, 'path'> }): Promise<void>
  goHome(): void
  openProject(slug: string, opts?: { newTab?: boolean }): void
  createProject(): Promise<void>
  openBoard(slug: string, opts?: { newTab?: boolean }): void
  createTask(project: string, fields: Partial<TaskFields>): Promise<string | null>
  updateTask(path: string, patch: Partial<TaskFields>): Promise<void>
  newTab(): void
  closeTab(id: number): void
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
  toggleBacklinks(): void
  clearReveal(): void
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** The vault root and the top-level projects/ folder are relied on by name */
export const canRename = (p: string) => p !== '' && p !== 'projects'

let nextId = 0
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
const flushEditors = () => Promise.all([...editors].map((e) => e.flush()))

function flatten(nodes: TreeNode[], notes: string[], folders: string[]) {
  for (const n of nodes) {
    if (n.type === 'dir') {
      folders.push(n.path)
      flatten(n.children ?? [], notes, folders)
    } else if (n.name.toLowerCase().endsWith('.md')) {
      notes.push(n.path)
    }
  }
}

// Open tabs are remembered per vault between launches (best effort: storage may be unavailable)
const tabsKey = (vault: string) => `waypoint:tabs:${vault}`
function saveTabs(vault: string | undefined, tabs: Tab[], activeTab: number) {
  if (!vault) return
  try {
    const paths = tabs.map((t) =>
      t.view.kind === 'file'
        ? t.view.path
        : t.view.kind === 'project' || t.view.kind === 'board'
          ? `${t.view.kind}:${t.view.slug}`
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
      if (t.view.kind !== 'file') return t
      const moved = movedPath(t.view.path, from, to)
      return moved ? { ...t, view: { ...t.view, path: moved } } : t
    })
    setTabs(tabs, s.activeTab, { expanded, selectedDir: movedPath(s.selectedDir, from, to) ?? s.selectedDir })
  }

  const isOpen = (path: string) => get().tabs.some((t) => t.view.kind === 'file' && t.view.path === path)

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
    backlinksOpen: true,
    prompt: null,
    menu: null,
    picker: null,
    reveal: null,

    async init() {
      const vault = await window.api.getVault()
      set({ vault })
      if (!vault) return
      await get().refresh()
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
      const restored = loadTabs(vault.path, get().notes, get().projects)
      if (restored) setTabs(restored.tabs, restored.activeTab)
      else setTabs([homeTab()], 0)
    },

    async refresh() {
      if (!get().vault) return
      const [tree, stats, recent, projects, tasks] = await Promise.all([
        window.api.tree(),
        window.api.stats(),
        window.api.recent(),
        window.api.projects(),
        window.api.tasks()
      ])
      const notes: string[] = []
      const folders: string[] = []
      flatten(tree, notes, folders)
      set({ tree, stats, recent, notes, folders, projects, tasks })
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
      const next = id === activeTab ? (rest[i] ?? rest[i - 1])?.id : activeTab
      setTabs(rest, next ?? 0)
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
    setSidebarMode: (sidebarMode) => set({ sidebarMode }),
    toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),
    clearReveal: () => set({ reveal: null })
  }
})
