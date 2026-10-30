import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { baseName } from '@shared/names'
import { useStore } from '../store'
import Icon from './Icon'

interface Item {
  key: string
  label: string
  detail: string
  run(newTab: boolean): void
}

const MAX_ITEMS = 60

/** Subsequence match: consecutive letters and word starts score higher; null if no match. */
export function fuzzy(q: string, s: string): number | null {
  const t = s.toLowerCase()
  let qi = 0
  let score = 0
  let last = -2
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue
    score += last === i - 1 ? 3 : i === 0 || /[\s/_.-]/.test(t[i - 1]) ? 2 : 1
    last = i
    qi++
  }
  return qi === q.length ? score : null
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** Ctrl+P note switcher and the folder chooser for "Move to…" */
export default function Picker() {
  const { picker, closePicker, notes, folders, recent, openFile, move, newNote, selectedDir } = useStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const items = useMemo((): Item[] => {
    if (!picker) return []
    const q = query.trim().toLowerCase()

    if (picker.kind === 'move') {
      const src = picker.path
      const targets = ['', ...folders].filter(
        (f) => f !== dirOf(src) && f !== src && !f.startsWith(src + '/')
      )
      return targets
        .map((f) => ({ f, s: q ? fuzzy(q, f || 'vault root') : 0 }))
        .filter((x) => x.s !== null)
        .sort((a, b) => b.s! - a.s! || a.f.localeCompare(b.f))
        .slice(0, MAX_ITEMS)
        .map(({ f }) => ({
          key: f || '/',
          label: f ? baseName(f) : 'Vault root',
          detail: dirOf(f),
          run: () => move(src, f)
        }))
    }

    const open = (p: string): Item => ({
      key: p,
      label: baseName(p),
      detail: dirOf(p),
      run: (newTab) => openFile(p, { newTab })
    })
    if (!q) {
      const recents = recent.filter((r) => notes.includes(r))
      const rest = notes.filter((n) => !recents.includes(n))
      return [...recents, ...rest].slice(0, MAX_ITEMS).map(open)
    }
    const ranked = notes
      .map((p) => {
        const byName = fuzzy(q, baseName(p))
        const byPath = fuzzy(q, p)
        const s = Math.max(byName === null ? -1 : byName * 2, byPath ?? -1)
        return { p, s }
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
      .slice(0, MAX_ITEMS)
      .map(({ p }) => open(p))
    const name = query.trim()
    if (!notes.some((p) => baseName(p).toLowerCase() === q)) {
      ranked.push({
        key: '+create',
        label: `Create “${name}”`,
        detail: selectedDir || 'vault root',
        run: () => void newNote(selectedDir, name)
      })
    }
    return ranked
  }, [picker, query, notes, folders, recent, openFile, move, newNote, selectedDir])

  useEffect(() => setIndex(0), [query, picker])
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])
  useEffect(() => {
    if (!picker) setQuery('')
  }, [picker])

  if (!picker) return null

  const pick = (item: Item | undefined, newTab: boolean) => {
    if (!item) return
    closePicker()
    item.run(newTab)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1))
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter') pick(items[index], e.ctrlKey)
    else if (e.key === 'Escape') closePicker()
    else return
    e.preventDefault()
  }

  return (
    <div className="modal-backdrop" onMouseDown={closePicker}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={picker.kind === 'move' ? `Move “${baseName(picker.path)}” to…` : 'Find or create a note…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <ul ref={list}>
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                className={i === index ? 'selected' : ''}
                onMouseMove={() => setIndex(i)}
                onClick={(e) => pick(item, e.ctrlKey)}
              >
                <Icon path={item.key} />
                <span className="picker-label">{item.label}</span>
                <span className="picker-detail">{item.detail}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="picker-empty">No matches</li>}
        </ul>
        {picker.kind === 'notes' && (
          <div className="picker-hint">
            <span>
              <kbd>↑↓</kbd> choose
            </span>
            <span>
              <kbd>Enter</kbd> open
            </span>
            <span>
              <kbd>Ctrl Enter</kbd> new tab
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
