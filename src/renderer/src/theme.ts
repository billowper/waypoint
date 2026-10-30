import { useEffect, useState } from 'react'
import { DEFAULT_COLORS, DEFAULT_FONTS, type FontPrefs, type Prefs, type ThemeColors } from '@shared/prefs'
import { palette } from '@shared/palette'

const dark = () => window.matchMedia('(prefers-color-scheme: dark)')

/** 'dark' | 'light', following Windows when the preference is 'system' */
export function useResolvedTheme(pref: Prefs['theme'] | undefined): 'dark' | 'light' {
  const [system, setSystem] = useState(() => (dark().matches ? 'dark' : 'light'))
  useEffect(() => {
    const mq = dark()
    const on = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return pref === 'light' || pref === 'dark' ? pref : (system as 'dark' | 'light')
}

const family = (name: string, fallback: string) => (name.trim() ? `'${name.trim().replace(/'/g, '')}', ${fallback}` : fallback)

/**
 * Put the theme on <html>: light/dark, the palette calculated from the accent colour, and fonts.
 * `colors` may be a project's own override.
 */
export function useApplyTheme(pref: Prefs['theme'] | undefined, colors?: ThemeColors, fonts?: FontPrefs) {
  const theme = useResolvedTheme(pref)
  const c = colors ?? DEFAULT_COLORS
  const f = fonts ?? DEFAULT_FONTS
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    const vars: Record<string, string> = {
      ...palette(theme, c.accent),
      '--sans': family(f.ui, "'Segoe UI', system-ui, sans-serif"),
      '--display': family(f.ui === DEFAULT_FONTS.ui ? 'Segoe UI Variable Display' : f.ui, "'Segoe UI', system-ui, sans-serif"),
      '--editor-font': family(f.editor || f.ui, "'Segoe UI', system-ui, sans-serif"),
      '--editor-size': `${f.size}px`,
      '--mono': family(f.mono, "'Cascadia Mono', Consolas, monospace")
    }
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    // The Windows caption buttons are drawn by Windows; tell it our colours
    window.api.setChrome?.(vars['--bg'], vars['--text'])
  }, [theme, c.accent, f.ui, f.editor, f.mono, f.size])
  return theme
}
