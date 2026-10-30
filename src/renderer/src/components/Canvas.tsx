import { useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, convertToExcalidrawElements, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { baseName } from '@shared/names'
import { enqueue, registerEditor, useStore } from '../store'

const SAVE_DELAY = 800
/** Cards link back to notes/tasks with this scheme; clicks are handled here, never by a browser */
const LINK = 'waypoint://open/'

type Scene = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>

/** An Excalidraw board stored as a .excalidraw JSON file in the vault, saved as you draw */
export default function Canvas({ path, active }: { path: string; active: boolean }) {
  const { openFile, notes, tasks } = useStore()
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const latest = useRef<Scene | null>(null)
  const lastSaved = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    window.api
      .read(path)
      .then((text) => {
        if (!live) return
        const data = text.trim() ? JSON.parse(text) : {}
        lastSaved.current = text
        setInitial({
          elements: data.elements ?? [],
          appState: { ...(data.appState ?? {}), collaborators: new Map() },
          files: data.files ?? {},
          scrollToContent: true
        })
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [path])

  // Saving: debounced, queued with the other file writes, and flushed before file operations
  useEffect(() => {
    const save = async () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const scene = latest.current
      if (!scene) return
      const json = serializeAsJSON(scene[0], scene[1], scene[2], 'local')
      if (json === lastSaved.current) return
      lastSaved.current = json
      await enqueue(() => window.api.write(path, json))
    }
    const unregister = registerEditor({ flush: save, renamed: () => {}, removed: () => {} })
    return () => {
      unregister()
      void save()
    }
  }, [path])

  const onChange = (...scene: Scene) => {
    latest.current = scene
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const s = latest.current
      if (!s) return
      const json = serializeAsJSON(s[0], s[1], s[2], 'local')
      if (json === lastSaved.current) return
      lastSaved.current = json
      await enqueue(() => window.api.write(path, json))
    }, SAVE_DELAY)
  }

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    const taskByPath = new Map(tasks.map((t) => [t.path, t]))
    return notes
      .map((p) => {
        const t = taskByPath.get(p)
        return { path: p, title: t ? `${t.id} · ${t.title}` : baseName(p), detail: t ? t.status : p.slice(0, -baseName(p).length - 4) }
      })
      .filter((c) => !q || `${c.title} ${c.path}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [notes, tasks, query])

  /** Drop a card for a note/task in the middle of the view, linked back to it */
  const addCard = (c: { path: string; title: string; detail: string }) => {
    const ex = api.current
    if (!ex) return
    const s = ex.getAppState()
    const zoom = s.zoom.value
    const x = -s.scrollX + s.width / 2 / zoom - 120
    const y = -s.scrollY + s.height / 2 / zoom - 40
    const card = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x,
        y,
        width: 240,
        height: 80,
        // Excalidraw's own palette: its dark theme inverts the canvas, so these read well in both
        strokeColor: '#f08c00',
        backgroundColor: '#ffec99',
        fillStyle: 'solid',
        roundness: { type: 3 },
        link: LINK + encodeURIComponent(c.path),
        label: { text: c.title, fontSize: 18 }
      }
    ])
    ex.updateScene({ elements: [...ex.getSceneElements(), ...card] })
    ex.setToast({ message: 'Card added. Click its link icon (or Ctrl+click) to open the note.', duration: 3000 })
    setPicking(false)
    setQuery('')
  }

  if (error) return <div className="board-page"><p className="empty">Couldn't open this board: {error}</p></div>
  if (!initial) return null

  return (
    <div className="canvas-page" hidden={!active}>
      <div className="canvas-toolbar">
        <span className="canvas-name">{baseName(path).replace(/\.excalidraw$/i, '')}</span>
        <div className="canvas-add">
          <button className="btn small" onClick={() => setPicking((p) => !p)}>
            Add note or task card
          </button>
          {picking && (
            <div className="canvas-picker">
              <input
                autoFocus
                value={query}
                placeholder="Find a note or task…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPicking(false)
                  else if (e.key === 'Enter' && candidates[0]) addCard(candidates[0])
                }}
              />
              <ul>
                {candidates.map((c) => (
                  <li key={c.path}>
                    <button onClick={() => addCard(c)}>
                      <span className="picker-label">{c.title}</span>
                      <span className="picker-detail">{c.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="canvas-host">
        <Excalidraw
          theme="dark"
          initialData={initial}
          excalidrawAPI={(a) => (api.current = a)}
          onChange={onChange}
          onLinkOpen={(element, event) => {
            const link = element.link ?? ''
            if (!link.startsWith(LINK)) return // ordinary web links: Excalidraw opens them (in the browser)
            event.preventDefault()
            const target = decodeURIComponent(link.slice(LINK.length))
            if (useStore.getState().notes.includes(target)) {
              openFile(target, { newTab: (event.detail.nativeEvent as MouseEvent)?.ctrlKey })
            } else api.current?.setToast({ message: `"${baseName(target)}" no longer exists.`, duration: 3000 })
          }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>
  )
}
