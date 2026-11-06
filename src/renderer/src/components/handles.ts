import { syntaxTree } from '@codemirror/language'
import { ChangeSet, EditorSelection, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MenuItem } from '../store'
import { LINE_KINDS, turnInto, turnIntoCode } from './blocks'
import { editorHost } from './host'
import { insertColumn, insertRow, tableAt } from './tableOps'

// Notion-style block handles: hovering a block shows a ⋮⋮ grip to its left. Drag it to move the
// block; click it for Turn into, Duplicate, Move up/down and Delete. A block is a paragraph,
// heading, code block, table, quote or divider, or a list item at any depth (with what's nested
// in it). A dragged list item can go before any other item or after a list's last one, at that
// item's depth (where several places line up, the mouse's left-right position picks the level).
// Moving keeps markdown's blank lines, so paragraphs don't run together, and renumbers the
// numbered lists it touches.

export interface Block {
  from: number
  to: number
  name: string
  /** For a list item, the kind of list it's in: items of the same kind sit on adjacent lines */
  list?: string
  /** 0 for the page's own blocks; 1 and up for items in nested lists */
  depth: number
  /** Spaces before a list item's marker */
  indent: number
  /** Whether it's the last item of its list */
  last?: boolean
}

function blockOf(state: EditorState, node: SyntaxNode, depth: number, list?: string): Block {
  const doc = state.doc
  const end = node.to > node.from && doc.sliceString(node.to - 1, node.to) === '\n' ? node.to - 1 : node.to
  const line = doc.lineAt(node.from)
  let last: boolean | undefined
  if (node.name === 'ListItem') {
    last = true
    for (let s = node.nextSibling; s; s = s.nextSibling) if (s.name === 'ListItem') last = false
  }
  return {
    from: line.from,
    to: doc.lineAt(end).to,
    name: node.name,
    list,
    depth,
    indent: /^\s*/.exec(line.text)![0].length,
    last
  }
}

/** The page's own blocks, in order (a top-level list's items count one each) */
export function blocksOf(state: EditorState): Block[] {
  const out: Block[] = []
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name === 'BulletList' || n.name === 'OrderedList') {
      for (let item = n.firstChild; item; item = item.nextSibling) {
        if (item.name === 'ListItem') out.push(blockOf(state, item, 0, n.name))
      }
    } else if (n.name !== 'Frontmatter' && n.name !== 'LinkReference') {
      out.push(blockOf(state, n, 0))
    }
  }
  return out
}

/** Every list item, at every depth, in order */
export function listItems(state: EditorState): Block[] {
  const out: Block[] = []
  const walk = (node: SyntaxNode, depth: number) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === 'BulletList' || c.name === 'OrderedList') {
        for (let item = c.firstChild; item; item = item.nextSibling) {
          if (item.name !== 'ListItem') continue
          out.push(blockOf(state, item, depth, c.name))
          walk(item, depth + 1)
        }
      } else if (c.name === 'Blockquote') {
        continue // lists in quotes keep their > on every line: not moved by handles
      }
    }
  }
  walk(syntaxTree(state).topNode, 0)
  return out
}

/** The block a position is in: the innermost list item, or the page's block */
export function blockAt(state: EditorState, pos: number): Block | null {
  let best: Block | null = null
  for (const item of listItems(state)) {
    if (pos >= item.from && pos <= item.to && (!best || item.depth >= best.depth)) best = item
  }
  return best ?? blocksOf(state).find((b) => pos >= b.from && pos <= b.to) ?? null
}

/** List items of the same kind of list stay on adjacent lines; anything else gets a blank line between */
const together = (a: Block, b: Block) => !!a.list && a.list === b.list
const gapText = (a: Block, b: Block) => (together(a, b) ? '\n' : '\n\n')

/** Shifts every line of a block's text left or right */
function reindent(text: string, by: number): string {
  if (!by) return text
  return text
    .split('\n')
    .map((line) => (by > 0 ? (line ? ' '.repeat(by) + line : line) : line.replace(new RegExp(`^ {0,${-by}}`), '')))
    .join('\n')
}

/** Takes a page block out with one of the gaps beside it; the wider gap stays */
function removal(state: EditorState, tops: Block[], i: number) {
  const b = tops[i]
  const prev = i > 0 ? tops[i - 1] : null
  const next = i < tops.length - 1 ? tops[i + 1] : null
  if (prev && next) {
    const before = state.sliceDoc(prev.to, b.from)
    const after = state.sliceDoc(b.to, next.from)
    return after.includes('\n\n') && !before.includes('\n\n') ? { from: prev.to, to: b.to } : { from: b.from, to: next.from }
  }
  if (next) return { from: b.from, to: next.from }
  if (prev) return { from: prev.to, to: b.to }
  return { from: b.from, to: b.to }
}

/** Takes any block out: page blocks with their gap, nested items as whole lines */
function removalOf(state: EditorState, x: Block) {
  const tops = blocksOf(state)
  const i = x.depth === 0 ? tops.findIndex((b) => b.from === x.from && b.to === x.to) : -1
  if (i >= 0) return removal(state, tops, i)
  if (x.to < state.doc.length) return { from: x.from, to: x.to + 1 }
  return { from: Math.max(0, x.from - 1), to: x.to }
}

/** Where a dragged block can go */
export type Gap =
  | { kind: 'top'; index: number } // before the page's block `index` (or at the end)
  | { kind: 'before'; item: Block } // before a list item, at its depth
  | { kind: 'after'; item: Block } // after a list's last item, at its depth

/** The numbered lists around a position */
function numberedListsAt(state: EditorState, pos: number): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(Math.min(pos, state.doc.length), side); n; n = n.parent) {
      if (n.name === 'OrderedList' && !out.some((o) => o.from === n!.from)) out.push(n)
    }
  }
  return out
}

/** A numbered list's items' marks */
function marksOf(state: EditorState, list: SyntaxNode) {
  const marks: { from: number; to: number; n: number; delim: string }[] = []
  for (let item = list.firstChild; item; item = item.nextSibling) {
    const mark = item.name === 'ListItem' ? item.getChild('ListMark') : null
    if (!mark) continue
    const m = /^(\d+)([.)])$/.exec(state.sliceDoc(mark.from, mark.to))
    if (m) marks.push({ from: mark.from, to: mark.to, n: Number(m[1]), delim: m[2] })
  }
  return marks
}

/**
 * Numbers the numbered lists around each position 1, 2, 3… onwards from the number the list
 * started at before the edit (`start`), or from its lowest number.
 */
function renumber(state: EditorState, spots: { pos: number; start: number | null }[]): ChangeSpec[] {
  const lists = new Map<number, { list: SyntaxNode; start: number | null }>()
  for (const { pos, start } of spots) {
    for (const list of numberedListsAt(state, pos)) {
      const seen = lists.get(list.from)
      if (!seen || seen.start === null) lists.set(list.from, { list, start })
    }
  }
  const changes: ChangeSpec[] = []
  for (const { list, start } of lists.values()) {
    const marks = marksOf(state, list)
    const from = start ?? Math.min(...marks.map((m) => m.n))
    marks.forEach((m, i) => {
      if (m.n !== from + i) changes.push({ from: m.from, to: m.to, insert: `${from + i}${m.delim}` })
    })
  }
  return changes
}

/**
 * Applies a block edit, renumbering in the same step the numbered lists at `touched` (positions
 * before the edit; `now` says where each is after it)
 */
function applyEdit(
  view: EditorView,
  spec: ChangeSpec[],
  cursor: (changes: ChangeSet) => number,
  touched: { was: number; now: (changes: ChangeSet) => number }[],
  userEvent: string
) {
  const { state } = view
  const first = state.changes(spec)
  const mid = state.update({ changes: first }).state
  const spots = touched.map(({ was, now }) => {
    const list = numberedListsAt(state, was)[0]
    const marks = list ? marksOf(state, list) : []
    return { pos: now(first), start: marks.length ? marks[0].n : null }
  })
  const fixes = mid.changes(renumber(mid, spots))
  const changes = first.compose(fixes)
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(fixes.mapPos(cursor(first))),
    userEvent,
    scrollIntoView: true
  })
  view.focus()
}

/** Moves block `x` to a gap */
export function moveTo(view: EditorView, x: Block, gap: Gap): void {
  const { state } = view
  const rem = removalOf(state, x)
  let text = state.sliceDoc(x.from, x.to)
  let at: number
  let lead = ''
  let insert: string
  if (gap.kind === 'top') {
    const tops = blocksOf(state)
    const asTop: Block = { ...x, depth: 0, indent: 0 }
    text = reindent(text, -x.indent)
    if (gap.index < tops.length) {
      const t = tops[gap.index]
      const p = gap.index > 0 ? tops[gap.index - 1] : null
      // If the block before is followed by just a line break, x needs a blank line of its own
      const pIsX = p && p.from === x.from && p.to === x.to
      if (p && !pIsX && !state.sliceDoc(p.to, t.from).includes('\n\n') && !together(p, asTop)) lead = '\n'
      at = t.from
      insert = lead + text + gapText(asTop, t)
    } else {
      const last = tops[tops.length - 1]
      at = last.to
      lead = gapText(last, asTop)
      insert = lead + text
    }
  } else if (gap.kind === 'before') {
    at = gap.item.from
    insert = reindent(text, gap.item.indent - x.indent) + '\n'
  } else {
    at = gap.item.to
    lead = '\n'
    insert = lead + reindent(text, gap.item.indent - x.indent)
  }
  if (at > rem.from && at < rem.to) return // into itself
  applyEdit(
    view,
    [rem, { from: at, insert }],
    (c) => c.mapPos(at, -1) + lead.length,
    [
      { was: x.from + x.indent, now: (c) => c.mapPos(rem.from, -1) },
      { was: at, now: (c) => c.mapPos(at, -1) + lead.length }
    ],
    'move.block'
  )
}

function duplicate(view: EditorView, b: Block) {
  const text = view.state.sliceDoc(b.from, b.to)
  const lead = b.depth > 0 ? '\n' : gapText(b, b)
  applyEdit(view, [{ from: b.to, insert: lead + text }], () => b.to + lead.length, [{ was: b.from + b.indent, now: () => b.to + lead.length }], 'input')
}

function remove(view: EditorView, b: Block) {
  const rem = removalOf(view.state, b)
  applyEdit(view, [rem], (c) => c.mapPos(rem.from), [{ was: b.from + b.indent, now: (c) => c.mapPos(rem.from) }], 'delete')
}

/** The list item before or after an item, in the same list */
function sibling(state: EditorState, b: Block, forward: boolean): Block | null {
  const items = listItems(state)
  const same = items.filter((i) => i.depth === b.depth && i.list === b.list)
  const parentOf = (i: Block) => items.filter((p) => p.depth === i.depth - 1 && p.from < i.from && p.to >= i.to).pop()?.from ?? -1
  const mine = parentOf(b)
  const siblings = same.filter((i) => parentOf(i) === mine)
  const k = siblings.findIndex((i) => i.from === b.from)
  return siblings[k + (forward ? 1 : -1)] ?? null
}

const TEXTUAL = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'ListItem', 'Blockquote'])

function blockMenu(view: EditorView, b: Block): MenuItem[] {
  const { state } = view
  const lines = () => {
    const out = []
    for (let n = view.state.doc.lineAt(b.from).number; n <= view.state.doc.lineAt(b.to).number; n++) out.push(view.state.doc.line(n))
    return out
  }
  const items: MenuItem[] = []
  if (TEXTUAL.has(b.name)) {
    const own = b.name === 'ListItem' ? () => [view.state.doc.lineAt(b.from)] : lines
    for (const { kind, label } of LINE_KINDS) items.push({ label: `Turn into ${label.toLowerCase()}`, run: () => turnInto(view, kind, own()) })
    if (b.name === 'Paragraph') items.push({ label: 'Turn into code block', run: () => turnIntoCode(view, lines()) })
    items.push('separator')
  }
  const table = b.name === 'Table' ? tableAt(state, b.from) : null
  if (table) {
    items.push({ label: 'Add row', run: () => insertRow(view, table, table.lines[table.lines.length - 1], false) })
    items.push({ label: 'Add column', run: () => insertColumn(view, table, Number.MAX_SAFE_INTEGER) })
    items.push('separator')
  }
  // Up and down: among the page's blocks, or a nested item among its siblings
  let up: Gap | null = null
  let down: Gap | null = null
  if (b.depth === 0) {
    const tops = blocksOf(state)
    const i = tops.findIndex((t) => t.from === b.from)
    if (i > 0) up = { kind: 'top', index: i - 1 }
    if (i >= 0 && i < tops.length - 1) down = { kind: 'top', index: i + 2 }
  } else {
    const prev = sibling(state, b, false)
    const next = sibling(state, b, true)
    if (prev) up = { kind: 'before', item: prev }
    if (next) {
      const after = sibling(state, next, true)
      down = after ? { kind: 'before', item: after } : { kind: 'after', item: next }
    }
  }
  items.push(
    { label: 'Duplicate', run: () => duplicate(view, b) },
    { label: 'Move up', disabled: !up, run: () => up && moveTo(view, b, up) },
    { label: 'Move down', disabled: !down, run: () => down && moveTo(view, b, down) },
    'separator',
    { label: 'Delete', danger: true, run: () => remove(view, b) }
  )
  return items
}

interface PlacedGap {
  gap: Gap
  /** Viewport position of the line drawn for it */
  y: number
  x: number
}

class Handles {
  handle: HTMLElement
  drop: HTMLElement
  current: Block | null = null
  drag: { startY: number; moved: boolean; gaps: PlacedGap[]; target: PlacedGap | null } | null = null

  constructor(readonly view: EditorView) {
    this.handle = document.createElement('div')
    this.handle.className = 'cm-block-handle'
    this.handle.textContent = '⋮⋮'
    this.handle.title = 'Drag to move · click for more'
    this.handle.hidden = true
    this.drop = document.createElement('div')
    this.drop.className = 'cm-block-drop'
    this.drop.hidden = true
    view.scrollDOM.append(this.handle, this.drop)
    view.scrollDOM.addEventListener('mousemove', this.onMove)
    view.scrollDOM.addEventListener('mouseleave', this.onLeave)
    this.handle.addEventListener('pointerdown', this.onDown)
  }

  update(u: ViewUpdate) {
    // Anything that moves the text (edits, fonts or pictures loading, resizing) leaves the grip behind
    if ((u.docChanged || u.geometryChanged) && !this.drag) this.hide()
  }

  destroy() {
    this.view.scrollDOM.removeEventListener('mousemove', this.onMove)
    this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave)
    this.handle.remove()
    this.drop.remove()
  }

  hide() {
    this.handle.hidden = true
    this.current = null
  }

  /** Scroller coordinates (what absolute positions inside it use) for viewport ones */
  private toScroller(x: number, y: number) {
    const r = this.view.scrollDOM.getBoundingClientRect()
    return { x: x - r.left + this.view.scrollDOM.scrollLeft, y: y - r.top + this.view.scrollDOM.scrollTop }
  }

  /** Where the page's text starts, in viewport x */
  private textLeft() {
    const content = this.view.contentDOM.getBoundingClientRect()
    return content.left + (parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0)
  }

  private onMove = (e: MouseEvent) => {
    if (this.drag || e.target === this.handle) return
    const view = this.view
    const line = view.lineBlockAtHeight(e.clientY - view.documentTop)
    const b = blockAt(view.state, line.from)
    if (!b) return this.hide()
    if (this.current && b.from === this.current.from && b.to === this.current.to && !this.handle.hidden) return
    this.current = b
    const textAt = b.from + b.indent
    const first = view.coordsAtPos(textAt, 1) ?? view.coordsAtPos(textAt, -1)
    if (!first) return this.hide()
    const lineHeight = Math.min(first.bottom - first.top, 40)
    const left = b.depth > 0 ? first.left : this.textLeft()
    const p = this.toScroller(left - 26, first.top + (lineHeight - 22) / 2)
    this.handle.style.top = `${p.y}px`
    this.handle.style.left = `${p.x}px`
    this.handle.hidden = false
  }

  private onLeave = () => {
    if (!this.drag) this.hide()
  }

  /** Every place block `x` could be dropped, with where to draw it */
  private gapsFor(x: Block): PlacedGap[] {
    const view = this.view
    const state = view.state
    const out: PlacedGap[] = []
    const inX = (pos: number) => pos >= x.from && pos <= x.to
    const top = (pos: number) => view.coordsAtPos(pos, 1)?.top ?? null
    const bottom = (pos: number) => view.coordsAtPos(pos, -1)?.bottom ?? null
    const itemX = (b: Block) => view.coordsAtPos(b.from + b.indent, 1)?.left ?? this.textLeft()
    const taken = new Set<number>()
    if (x.name === 'ListItem') {
      for (const item of listItems(state)) {
        if (inX(item.from)) continue
        const y = top(item.from)
        // Just below x at x's own depth is where it already is
        if (y !== null && !(item.from === x.to + 1 && item.indent === x.indent)) {
          out.push({ gap: { kind: 'before', item }, y: y - 2, x: itemX(item) })
          taken.add(item.from)
        }
        if (item.last && !(item.from === x.from)) {
          const yb = bottom(item.to)
          // Straight above x at x's own depth is where it already is
          if (yb !== null && !inX(item.to) && !(item.to + 1 === x.from && item.indent === x.indent)) out.push({ gap: { kind: 'after', item }, y: yb + 2, x: itemX(item) })
        }
      }
    }
    const tops = blocksOf(state)
    const xi = x.depth === 0 ? tops.findIndex((b) => b.from === x.from && b.to === x.to) : -1
    for (let i = 0; i <= tops.length; i++) {
      if (xi >= 0 && (i === xi || i === xi + 1)) continue
      const pos = i < tops.length ? tops[i].from : tops[tops.length - 1].to
      if (i < tops.length && taken.has(pos)) continue
      if (i < tops.length && inX(pos)) continue
      const y = i < tops.length ? top(pos) : bottom(pos)
      if (y !== null) out.push({ gap: { kind: 'top', index: i }, y: i < tops.length ? y - 2 : y + 2, x: this.textLeft() })
    }
    return out
  }

  /** The nearest gap up and down; among gaps at about the same height, the nearest left to right */
  private pick(gaps: PlacedGap[], x: number, y: number): PlacedGap | null {
    if (!gaps.length) return null
    const nearest = Math.min(...gaps.map((g) => Math.abs(g.y - y)))
    const level = gaps.filter((g) => Math.abs(g.y - y) - nearest < 6)
    return level.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a))
  }

  private showDrop(g: PlacedGap) {
    const content = this.view.contentDOM.getBoundingClientRect()
    const pad = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0
    const right = content.right - pad
    const p = this.toScroller(g.x, g.y - 1)
    this.drop.style.top = `${p.y}px`
    this.drop.style.left = `${p.x}px`
    this.drop.style.width = `${Math.max(40, right - g.x)}px`
    this.drop.hidden = false
  }

  private onDown = (e: PointerEvent) => {
    const x = this.current
    if (e.button !== 0 || !x) return
    e.preventDefault()
    this.handle.setPointerCapture(e.pointerId)
    this.drag = { startY: e.clientY, moved: false, gaps: [], target: null }
    const move = (ev: PointerEvent) => {
      const drag = this.drag
      if (!drag) return
      if (!drag.moved && Math.abs(ev.clientY - drag.startY) < 4) return
      if (!drag.moved) drag.gaps = this.gapsFor(x)
      drag.moved = true
      this.handle.classList.add('dragging')
      drag.target = this.pick(drag.gaps, ev.clientX, ev.clientY)
      if (drag.target) this.showDrop(drag.target)
    }
    const up = () => {
      this.handle.removeEventListener('pointermove', move)
      this.handle.removeEventListener('pointerup', up)
      this.handle.removeEventListener('pointercancel', up)
      this.handle.classList.remove('dragging')
      this.drop.hidden = true
      const drag = this.drag
      this.drag = null
      if (!drag) return
      if (drag.moved) {
        if (drag.target) moveTo(this.view, x, drag.target.gap)
        this.hide()
      } else {
        const r = this.handle.getBoundingClientRect()
        this.view.state.facet(editorHost)?.menu(r.left, r.bottom + 4, blockMenu(this.view, x))
      }
    }
    this.handle.addEventListener('pointermove', move)
    this.handle.addEventListener('pointerup', up)
    this.handle.addEventListener('pointercancel', up)
  }
}

export const blockHandles: Extension = ViewPlugin.fromClass(Handles)
