import { net, protocol } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { extname, join } from 'path'
import { pathToFileURL } from 'url'
import type { Vault } from './vault'
export { readIcons, setIcon, moveIcons, dropIcons } from './iconMap'

/**
 * Icons for notes, boards, folders, tasks and projects: one map in .app/icons.json
 * (vault-relative path → emoji, or "img:<file>" for a picture stored in .app/icons/).
 * Kept out of the notes themselves so plain notes stay plain, and so folders and boards work too.
 */

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

/**
 * The page shows stored pictures as wp-icon://<file>, and pictures in notes as wp-file://
 * (attachments.ts), and gallery files as wp-media:// (galleryMedia.ts). Electron takes one call for all schemes, before the app is ready.
 */
export function registerIconScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'wp-icon', privileges: { standard: true, secure: true } },
    { scheme: 'wp-file', privileges: { standard: true, secure: true } },
    // Gallery pictures and videos (galleryMedia.ts); `stream` lets videos play and seek
    { scheme: 'wp-media', privileges: { standard: true, secure: true, stream: true } }
  ])
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
