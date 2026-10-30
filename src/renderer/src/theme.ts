import { useEffect, useState } from 'react'
import type { Prefs } from '@shared/prefs'

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

/** Put the theme on <html> so the CSS variables switch */
export function useApplyTheme(pref: Prefs['theme'] | undefined) {
  const theme = useResolvedTheme(pref)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return theme
}
