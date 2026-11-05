import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Line,
  type Range,
  type Text
} from '@codemirror/state'
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

// Notion-style live preview: markdown syntax is hidden and drawn as what it means, all the time,
// including on the line being edited. The file underneath stays plain markdown. The Markdown
// button (Ctrl+Shift+M) turns all of this off to show and edit the source.
// wysiwyg.ts makes the cursor, arrows and deleting behave around what's hidden here.
//
// Two things stay raw: a table while the selection is in it (tablePreview.ts), and syntax that
// isn't finished yet (an unclosed ``` fence, a ** with no partner), so you can see what you type.
//
// Links: a click follows a link; Ctrl+click (or middle-click) on a [[wiki link]] opens it in a new tab.

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

/** Whether the editor has focus, kept in the state so state fields (tablePreview.ts) can see it */
const setFocused = StateEffect.define<boolean>()
export const editorFocused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) value = e.value
    return value
  }
})

/**
 * Markdown the preview hides or draws over:
 * - inline: marks around text (** _ ~~ ` [ ](url) [[ ]])
 * - prefix: block markers at the start of a line (# > - [ ])
 * - open / close: the ``` lines of a code block
 * - rule: a --- line (a divider, or the underline of a heading)
 */
export type HiddenKind = 'inline' | 'prefix' | 'open' | 'close' | 'rule'
export interface Hidden {
  from: number
  to: number
  kind: HiddenKind
}

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
const bullet = new BulletWidget()

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
const rule = new RuleWidget()

/** Stands in for a code block's opening ```, showing its language */
class LangWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: LangWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-code-lang'
    el.textContent = this.lang
    return el
  }
}

/** Whether a fenced code block has its closing fence (an unclosed one shows its ``` until it does) */
export function fenceClosed(node: SyntaxNode, doc: Text): boolean {
  const marks = node.getChildren('CodeMark')
  return marks.length >= 2 && doc.lineAt(marks[marks.length - 1].from).number > doc.lineAt(node.from).number
}

function collect(state: EditorState, ranges: readonly { from: number; to: number }[]) {
  const doc = state.doc
  const decos: Range<Decoration>[] = []
  const hidden: Hidden[] = []
  /** Top-level tables belong to tablePreview.ts, so nothing here decorates inside them */
  const tables: { from: number; to: number }[] = []

  const hideRange = (from: number, to: number, kind: HiddenKind, widget?: WidgetType) => {
    if (to <= from) return
    decos.push((widget ? Decoration.replace({ widget }) : hide).range(from, to))
    hidden.push({ from, to, kind })
  }
  // Include the single space after a block marker ("# ", "> ", "- ")
  const withSpace = (to: number) => (doc.sliceString(to, to + 1) === ' ' ? to + 1 : to)
  const linkMark = (url: string) =>
    Decoration.mark({ class: 'cm-md-link', attributes: { 'data-url': url, title: url, 'data-rendered': '' } })

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const parent = node.parent
        switch (node.name) {
          case 'Table':
            if (parent?.name !== 'Document') return
            tables.push({ from: node.from, to: node.to })
            return false
          case 'HeaderMark': {
            const line = doc.lineAt(node.from)
            if (parent?.name.startsWith('SetextHeading') && line.number > doc.lineAt(parent.from).number) {
              hideRange(node.from, line.to, 'rule') // the --- or === under the heading
            } else if (node.from === parent?.from) {
              hideRange(node.from, withSpace(node.to), 'prefix')
            } else {
              hideRange(node.from, node.to, 'inline') // closing #s
            }
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hideRange(node.from, node.to, 'inline')
            return
          case 'InlineCode':
            decos.push(Decoration.mark({ class: 'cm-md-inline-code' }).range(node.from, node.to))
            for (const m of node.getChildren('CodeMark')) hideRange(m.from, m.to, 'inline')
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
            decos.push(linkMark(doc.sliceString(url.from, url.to)).range(url.from, url.to))
            for (const m of node.getChildren('LinkMark')) hideRange(m.from, m.to, 'inline')
            return false
          }
          case 'URL':
            // Bare URL in text (GFM autolink); URLs inside links/images are handled above
            if (parent?.name === 'Paragraph' || parent?.name === 'Task' || parent?.name === 'TableCell') {
              decos.push(linkMark(doc.sliceString(node.from, node.to)).range(node.from, node.to))
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
            const end = withSpace(node.to)
            if (checked && task && task.to > end) {
              decos.push(Decoration.mark({ class: 'cm-md-done' }).range(end, task.to))
            }
            hideRange(node.from, end, 'prefix', new CheckboxWidget(checked, node.from))
            return
          }
          case 'QuoteMark': {
            const line = doc.lineAt(node.from)
            decos.push(Decoration.line({ class: 'cm-md-quote' }).range(line.from))
            hideRange(node.from, withSpace(node.to), 'prefix')
            return
          }
          case 'HorizontalRule':
            hideRange(node.from, node.to, 'rule', rule)
            return
        }
        return
      }
    })
  }

  function fencedCode(node: SyntaxNode) {
    const first = doc.lineAt(node.from).number
    const last = doc.lineAt(node.to).number
    for (let l = first; l <= last; l++) {
      const line = doc.line(l)
      const cls =
        'cm-md-codeblock' + (l === first ? ' cm-md-codeblock-first' : '') + (l === last ? ' cm-md-codeblock-last' : '')
      decos.push(Decoration.line({ class: cls }).range(line.from))
    }
    if (!fenceClosed(node, doc)) return
    // The ``` lines stay as the block's padding: the opening one shows the language
    const open = doc.line(first)
    const close = doc.line(last)
    const info = node.getChild('CodeInfo')
    hideRange(open.from, open.to, 'open', new LangWidget(info ? doc.sliceString(info.from, info.to) : ''))
    hideRange(close.from, close.to, 'close')
  }

  function link(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark')
    const url = node.getChild('URL')
    // Only inline links: [text](url). Reference links stay raw.
    if (marks.length < 3 || !url) return
    const open = marks[0]
    const close = marks[1]
    if (close.from > open.to) {
      decos.push(linkMark(doc.sliceString(url.from, url.to)).range(open.to, close.from))
    }
    hideRange(open.from, open.to, 'inline')
    hideRange(close.from, node.to, 'inline')
  }

  function listMark(node: SyntaxNode) {
    const item = node.parent
    if (!item) return
    if (item.getChild('Task')) {
      hideRange(node.from, withSpace(node.to), 'prefix') // the checkbox stands in for the bullet
    } else if (item.parent?.name === 'BulletList') {
      hideRange(node.from, withSpace(node.to), 'prefix', bullet)
    }
  }

  // [[wiki links]] aren't part of the markdown grammar, so find them by pattern
  const ctx = state.facet(linkContext)
  const notes = ctx?.notes() ?? []
  const fromPath = ctx?.from() ?? ''
  for (const { from, to } of ranges) {
    const start = doc.lineAt(from).from
    for (const l of parseLinks(doc.sliceString(start, doc.lineAt(to).to))) {
      const lf = start + l.from
      const lt = start + l.to
      if (CODE.has(syntaxTree(state).resolveInner(lf + 2, 1).name)) continue
      if (tables.some((t) => lf >= t.from && lt <= t.to)) continue
      const raw = doc.sliceString(lf + 2, lt - 2)
      const pipe = raw.indexOf('|')
      const textFrom = pipe === -1 ? lf + 2 : lf + 3 + pipe
      const resolved = resolveLink(l.target, fromPath, notes) !== null
      if (lt - 2 > textFrom) {
        decos.push(
          Decoration.mark({
            class: resolved ? 'cm-md-wikilink' : 'cm-md-wikilink unresolved',
            attributes: {
              'data-wikilink': l.target,
              title: resolved ? l.target : `${l.target} — not created yet; click to create`,
              'data-rendered': ''
            }
          }).range(textFrom, lt - 2)
        )
      }
      hideRange(lf, textFrom, 'inline')
      hideRange(lt - 2, lt, 'inline')
    }
  }

  return { decos, hidden }
}

/** What the preview hides on one line, in order */
export function hiddenOnLine(state: EditorState, line: Line): Hidden[] {
  return collect(state, [{ from: line.from, to: line.to }])
    .hidden.filter((h) => h.from >= line.from && h.to <= line.to)
    .sort((a, b) => a.from - b.from || a.to - b.to)
}

class Preview {
  decorations!: DecorationSet
  /** What's hidden: the cursor steps over it as a whole */
  atoms!: RangeSet<Decoration>
  constructor(view: EditorView) {
    this.compute(view)
  }
  compute(view: EditorView) {
    const { decos, hidden } = collect(view.state, view.visibleRanges)
    this.decorations = Decoration.set(decos, true)
    this.atoms = RangeSet.of(
      hidden.map((h) => hide.range(h.from, h.to)),
      true
    )
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
      this.compute(u.view)
    }
  }
}

const previewPlugin = ViewPlugin.fromClass(Preview, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      if (e.button !== 0 && e.button !== 1) return false
      const el = (e.target as HTMLElement).closest('[data-url], [data-wikilink]')
      if (!el) return false
      const mod = e.ctrlKey || e.metaKey
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
})

export const livePreview: Extension = [
  editorFocused,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  previewPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(previewPlugin)?.atoms ?? RangeSet.empty)
]
