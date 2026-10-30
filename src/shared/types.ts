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
  recent(): Promise<string[]>
  touchRecent(rel: string): Promise<string[]>
  reveal(rel: string): Promise<void>
  onChanged(cb: (events: ChangeEvent[]) => void): () => void
}
