import type { TreeNode } from './types'
import { pagesFolder } from './names'

/**
 * Notion-style nesting on plain files: a note's sub-pages live in a folder of the same name beside
 * it (Plan.md + Plan/). The vault's tree stays what's on disk; `arrange` draws each pair as one row.
 */

/** A row in the sidebar: a tree node, and for a note with sub-pages, the folder they're in */
export type TreeRow = TreeNode & { folder?: string }

export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.type === 'dir' && path.startsWith(n.path + '/')) return findNode(n.children ?? [], path)
  }
  return null
}

/** Can things be dropped into this note? Not tasks (the board owns those), nor the project page */
export function canNest(path: string): boolean {
  return !!pagesFolder(path) && !/^projects\/[^/]+\/(project\.md$|tasks\/)/.test(path)
}

/**
 * One folder's rows: notes merged with their sub-pages' folders, then in order: `pinned` names, the
 * hand-made order, and anything else after it (folders first, then by name).
 */
export function arrange(nodes: TreeNode[], order: string[] = [], pinned: string[] = []): TreeRow[] {
  const dirs = new Map(nodes.filter((n) => n.type === 'dir').map((n) => [n.path, n]))
  const owned = new Set<string>()
  const rows: TreeRow[] = []
  for (const n of nodes) {
    const folder = n.type === 'file' && canNest(n.path) ? pagesFolder(n.path) : null
    const dir = folder ? dirs.get(folder) : undefined
    if (dir) owned.add(dir.path)
    rows.push(dir ? { ...n, children: dir.children, folder: dir.path } : n)
  }
  const rank = (list: string[], name: string) => (list.includes(name) ? list.indexOf(name) : list.length)
  return rows
    .filter((n) => !owned.has(n.path))
    .sort(
      (a, b) =>
        rank(pinned, a.name) - rank(pinned, b.name) ||
        rank(order, a.name) - rank(order, b.name) ||
        Number(b.type === 'dir') - Number(a.type === 'dir') ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
}
