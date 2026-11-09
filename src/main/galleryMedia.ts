import { clipboard, ClipboardItem, nativeImage, protocol, type WebContents } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { extname, resolve } from 'path'
import { Readable } from 'stream'
import { mediaKind } from './gallery'

/**
 * Showing a gallery's files in the page (see gallery.ts):
 *   wp-media://f/<full path, URI-encoded>        the file itself, with byte ranges so videos can seek
 *   wp-media://t/<full path, URI-encoded>?w=256  a small picture of it, from Windows' own thumbnails (videos too)
 * Only pictures and videos inside a folder some project lists as a gallery are served (`allowed`).
 * The scheme is registered as privileged in icons.ts.
 */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg'
}

const notFound = () => new Response('Not found', { status: 404 })

async function serveFile(abs: string, req: Request): Promise<Response> {
  const { size } = await fs.stat(abs)
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  }
  const body = (start: number, end: number) => Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (range && (range[1] || range[2]) && size > 0) {
    // "a-b", "a-" (to the end) or "-n" (the last n bytes)
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(body(start, end), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
    })
  }
  if (size === 0) return new Response(null, { status: 200, headers })
  return new Response(body(0, size - 1), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}

export function serveGalleryMedia(allowed: (abs: string) => boolean) {
  protocol.handle('wp-media', async (req) => {
    try {
      const url = new URL(req.url)
      const abs = resolve(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
      if (!mediaKind(abs) || !allowed(abs)) return notFound()
      if (url.hostname !== 't') return await serveFile(abs, req)
      const w = Math.min(1024, Math.max(32, Number(url.searchParams.get('w')) || 256))
      try {
        const thumb = await nativeImage.createThumbnailFromPath(abs, { width: w, height: w })
        // (the address carries the file's modified time, so a changed file gets a new thumbnail)
        return new Response(new Uint8Array(thumb.toPNG()), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' } })
      } catch {
        // No thumbnail from Windows (an SVG, say): a picture can stand in for itself
        return mediaKind(abs) === 'image' ? await serveFile(abs, req) : notFound()
      }
    } catch {
      return notFound()
    }
  })
}

const writePng = (png: Uint8Array) =>
  clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])

/** Put a picture on the clipboard as an image. False when Electron can't read the format (the page converts it instead) */
export async function copyImageFile(abs: string): Promise<boolean> {
  if (!/\.(png|jpe?g)$/i.test(abs)) return false
  const image = nativeImage.createFromPath(abs)
  if (image.isEmpty()) return false
  await writePng(image.toPNG())
  return true
}

export async function copyImageData(png: Uint8Array): Promise<void> {
  if (nativeImage.createFromBuffer(Buffer.from(png)).isEmpty()) throw new Error("That picture couldn't be copied")
  await writePng(png)
}

/** Drag a gallery file out of the window, into Explorer or another app */
export async function dragFile(sender: WebContents, abs: string) {
  const icon = await nativeImage.createThumbnailFromPath(abs, { width: 96, height: 96 }).catch(() => null)
  if (icon && !icon.isEmpty() && !sender.isDestroyed()) sender.startDrag({ file: abs, icon })
}
