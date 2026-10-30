import { useState } from 'react'

interface Props {
  title: string
  placeholder?: string
  initial?: string
  action?: string
  resolve: (v: string | null) => void
}

export default function Prompt({ title, placeholder, initial = '', action = 'OK', resolve }: Props) {
  const [value, setValue] = useState(initial)
  return (
    <div className="modal-backdrop" onMouseDown={() => resolve(null)}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          resolve(value.trim() || null)
        }}
      >
        <label>{title}</label>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && resolve(null)}
        />
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
