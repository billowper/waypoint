import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { withDefaults, type Prefs } from '@shared/prefs'

export interface AppConfig {
  vaultPath?: string
  recent: Record<string, string[]> // vaultPath -> recent relative paths
  bounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
  prefs?: Partial<Prefs>
  /** Set once the "still running in the tray" toast has been shown */
  trayHintShown?: boolean
  /** Epoch ms of the last nudge, so restarts don't nudge straight away */
  lastNudge?: number
  /** What the last nudge was about, so the next one says something different */
  lastNudgeKey?: string
}

export const prefs = (): Prefs => withDefaults(loadConfig().prefs)

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
