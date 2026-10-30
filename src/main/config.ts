import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface AppConfig {
  vaultPath?: string
  recent: Record<string, string[]> // vaultPath -> recent relative paths
  bounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
}

const file = () => join(app.getPath('userData'), 'config.json')

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  try {
    cache = { recent: {}, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    cache = { recent: {} }
  }
  return cache!
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  cache = { ...loadConfig(), ...patch }
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(cache, null, 2))
  return cache
}
