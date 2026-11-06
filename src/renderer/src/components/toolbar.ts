import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { LINE_KINDS, turnInto, turnIntoCode } from './blocks'
import { bold, code, formatAt, italic, linkCommand, strike } from './format'
import { editorHost } from './host'

// The bar over selected text: bold, italic, strikethrough, code, link, and "Turn into" for the
// lines the selection covers. Shown once the mouse is let go, and only while the editor has focus.

const setFocus = StateEffect.define<boolean>()
const setDragging = StateEffect.define<boolean>()

interface Status {
  focused: boolean
  dragging: boolean
}

const status = StateField.define<Status>({
  create: () => ({ focused: false, dragging: false }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocus)) value = { ...value, focused: e.value }
      if (e.is(setDragging)) value = { ...value, dragging: e.value }
    }
    return value
  }
})

function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'Frontmatter') return true
  }
  return false
}

function bar(view: EditorView): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-format-bar'
  const button = (label: string, title: string, run: (view: EditorView, el: HTMLElement) => unknown, cls = '', on = false) => {
    const el = document.createElement('button')
    el.className = `cm-format-btn ${cls}${on ? ' on' : ''}`
    el.textContent = label
    el.title = title
    el.addEventListener('mousedown', (e) => e.preventDefault()) // keep the selection
    el.addEventListener('click', (e) => {
      e.preventDefault()
      run(view, el)
    })
    dom.append(el)
  }
  button('Turn into ▾', 'Turn into another kind of block', (v, el) => {
    const r = el.getBoundingClientRect()
    v.state.facet(editorHost)?.menu(r.left, r.bottom + 4, [
      ...LINE_KINDS.map(({ kind, label }) => ({ label, run: () => turnInto(v, kind) })),
      { label: 'Code block', run: () => turnIntoCode(v) }
    ])
  }, 'wide')
  button('B', 'Bold (Ctrl+B)', bold, 'b', !!formatAt(view, 'StrongEmphasis'))
  button('I', 'Italic (Ctrl+I)', italic, 'i', !!formatAt(view, 'Emphasis'))
  button('S', 'Strikethrough (Ctrl+Shift+S)', strike, 's', !!formatAt(view, 'Strikethrough'))
  button('</>', 'Code (Ctrl+E)', code, 'code', !!formatAt(view, 'InlineCode'))
  button('Link', 'Link (Ctrl+K)', linkCommand, 'wide')
  return dom
}

function tooltipFor(state: EditorState): Tooltip | null {
  const { focused, dragging } = state.field(status)
  const sel = state.selection
  if (!focused || dragging || sel.ranges.length > 1 || sel.main.empty) return null
  if (inCode(state, sel.main.from) || inCode(state, sel.main.to)) return null
  return { pos: sel.main.from, end: sel.main.to, above: true, create: (view) => ({ dom: bar(view) }) }
}

const tooltip = StateField.define<Tooltip | null>({
  create: tooltipFor,
  update(value, tr) {
    const changed = tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocus) || e.is(setDragging))
    return changed ? tooltipFor(tr.state) : value
  },
  provide: (f) => showTooltip.from(f)
})

export const formatToolbar: Extension = [
  status,
  tooltip,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
  EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false
      view.dispatch({ effects: setDragging.of(true) })
      const up = () => {
        window.removeEventListener('mouseup', up)
        view.dispatch({ effects: setDragging.of(false) })
      }
      window.addEventListener('mouseup', up)
      return false
    }
  })
]
