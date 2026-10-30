import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SearchHit } from '@shared/types'
import { baseName } from '@shared/names'
import { useStore } from '../store'
import { noteMenu, showMenu } from '../menus'
import Icon, { noteDefault } from './Icon'

const DEBOUNCE = 150
const CONTEXT = 40 // characters shown before the first match on long lines

let lastQuery = '' // kept while switching between Files and Search

/** Line text with matched ranges highlighted, trimmed to start near the first match */
function highlight(text: string, ranges: [number, number][]): ReactNode[] {
  const start = ranges.length && ranges[0][0] > CONTEXT ? ranges[0][0] - CONTEXT : 0
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

export default function SearchPanel() {
  const openFile = useStore((s) => s.openFile)
  const [query, setQuery] = useState(lastQuery)
  const [hits, setHits] = useState<SearchHit[]>([])
  // Keyboard highlight over every result row (note headers and their lines); -1 = none yet
  const [index, setIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  // Every clickable row in display order, so arrow keys can walk them
  const rows = useMemo(
    () => hits.flatMap((h) => [{ path: h.path, line: h.lines[0]?.line }, ...h.lines.map((l) => ({ path: h.path, line: l.line }))]),
    [hits]
  )
  let row = 0 // running row number while rendering

  // A new query starts from the box; a refresh of the same query (a note saved) keeps your place
  useEffect(() => setIndex(-1), [query])
  useEffect(() => setIndex((i) => Math.min(i, rows.length - 1)), [rows])
  useEffect(() => {
    list.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const open = (i: number, newTab: boolean) => {
    const r = rows[i]
    if (r) openFile(r.path, { newTab, reveal: r.line ? { line: r.line, query } : undefined })
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, rows.length - 1))
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, -1))
    else if (e.key === 'Enter') open(Math.max(index, 0), e.ctrlKey)
    else if (e.key === 'Escape') index >= 0 ? setIndex(-1) : setQuery('')
    else return
    e.preventDefault()
  }

  useEffect(() => {
    lastQuery = query
    const q = query.trim()
    if (!q) return setHits([])
    let live = true
    const run = () => window.api.search(q).then((h) => live && setHits(h))
    const timer = setTimeout(run, DEBOUNCE)
    const off = window.api.onChanged(run) // results follow edits
    return () => {
      live = false
      clearTimeout(timer)
      off()
    }
  }, [query])

  useEffect(() => input.current?.select(), [])

  const total = hits.reduce((n, h) => n + h.lines.length, 0)

  return (
    <div className="search-panel">
      <input
        ref={input}
        className="search-input"
        autoFocus
        value={query}
        placeholder="Search all notes…"
        title="↑↓ choose a result · Enter open · Ctrl+Enter new tab · Esc clear"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      {query.trim() && (
        <p className="search-summary">
          {hits.length ? `${hits.length} note${hits.length === 1 ? '' : 's'}` : 'No matches'}
          {total > hits.length ? ` · ${total}+ lines` : ''}
        </p>
      )}
      <ul className="search-results" ref={list}>
        {hits.map((h) => {
          const noteRow = row++
          return (
            <li key={h.path}>
              <button
                className={`search-note ${index === noteRow ? 'selected' : ''}`}
                onContextMenu={(e) => showMenu(e, noteMenu(h.path))}
                data-row={noteRow}
                title={h.path}
                onClick={(e) => open(noteRow, e.ctrlKey)}
              >
                <Icon path={h.path} fallback={noteDefault(h.path, /^projects\/[^/]+\/tasks\//.test(h.path))} />
                {baseName(h.path)}
                <span className="search-dir">{h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : ''}</span>
              </button>
              {h.lines.map((l) => {
                const lineRow = row++
                return (
                  <button
                    key={l.line}
                    className={`search-line ${index === lineRow ? 'selected' : ''}`}
                    data-row={lineRow}
                    onClick={(e) => open(lineRow, e.ctrlKey)}
                  >
                    {highlight(l.text, l.ranges)}
                  </button>
                )
              })}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
