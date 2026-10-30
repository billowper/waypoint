import { net, protocol } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { extname, join } from 'path'
import { pathToFileURL } from 'url'
import type { Vault } from './vault'
import { movedPath } from '@shared/names'

/**
 * Icons for notes, boards, folders, tasks and projects: one map in .app/icons.json
 * (vault-relative path → emoji, or "img:<file>" for a picture stored in .app/icons/).
 * Kept out of the notes themselves so plain notes stay plain, and so folders and boards work too.
 */

const MAP = '.app/icons.json'
const DIR = '.app/icons'
const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'])
const EXT_FOR_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/bmp': '.bmp'
}

/** The page shows stored pictures as wp-icon://<file>; must be registered before the app is ready */
export function registerIconScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'wp-icon', privileges: { standard: true, secure: true } }])
}

/** Serve pictures from the open vault's .app/icons/ folder, and nothing else */
export function serveIcons(vault: () => Vault | null) {
  protocol.handle('wp-icon', async (req) => {
    const v = vault()
    // wp-icon://i/<file> (the file name rides in the path; hosts get lower-cased)
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''))
    if (!v || !/^[\w.-]+$/.test(name)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(join(v.abs(DIR), name)).toString())
  })
}

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

/** Store picture bytes in .app/icons/ under a content hash (so the same image is kept once) */
async function storeImage(v: Vault, data: Buffer, ext: string): Promise<string> {
  if (data.length > MAX_IMAGE) throw new Error('That image is over 5 MB')
  const name = createHash('sha1').update(data).digest('hex').slice(0, 16) + ext.toLowerCase()
  await fs.mkdir(v.abs(DIR), { recursive: true })
  await fs.writeFile(v.abs(`${DIR}/${name}`), data)
  return `img:${name}`
}

export async function iconFromFile(v: Vault, file: string): Promise<string> {
  const ext = extname(file).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new Error('Pick an image (PNG, JPG, GIF, WebP, SVG, ICO or BMP)')
  return storeImage(v, await fs.readFile(file), ext)
}

/** Download a picture once, so it works offline and travels with the vault */
export async function iconFromUrl(v: Vault, url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Use a link starting with http:// or https://')
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`The site said ${res.status} ${res.statusText}`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT_FOR_TYPE[type] ?? (IMAGE_EXT.has(extname(new URL(url).pathname).toLowerCase()) ? extname(new URL(url).pathname) : '')
  if (!ext) throw new Error("That link isn't an image")
  return storeImage(v, Buffer.from(await res.arrayBuffer()), ext)
}
