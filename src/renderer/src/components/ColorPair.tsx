import { useEffect, useState } from 'react'
import type { ThemeColors } from '@shared/prefs'

const HEX = /^#[0-9a-f]{6}$/i

/** One colour: swatch picker plus an editable hex box */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="color-input" title={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <input
        className="hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          if (HEX.test(v)) onChange(v.toLowerCase())
        }}
        onBlur={() => setText(value)}
      />
      <span>{label}</span>
    </label>
  )
}

/** Primary + accent pickers; the rest of the palette is calculated from these */
export default function ColorPair({ value, onChange }: { value: ThemeColors; onChange(v: ThemeColors): void }) {
  return (
    <div className="color-pair">
      <ColorInput label="Primary" value={value.primary} onChange={(primary) => onChange({ ...value, primary })} />
      <ColorInput label="Accent" value={value.accent} onChange={(accent) => onChange({ ...value, accent })} />
    </div>
  )
}
