/**
 * The page side of the plugin API, served to every plugin page at wp-plugin://<id>/_waypoint/bridge.mjs
 * (`import { waypoint } from '/_waypoint/bridge.mjs'`). It is plain JavaScript in a string because it is sent to the
 * page as it is. Wire format: docs/plugins.md ("The bridge"); the other end is components/PluginView.tsx.
 * No backticks or ${} in here, so the source stays a simple template literal.
 */
export const BRIDGE_PATH = '/_waypoint/bridge.mjs'

export const BRIDGE_SOURCE = `// Waypoint's bridge for plugin pages. See docs/plugins.md.
const host = window.parent
const standalone = host === window
const post = (message) => {
  if (!standalone) host.postMessage({ wp: 1, ...message }, '*')
}

let nextCall = 1
const calls = new Map()
const listeners = new Map()
const menus = new Map()
let nextMenu = 1
let initialised = false
let resolveReady
const ready = new Promise((resolve) => (resolveReady = resolve))

/** Waypoint's colours as CSS variables on <html> (--wp-bg, --wp-fg…) and data-theme="light|dark" */
function applyTheme(theme) {
  if (!theme) return
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.vars || {})) root.style.setProperty(name, value)
  root.dataset.theme = theme.mode
  root.style.colorScheme = theme.mode
}

/** A panel's height follows its content: tell Waypoint whenever it changes (it sizes the iframe) */
function reportSize() {
  let last = -1
  const send = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height)
    if (height !== last) {
      last = height
      post({ type: 'size', height })
    }
  }
  new ResizeObserver(send).observe(document.documentElement)
  send()
}

export const waypoint = {
  /** "view" (a tab) or "panel" (embedded in Home or a project page); set when ready resolves */
  kind: null,
  /** Resolves once Waypoint has sent the view's state and the theme */
  ready,
  /** The view's id, e.g. "inbox" (set when ready resolves) */
  view: null,
  /** The tab's state (from openView, a project view or setState), or null (set when ready resolves) */
  state: null,
  /** Saved with the tab and restored on the next launch */
  setState(state) {
    waypoint.state = state === undefined ? null : state
    post({ type: 'setState', state })
  },
  /** Ask the plugin's main module (a host.handle function); rejects with its error's message (and err.status) */
  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextCall++
      calls.set(id, { resolve, reject })
      try {
        post({ type: 'call', id, method, params })
      } catch (e) {
        calls.delete(id)
        reject(e)
      }
    })
  },
  /** Listen for an event the main module sent with host.emit; returns a function that stops listening */
  on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(callback)
    return () => listeners.get(event)?.delete(callback)
  },
  /**
   * Waypoint's own right-click menu at the event's position. items: 'separator' or { id, label, checked, disabled, danger }.
   * Resolves to the chosen item's id, or null when it was dismissed.
   */
  menu(event, items) {
    return new Promise((resolve) => {
      const id = nextMenu++
      menus.set(id, resolve)
      if (event && event.preventDefault) event.preventDefault()
      post({ type: 'menu', id, x: (event && event.clientX) || 0, y: (event && event.clientY) || 0, items })
    })
  },
  /** A new tab (or the tab that already has this state) */
  openView(view, state) {
    post({ type: 'open', what: 'view', view, state })
  },
  /** Open the task note in Waypoint */
  openTask(id) {
    post({ type: 'open', what: 'task', id })
  },
  openProject(slug) {
    post({ type: 'open', what: 'project', slug })
  },
  /** http(s), mailto and claude:// links only */
  openExternal(url) {
    post({ type: 'open', what: 'external', url })
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== host) return
  const m = event.data
  if (!m || m.wp !== 1) return
  if (m.type === 'init') {
    applyTheme(m.theme)
    if (!initialised) {
      initialised = true
      waypoint.view = m.view
      waypoint.kind = m.kind === 'panel' ? 'panel' : 'view'
      waypoint.state = m.state === undefined ? null : m.state
      resolveReady()
      if (waypoint.kind === 'panel') reportSize()
    }
  } else if (m.type === 'theme') {
    applyTheme(m.theme)
  } else if (m.type === 'event') {
    for (const callback of [...(listeners.get(m.event) || [])]) {
      try {
        callback(m.data)
      } catch (e) {
        console.error(e)
      }
    }
  } else if (m.type === 'menu-result') {
    const resolve = menus.get(m.id)
    menus.delete(m.id)
    if (resolve) resolve(typeof m.choice === 'string' ? m.choice : null)
  } else if (m.type === 'result') {
    const pending = calls.get(m.id)
    if (!pending) return
    calls.delete(m.id)
    if (m.ok) pending.resolve(m.value)
    else pending.reject(Object.assign(new Error(m.error || 'The call failed'), m.status === undefined ? {} : { status: m.status }))
  }
})

// Ask for init now: Waypoint also sends it when the frame loads, but a page that imports this late would miss that
post({ type: 'hello' })

export default waypoint
`
