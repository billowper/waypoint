import { useEffect, useRef, useState } from 'react'
import { PLUGIN_SCHEME, checkMenuItems, type FromPageMessage, type ToPageMessage } from '@shared/pluginApi'
import { useStore, type MenuItem } from '../store'
import { pluginTheme } from '../theme'

/**
 * The parent end of the plugin wire (docs/plugins.md): an <iframe> loaded from wp-plugin://<id>/<page>, sandboxed,
 * with no access to Waypoint except through postMessage. Used by PluginView (a tab: kind "view") and by the panels
 * on Home and project pages (kind "panel"). It forwards the page's calls to the plugin (window.api.pluginCall),
 * the plugin's events to the page, sends the state and Waypoint's theme (on load, when the page asks, and when the
 * theme changes), opens the menus the page asks for, and for a view keeps the page's setState with the tab; for a
 * panel it sizes the frame to the height the page reports. Every message is checked to come from this frame and
 * from the plugin's origin.
 */

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads'
/** The page's setState is kept with the tab after it has been quiet this long */
const STATE_DELAY = 250
/** A panel never grows past this, whatever its page reports */
const MAX_PANEL_HEIGHT = 20000

/** wp-plugin://<id>/<page>: each path segment encoded, a #hash or ?query kept as written */
export function pageUrl(plugin: string, page: string): string {
  const [, path, rest] = /^([^#?]*)(.*)$/.exec(page) ?? ['', page, '']
  return `${PLUGIN_SCHEME}://${plugin}/${path.split('/').filter((s) => s && s !== '.').map(encodeURIComponent).join('/')}${rest}`
}

interface Props {
  plugin: string
  /** The view's or panel's id */
  view: string
  /** The page, relative to the plugin folder (from plugin.json) */
  page: string
  kind: 'view' | 'panel'
  state: unknown
  title: string
  /** A view: the page called setState (already debounced) */
  onState?: (state: unknown) => void
}

export default function PluginFrame(p: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const stateRef = useRef(p.state)
  const loadedFrame = useRef(false)
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [height, setHeight] = useState(0)
  const origin = `${PLUGIN_SCHEME}://${p.plugin}`
  const src = pageUrl(p.plugin, p.page)
  const panel = p.kind === 'panel'

  // A panel's state comes from the page it's on; a view's is its own, once the page has changed it
  if (panel) stateRef.current = p.state

  /** To the page; only the plugin's own origin may ever receive it */
  const post = (message: ToPageMessage) => frame.current?.contentWindow?.postMessage({ wp: 1, ...message }, origin)
  const sendInit = () => post({ type: 'init', kind: p.kind, view: p.view, state: stateRef.current ?? null, theme: pluginTheme() })

  // A new frame is a page that hasn't loaded yet
  useEffect(() => {
    loadedFrame.current = false
  }, [src])

  useEffect(() => {
    const flushState = () => {
      if (!stateTimer.current) return
      clearTimeout(stateTimer.current)
      stateTimer.current = null
      p.onState?.(stateRef.current)
    }

    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win || e.origin !== origin) return
      const m = e.data as (FromPageMessage & { wp?: number }) | null
      if (!m || typeof m !== 'object' || m.wp !== 1) return
      const store = useStore.getState()
      const reply = (message: ToPageMessage) => win.postMessage({ wp: 1, ...message }, origin)

      if (m.type === 'hello') sendInit()
      else if (m.type === 'call') {
        if (typeof m.id !== 'number' || typeof m.method !== 'string') return
        window.api.pluginCall(p.plugin, m.method, m.params).then(
          (r) => reply(r.ok ? { type: 'result', id: m.id, ok: true, value: r.value } : { type: 'result', id: m.id, ok: false, error: r.error, status: r.status }),
          (err) => reply({ type: 'result', id: m.id, ok: false, error: (err as Error).message })
        )
      } else if (m.type === 'setState') {
        if (panel) return // a panel's state is the page it's on
        stateRef.current = m.state
        if (stateTimer.current) clearTimeout(stateTimer.current)
        stateTimer.current = setTimeout(flushState, STATE_DELAY)
      } else if (m.type === 'size') {
        if (panel && typeof m.height === 'number' && Number.isFinite(m.height)) setHeight(Math.min(MAX_PANEL_HEIGHT, Math.max(0, Math.round(m.height))))
      } else if (m.type === 'menu') {
        if (typeof m.id !== 'number') return
        const id = m.id
        const checked = checkMenuItems(m.items)
        if (!checked.ok || !Number.isFinite(m.x) || !Number.isFinite(m.y)) {
          console.warn(`[plugin ${p.plugin}] waypoint.menu: ${checked.ok ? 'x and y must be numbers' : checked.error}`)
          return reply({ type: 'menu-result', id, choice: null })
        }
        const box = frame.current!.getBoundingClientRect() // the page's coordinates are inside the frame
        let answered = false
        const finish = (choice: string | null) => {
          if (answered) return
          answered = true
          reply({ type: 'menu-result', id, choice })
        }
        const items = checked.items.map(
          (it): MenuItem =>
            it === 'separator'
              ? 'separator'
              : {
                  label: it.label,
                  ...(it.danger ? { danger: true } : {}),
                  ...(it.disabled ? { disabled: true } : {}),
                  ...(it.checked === undefined ? {} : { checked: it.checked }),
                  run: () => finish(it.id)
                }
        )
        // onClose also fires when an item was chosen (before its run), so "dismissed" waits a tick for the choice
        store.openMenu({ x: box.left + m.x, y: box.top + m.y, items, onClose: () => setTimeout(() => finish(null), 0) })
      } else if (m.type === 'open') {
        if (m.what === 'view' && typeof m.view === 'string') store.openPlugin(p.plugin, m.view, m.state)
        else if (m.what === 'project' && typeof m.slug === 'string' && store.projects.some((x) => x.slug === m.slug)) store.openProject(m.slug, { newTab: true })
        else if (m.what === 'task' && typeof m.id === 'string') void openTask(m.id)
        else if (m.what === 'external' && typeof m.url === 'string') window.api.pluginOpenExternal(m.url).catch(() => undefined)
      }
    }

    /** The task note for an id: from the list in memory, else after a refresh (it may be new) */
    const openTask = async (id: string) => {
      const find = () => useStore.getState().tasks.find((t) => t.id.toLowerCase() === id.toLowerCase())
      if (!find()) await useStore.getState().refresh()
      const task = find()
      if (task) await useStore.getState().openFile(task.path, { newTab: true })
    }

    window.addEventListener('message', onMessage)
    // Events the plugin's main module sends (host.emit) arrive from main for every window
    const offEvents = window.api.onPluginEvent((plugin, event, data) => {
      if (plugin === p.plugin) post({ type: 'event', event, data })
    })
    // The theme changes by editing <html> (data-theme and style), including when a project's colours apply
    let themeTimer: ReturnType<typeof setTimeout> | null = null
    const watch = new MutationObserver(() => {
      if (themeTimer) clearTimeout(themeTimer)
      themeTimer = setTimeout(() => loadedFrame.current && post({ type: 'theme', theme: pluginTheme() }), 50)
    })
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] })
    return () => {
      window.removeEventListener('message', onMessage)
      offEvents()
      watch.disconnect()
      if (themeTimer) clearTimeout(themeTimer)
      flushState() // a state still waiting is kept, not lost with the tab
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.plugin, p.view, origin, panel])

  return (
    <iframe
      ref={frame}
      key={src}
      className={panel ? 'plugin-panel-frame' : 'plugin-frame'}
      style={panel ? { height } : undefined}
      src={src}
      sandbox={SANDBOX}
      title={p.title}
      scrolling={panel ? 'no' : undefined}
      onLoad={() => {
        loadedFrame.current = true
        sendInit()
      }}
    />
  )
}
