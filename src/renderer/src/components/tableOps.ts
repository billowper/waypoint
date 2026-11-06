import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Line } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { editMenu } from '../menus'
import type { MenuItem } from '../store'
import { editorHost } from './host'

// Adding and removing a table's rows and columns, from a right-click in the table or the block
// menu (handles.ts). Edits the markdown lines: | cells | and the |---| line under the header.

export interface TableLines {
  node: SyntaxNode
  header: Line
  delimiter: Line
  /** Every line of the table, header first */
  lines: Line[]
}

/** The top-level table at a position */
export function tableAt(state: EditorState, pos: number): TableLines | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== 'Table') continue
    if (n.parent?.name !== 'Document') return null
    const head = n.getChild('TableHeader')
    const delim = n.getChild('TableDelimiter')
    if (!head || !delim) return null
    const lines: Line[] = []
    for (let l = state.doc.lineAt(n.from).number; l <= state.doc.lineAt(n.to).number; l++) lines.push(state.doc.line(l))
    return { node: n, header: state.doc.lineAt(head.from), delimiter: state.doc.lineAt(delim.from), lines }
  }
  return null
}

interface Row {
  indent: string
  leadPipe: boolean
  trailPipe: boolean
  cells: string[]
}

/** A table line's cells, split on its | (not \|) */
function splitRow(text: string): Row {
  const indent = /^\s*/.exec(text)![0]
  let s = text.slice(indent.length).replace(/\s+$/, '')
  const leadPipe = s.startsWith('|')
  if (leadPipe) s = s.slice(1)
  const trailPipe = /(^|[^\\])\|$/.test(s)
  if (trailPipe) s = s.slice(0, -1)
  return { indent, leadPipe, trailPipe, cells: s.split(/(?<!\\)\|/) }
}

const joinRow = (r: Row) => r.indent + (r.leadPipe ? '|' : '') + r.cells.join('|') + (r.trailPipe ? '|' : '')

/** Which column a position is in */
export function columnAt(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const pipes = (before.match(/(?<!\\)\|/g) ?? []).length
  return Math.max(0, pipes - (/^\s*\|/.test(line.text) ? 1 : 0))
}

function rewrite(view: EditorView, t: TableLines, edit: (row: Row, delimiter: boolean) => void) {
  const changes = t.lines.map((line) => {
    const row = splitRow(line.text)
    edit(row, line.number === t.delimiter.number)
    return { from: line.from, to: line.to, insert: joinRow(row) }
  })
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true })
  view.focus()
}

export function insertColumn(view: EditorView, t: TableLines, at: number) {
  rewrite(view, t, (row, delimiter) => row.cells.splice(Math.min(at, row.cells.length), 0, delimiter ? ' --- ' : '  '))
}

export function deleteColumn(view: EditorView, t: TableLines, at: number) {
  if (splitRow(t.header.text).cells.length < 2) return
  rewrite(view, t, (row) => {
    if (at < row.cells.length) row.cells.splice(at, 1)
  })
}

/** An empty row after `line` (after the |---| line if that's the header) */
export function insertRow(view: EditorView, t: TableLines, line: Line, above: boolean) {
  const cells = splitRow(t.header.text).cells.length
  const row = '|' + '  |'.repeat(cells)
  let at: number
  if (above && line.number > t.delimiter.number) at = line.from
  else at = (line.number <= t.delimiter.number ? t.delimiter : line).to
  const insert = above && line.number > t.delimiter.number ? row + '\n' : '\n' + row
  const cursor = above && line.number > t.delimiter.number ? at + 2 : at + 3
  view.dispatch({ changes: { from: at, insert }, selection: EditorSelection.cursor(cursor), userEvent: 'input', scrollIntoView: true })
  view.focus()
}

export function deleteRow(view: EditorView, t: TableLines, line: Line) {
  if (line.number <= t.delimiter.number) return // not the header
  const from = line.from > 0 ? line.from - 1 : line.from
  view.dispatch({ changes: { from, to: line.to }, userEvent: 'delete', scrollIntoView: true })
  view.focus()
}

/** Row and column items for a position in a table */
export function tableMenu(view: EditorView, t: TableLines, pos: number): MenuItem[] {
  const line = view.state.doc.lineAt(pos)
  const col = columnAt(view.state, pos)
  const header = line.number <= t.delimiter.number
  const columns = splitRow(t.header.text).cells.length
  return [
    ...(header ? [] : [{ label: 'Insert row above', run: () => insertRow(view, t, line, true) }]),
    { label: 'Insert row below', run: () => insertRow(view, t, line, false) },
    ...(header ? [] : [{ label: 'Delete row', danger: true, run: () => deleteRow(view, t, line) }]),
    'separator',
    { label: 'Insert column left', run: () => insertColumn(view, t, col) },
    { label: 'Insert column right', run: () => insertColumn(view, t, col + 1) },
    { label: 'Delete column', danger: true, disabled: columns < 2, run: () => deleteColumn(view, t, col) }
  ]
}

/** Right-click in a table: its row and column items, then cut, copy and paste */
export const tableContextMenu = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (!(e.target as HTMLElement).closest('.cm-md-trow')) return false
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    const host = view.state.facet(editorHost)
    const t = pos === null ? null : tableAt(view.state, pos)
    if (pos === null || !host || !t) return false
    e.preventDefault()
    const sel = view.state.selection.main
    if (pos < sel.from || pos > sel.to) view.dispatch({ selection: { anchor: pos } })
    host.menu(e.clientX, e.clientY, [...tableMenu(view, t, pos), 'separator', ...editMenu(!view.state.selection.main.empty, true)])
    return true
  }
})
