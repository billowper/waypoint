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
  recent(): Promise<string[]>
  touchRecent(rel: string): Promise<string[]>
  reveal(rel: string): Promise<void>
  onChanged(cb: (events: ChangeEvent[]) => void): () => void
}
