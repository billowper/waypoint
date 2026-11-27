import { extname, resolve, sep } from 'path'
import { EXTERNAL_SCHEMES } from '@shared/pluginApi'

/**
 * Small pure helpers for serving plugin files and opening links (no Electron, so they can be tried on their own).
 */

/**
 * The file a request path names, or null if it leaves `root` (checked like Vault.abs: resolve, then compare
 * with the folder). `urlPath` is a decoded URL path such as "/web/index.html".
 */
export function resolveInside(root: string, urlPath: string): string | null {
  if (urlPath.includes('\0')) return null
  const base = resolve(root)
  const p = resolve(base, '.' + (urlPath.startsWith('/') || urlPath.startsWith('\\') ? urlPath : '/' + urlPath))
  const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  const prefix = base.endsWith(sep) ? base : base + sep
  return same(p, base) || (p.length > prefix.length && same(p.slice(0, prefix.length), prefix)) ? p : null
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
}

export const contentType = (file: string) => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'

/** Only web links, mail and Claude's own scheme may be handed to the OS (a plugin can't launch files this way) */
export function externalUrlOk(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    return EXTERNAL_SCHEMES.includes(new URL(url).protocol)
  } catch {
    return false
  }
}
