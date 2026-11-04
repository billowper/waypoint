import type { Vault } from './vault'
import type { NotesIndex } from './notesIndex'
import { movedPath } from '@shared/names'
import { formatLink, linkTextFor, parseLinks, resolveLink } from '@shared/links'

/**
 * Rewrite [[links]] that pointed at notes under `from` so they point at `to` instead.
 * `before` is every note path before the move (the index as it was). Returns the notes changed.
 */
export async function updateLinks(
  v: Vault,
  index: NotesIndex,
  before: string[],
  from: string,
  to: string
): Promise<string[]> {
  const moved = new Map<string, string>()
  for (const p of before) {
    const dest = movedPath(p, from, to)
    if (dest) moved.set(p, dest)
  }
  if (!moved.size) return []
  const after = before.map((p) => moved.get(p) ?? p)
  const changed: string[] = []
  for (const oldPath of index.linkersOf(new Set(moved.keys()), before)) {
    const path = moved.get(oldPath) ?? oldPath
    const text = await v.read(path).catch(() => null)
    if (text === null) continue
    let out = text
    for (const l of parseLinks(text).reverse()) {
      const target = resolveLink(l.target, oldPath, before)
      const dest = target ? moved.get(target) : undefined
      // Name-only links usually still work after a folder move; only rewrite the ones that break
      if (!dest || resolveLink(l.target, path, after) === dest) continue
      out = out.slice(0, l.from) + formatLink(linkTextFor(dest, after), l.heading, l.alias, l.escapedPipe) + out.slice(l.to)
    }
    if (out !== text) {
      await v.write(path, out)
      changed.push(path)
    }
  }
  return changed
}
