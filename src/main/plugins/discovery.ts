import { promises as fs } from 'fs'
import { basename, join, resolve } from 'path'
import type { PluginManifest } from '@shared/pluginApi'
import { validateManifest } from './manifest'

/**
 * Finding plugins: every folder under <userData>/plugins/ and every dev folder from the config that holds a
 * plugin.json. No Electron here; the caller says where to look.
 */

export const MANIFEST_FILE = 'plugin.json'

export interface FoundPlugin {
  /** The plugin's id (the folder name when plugin.json is too broken to say) */
  id: string
  dir: string
  source: 'installed' | 'dev'
  /** Set when plugin.json is fine */
  manifest?: PluginManifest
  /** Why it can't be loaded */
  error?: string
  newer?: boolean
}

async function read(dir: string, source: FoundPlugin['source']): Promise<FoundPlugin> {
  const fallback = basename(dir)
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(join(dir, MANIFEST_FILE), 'utf8'))
  } catch (e: any) {
    const missing = e?.code === 'ENOENT'
    return { id: fallback, dir, source, error: missing ? `No ${MANIFEST_FILE} in this folder` : `${MANIFEST_FILE} isn't valid JSON: ${e?.message ?? e}` }
  }
  const result = validateManifest(raw)
  if (result.ok) return { id: result.manifest.id, dir, source, manifest: result.manifest }
  const id = raw && typeof (raw as any).id === 'string' && (raw as any).id.trim() ? (raw as any).id.trim() : fallback
  return { id, dir, source, error: result.error, newer: result.newer }
}

/**
 * All plugins found. A folder under plugins/ without a plugin.json is just a folder; a dev folder without one is
 * listed (so it can be removed). Two with the same id: the dev folder wins, then the first one found.
 */
export async function discoverPlugins(pluginsDir: string, devPaths: string[]): Promise<FoundPlugin[]> {
  const installed = (await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(pluginsDir, e.name))
  const found: FoundPlugin[] = []
  for (const dir of [...new Set(devPaths.map((d) => resolve(d)))]) found.push(await read(dir, 'dev'))
  for (const dir of installed) {
    if (!(await fs.stat(join(dir, MANIFEST_FILE)).catch(() => null))) continue
    found.push(await read(dir, 'installed'))
  }
  const seen = new Set<string>()
  return found.map((p) => {
    if (!p.manifest) return p
    if (!seen.has(p.id)) return seen.add(p.id), p
    return { ...p, manifest: undefined, error: `Another folder already provides the plugin "${p.id}"` }
  })
}
