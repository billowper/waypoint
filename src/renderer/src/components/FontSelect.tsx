import { useEffect, useMemo, useRef, useState } from 'react'

let fontsCache: Promise<string[]> | null = null
const installed = () => (fontsCache ??= window.api.installedFonts())

interface Props {
  value: string
  onChange(font: string): void
  /** Offered first (e.g. sensible defaults or monospace fonts) */
  suggested: string[]
  /** When set, an extra first choice that clears the value (e.g. "Same as interface") */
  emptyLabel?: string
}

/** Dropdown of installed fonts, each shown in its own typeface, with a filter box */
export default function FontSelect({ value, onChange, suggested, emptyLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [fonts, setFonts] = useState<string[]>([])
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    installed().then(setFonts)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    const have = new Set(fonts.map((f) => f.toLowerCase()))
    const top = suggested.filter((f) => have.has(f.toLowerCase()) || !fonts.length)
    const rest = fonts.filter((f) => !top.some((t) => t.toLowerCase() === f.toLowerCase()))
    const all = [...top, ...rest]
    return q ? all.filter((f) => f.toLowerCase().includes(q)) : all
  }, [fonts, suggested, query])

  const pick = (f: string) => {
    onChange(f)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="font-select" ref={root}>
      <button className="font-current" style={{ fontFamily: value ? `'${value}'` : undefined }} onClick={() => setOpen(!open)}>
        {value || emptyLabel || 'Choose…'}
        <span className="chev-down">▾</span>
      </button>
      {open && (
        <div className="font-menu">
          <input
            autoFocus
            value={query}
            placeholder={fonts.length ? `Filter ${fonts.length} fonts…` : 'Loading fonts…'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              // Enter takes the first match, or a typed name that isn't listed
              else if (e.key === 'Enter') pick(choices[0] ?? query.trim())
            }}
          />
          <ul>
            {emptyLabel && !query && (
              <li>
                <button className={!value ? 'on' : ''} onClick={() => pick('')}>
                  {emptyLabel}
                </button>
              </li>
            )}
            {choices.map((f, i) => (
              <li key={f}>
                {i === suggested.length && !query && suggested.length > 0 && <hr />}
                <button className={f === value ? 'on' : ''} style={{ fontFamily: `'${f}'` }} onClick={() => pick(f)}>
                  {f}
                </button>
              </li>
            ))}
            {choices.length === 0 && query.trim() && (
              <li>
                <button onClick={() => pick(query.trim())}>Use “{query.trim()}”</button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
