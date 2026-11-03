import { promises as fs } from 'fs'
import { posix } from 'path'
import type { TreeOrder } from '@shared/types'
import { movedPath } from '@shared/names'
import type { Vault } from './vault'

/**
 * The sidebar's hand-made order, .app/tree-order.json: folder path → names in it. Only folders
 * someone has reordered appear; new files go after the listed ones. No Electron here (the connector uses it too).
 */
const FILE = '.app/tree-order.json'

const dirOf = (rel: string) => (rel.includes('/') ? posix.dirname(rel) : '')

export async function readTreeOrder(v: Vault): Promise<TreeOrder> {
  try {
    const data = JSON.parse(await fs.readFile(v.abs(FILE), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

async function write(v: Vault, order: TreeOrder) {
  await fs.mkdir(v.abs('.app'), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(order).sort(([a], [b]) => a.localeCompare(b)))
  await fs.writeFile(v.abs(FILE), JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

export async function saveTreeOrder(v: Vault, dir: string, names: string[]): Promise<void> {
  await write(v, { ...(await readTreeOrder(v)), [dir]: [...new Set(names)] })
}

/** After a rename/move: keep its place if it stayed in the same folder, and carry the lists of folders inside it */
export async function moveInTreeOrder(v: Vault, from: string, to: string): Promise<void> {
  const order = await readTreeOrder(v)
  const next: TreeOrder = {}
  for (const [dir, names] of Object.entries(order)) next[(dir && movedPath(dir, from, to)) || dir] = [...names]
  const home = next[dirOf(from)]
  const at = home ? home.indexOf(posix.basename(from)) : -1
  if (at !== -1) {
    if (dirOf(from) === dirOf(to)) home[at] = posix.basename(to)
    else home.splice(at, 1)
  }
  if (JSON.stringify(next) !== JSON.stringify(order)) await write(v, next)
}

/** After a delete: forget it and the lists of folders inside it */
export async function dropFromTreeOrder(v: Vault, rel: string): Promise<void> {
  const order = await readTreeOrder(v)
  const next = Object.fromEntries(Object.entries(order).filter(([dir]) => !dir || !movedPath(dir, rel, rel)))
  const home = next[dirOf(rel)]
  if (home) next[dirOf(rel)] = home.filter((n) => n !== posix.basename(rel))
  if (JSON.stringify(next) !== JSON.stringify(order)) await write(v, next)
}
