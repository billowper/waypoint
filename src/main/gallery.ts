import { promises as fs } from 'fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { Gallery, GalleryItem } from '@shared/types'
import { GALLERY_IMAGE_EXT, GALLERY_VIDEO_EXT } from '@shared/types'

/**
 * A project's gallery: the pictures and videos in the folders its project.md lists under `galleries`
 * (anywhere on this PC, sub-folders included). Nothing is copied into the vault or written to those folders.
 * No Electron in here (src/main/galleryMedia.ts has the parts that need it).
 */

/** Stop at this many files, so a folder picked by mistake (C:\) can't hang the app */
export const GALLERY_MAX = 5000
const MAX_DEPTH = 8

const ext = (name: string) => extname(name).slice(1).toLowerCase()
export const mediaKind = (name: string): GalleryItem['kind'] | null =>
  GALLERY_IMAGE_EXT.includes(ext(name)) ? 'image' : GALLERY_VIDEO_EXT.includes(ext(name)) ? 'video' : null

export const isInsideFolder = (dir: string, p: string) => {
  const [d, f] = [resolve(dir).toLowerCase(), resolve(p).toLowerCase()]
  return f.startsWith(d.endsWith(sep) ? d : d + sep)
}

export async function listGallery(folders: { title: string; path: string }[]): Promise<Gallery> {
  const items: GalleryItem[] = []
  const out: Gallery = { folders: [], items, truncated: false }
  const seen = new Set<string>()

  const walk = async (root: string, dir: string, folder: number, depth: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.') && mediaKind(e.name))
    const stats = await Promise.all(files.map((e) => fs.stat(join(dir, e.name)).catch(() => null)))
    files.forEach((e, i) => {
      const st = stats[i]
      const path = join(dir, e.name)
      if (!st || seen.has(path.toLowerCase())) return
      if (items.length >= GALLERY_MAX) return void (out.truncated = true)
      seen.add(path.toLowerCase())
      items.push({
        path,
        name: e.name,
        kind: mediaKind(e.name)!,
        folder,
        sub: relative(root, dir).replace(/\\/g, '/'),
        size: st.size,
        modified: st.mtimeMs
      })
    })
    if (depth >= MAX_DEPTH) return
    for (const e of entries) {
      if (out.truncated) return
      // Hidden and tool folders (.git, node_modules) hold nothing anyone wants in a gallery
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') await walk(root, join(dir, e.name), folder, depth + 1)
    }
  }

  for (const [i, f] of folders.entries()) {
    const ok = isAbsolute(f.path) && !!(await fs.stat(f.path).catch(() => null))?.isDirectory()
    out.folders.push({ title: f.title || f.path, path: f.path, missing: !ok })
    if (ok) await walk(resolve(f.path), resolve(f.path), i, 0)
  }
  return out
}
