import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { baseName } from '@shared/names'
import { useStore } from '../store'
import { IconGlyph } from './Icon'

/** First visible character (an emoji can be several code points: skin tones, flags, ZWJ sequences) */
function firstGrapheme(text: string): string {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of seg.segment(text.trim())) return segment
  return ''
}

/**
 * Choose an icon: Windows' emoji panel opens straight away and types into the box here;
 * or use a picture from a file or a link, or remove the icon.
 */
export default function IconPicker() {
  const { iconPicker, closeIconPicker, icons, setIcon } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [askUrl, setAskUrl] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const path = iconPicker?.path ?? ''
  const current = icons[path]

  // Keep it on screen
  useLayoutEffect(() => {
    if (!iconPicker || !box.current) return
    const { width, height } = box.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(iconPicker.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(iconPicker.y, window.innerHeight - height - 8))
    })
  }, [iconPicker])

  // Open Windows' emoji panel as soon as the picker shows; it types into the focused box
  const openEmojiPanel = () => {
    input.current?.focus()
    setTimeout(() => window.api.showEmojiPanel(), 50)
  }
  useEffect(() => {
    if (!iconPicker) return
    setAskUrl(false)
    setUrl('')
    openEmojiPanel()
  }, [iconPicker])

  if (!iconPicker) return null

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      closeIconPicker()
    } catch (e) {
      alert(`Couldn't set the icon.\n\n${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="menu-backdrop" onMouseDown={closeIconPicker}>
      <div className="icon-picker" ref={box} style={pos} onMouseDown={(e) => e.stopPropagation()}>
        <div className="icon-picker-head">
          <span className="icon-preview">{current ? <IconGlyph icon={current} /> : <span className="icon-none">∅</span>}</span>
          <span className="icon-for" title={path}>
            Icon for <b>{baseName(path) || path}</b>
          </span>
        </div>
        <input
          ref={input}
          className="emoji-input"
          placeholder="Pick from the emoji panel, or type one"
          onInput={(e) => {
            const g = firstGrapheme((e.target as HTMLInputElement).value)
            if (g) run(() => setIcon(path, g))
          }}
          onKeyDown={(e) => e.key === 'Escape' && closeIconPicker()}
        />
        <div className="icon-actions">
          <button className="btn small" onClick={openEmojiPanel}>
            Emoji panel <kbd>Win .</kbd>
          </button>
          <button className="btn small" disabled={busy} onClick={() => run(async () => window.api.iconFromFile(path))}>
            Image from file…
          </button>
          <button className="btn small" disabled={busy} onClick={() => setAskUrl(true)}>
            Image from URL…
          </button>
          {current && (
            <button className="btn small danger" disabled={busy} onClick={() => run(() => setIcon(path, null))}>
              Remove
            </button>
          )}
        </div>
        {askUrl && (
          <form
            className="icon-url"
            onSubmit={(e) => {
              e.preventDefault()
              if (url.trim()) run(() => window.api.iconFromUrl(path, url.trim()))
            }}
          >
            <input autoFocus value={url} placeholder="https://…/image.png" onChange={(e) => setUrl(e.target.value)} />
            <button className="btn small primary" disabled={busy || !url.trim()}>
              {busy ? 'Getting it…' : 'Use'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
