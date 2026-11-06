import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/** A suggestion under the box: picking it answers with `value` */
export interface Suggestion {
  label: string
  detail?: string
  value: string
}

interface Props {
  title: string
  placeholder?: string
  initial?: string
  action?: string
  /** An empty answer counts (as ""), rather than as Cancel */
  allowEmpty?: boolean
  /** Suggestions for what's typed; Enter picks the highlighted one */
  suggest?: (text: string) => Suggestion[]
  resolve: (v: string | null) => void
}

export default function Prompt({ title, placeholder, initial = '', action = 'OK', allowEmpty = false, suggest, resolve }: Props) {
  const [value, setValue] = useState(initial)
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const suggestions = useMemo(() => suggest?.(value) ?? [], [suggest, value])
  useEffect(() => setIndex(0), [value])
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') resolve(null)
    else if (e.key === 'ArrowDown' && suggestions.length) setIndex((i) => Math.min(i + 1, suggestions.length - 1))
    else if (e.key === 'ArrowUp' && suggestions.length) setIndex((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter' && suggestions[index]) resolve(suggestions[index].value)
    else return
    e.preventDefault()
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => resolve(null)}>
      <form
        className={`modal ${suggest ? 'with-suggestions' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          resolve(allowEmpty ? value.trim() : value.trim() || null)
        }}
      >
        <label>{title}</label>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />
        {suggestions.length > 0 && (
          <ul className="prompt-suggestions" ref={list}>
            {suggestions.map((s, i) => (
              <li key={`${s.value}\n${s.label}`}>
                <button
                  type="button"
                  className={i === index ? 'selected' : ''}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => resolve(s.value)}
                >
                  <span className="picker-label">{s.label}</span>
                  {s.detail && <span className="picker-detail">{s.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {action}
          </button>
        </div>
      </form>
    </div>
  )
}
