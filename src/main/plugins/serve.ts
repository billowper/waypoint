import { protocol } from 'electron'
import { promises as fs } from 'fs'
import { PLUGIN_CSP, PLUGIN_SCHEME } from '@shared/pluginApi'
import { BRIDGE_PATH, BRIDGE_SOURCE } from './bridgeModule'
import { contentType, resolveInside } from './files'
import { servedPluginDir } from './manager'

/**
 * wp-plugin://<id>/<path>: the pages of enabled plugins. Serves only files inside the plugin's own folder (checked
 * like Vault.abs), plus the built-in bridge module, and puts the content security policy on everything so a page
 * can't reach the network or Waypoint. The scheme is registered as privileged in icons.ts (one call for all schemes).
 */
export function servePlugins() {
  protocol.handle(PLUGIN_SCHEME, async (req) => {
    const headers: Record<string, string> = {
      'Content-Security-Policy': PLUGIN_CSP,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }
    const notFound = () => new Response('Not found', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } })
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers })
    try {
      const url = new URL(req.url)
      const dir = await servedPluginDir(url.hostname)
      if (!dir) return notFound()
      const path = decodeURIComponent(url.pathname)
      if (path === BRIDGE_PATH) return new Response(BRIDGE_SOURCE, { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } })
      const file = resolveInside(dir, path === '/' ? '/index.html' : path)
      if (!file) return notFound()
      const bytes = await fs.readFile(file)
      return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': contentType(file) } })
    } catch {
      return notFound() // a missing file, a folder, or a path that isn't valid
    }
  })
}
