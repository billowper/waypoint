import { net, protocol } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { extname, join, posix, resolve } from 'path'
import { pathToFileURL } from 'url'
import { movedPath } from '@shared/names'
import type { Vault } from './vault'

/**
 * Pictures in notes. Pasted, dropped and picked pictures are saved in the vault's attachments/
 * folder and written into the note as ![](path relative to the note), so they show in any
 * markdown viewer. The page shows them through wp-file://, which serves pictures from the vault
 * and nothing else.
 */

export const ATTACHMENTS = 'attachments'
const MAX = 25 * 1024 * 1024
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']

const isImage = (name: string) => IMAGE_EXT.includes(extname(name).slice(1).toLowerCase())

/**
 * wp-file://v/<vault-relative path, URI-encoded>; registered as privileged in icons.ts.
 * wp-file://x/<full path, URI-encoded> is a picture beside a linked doc's file, outside the vault:
 * `external` says whether that path is one the app is showing (inside a linked file's repo).
 */
export function serveAttachments(vault: () => Vault | null, external: (abs: string) => boolean = () => false) {
  protocol.handle('wp-file', async (req) => {
    const v = vault()
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (!v || !isImage(rel)) return new Response('Not found', { status: 404 })
    try {
      if (url.hostname === 'x') {
        const abs = resolve(rel)
        if (!external(abs)) return new Response('Not found', { status: 404 })
        return await net.fetch(pathToFileURL(abs).toString())
      }
      return await net.fetch(pathToFileURL(v.abs(rel)).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** A file name that's safe on disk and in markdown: no spaces or brackets */
function cleanName(name: string): string {
  const ext = extname(name).toLowerCase() || '.png'
  const base = name
    .slice(0, name.length - extname(name).length)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (base || 'image') + ext
}

/** Saves picture bytes in attachments/ under a name not taken yet; returns its vault-relative path */
export async function saveAttachment(v: Vault, name: string, data: Buffer): Promise<string> {
  if (!isImage(name)) throw new Error('Only pictures can be added to a note')
  if (data.length > MAX) throw new Error('That picture is over 25 MB')
  const clean = cleanName(name)
  const dir = v.abs(ATTACHMENTS)
  await fs.mkdir(dir, { recursive: true })
  const ext = extname(clean)
  const base = clean.slice(0, -ext.length)
  let file = clean
  for (let n = 2; existsSync(join(dir, file)); n++) file = `${base}-${n}${ext}`
  await fs.writeFile(join(dir, file), data, { flag: 'wx' })
  return `${ATTACHMENTS}/${file}`
}

const MD_LINK = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g

/**
 * After notes move to another folder, their relative links to files (pictures, mostly) would
 * point at the wrong place. Rewrites them in the moved notes. Returns the notes changed.
 */
export async function fixRelativeLinks(v: Vault, before: string[], from: string, to: string): Promise<string[]> {
  const changed: string[] = []
  for (const oldPath of before) {
    const path = movedPath(oldPath, from, to)
    if (!path || !path.toLowerCase().endsWith('.md')) continue
    const oldDir = posix.dirname(oldPath)
    const newDir = posix.dirname(path)
    if (oldDir === newDir) continue
    const text = await v.read(path).catch(() => null)
    if (text === null) continue
    const out = text.replace(MD_LINK, (all, open: string, target: string, close: string) => {
      const bare = target.startsWith('<') ? target.slice(1, -1) : target
      if (/^[a-z][\w+.-]*:|^[#/]/i.test(bare)) return all // web address, anchor or absolute
      let decoded: string
      try {
        decoded = decodeURI(bare)
      } catch {
        return all
      }
      const file = posix.normalize(posix.join(oldDir === '.' ? '' : oldDir, decoded))
      if (file.startsWith('..')) return all
      // A file that moved along with the note (its sub-pages folder) is found at its new place
      const now = movedPath(file, from, to) ?? file
      if (!existsSync(v.abs(now))) return all
      const rel = posix.relative(newDir === '.' ? '' : newDir, now)
      const written = /[\s()<>]/.test(rel) ? `<${rel}>` : rel
      return open + written + close
    })
    if (out !== text) {
      await v.write(path, out)
      changed.push(path)
    }
  }
  return changed
}
