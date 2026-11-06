import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  RangeSet,
  StateEffect,
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
import { editorHost } from './host'

// Notion-style live preview: markdown syntax is hidden and drawn as what it means, all the time,
// including on the line being edited. The file underneath stays plain markdown. The Markdown
// button (Ctrl+Shift+M) turns all of this off to show and edit the source.
// wysiwyg.ts makes the cursor, arrows and deleting behave around what's hidden here.
//
// Syntax that isn't finished yet stays raw (an unclosed ``` fence, a ** with no partner), so you
// can see what you type.
//
// A top-level table is its own text laid out as a grid: each row's line is a flex row, each
// cell's text a column, and the | and the |---| line are hidden. So cells are edited in place.
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

/**
 * Markdown the preview hides or draws over:
 * - inline: marks around text (** _ ~~ ` [ ](url) [[ ]])
 * - prefix: block markers at the start of a line (# > - [ ])
 * - open / close: the ``` lines of a code block
 * - rule: a --- line (a divider, or the underline of a heading)
 * - pipe: a table's | (with any space outside the first and last)
 * - skip: a table's |---| line, which the cursor passes over
 * - object: something drawn in its place, deleted whole (a picture)
 */
export type HiddenKind = 'inline' | 'prefix' | 'open' | 'close' | 'rule' | 'pipe' | 'skip' | 'object'
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

/** A picture: ![alt](path) */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly path: string
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.title = this.alt || this.path
    img.draggable = false
    // Pictures load after the line is measured
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => {
      wrap.classList.add('broken')
      wrap.textContent = `Picture not found: ${this.path}`
      view.requestMeasure()
    })
    img.src = this.src
    wrap.append(img)
    return wrap
  }
  // A click beside or on it puts the cursor there
  ignoreEvent() {
    return false
  }
}

/** Callout types (GitHub's and Obsidian's) → [colour group, icon] */
const CALLOUTS: Record<string, [string, string]> = {
  note: ['blue', 'ℹ️'],
  info: ['blue', 'ℹ️'],
  abstract: ['blue', '📄'],
  summary: ['blue', '📄'],
  tldr: ['blue', '📄'],
  todo: ['blue', '☑️'],
  tip: ['green', '💡'],
  hint: ['green', '💡'],
  success: ['green', '✅'],
  check: ['green', '✅'],
  done: ['green', '✅'],
  important: ['purple', '❗'],
  question: ['yellow', '❓'],
  help: ['yellow', '❓'],
  faq: ['yellow', '❓'],
  warning: ['yellow', '⚠️'],
  caution: ['red', '⚠️'],
  attention: ['yellow', '⚠️'],
  danger: ['red', '⛔'],
  error: ['red', '⛔'],
  failure: ['red', '⛔'],
  bug: ['red', '🐞'],
  example: ['purple', '📋'],
  quote: ['gray', '❝']
}

/** Stands in for a callout's [!type]: its icon, and its name when it has no title */
class CalloutWidget extends WidgetType {
  constructor(
    readonly icon: string,
    readonly label: string
  ) {
    super()
  }
  eq(other: CalloutWidget) {
    return other.icon === this.icon && other.label === this.label
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-callout-icon'
    el.textContent = this.icon
    if (this.label) {
      const label = document.createElement('span')
      label.className = 'cm-md-callout-label'
      label.textContent = this.label
      el.append(label)
    }
    return el
  }
}

/** Holds an empty table cell's place (one written || with no space in it) */
class EmptyCellWidget extends WidgetType {
  constructor(readonly style: string) {
    super()
  }
  eq(other: EmptyCellWidget) {
    return other.style === this.style
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-cell'
    el.setAttribute('style', this.style)
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
  /** Backslash escapes, hidden after the wiki links are known (a link's \| is the link's) */
  const escapes: number[] = []
  /** Table cells, marked once what's hidden in them is known */
  const cellMarks: { from: number; to: number; style: string }[] = []
  /** Lines of callouts, which are drawn as boxes rather than quotes */
  const callouts: { from: number; to: number }[] = []

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
            if (parent?.name === 'Document') table(node)
            return // cells can have formatting in them
          case 'Escape':
            escapes.push(node.from)
            return
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
          case 'InlineCode': {
            // Over the code only, not the hidden ` (in a table, a mark starting where a cell does
            // would end up outside the cell)
            const marks = node.getChildren('CodeMark')
            const from = marks.length >= 2 ? marks[0].to : node.from
            const to = marks.length >= 2 ? marks[marks.length - 1].from : node.to
            if (to > from) decos.push(Decoration.mark({ class: 'cm-md-inline-code' }).range(from, to))
            for (const m of marks) hideRange(m.from, m.to, 'inline')
            return false
          }
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
            image(node)
            return false
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
          case 'Blockquote':
            callout(node)
            return
          case 'QuoteMark': {
            const line = doc.lineAt(node.from)
            if (!callouts.some((c) => line.from >= c.from && line.from <= c.to)) {
              decos.push(Decoration.line({ class: 'cm-md-quote' }).range(line.from))
            }
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

  function table(node: SyntaxNode) {
    const rows: { line: Line; head: boolean; pipes: { from: number; to: number }[]; cells: { from: number; to: number }[] }[] =
      []
    let aligns: string[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableDelimiter') {
        // The |---| line: kept, as the editor needs every line, but flattened and passed over
        const line = doc.lineAt(child.from)
        decos.push(Decoration.line({ class: 'cm-md-tdelim' }).range(line.from))
        hideRange(line.from, line.to, 'skip')
        aligns = line.text
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((part) => {
            const s = part.trim()
            const left = s.startsWith(':')
            const right = s.endsWith(':')
            return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
          })
        continue
      }
      if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue
      const line = doc.lineAt(child.from)
      const pipes = child.getChildren('TableDelimiter').map((p) => ({ from: p.from, to: p.to }))
      // Cells are what's between the |s; text before the first or after the last is one only if not blank
      const cells: { from: number; to: number }[] = []
      const cuts = [line.from, ...pipes.flatMap((p) => [p.from, p.to]), line.to]
      for (let i = 0; i < cuts.length; i += 2) {
        const edge = i === 0 || i === cuts.length - 2
        if (edge && pipes.length && !doc.sliceString(cuts[i], cuts[i + 1]).trim()) {
          // Blank space outside the table's edge | goes with it
          if (i === 0) pipes[0].from = cuts[i]
          else pipes[pipes.length - 1].to = cuts[i + 1]
          continue
        }
        cells.push({ from: cuts[i], to: cuts[i + 1] })
      }
      // The spaces padding a cell's text go with the | beside them, so the cursor can't stop in
      // them (typing there would put a space between you and the text). An empty cell keeps its
      // spaces as somewhere to type.
      for (const c of cells) {
        const text = doc.sliceString(c.from, c.to)
        if (!text.trim()) continue
        const lead = text.length - text.trimStart().length
        const trail = text.length - text.trimEnd().length
        const before = pipes.find((p) => p.to === c.from)
        const after = pipes.find((p) => p.from === c.to)
        if (before) before.to += lead
        if (after) after.from -= trail
        c.from += before ? lead : 0
        c.to -= after ? trail : 0
      }
      rows.push({ line, head: child.name === 'TableHeader', pipes, cells })
    }
    // Columns share the width by their longest text, as shown (without ** [[ ]] and the like)
    const shown = (from: number, to: number) =>
      doc
        .sliceString(from, to)
        .replace(/\]\([^)]*\)|\[\[[^\]|]*\||[*_`~\\[\]]/g, '')
        .trim().length
    const widths: number[] = []
    // and are never narrower than their longest word (up to a point), so "10" doesn't wrap to "1 0"
    const words: number[] = []
    for (const row of rows) {
      row.cells.forEach((c, i) => {
        widths[i] = Math.max(widths[i] ?? 3, Math.min(40, shown(c.from, c.to)))
        const longest = Math.max(0, ...doc.sliceString(c.from, c.to).split(/\s+/).map((w) => w.length))
        words[i] = Math.max(words[i] ?? 1, Math.min(14, longest))
      })
    }
    rows.forEach((row, r) => {
      const cls = 'cm-md-trow' + (row.head ? ' cm-md-thead' : '') + (r === rows.length - 1 ? ' cm-md-tlast' : '')
      decos.push(Decoration.line({ class: cls }).range(row.line.from))
      for (const p of row.pipes) hideRange(p.from, p.to, 'pipe')
      row.cells.forEach((c, i) => {
        // Every cell in a column gets the same grow and minimum (in em, which bold text doesn't change),
        // so the columns line up from row to row
        const style =
          `flex-grow: ${widths[i] ?? 3}; min-width: ${((words[i] ?? 1) * 0.62).toFixed(2)}em;` +
          (aligns[i] ? ` text-align: ${aligns[i]};` : '')
        if (c.to > c.from) cellMarks.push({ from: c.from, to: c.to, style })
        else decos.push(Decoration.widget({ widget: new EmptyCellWidget(style), side: 1 }).range(c.from))
      })
    })
  }

  /** A quote that starts with [!note], [!warning] and so on: a coloured box with an icon */
  function callout(node: SyntaxNode) {
    const first = doc.lineAt(node.from)
    const m = /^(\s*>\s?)\[!([\w-]+)\]([+-]?)([ \t]*)(.*)$/.exec(first.text)
    if (!m) return
    const type = m[2].toLowerCase()
    const [colour, icon] = CALLOUTS[type] ?? ['blue', 'ℹ️']
    const end = node.to > node.from && doc.sliceString(node.to - 1, node.to) === '\n' ? node.to - 1 : node.to
    const last = doc.lineAt(end)
    callouts.push({ from: first.from, to: last.to })
    for (let l = first.number; l <= last.number; l++) {
      const line = doc.line(l)
      const cls =
        `cm-md-callout cm-md-callout-${colour}` +
        (l === first.number ? ' cm-md-callout-first' : '') +
        (l === last.number ? ' cm-md-callout-last' : '')
      decos.push(Decoration.line({ class: cls }).range(line.from))
    }
    const markFrom = first.from + m[1].length
    const markTo = markFrom + 2 + m[2].length + 1 + m[3].length + m[4].length
    const label = m[5].trim() ? '' : type.charAt(0).toUpperCase() + type.slice(1)
    hideRange(markFrom, markTo, 'prefix', new CalloutWidget(icon, label))
    if (m[5].trim()) decos.push(Decoration.mark({ class: 'cm-md-callout-title' }).range(markTo, first.to))
  }

  function image(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark')
    const url = node.getChild('URL')
    // Only inline pictures: ![alt](path). Reference ones stay raw.
    if (marks.length < 3 || !url) return
    let path = doc.sliceString(url.from, url.to)
    if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1)
    const alt = doc.sliceString(marks[0].to, marks[1].from)
    const src = state.facet(editorHost)?.imageSrc(path) ?? path
    hideRange(node.from, node.to, 'object', new ImageWidget(src, alt, path))
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
  const wikis: { from: number; to: number }[] = []
  for (const { from, to } of ranges) {
    const start = doc.lineAt(from).from
    for (const l of parseLinks(doc.sliceString(start, doc.lineAt(to).to))) {
      const lf = start + l.from
      const lt = start + l.to
      if (CODE.has(syntaxTree(state).resolveInner(lf + 2, 1).name)) continue
      wikis.push({ from: lf, to: lt })
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
  // \* shows as *
  for (const e of escapes) {
    if (!wikis.some((w) => e >= w.from && e < w.to)) hideRange(e, e + 1, 'inline')
  }
  // A cell's span has to be the row's flex item, so it must be outside any other mark that covers
  // the same text (a link filling the cell): inclusive puts it outside. But not when the cell starts
  // with hidden markdown, which would then sit inside the cell and let its text wrap before it.
  for (const c of cellMarks) {
    const inclusive = !hidden.some((h) => h.from === c.from)
    decos.push(Decoration.mark({ class: 'cm-md-cell', inclusive, attributes: { style: c.style } }).range(c.from, c.to))
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
  previewPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(previewPlugin)?.atoms ?? RangeSet.empty)
]
