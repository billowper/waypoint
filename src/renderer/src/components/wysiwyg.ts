import { syntaxTree } from '@codemirror/language'
import { deleteMarkupBackward } from '@codemirror/lang-markdown'
import { deleteCharBackward } from '@codemirror/commands'
import {
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  findClusterBreak,
  type Extension,
  type Line
} from '@codemirror/state'
import { EditorView, keymap, type Command, type KeyBinding } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseLinks } from '@shared/links'
import { fenceClosed, hiddenOnLine, type Hidden } from './livePreview'

// Editing around the markdown that live preview hides (livePreview.ts), so a page behaves like a
// Notion page rather than text with invisible bits in it:
// - the cursor never waits in front of a line's hidden markers, or on a code block's ``` lines
// - arrows step over hidden marks in one press
// - Backspace and Delete take out what you can see: the letter beside a hidden mark, a line's
//   marker (heading → text, task → bullet → text), a divider. Formatting left empty goes too.
// - typing on a hidden ``` or --- line starts a new line after it
// - Enter after an opening ``` closes the block; Enter at the start of a heading adds a line above
//
// formatKeymap (Ctrl+B, Ctrl+I, Ctrl+E, Ctrl+Shift+S) is apart, as it works in the markdown view too.

const SOLID = new Set(['open', 'close', 'rule'])
const isSolid = (h: Hidden) => SOLID.has(h.kind)
const isMark = (h: Hidden) => h.kind === 'inline' || h.kind === 'prefix'
const ofKind = (hidden: Hidden[], kind: Hidden['kind']) => hidden.filter((h) => h.kind === kind)

/** End of the run of hidden ranges that starts at pos (pos itself if none does) */
function runForward(hidden: Hidden[], pos: number): number {
  for (let moved = true; moved; ) {
    moved = false
    for (const h of hidden) {
      if (h.from === pos && h.to > pos) {
        pos = h.to
        moved = true
      }
    }
  }
  return pos
}

/** Start of the run of hidden ranges that ends at pos (pos itself if none does) */
function runBack(hidden: Hidden[], pos: number): number {
  for (let moved = true; moved; ) {
    moved = false
    for (const h of hidden) {
      if (h.to === pos && h.from < pos) {
        pos = h.from
        moved = true
      }
    }
  }
  return pos
}

const step = (line: Line, pos: number, forward: boolean) =>
  line.from + findClusterBreak(line.text, pos - line.from, forward)

const lineBefore = (state: EditorState, line: Line) => (line.number > 1 ? state.doc.line(line.number - 1) : null)
const lineAfter = (state: EditorState, line: Line) =>
  line.number < state.doc.lines ? state.doc.line(line.number + 1) : null
const solidOf = (state: EditorState, line: Line) => hiddenOnLine(state, line).find(isSolid)

// ---------------------------------------------------------------------------------------------
// Where the cursor may rest

/**
 * Moves a cursor off the places that would put typing in the wrong spot: in front of a line's
 * hidden markers (text typed there would break them) and onto a hidden ``` or --- line, which
 * it passes over in the direction it was going. The end of a closing ``` or a --- is allowed
 * after an edit, as the way out of a code block or divider at the end of the page.
 */
function settle(state: EditorState, head: number, before: number, moved: boolean): number {
  for (let i = 0; i < 4; i++) {
    const line = state.doc.lineAt(head)
    const hidden = hiddenOnLine(state, line)
    const solid = hidden.find(isSolid)
    if (!solid) return runForward(ofKind(hidden, 'prefix'), head)
    if (solid.kind !== 'open' && head === line.to && !moved) return head
    const up = head < before
    const prev = lineBefore(state, line)
    const next = lineAfter(state, line)
    let to: number
    if (up && prev) to = prev.to
    else if (next && (!up || solid.kind === 'open')) to = next.from
    else to = line.to
    if (to === head) return head
    head = to
  }
  return head
}

const cursorFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr
  const sel = tr.newSelection
  if (sel.ranges.length > 1 || !sel.main.empty) return tr
  const before = tr.changes.mapPos(tr.startState.selection.main.head)
  const head = settle(tr.state, sel.main.head, before, !tr.docChanged)
  return head === sel.main.head ? tr : [tr, { selection: EditorSelection.cursor(head), sequential: true }]
})

/** Typing at the end of a hidden ``` or --- line goes on a new line after it */
const solidLineInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input')) return tr
  let count = 0
  let at = -1
  let text = ''
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    if (fromA === toA) {
      at = fromA
      text = inserted.toString()
    }
  })
  if (count !== 1 || at < 0 || !text || text.startsWith('\n')) return tr
  const start = tr.startState
  const line = start.doc.lineAt(at)
  if (at !== line.to || !solidOf(start, line)) return tr
  const insert = start.lineBreak + text
  return {
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: true
  }
})

// ---------------------------------------------------------------------------------------------
// Arrows

/**
 * Left and right over hidden marks in one press, as if they weren't there. With `lineStart`
 * (Ctrl+Left) it only steps in from the start of a line's text to the line before.
 */
function arrow(forward: boolean, lineStart = false): Command {
  return (view) => {
    const { state } = view
    const sel = state.selection
    if (sel.ranges.length > 1 || !sel.main.empty) return false
    const head = sel.main.head
    const line = state.doc.lineAt(head)
    const marks = hiddenOnLine(state, line).filter(isMark)
    const edge = forward ? runForward(marks, head) : runBack(marks, head)
    if (edge === head || (lineStart && (forward || edge > line.from))) return false
    let to: number
    if (forward) to = edge < line.to ? step(line, edge, true) : line.number < state.doc.lines ? line.to + 1 : edge
    else to = edge > line.from ? step(line, edge, false) : line.number > 1 ? line.from - 1 : edge
    view.dispatch({ selection: EditorSelection.cursor(to), scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// Deleting

const INLINE = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'InlineCode', 'Link'])
const MARK_OF: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark',
  Link: 'LinkMark'
}

/** The text inside a piece of inline formatting, between its marks */
function contentOf(node: SyntaxNode): { from: number; to: number } | null {
  const marks = node.getChildren(MARK_OF[node.name])
  if (node.name === 'Link') return marks.length >= 3 && node.getChild('URL') ? { from: marks[0].to, to: marks[1].from } : null
  return marks.length >= 2 ? { from: marks[0].to, to: marks[marks.length - 1].from } : null
}

/** Widens a deletion to take whole formatting whose text it would empty, so no stray ** is left */
function widenToEmptied(state: EditorState, from: number, to: number): [number, number] {
  let f = from
  let t = to
  for (let changed = true; changed; ) {
    changed = false
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(f, 1); n; n = n.parent) {
      if (!INLINE.has(n.name) || n.from > f || n.to < t || (n.from === f && n.to === t)) continue
      const c = contentOf(n)
      if (c && c.from >= f && c.to <= t) {
        f = n.from
        t = n.to
        changed = true
      }
    }
    const line = state.doc.lineAt(f)
    for (const l of parseLinks(line.text)) {
      const lf = line.from + l.from
      const lt = line.from + l.to
      if (lf > f || lt < t || (lf === f && lt === t)) continue
      const pipe = state.doc.sliceString(lf + 2, lt - 2).indexOf('|')
      const textFrom = pipe === -1 ? lf + 2 : lf + 3 + pipe
      if (textFrom >= f && lt - 2 <= t) {
        f = lf
        t = lt
        changed = true
      }
    }
  }
  return [f, t]
}

function remove(view: EditorView, from: number, to: number, userEvent: string, cursor = from): boolean {
  if (to > from) {
    view.dispatch({
      changes: { from, to },
      selection: EditorSelection.cursor(Math.min(cursor, from)),
      userEvent,
      scrollIntoView: true
    })
  }
  return true
}

function moveTo(view: EditorView, pos: number): boolean {
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true, userEvent: 'select' })
  return true
}

/** A selection never takes half a mark, and takes formatting it empties whole */
function deleteSelection(view: EditorView, from: number, to: number): boolean {
  const { state } = view
  const doc = state.doc
  const marks = [...hiddenOnLine(state, doc.lineAt(from)), ...hiddenOnLine(state, doc.lineAt(to))].filter(
    (h) => h.kind === 'inline'
  )
  for (const h of marks) {
    if (h.from < from && from < h.to) from = h.to
    if (h.from < to && to < h.to) to = h.from
  }
  if (to <= from) return true
  const [f, t] = widenToEmptied(state, from, to)
  return remove(view, f, t, 'delete.selection')
}

const backspace: Command = (view) => {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length > 1) return false
  if (!sel.main.empty) return deleteSelection(view, sel.main.from, sel.main.to)
  const head = sel.main.head
  const line = state.doc.lineAt(head)
  const hidden = hiddenOnLine(state, line)
  const prev = lineBefore(state, line)

  // At the end of a hidden line: a divider goes; from a ``` line, into the line before
  const solid = hidden.find(isSolid)
  if (solid) {
    if (solid.kind === 'rule') {
      return prev
        ? remove(view, prev.to, line.to, 'delete.backward')
        : remove(view, line.from, Math.min(line.to + 1, state.doc.length), 'delete.backward')
    }
    return prev ? moveTo(view, prev.to) : true
  }

  const at = runBack(ofKind(hidden, 'inline'), head)
  // At the start of a line under a code block or divider: joining would break it
  if (at === line.from && prev) {
    const above = solidOf(state, prev)
    if (above) {
      if (line.length === 0) return remove(view, prev.to, line.to, 'delete.backward')
      if (above.kind === 'rule') return remove(view, prev.from, line.from, 'delete.backward', head)
      const before = lineBefore(state, prev)
      return before ? moveTo(view, before.to) : true
    }
  }
  // At the start of the line's text (perhaps behind hidden marks): the line's marker goes, or
  // the line joins the one before
  const marker = hidden.find((h) => h.kind === 'prefix' && h.to === at)
  if (marker) {
    // A task becomes a bullet, a bullet becomes text
    const name = syntaxTree(state).resolveInner(marker.from, 1).name
    if (name === 'TaskMarker' || name === 'ListMark') return remove(view, marker.from, at, 'delete.backward')
  }
  if (marker || at === line.from) {
    if (at === head) return false // the markdown and default keys handle it
    moveTo(view, at)
    return deleteMarkupBackward(view) || deleteCharBackward(view)
  }
  // Otherwise the letter before, and the formatting around it if that empties it
  const c = step(line, at, false)
  const [f, t] = widenToEmptied(state, c, at)
  if (at === head && f === c && t === at) return false
  return remove(view, f, t, 'delete.backward')
}

const deleteForward: Command = (view) => {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length > 1) return false
  if (!sel.main.empty) return deleteSelection(view, sel.main.from, sel.main.to)
  const head = sel.main.head
  const line = state.doc.lineAt(head)
  const hidden = hiddenOnLine(state, line)
  const next = lineAfter(state, line)

  // After a hidden ``` or --- line: only an empty line below can go
  if (hidden.some(isSolid)) {
    return next && next.length === 0 ? remove(view, line.to, next.to, 'delete.forward', head) : true
  }

  const at = runForward(ofKind(hidden, 'inline'), head)
  if (at < line.to) {
    const c = step(line, at, true)
    const [f, t] = widenToEmptied(state, at, c)
    if (at === head && f === at && t === c) return false
    return remove(view, f, t, 'delete.forward', head)
  }

  // At the end of the line: pull the next line's text up, without its markers
  if (!next) return at !== head
  const below = hiddenOnLine(state, next)
  const solid = below.find(isSolid)
  if (solid) return solid.kind === 'rule' ? remove(view, line.to, next.to, 'delete.forward', head) : true
  const textStart = next.from + /^\s*/.exec(next.text)![0].length
  const end = runForward(ofKind(below, 'prefix'), textStart)
  if (end === textStart) return at === head ? false : remove(view, line.to, next.from, 'delete.forward', head)
  return remove(view, line.to, end, 'delete.forward', head)
}

// ---------------------------------------------------------------------------------------------
// Enter

function fenceAt(state: EditorState, line: Line): SyntaxNode | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); n; n = n.parent) {
    if (n.name === 'FencedCode') return n
  }
  return null
}

const enter: Command = (view) => {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length > 1 || !sel.main.empty) return false
  const head = sel.main.head
  const line = state.doc.lineAt(head)

  // After an opening ```: close the block, so the rest of the page doesn't turn into code
  const fence = /^(\s*)(`{3,}|~{3,})[^`]*$/.exec(line.text)
  if (fence && head === line.to) {
    const node = fenceAt(state, line)
    if (node && state.doc.lineAt(node.from).number === line.number && !fenceClosed(node, state.doc)) {
      const indent = fence[1]
      view.dispatch({
        changes: { from: head, insert: `\n${indent}\n${indent}${fence[2]}` },
        selection: EditorSelection.cursor(head + 1 + indent.length),
        userEvent: 'input',
        scrollIntoView: true
      })
      return true
    }
  }

  // At the start of a heading's text: a new line above, rather than splitting the # off
  if (head < line.to) {
    const lead = hiddenOnLine(state, line).find((h) => h.kind === 'prefix' && h.to === head)
    if (lead && syntaxTree(state).resolveInner(lead.from, 1).name === 'HeaderMark') {
      view.dispatch({
        changes: { from: line.from, insert: state.lineBreak },
        selection: EditorSelection.cursor(head + 1),
        userEvent: 'input',
        scrollIntoView: true
      })
      return true
    }
  }
  return false
}

/** Ahead of the markdown keys (lists, quotes) and the defaults */
export const wysiwyg: Extension = [
  cursorFilter,
  solidLineInput,
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: backspace },
      { key: 'Delete', run: deleteForward },
      { key: 'Enter', run: enter },
      { key: 'ArrowLeft', run: arrow(false) },
      { key: 'ArrowRight', run: arrow(true) },
      { key: 'Mod-ArrowLeft', run: arrow(false, true) }
    ])
  )
]

// ---------------------------------------------------------------------------------------------
// Formatting keys

/** Takes the formatting off if the selection is in it, otherwise wraps the selection in `mark` */
function toggleFormat(mark: string, node: string): Command {
  return (view) => {
    const { state } = view
    const sel = state.selection.main
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(sel.from, 1); n; n = n.parent) {
      if (n.name !== node || n.to < sel.to) continue
      const marks = n.getChildren(MARK_OF[node])
      if (marks.length < 2) break
      const open = marks[0]
      const close = marks[marks.length - 1]
      view.dispatch({
        changes: [
          { from: open.from, to: open.to },
          { from: close.from, to: close.to }
        ],
        userEvent: 'input.format'
      })
      return true
    }
    if (sel.empty) {
      view.dispatch({
        changes: { from: sel.from, insert: mark + mark },
        selection: EditorSelection.cursor(sel.from + mark.length),
        userEvent: 'input.format'
      })
      return true
    }
    // Markdown formatting can't start or end with a space
    const text = state.sliceDoc(sel.from, sel.to)
    const from = sel.from + (text.length - text.trimStart().length)
    const to = sel.to - (text.length - text.trimEnd().length)
    if (to <= from) return true
    view.dispatch({
      changes: [
        { from, insert: mark },
        { from: to, insert: mark }
      ],
      selection: EditorSelection.range(from + mark.length, to + mark.length),
      userEvent: 'input.format'
    })
    return true
  }
}

/** Goes ahead of the default keys, which use Ctrl+I to select the enclosing syntax */
export const formatKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleFormat('**', 'StrongEmphasis'), preventDefault: true },
  { key: 'Mod-i', run: toggleFormat('*', 'Emphasis'), preventDefault: true },
  { key: 'Mod-e', run: toggleFormat('`', 'InlineCode'), preventDefault: true },
  { key: 'Mod-Shift-s', run: toggleFormat('~~', 'Strikethrough'), preventDefault: true }
]
