import { useEffect, useState } from 'react'

const HEX = /^#[0-9a-f]{6}$/i

/** Accent colour: swatch picker plus an editable hex box */
export default function AccentPicker({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="color-input" title="Accent colour">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Accent colour" />
      <input
        className="hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value
          if (HEX.test(v)) onChange(v.toLowerCase())
        }}
        onBlur={() => setText(value)}
      />
    </label>
  )
}
