import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Prefs } from '@shared/prefs'
import type { SearchHit, TreeNode } from '@shared/types'
import { baseName } from '@shared/names'
import { useApplyTheme } from '../theme'
import { fuzzy } from './Picker'

const DEBOUNCE = 120
const MAX_NAMES = 6

interface Row {
  key: string
  path: string
  line?: number
  title: ReactNode
  detail: string
  kind: 'note' | 'line'
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function flattenNotes(nodes: TreeNode[], out: string[] = []) {
  for (const n of nodes) {
    if (n.type === 'dir') flattenNotes(n.children ?? [], out)
    else if (n.name.toLowerCase().endsWith('.md')) out.push(n.path)
  }
  return out
}

function marked(text: string, ranges: [number, number][]): ReactNode[] {
  const start = ranges.length && ranges[0][0] > 40 ? ranges[0][0] - 40 : 0
  const out: ReactNode[] = start ? ['…'] : []
  let at = start
  ranges.forEach(([s, e], i) => {
    if (e <= at) return
    s = Math.max(s, at)
    out.push(text.slice(at, s), <mark key={i}>{text.slice(s, e)}</mark>)
    at = e
  })
  out.push(text.slice(at))
  return out
}

/**
 * The global search popup (Ctrl+Alt+F by default): note names first, then matching lines from
 * inside notes. Arrow keys choose, Enter opens in the main window, Esc closes.
 */
export default function QuickSearch() {
  const [prefs, setPrefs] = useState<Prefs>()
  useApplyTheme(prefs?.theme, prefs?.colors, prefs?.fonts)
  const [notes, setNotes] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const box = useRef<HTMLDivElement>(null)

  // The window is sized to the box, so it grows and shrinks with the results
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => window.api.popupHeight(el.scrollHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    window.api.prefs().then(setPrefs)
    window.api.tree().then((t) => setNotes(flattenNotes(t)))
    window.api.recent().then((r) => setRecent(r))
  }, [])
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    const q = query.trim()
    if (!q) return setHits([])
    let live = true
    const t = setTimeout(() => window.api.search(q).then((h) => live && setHits(h)), DEBOUNCE)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const rows = useMemo((): Row[] => {
    const q = query.trim().toLowerCase()
    const note = (p: string): Row => ({ key: `n:${p}`, path: p, title: baseName(p), detail: dirOf(p), kind: 'note' })
    if (!q) return recent.filter((r) => notes.includes(r)).slice(0, 8).map(note)
    const names = notes
      .map((p) => ({ p, s: fuzzy(q, baseName(p)) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s! || a.p.length - b.p.length)
      .slice(0, MAX_NAMES)
      .map((x) => note(x.p))
    const lines = hits.flatMap((h) =>
      h.lines.map(
        (l): Row => ({
          key: `l:${h.path}:${l.line}`,
          path: h.path,
          line: l.line,
          title: marked(l.text.trim() ? l.text : '…', l.ranges),
          detail: baseName(h.path),
          kind: 'line'
        })
      )
    )
    return [...names, ...lines]
  }, [query, notes, hits, recent])

  useEffect(() => setIndex(0), [query])
  useEffect(() => setIndex((i) => Math.min(i, Math.max(rows.length - 1, 0))), [rows])
  useEffect(() => {
    list.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const open = (r: Row | undefined, newTab: boolean) => {
    if (!r) return
    window.api.searchOpen(r.path, r.line ? { line: r.line, query } : undefined, newTab)
  }

  const nameCount = rows.filter((r) => r.kind === 'note').length

  return (
    <div className="quick-search" ref={box}>
      <input
        autoFocus
        value={query}
        placeholder="Search notes…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, rows.length - 1))
          else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
          else if (e.key === 'Enter') open(rows[index], e.ctrlKey)
          else if (e.key === 'Escape') window.api.searchClose()
          else return
          e.preventDefault()
        }}
      />
      {rows.length > 0 && (
        <ul ref={list}>
          {rows.map((r, i) => (
            <li key={r.key}>
              {i === 0 && <div className="qs-group">{query.trim() ? (nameCount ? 'Notes' : 'In notes') : 'Recent'}</div>}
              {i === nameCount && i > 0 && query.trim() && <div className="qs-group">In notes</div>}
              <button
                data-row={i}
                className={`qs-row ${r.kind} ${i === index ? 'selected' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={(e) => open(r, e.ctrlKey)}
              >
                <span className="qs-title">{r.title}</span>
                <span className="qs-detail">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && rows.length === 0 && <p className="qs-empty">No matches</p>}
      <div className="qs-hint">
        <span>
          <kbd>↑↓</kbd> choose
        </span>
        <span>
          <kbd>Enter</kbd> open
        </span>
        <span>
          <kbd>Ctrl Enter</kbd> new tab
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  )
}
