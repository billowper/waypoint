import { promises as fs } from 'fs'
import type { Vault } from './vault'
import { movedPath } from '@shared/names'

/**
 * The icon map, .app/icons.json (vault-relative path → emoji, or "img:<file>" for a picture in
 * .app/icons/). No Electron here, so the Claude Code connector can keep icons in step on moves too.
 */
const MAP = '.app/icons.json'

export async function readIcons(v: Vault): Promise<Record<string, string>> {
  try {
    const data = JSON.parse(await fs.readFile(v.abs(MAP), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

async function writeIcons(v: Vault, map: Record<string, string>) {
  await fs.mkdir(v.abs('.app'), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  await fs.writeFile(v.abs(MAP), JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

export async function setIcon(v: Vault, path: string, icon: string | null) {
  const map = await readIcons(v)
  if (icon) map[path] = icon
  else delete map[path]
  await writeIcons(v, map)
}

/** After a rename/move: icons travel with the file or folder (and everything inside it) */
export async function moveIcons(v: Vault, from: string, to: string) {
  const map = await readIcons(v)
  let changed = false
  const next: Record<string, string> = {}
  for (const [p, icon] of Object.entries(map)) {
    const moved = movedPath(p, from, to)
    if (moved && moved !== p) changed = true
    next[moved ?? p] = icon
  }
  if (changed) await writeIcons(v, next)
  return changed
}

/** After a delete: drop the icons of what went */
export async function dropIcons(v: Vault, path: string) {
  const map = await readIcons(v)
  const next = Object.fromEntries(Object.entries(map).filter(([p]) => !movedPath(p, path, path)))
  if (Object.keys(next).length !== Object.keys(map).length) {
    await writeIcons(v, next)
    return true
  }
  return false
}
