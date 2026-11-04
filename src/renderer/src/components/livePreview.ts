import { syntaxTree } from '@codemirror/language'
import { Facet, StateEffect, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseLinks, resolveLink } from '@shared/links'

// Obsidian-style live preview: markdown syntax is hidden and rendered, except on the lines
// the selection touches, where the raw text comes back so it can be edited.
//
// Links: on a rendered line a plain click follows a link; on the line being edited, Ctrl+click.
// Ctrl+click (or middle-click) on a [[wiki link]] opens it in a new tab.

/** What the editor knows about the vault, for resolving and following [[wiki links]] */
export interface LinkContext {
  notes(): string[]
  /** Path of the note being edited */
  from(): string
  open(target: string, newTab: boolean): void
}
export const linkContext = Facet.define<LinkContext, LinkContext | null>({ combine: (v) => v[0] ?? null })

/** Dispatch when the set of notes changes, so links re-check whether they resolve. */
export const refreshLinks = StateEffect.define<null>()

const hide = Decoration.replace({})
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText'])

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // TaskMarker is "[ ]" / "[x]": flip the middle character
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' }
      })
    })
    box.addEventListener('click', (e) => e.preventDefault())
    return box
  }
  ignoreEvent() {
    return true
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-hr'
    return el
  }
}

function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  if (!view.hasFocus) return lines
  const { doc, selection } = view.state
  for (const r of selection.ranges) {
    const last = doc.lineAt(r.to).number
    for (let l = doc.lineAt(r.from).number; l <= last; l++) lines.add(l)
  }
  return lines
}

function build(view: EditorView): DecorationSet {
  const state: EditorState = view.state
  const doc = state.doc
  const active = activeLines(view)
  const decos: Range<Decoration>[] = []
  /** Tables drawn by tablePreview.ts, so nothing here decorates what they replace */
  const drawnTables: { from: number; to: number }[] = []

  const touches = (from: number, to: number) => {
    const last = doc.lineAt(to).number
    for (let l = doc.lineAt(from).number; l <= last; l++) if (active.has(l)) return true
    return false
  }
  const hideRange = (from: number, to: number) => {
    if (to > from) decos.push(hide.range(from, to))
  }
  // Include the single space after a block marker ("# ", "> ", "- ")
  const withSpace = (to: number) => (doc.sliceString(to, to + 1) === ' ' ? to + 1 : to)
  const linkMark = (url: string, rendered: boolean) =>
    Decoration.mark({
      class: 'cm-md-link',
      attributes: { 'data-url': url, title: url, ...(rendered ? { 'data-rendered': '' } : {}) }
    })

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const parent = node.parent
        switch (node.name) {
          case 'Table':
            if (parent?.name === 'Document' && !touches(node.from, node.to)) {
              drawnTables.push({ from: node.from, to: node.to })
              return false
            }
            return
          case 'HeaderMark':
            if (!touches(node.from, node.to)) hideRange(node.from, withSpace(node.to))
            return
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (parent && !touches(parent.from, parent.to)) hideRange(node.from, node.to)
            return
          case 'InlineCode':
            decos.push(Decoration.mark({ class: 'cm-md-inline-code' }).range(node.from, node.to))
            if (!touches(node.from, node.to)) {
              for (const m of node.getChildren('CodeMark')) hideRange(m.from, m.to)
            }
            return false
          case 'FencedCode':
            fencedCode(node)
            return false
          case 'Frontmatter': {
            const last = doc.lineAt(node.to).number
            for (let l = doc.lineAt(node.from).number; l <= last; l++) {
              decos.push(Decoration.line({ class: 'cm-md-frontmatter' }).range(doc.line(l).from))
            }
            return false
          }
          case 'Link':
            link(node)
            return false
          case 'Autolink': {
            const url = node.getChild('URL')
            if (!url) return false
            const rendered = !touches(node.from, node.to)
            decos.push(linkMark(doc.sliceString(url.from, url.to), rendered).range(url.from, url.to))
            if (rendered) {
              for (const m of node.getChildren('LinkMark')) hideRange(m.from, m.to)
            }
            return false
          }
          case 'URL':
            // Bare URL in text (GFM autolink); URLs inside links/images are handled above
            if (parent?.name === 'Paragraph' || parent?.name === 'Task' || parent?.name === 'TableCell') {
              const rendered = !touches(node.from, node.to)
              decos.push(linkMark(doc.sliceString(node.from, node.to), rendered).range(node.from, node.to))
            }
            return
          case 'Image':
            return false // rendered images come later; keep the raw syntax for now
          case 'ListMark':
            listMark(node)
            return
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            const task = node.parent
            if (checked && task && task.to > node.to) {
              decos.push(Decoration.mark({ class: 'cm-md-done' }).range(withSpace(node.to), task.to))
            }
            if (!touches(node.from, node.to)) {
              decos.push(
                Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to)
              )
            }
            return
          }
          case 'QuoteMark': {
            const line = doc.lineAt(node.from)
            decos.push(Decoration.line({ class: 'cm-md-quote' }).range(line.from))
            if (!active.has(line.number)) hideRange(node.from, withSpace(node.to))
            return
          }
          case 'HorizontalRule':
            if (!touches(node.from, node.to)) {
              decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            }
            return
        }
        return
      }
    })
  }

  function fencedCode(node: SyntaxNode) {
    const first = doc.lineAt(node.from).number
    const last = doc.lineAt(node.to).number
    const editing = touches(node.from, node.to)
    for (let l = first; l <= last; l++) {
      const line = doc.line(l)
      const cls =
        'cm-md-codeblock' + (l === first ? ' cm-md-codeblock-first' : '') + (l === last ? ' cm-md-codeblock-last' : '')
      decos.push(Decoration.line({ class: cls }).range(line.from))
    }
    if (!editing) {
      // Hide the ``` fences (and language tag) but keep their lines as the block's padding
      for (const m of node.getChildren('CodeMark')) {
        const line = doc.lineAt(m.from)
        if (line.number === first || line.number === last) hideRange(line.from, line.to)
      }
    }
  }

  function link(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark')
    const url = node.getChild('URL')
    // Only inline links: [text](url). Reference links stay raw.
    if (marks.length < 3 || !url) return
    const open = marks[0]
    const close = marks[1]
    const rendered = !touches(node.from, node.to)
    if (close.from > open.to) {
      decos.push(linkMark(doc.sliceString(url.from, url.to), rendered).range(open.to, close.from))
    }
    if (rendered) {
      hideRange(open.from, open.to)
      hideRange(close.from, node.to)
    }
  }

  function listMark(node: SyntaxNode) {
    if (touches(node.from, node.to)) return
    const item = node.parent
    if (!item) return
    if (item.getChild('Task')) {
      hideRange(node.from, withSpace(node.to)) // the checkbox stands in for the bullet
    } else if (item.parent?.name === 'BulletList') {
      decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
    }
  }

  // [[wiki links]] aren't part of the markdown grammar, so find them by pattern
  const ctx = state.facet(linkContext)
  const notes = ctx?.notes() ?? []
  const fromPath = ctx?.from() ?? ''
  for (const { from, to } of view.visibleRanges) {
    const start = doc.lineAt(from).from
    for (const l of parseLinks(doc.sliceString(start, doc.lineAt(to).to))) {
      const lf = start + l.from
      const lt = start + l.to
      if (CODE.has(syntaxTree(state).resolveInner(lf + 2, 1).name)) continue
      if (drawnTables.some((t) => lf >= t.from && lt <= t.to)) continue
      const raw = doc.sliceString(lf + 2, lt - 2)
      const pipe = raw.indexOf('|')
      const textFrom = pipe === -1 ? lf + 2 : lf + 3 + pipe
      const rendered = !touches(lf, lt)
      const resolved = resolveLink(l.target, fromPath, notes) !== null
      if (lt - 2 > textFrom) {
        decos.push(
          Decoration.mark({
            class: resolved ? 'cm-md-wikilink' : 'cm-md-wikilink unresolved',
            attributes: {
              'data-wikilink': l.target,
              title: resolved ? l.target : `${l.target} — not created yet; click to create`,
              ...(rendered ? { 'data-rendered': '' } : {})
            }
          }).range(textFrom, lt - 2)
        )
      }
      if (rendered) {
        hideRange(lf, textFrom)
        hideRange(lt - 2, lt)
      }
    }
  }

  return Decoration.set(decos, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))
      ) {
        this.decorations = build(u.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        if (e.button !== 0 && e.button !== 1) return false
        const el = (e.target as HTMLElement).closest('[data-url], [data-wikilink]')
        if (!el) return false
        const mod = e.ctrlKey || e.metaKey
        if (!mod && e.button === 0 && !el.hasAttribute('data-rendered')) return false // editing
        e.preventDefault()
        const wiki = el.getAttribute('data-wikilink')
        if (wiki !== null) {
          view.state.facet(linkContext)?.open(wiki, mod || e.button === 1)
          return true
        }
        const url = el.getAttribute('data-url')
        if (url && /^https?:\/\//i.test(url)) window.open(url) // main process sends it to the browser
        return true
      }
    }
  }
)
