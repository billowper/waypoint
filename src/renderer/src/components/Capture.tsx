import { useState } from 'react'

/** The quick-capture window (global hotkey, jump list, tray): one box that appends to inbox.md */
export default function Capture() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await window.api.captureAdd(text)
    } catch (e) {
      setBusy(false)
      alert(`Couldn't add to the inbox.\n\n${(e as Error).message}`)
    }
  }

  return (
    <div className="capture">
      <div className="capture-head">
        <span className="brand-mark small">◆</span> Quick capture <span className="capture-to">→ inbox</span>
      </div>
      <textarea
        autoFocus
        value={text}
        placeholder="What's on your mind?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            window.api.captureClose()
          }
        }}
      />
      <div className="capture-hint">
        <span>
          <kbd>Enter</kbd> add
        </span>
        <span>
          <kbd>Shift Enter</kbd> new line
        </span>
        <span>
          <kbd>Esc</kbd> cancel
        </span>
      </div>
    </div>
  )
}
