/** Personal app preferences (per PC, in userData config; not part of the vault) */
export interface Prefs {
  /** Closing the window keeps Waypoint running in the tray (needed for nudges) */
  closeToTray: boolean
  startWithWindows: boolean
  /** Electron accelerator for the global quick-capture window; '' turns it off */
  captureHotkey: string
  nudges: NudgePrefs
  theme: 'dark' | 'light' | 'system'
  backup: BackupPrefs
}

export interface BackupPrefs {
  /** Folder outside the vault for zip snapshots; '' = not set up */
  dir: string
  daily: boolean
  /** How many snapshots to keep */
  keep: number
  /** Epoch ms of the last backup */
  last: number
}

export interface NudgePrefs {
  enabled: boolean
  /** Minimum gap between nudges */
  everyMinutes: number
  /** Nudges only between these hours (24h clock, local time) */
  startHour: number
  endHour: number
  weekdaysOnly: boolean
  /** Epoch ms; no nudges before this */
  snoozedUntil: number
  /** Task paths / project slugs Bill said "don't nag about this" for */
  muted: string[]
  /** Projects with no changes for this many days count as stale */
  staleDays: number
}

export const DEFAULT_PREFS: Prefs = {
  closeToTray: true,
  startWithWindows: false,
  captureHotkey: 'Control+Alt+W',
  nudges: {
    enabled: true,
    everyMinutes: 120,
    startHour: 9,
    endHour: 18,
    weekdaysOnly: true,
    snoozedUntil: 0,
    muted: [],
    staleDays: 14
  },
  theme: 'dark',
  backup: { dir: '', daily: true, keep: 14, last: 0 }
}

/** Fill in anything missing (older config files, hand edits) */
export function withDefaults(p: Partial<Prefs> | undefined): Prefs {
  return {
    ...DEFAULT_PREFS,
    ...p,
    nudges: { ...DEFAULT_PREFS.nudges, ...p?.nudges },
    backup: { ...DEFAULT_PREFS.backup, ...p?.backup }
  }
}
