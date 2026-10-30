import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { canRename, useStore, type MenuState } from '../store'

export default function ContextMenu({ x, y, path, type }: MenuState) {
  const { closeMenu, rename, newNote, newFolder, openFile, duplicate, remove, openPicker } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu on screen near the window edges
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeMenu)
    }
  }, [closeMenu])

  const run = (fn: () => unknown) => () => {
    closeMenu()
    fn()
  }
  const isMd = type === 'file' && path.toLowerCase().endsWith('.md')
  const editable = canRename(path)

  return (
    <div className="menu-backdrop" onMouseDown={closeMenu} onContextMenu={(e) => e.preventDefault()}>
      <div className="menu" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}>
        {isMd && (
          <>
            <button onClick={run(() => openFile(path))}>Open</button>
            <button onClick={run(() => openFile(path, { newTab: true }))}>
              Open in new tab <kbd>Ctrl click</kbd>
            </button>
            <hr />
          </>
        )}
        {type === 'dir' && (
          <>
            <button onClick={run(() => newNote(path))}>New note here</button>
            <button onClick={run(() => newFolder(path))}>New folder here</button>
            <hr />
          </>
        )}
        {editable && (
          <>
            <button onClick={run(() => rename(path))}>
              Rename <kbd>F2</kbd>
            </button>
            <button onClick={run(() => openPicker({ kind: 'move', path }))}>Move to…</button>
            <button onClick={run(() => duplicate(path))}>Duplicate</button>
          </>
        )}
        <button onClick={run(() => window.api.reveal(path))}>Show in Explorer</button>
        {editable && (
          <>
            <hr />
            <button className="danger" onClick={run(() => remove(path))}>
              Delete <kbd>Del</kbd>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
