import type { Prefs } from './prefs'

export interface TreeNode {
  name: string
  /** Vault-relative path using forward slashes */
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface VaultInfo {
  path: string
  name: string
}

export interface VaultStats {
  notes: number
  projects: number
}

export interface ChangeEvent {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}

/** A note that links to another, with the lines the links are on */
export interface Backlink {
  path: string
  lines: { line: number; text: string }[]
}

export interface SearchHit {
  path: string
  /** Matching lines (1-based) with [start, end) ranges of the matched terms */
  lines: { line: number; text: string; ranges: [number, number][] }[]
}

export const PROJECT_STATUSES = ['idea', 'active', 'paused', 'done'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** What lives in a project's project.md frontmatter */
export interface ProjectSettings {
  title: string
  status: ProjectStatus
  /** Prefix for task IDs, e.g. "WEB" → WEB-001 */
  key: string
  tags: string[]
  created: string
  /** The project's own code repository (separate from the vault's git) */
  repo: { path: string; remote: string }
  links: { title: string; url: string }[]
  bookmarks: { title: string; path: string }[]
  /** The project's own accent colour; null = use the app's */
  colors: { accent: string } | null
}

export interface Project extends ProjectSettings {
  /** Folder name under projects/ */
  slug: string
  /** Vault-relative folder, "projects/<slug>" */
  dir: string
  /** project.md body without its "# Title" line */
  overview: string
  /** Newest modification time of anything in the project (ms) */
  updated: number
  hasFile: boolean
}

export const TASK_STATUSES = ['backlog', 'todo', 'doing', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'Doing',
  done: 'Done'
}
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Editable task fields (frontmatter of projects/<slug>/tasks/<ID>.md) */
export interface TaskFields {
  title: string
  status: TaskStatus
  priority: Priority
  /** YYYY-MM-DD or '' */
  due: string
  labels: string[]
}

export interface Task extends TaskFields {
  /** Vault-relative path of the task note */
  path: string
  /** e.g. WR-001 */
  id: string
  project: string
  created: string
  /** Set when the task moved to Done (YYYY-MM-DD) */
  completed: string
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  /** Changed files (vault-relative) with git's two-letter code, e.g. "M", "A", "?" */
  files: { path: string; code: string }[]
  conflicted: string[]
  ahead: number
  behind: number
  hasRemote: boolean
  lastCommit: { hash: string; date: string; message: string } | null
  /** Set when git itself isn't installed or failed */
  error?: string
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

/** Per-vault settings in .app/settings.json (committed with the vault) */
export interface VaultSettings {
  version: number
  git: { autoCommit: boolean; intervalMinutes: number }
}

/** Things the main process asks the UI to do (jump list, tray, toasts, second launches) */
/** A tab's content in a form that can travel between windows (and be saved for next launch) */
export type ViewRef =
  | { kind: 'home' }
  | { kind: 'settings' }
  | { kind: 'file'; path: string }
  | { kind: 'canvas'; path: string }
  | { kind: 'history'; path: string }
  | { kind: 'project'; slug: string }
  | { kind: 'board'; slug: string }

/** Shown as a banner when Bill clicks a nudge, so he can mute or snooze it */
export interface NudgeInfo {
  key: string
  message: string
  /** Set for nudges shown inside the app (no toast was clicked yet) */
  title?: string
  open?: AppCommand
}

export type AppCommand =
  | { kind: 'new-note' }
  | { kind: 'home' }
  | { kind: 'capture' }
  | { kind: 'open'; path: string; nudge?: NudgeInfo; reveal?: { line: number; query?: string }; newTab?: boolean }
  | { kind: 'search' }
  | { kind: 'open-project'; slug: string; nudge?: NudgeInfo }
  | { kind: 'open-board'; slug: string }
  | { kind: 'snooze'; minutes: number }
  /** Show a nudge as a banner in the app (used when the window is in front) */
  | { kind: 'nudge'; nudge: NudgeInfo }

export interface DesktopInfo {
  packaged: boolean
  /** The quick-capture hotkey actually registered ('' if none or taken by another app) */
  hotkey: string
  searchHotkey: string
}

export interface Api {
  getVault(): Promise<VaultInfo | null>
  openVault(): Promise<VaultInfo | null>
  tree(): Promise<TreeNode[]>
  stats(): Promise<VaultStats>
  read(rel: string): Promise<string>
  write(rel: string, content: string): Promise<void>
  createNote(dirRel: string, name?: string): Promise<string>
  createFolder(dirRel: string, name: string): Promise<string>
  /**
   * Rename/move/duplicate return the new vault-relative path (unchanged if nothing happened).
   * Rename and move also update [[links]] in other notes that pointed at what moved.
   */
  rename(rel: string, newName: string, syncHeading: boolean): Promise<string>
  move(rel: string, destDirRel: string): Promise<string>
  duplicate(rel: string): Promise<string>
  /** Asks for confirmation, then moves to the Recycle Bin. Resolves false if cancelled. */
  trash(rel: string): Promise<boolean>
  search(query: string): Promise<SearchHit[]>
  backlinks(rel: string): Promise<Backlink[]>
  projects(): Promise<Project[]>
  /** Returns the new project's slug */
  createProject(name: string): Promise<string>
  saveProject(slug: string, settings: ProjectSettings): Promise<void>
  /** Outside-the-vault paths (repo folder, bookmarks); only paths a project lists are allowed */
  openPath(path: string): Promise<void>
  revealPath(path: string): Promise<void>
  openInCode(path: string): Promise<void>
  pickPath(kind: 'file' | 'folder'): Promise<string | null>
  /** All tasks, or one project's */
  tasks(project?: string): Promise<Task[]>
  /** Returns the new task's path */
  createTask(project: string, fields: Partial<TaskFields>): Promise<string>
  updateTask(rel: string, patch: Partial<TaskFields>): Promise<Task>
  vaultSettings(): Promise<VaultSettings>
  saveVaultSettings(settings: VaultSettings): Promise<void>
  gitStatus(): Promise<GitStatus>
  gitInit(): Promise<void>
  /** Resolves false when there was nothing to commit */
  gitCommit(message: string): Promise<boolean>
  gitPull(): Promise<string>
  gitPush(): Promise<void>
  gitLog(file?: string): Promise<GitCommit[]>
  /** Patch for a commit, or uncommitted changes when hash is "working" */
  gitDiff(hash: string, file?: string): Promise<string>
  recent(): Promise<string[]>
  touchRecent(rel: string): Promise<string[]>
  reveal(rel: string): Promise<void>
  onChanged(cb: (events: ChangeEvent[]) => void): () => void
  /** Fires after commits the app made by itself (auto-commit) */
  onGitChanged(cb: () => void): () => void
  onCommand(cb: (c: AppCommand) => void): () => void
  prefs(): Promise<Prefs>
  savePrefs(prefs: Prefs): Promise<Prefs>
  desktopInfo(): Promise<DesktopInfo>
  /** Quick capture window: append to inbox.md, then close */
  captureAdd(text: string): Promise<void>
  captureClose(): void
  /** Search popup: open a result in the main window (closes the popup) */
  searchOpen(path: string, reveal?: { line: number; query?: string }, newTab?: boolean): void
  searchClose(): void
  /** Fit the popup window to its content */
  popupHeight(px: number): void
  /** Open views in a new window of their own (under the pointer when a tab is dragged out) */
  openWindow(views: ViewRef[], atCursor?: boolean): Promise<void>
  /** Which window this is */
  windowInfo(): Promise<{ id: number; main: boolean }>
  /** If another window already has this note/board open, switch to it there and resolve true */
  claimOpen(path: string): Promise<boolean>
  /** Tell the main process what this window has open */
  reportWindowState(state: { views: ViewRef[]; paths: string[] }): void
  showMain(): void
  /** Close this window (content windows only) */
  closeWindow(): void
  /** Another window renamed/moved something */
  onMoved(cb: (from: string, to: string) => void): () => void
  /** Another window deleted something */
  onRemoved(cb: (path: string) => void): () => void
  /** Another window is about to rename/move/delete: save unsaved edits now */
  onFlushRequest(cb: () => Promise<void>): () => void
  onPrefsChanged(cb: (prefs: Prefs) => void): () => void
  /** Clipboard and selection actions for context menus */
  editAction(action: 'cut' | 'copy' | 'paste' | 'selectAll'): void
  /** Font families installed on this PC (sorted) */
  installedFonts(): Promise<string[]>
  /** Match the native title-bar buttons to the page's colours */
  setChrome(background: string, symbols: string): void
  /** Zip the vault into the backup folder now; returns the file written */
  backupNow(): Promise<string>
  /** New Excalidraw board in a folder; returns its path */
  createBoard(dir: string, name: string): Promise<string>
  /** Show a nudge right away (ignores timing rules; for trying it out) */
  nudgeNow(): Promise<void>
}
