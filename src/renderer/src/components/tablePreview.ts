import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension, type Range, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet, type KeyBinding } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseLinks, resolveLink, type WikiLink } from '@shared/links'
import { linkContext, refreshLinks } from './livePreview'

// Markdown tables in live preview. A table is drawn as a real one until the selection touches
// its lines, when the raw text comes back so it can be edited.
//
// This is apart from livePreview.ts because a decoration that replaces whole lines has to come
// from a state field: CodeMirror doesn't accept them from a view plugin. Clicks on links in a
// table still go to the handler in livePreview.ts.

type Span =
  | string
  | { kind: 'em' | 'strong' | 'del'; children: Span[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; url: string; children: Span[] }
  | { kind: 'wiki'; target: string; text: string; resolved: boolean }

interface Cell {
  /** Where the cell's text starts, counted from the start of the table */
  offset: number
  spans: Span[]
}

interface TableModel {
  aligns: string[]
  header: Cell[]
  rows: Cell[][]
}

const skipSpace = (doc: Text, pos: number) => (doc.sliceString(pos, pos + 1) === ' ' ? pos + 1 : pos)

function readSpans(doc: Text, cell: SyntaxNode, state: EditorState): Span[] {
  const ctx = state.facet(linkContext)
  const notes = ctx?.notes() ?? []
  const fromPath = ctx?.from() ?? ''
  const wikis: WikiLink[] = parseLinks(doc.sliceString(cell.from, cell.to)).map((l) => ({
    ...l,
    from: l.from + cell.from,
    to: l.to + cell.from
  }))

  const wikiSpan = (l: WikiLink): Span => {
    const raw = doc.sliceString(l.from + 2, l.to - 2)
    const pipe = raw.indexOf('|')
    return {
      kind: 'wiki',
      target: l.target,
      text: pipe === -1 ? raw : raw.slice(pipe + 1),
      resolved: resolveLink(l.target, fromPath, notes) !== null
    }
  }

  const walk = (node: SyntaxNode, from: number, to: number): Span[] => {
    const out: Span[] = []
    let pos = from
    const push = (span: Span) => {
      const last = out[out.length - 1]
      if (typeof span === 'string' && typeof last === 'string') out[out.length - 1] = last + span
      else out.push(span)
    }
    const textTo = (end: number) => {
      if (end > pos) push(doc.sliceString(pos, end))
    }
    const wikisBefore = (limit: number) => {
      for (const l of wikis) {
        if (l.from < pos || l.from >= limit) continue
        textTo(l.from)
        push(wikiSpan(l))
        pos = l.to
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue
      // A wiki link starting inside this child is found when walking the child
      wikisBefore(child.from + 1)
      if (child.from < pos) continue
      textTo(child.from)
      for (const span of readNode(child)) push(span)
      pos = child.to
    }
    wikisBefore(to)
    textTo(to)
    return out
  }

  const readNode = (node: SyntaxNode): Span[] => {
    const raw = () => [doc.sliceString(node.from, node.to)]
    switch (node.name) {
      case 'EmphasisMark':
      case 'StrikethroughMark':
        return []
      case 'Emphasis':
        return [{ kind: 'em', children: walk(node, node.from, node.to) }]
      case 'StrongEmphasis':
        return [{ kind: 'strong', children: walk(node, node.from, node.to) }]
      case 'Strikethrough':
        return [{ kind: 'del', children: walk(node, node.from, node.to) }]
      case 'InlineCode': {
        const marks = node.getChildren('CodeMark')
        if (marks.length < 2) return raw()
        return [{ kind: 'code', text: doc.sliceString(marks[0].to, marks[1].from).replace(/\\\|/g, '|') }]
      }
      case 'Link': {
        // Only inline links: [text](url). Reference links stay raw, as they do outside tables.
        const marks = node.getChildren('LinkMark')
        const url = node.getChild('URL')
        if (marks.length < 3 || !url) return raw()
        return [
          {
            kind: 'link',
            url: doc.sliceString(url.from, url.to),
            children: walk(node, marks[0].to, marks[1].from)
          }
        ]
      }
      case 'Autolink': {
        const url = node.getChild('URL')
        if (!url) return raw()
        const text = doc.sliceString(url.from, url.to)
        return [{ kind: 'link', url: text, children: [text] }]
      }
      case 'URL': {
        const text = doc.sliceString(node.from, node.to)
        return [{ kind: 'link', url: text, children: [text] }]
      }
      case 'Escape':
        return [doc.sliceString(node.from + 1, node.to)]
      default:
        return raw()
    }
  }

  return walk(cell, cell.from, cell.to)
}

/** The parser leaves empty cells out, so they're worked out from the | around them */
function readRow(row: SyntaxNode, start: number, width: number, state: EditorState): Cell[] {
  const doc = state.doc
  const cells: Cell[] = []
  let lastPipe = -1
  let cellSincePipe = false
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      cells.push({ offset: child.from - start, spans: readSpans(doc, child, state) })
      cellSincePipe = true
    } else if (child.name === 'TableDelimiter') {
      if (lastPipe !== -1 && !cellSincePipe) {
        cells.push({ offset: skipSpace(doc, lastPipe) - start, spans: [] })
      }
      lastPipe = child.to
      cellSincePipe = false
    }
  }
  // Rows can be shorter or longer than the header, which decides the column count
  while (cells.length < width) cells.push({ offset: row.to - start, spans: [] })
  return cells.slice(0, width)
}

function readTable(table: SyntaxNode, start: number, state: EditorState): TableModel | null {
  const head = table.getChild('TableHeader')
  const delimiter = table.getChild('TableDelimiter')
  if (!head || !delimiter) return null
  const aligns = state.doc
    .sliceString(delimiter.from, delimiter.to)
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((part) => {
      const s = part.trim()
      const left = s.startsWith(':')
      const right = s.endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
    })
  let width = 0
  let pipe = false
  for (let child = head.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      width++
      pipe = false
    } else if (child.name === 'TableDelimiter') {
      if (pipe) width++ // an empty header cell
      pipe = true
    }
  }
  return {
    aligns,
    header: readRow(head, start, width, state),
    rows: table.getChildren('TableRow').map((row) => readRow(row, start, width, state))
  }
}

function appendSpans(parent: HTMLElement, spans: Span[]) {
  for (const span of spans) {
    if (typeof span === 'string') {
      parent.append(span)
      continue
    }
    switch (span.kind) {
      case 'em':
      case 'strong':
      case 'del': {
        const el = document.createElement(span.kind)
        appendSpans(el, span.children)
        parent.append(el)
        break
      }
      case 'code': {
        const el = document.createElement('code')
        el.className = 'cm-md-inline-code'
        // Long identifiers can wrap at their separators, or they'd force columns off the side
        span.text.split(/(?<=[_.\/-])/).forEach((part, i) => {
          if (i > 0) el.append(document.createElement('wbr'))
          el.append(part)
        })
        parent.append(el)
        break
      }
      case 'link': {
        const el = document.createElement('span')
        el.className = 'cm-md-link'
        el.title = span.url
        el.setAttribute('data-url', span.url)
        el.setAttribute('data-rendered', '')
        appendSpans(el, span.children)
        parent.append(el)
        break
      }
      case 'wiki': {
        const el = document.createElement('span')
        el.className = span.resolved ? 'cm-md-wikilink' : 'cm-md-wikilink unresolved'
        el.title = span.resolved ? span.target : `${span.target} — not created yet; click to create`
        el.setAttribute('data-wikilink', span.target)
        el.setAttribute('data-rendered', '')
        el.textContent = span.text
        parent.append(el)
        break
      }
    }
  }
}

class TableWidget extends WidgetType {
  private readonly key: string
  constructor(readonly table: TableModel) {
    super()
    this.key = JSON.stringify(table)
  }
  eq(other: TableWidget) {
    return other.key === this.key
  }
  get estimatedHeight() {
    return (this.table.rows.length + 1) * 36
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-md-table'
    const addRow = (parent: HTMLElement, cells: Cell[], tag: 'th' | 'td') => {
      const row = document.createElement('tr')
      cells.forEach((cell, i) => {
        const el = document.createElement(tag)
        el.setAttribute('data-offset', String(cell.offset))
        if (this.table.aligns[i]) el.style.textAlign = this.table.aligns[i]
        appendSpans(el, cell.spans)
        row.append(el)
      })
      parent.append(row)
    }
    const head = document.createElement('thead')
    addRow(head, this.table.header, 'th')
    const body = document.createElement('tbody')
    for (const row of this.table.rows) addRow(body, row, 'td')
    table.append(head, body)
    wrap.append(table)
    return wrap
  }
  // Only a press on a cell reaches the editor. Anything else, like the scrollbar of a wide table,
  // stays with the browser.
  ignoreEvent(e: Event) {
    return !(e.type === 'mousedown' && (e.target as HTMLElement).closest('td, th'))
  }
}

const setFocused = StateEffect.define<boolean>()
const focused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) value = e.value
    return value
  }
})

function build(state: EditorState): DecorationSet {
  const { doc, selection } = state
  const hasFocus = state.field(focused)
  const decos: Range<Decoration>[] = []
  // Only top-level tables: in a list or quote, the markers on each line have to stay visible
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'Table') continue
    const from = doc.lineAt(node.from).from
    const to = doc.lineAt(node.to).to
    if (hasFocus && selection.ranges.some((r) => r.from <= to && r.to >= from)) continue
    const table = readTable(node, from, state)
    if (table) decos.push(Decoration.replace({ block: true, widget: new TableWidget(table) }).range(from, to))
  }
  return Decoration.set(decos)
}

const tables = StateField.define<DecorationSet>({
  create: build,
  update(decos, tr) {
    const rebuild =
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(setFocused) || e.is(refreshLinks))
    return rebuild ? build(tr.state) : decos
  },
  provide: (field) => EditorView.decorations.from(field)
})

/**
 * Up and down skip block widgets, which would leave a drawn table out of reach of the keyboard.
 * Moving onto a table's line goes into its raw text instead.
 */
function moveIntoTable(view: EditorView, forward: boolean): boolean {
  const { doc, selection } = view.state
  const main = selection.main
  if (selection.ranges.length > 1 || !main.empty) return false
  const line = doc.lineAt(main.head)
  if (line.number === (forward ? doc.lines : 1)) return false
  const next = doc.line(line.number + (forward ? 1 : -1))
  let table: { from: number; to: number } | null = null
  view.state.field(tables).between(next.from, next.from, (from, to) => {
    table = { from, to }
  })
  if (!table) return false
  // Still moving within a wrapped line
  const moved = view.moveVertically(main, forward).head
  if (moved >= line.from && moved <= line.to) return false
  const { from, to } = table as { from: number; to: number }
  const row = doc.lineAt(forward ? from : to)
  const anchor = row.from + Math.min(main.head - line.from, row.length)
  view.dispatch({ selection: { anchor }, scrollIntoView: true })
  return true
}

/** Goes after the autocomplete keys, so arrows still move through an open completion list */
export const tableKeymap: readonly KeyBinding[] = [
  { key: 'ArrowUp', run: (view) => moveIntoTable(view, false) },
  { key: 'ArrowDown', run: (view) => moveIntoTable(view, true) }
]

export const tablePreview: Extension = [
  focused,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  tables,
  EditorView.domEventHandlers({
    // Clicking a cell puts the cursor in its text, which brings the raw table back to edit
    mousedown(e, view) {
      if (e.button !== 0) return false
      const target = e.target as HTMLElement
      if (target.closest('[data-url], [data-wikilink]')) return false
      const cell = target.closest<HTMLElement>('.cm-md-table td, .cm-md-table th')
      const wrap = cell?.closest<HTMLElement>('.cm-md-table-wrap')
      if (!cell || !wrap) return false
      const anchor = view.posAtDOM(wrap) + Number(cell.getAttribute('data-offset'))
      view.dispatch({ selection: { anchor }, scrollIntoView: true })
      view.focus()
      return true
    }
  })
]
