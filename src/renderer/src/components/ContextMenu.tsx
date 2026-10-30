import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, type MenuState } from '../store'

/** Renders whichever right-click menu is open (items come from menus.ts) */
export default function ContextMenu({ x, y, items }: MenuState) {
  const closeMenu = useStore((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu on screen near the window edges
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 8))
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

  return (
    <div className="menu-backdrop" onMouseDown={closeMenu} onContextMenu={(e) => (e.preventDefault(), closeMenu())}>
      <div className="menu" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}>
        {items.map((it, i) =>
          it === 'separator' ? (
            <hr key={i} />
          ) : (
            <button
              key={i}
              className={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              onClick={() => {
                useStore.setState({ lastMenuPos: { x: pos.left, y: pos.top } })
                closeMenu()
                it.run()
              }}
            >
              {it.label}
              {it.kbd && <kbd>{it.kbd}</kbd>}
            </button>
          )
        )}
      </div>
    </div>
  )
}
