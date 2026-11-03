/** Personal app preferences (per PC, in userData config; not part of the vault) */
export interface Prefs {
  /** Closing the window keeps Waypoint running in the tray (needed for nudges) */
  closeToTray: boolean
  startWithWindows: boolean
  /** Electron accelerator for the global quick-capture window; '' turns it off */
  captureHotkey: string
  nudges: NudgePrefs
  theme: 'dark' | 'light' | 'system'
  /** The picked colour; everything else is calculated (see palette.ts) */
  colors: ThemeColors
  fonts: FontPrefs
  /** Zoom for the whole interface (1 = 100%) */
  uiScale: number
  /** Electron accelerator for the global search popup; '' turns it off */
  searchHotkey: string
  backup: BackupPrefs
  /** Show the optional Claude Code controls (project page, Settings) */
  claudeCode: boolean
  /** Where "Send to Claude" goes first: a terminal starts work straight away, the Claude app waits for Enter */
  claudeSendTo: 'terminal' | 'app'
}

export interface ThemeColors {
  /** Buttons, links, cursor, focus, highlights */
  accent: string
}

export interface FontPrefs {
  /** Interface font family */
  ui: string
  /** Note text; '' = same as the interface */
  editor: string
  /** Code, IDs, YAML */
  mono: string
  /** Note text size in px */
  size: number
}

export const DEFAULT_COLORS: ThemeColors = { accent: '#e6aa50' }
export const DEFAULT_FONTS: FontPrefs = { ui: 'Segoe UI Variable Text', editor: '', mono: 'Cascadia Code', size: 15.5 }

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
  colors: DEFAULT_COLORS,
  fonts: DEFAULT_FONTS,
  uiScale: 1,
  searchHotkey: 'Control+Alt+F',
  backup: { dir: '', daily: true, keep: 14, last: 0 },
  claudeCode: true,
  claudeSendTo: 'terminal'
}

/** Fill in anything missing (older config files, hand edits) */
export function withDefaults(p: Partial<Prefs> | undefined): Prefs {
  return {
    ...DEFAULT_PREFS,
    ...p,
    nudges: { ...DEFAULT_PREFS.nudges, ...p?.nudges },
    backup: { ...DEFAULT_PREFS.backup, ...p?.backup },
    // Older settings had primary + accent; the primary was the main colour
    colors: {
      accent: (p?.colors as { primary?: string } | undefined)?.primary ?? p?.colors?.accent ?? DEFAULT_COLORS.accent
    },
    fonts: { ...DEFAULT_FONTS, ...p?.fonts }
  }
}
