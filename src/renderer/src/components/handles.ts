import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MenuItem } from '../store'
import { LINE_KINDS, turnInto, turnIntoCode } from './blocks'
import { editorHost } from './host'
import { insertColumn, insertRow, tableAt } from './tableOps'

// Notion-style block handles: hovering a block shows a ⋮⋮ grip to its left. Drag it to move the
// block; click it for Turn into, Duplicate, Move up/down and Delete. A block is a paragraph,
// heading, code block, table, quote, divider, or one item of a list (with what's nested in it).
// Moving keeps markdown's blank lines, so paragraphs don't run together.

export interface Block {
  from: number
  to: number
  name: string
  /** For a list item, the kind of list it's in: items of the same kind sit on adjacent lines */
  list?: string
}

function blockOf(state: EditorState, node: SyntaxNode, list?: string): Block {
  const doc = state.doc
  const end = node.to > node.from && doc.sliceString(node.to - 1, node.to) === '\n' ? node.to - 1 : node.to
  return { from: doc.lineAt(node.from).from, to: doc.lineAt(end).to, name: node.name, list }
}

/** The page's blocks, in order */
export function blocksOf(state: EditorState): Block[] {
  const out: Block[] = []
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name === 'BulletList' || n.name === 'OrderedList') {
      for (let item = n.firstChild; item; item = item.nextSibling) {
        if (item.name === 'ListItem') out.push(blockOf(state, item, n.name))
      }
    } else if (n.name !== 'Frontmatter' && n.name !== 'LinkReference') {
      out.push(blockOf(state, n))
    }
  }
  return out
}

/** List items of the same kind of list stay on adjacent lines; anything else gets a blank line between */
const together = (a: Block, b: Block) => !!a.list && a.list === b.list
const gap = (a: Block, b: Block) => (together(a, b) ? '\n' : '\n\n')

/**
 * The change that takes block `i` out with one of the gaps beside it. The wider gap stays, so the
 * last item of a list leaves the blank line between the list and what follows.
 */
function removal(state: EditorState, blocks: Block[], i: number) {
  const b = blocks[i]
  const prev = i > 0 ? blocks[i - 1] : null
  const next = i < blocks.length - 1 ? blocks[i + 1] : null
  if (prev && next) {
    const before = state.sliceDoc(prev.to, b.from)
    const after = state.sliceDoc(b.to, next.from)
    return after.includes('\n\n') && !before.includes('\n\n') ? { from: prev.to, to: b.to } : { from: b.from, to: next.from }
  }
  if (next) return { from: b.from, to: next.from }
  if (prev) return { from: prev.to, to: b.to }
  return { from: b.from, to: b.to }
}

/** Moves block `i` to before block `before` (blocks.length: to the end) */
export function moveBlock(view: EditorView, blocks: Block[], i: number, before: number): void {
  if (before === i || before === i + 1 || i < 0 || i >= blocks.length) return
  const { state } = view
  const x = blocks[i]
  const text = state.sliceDoc(x.from, x.to)
  let at: number
  let lead = ''
  let insert: string
  if (before < blocks.length) {
    const t = blocks[before]
    const p = before > 0 ? blocks[before - 1] : null
    // If the block before is followed by just a line break, x needs a blank line of its own
    if (p && p !== x && !state.sliceDoc(p.to, t.from).includes('\n\n') && !together(p, x)) lead = '\n'
    at = t.from
    insert = lead + text + gap(x, t)
  } else {
    const last = blocks[blocks.length - 1]
    at = last.to
    lead = gap(last, x)
    insert = lead + text
  }
  const changes = state.changes([removal(state, blocks, i), { from: at, insert }])
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(changes.mapPos(at, -1) + lead.length),
    userEvent: 'move.block',
    scrollIntoView: true
  })
  view.focus()
}

function duplicate(view: EditorView, b: Block) {
  const text = view.state.sliceDoc(b.from, b.to)
  const insert = gap(b, b) + text
  view.dispatch({
    changes: { from: b.to, insert },
    selection: EditorSelection.cursor(b.to + gap(b, b).length),
    userEvent: 'input',
    scrollIntoView: true
  })
  view.focus()
}

function remove(view: EditorView, blocks: Block[], i: number) {
  view.dispatch({ changes: removal(view.state, blocks, i), userEvent: 'delete', scrollIntoView: true })
  view.focus()
}

const TEXTUAL = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'ListItem', 'Blockquote'])

function blockMenu(view: EditorView, blocks: Block[], i: number): MenuItem[] {
  const b = blocks[i]
  const lines = () => {
    const out = []
    for (let n = view.state.doc.lineAt(b.from).number; n <= view.state.doc.lineAt(b.to).number; n++) out.push(view.state.doc.line(n))
    return out
  }
  const items: MenuItem[] = []
  if (TEXTUAL.has(b.name)) {
    for (const { kind, label } of LINE_KINDS) items.push({ label: `Turn into ${label.toLowerCase()}`, run: () => turnInto(view, kind, lines()) })
    if (b.name === 'Paragraph') items.push({ label: 'Turn into code block', run: () => turnIntoCode(view, lines()) })
    items.push('separator')
  }
  const table = b.name === 'Table' ? tableAt(view.state, b.from) : null
  if (table) {
    items.push({ label: 'Add row', run: () => insertRow(view, table, table.lines[table.lines.length - 1], false) })
    items.push({ label: 'Add column', run: () => insertColumn(view, table, Number.MAX_SAFE_INTEGER) })
    items.push('separator')
  }
  items.push(
    { label: 'Duplicate', run: () => duplicate(view, b) },
    { label: 'Move up', disabled: i === 0, run: () => moveBlock(view, blocks, i, i - 1) },
    { label: 'Move down', disabled: i === blocks.length - 1, run: () => moveBlock(view, blocks, i, i + 2) },
    'separator',
    { label: 'Delete', danger: true, run: () => remove(view, blocks, i) }
  )
  return items
}

class Handles {
  handle: HTMLElement
  drop: HTMLElement
  blocks: Block[] = []
  current = -1
  drag: { startY: number; moved: boolean; target: number } | null = null

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
    this.current = -1
  }

  /** Scroller coordinates (what absolute positions inside it use) for a viewport y */
  private scrollY(y: number) {
    return y - this.view.scrollDOM.getBoundingClientRect().top + this.view.scrollDOM.scrollTop
  }

  private blockAtY(y: number): number {
    const view = this.view
    const line = view.lineBlockAtHeight(y - view.documentTop)
    const pos = line.from
    this.blocks = blocksOf(view.state)
    return this.blocks.findIndex((b) => pos >= b.from && pos <= b.to)
  }

  private onMove = (e: MouseEvent) => {
    if (this.drag || e.target === this.handle) return
    const i = this.blockAtY(e.clientY)
    if (i === -1) return this.hide()
    if (i === this.current && !this.handle.hidden) return
    this.current = i
    const view = this.view
    const b = this.blocks[i]
    const first = view.coordsAtPos(b.from, 1) ?? view.coordsAtPos(b.from, -1)
    if (!first) return this.hide()
    const content = view.contentDOM.getBoundingClientRect()
    const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0
    const scroller = view.scrollDOM.getBoundingClientRect()
    const lineHeight = Math.min(first.bottom - first.top, 40)
    this.handle.style.top = `${this.scrollY(first.top) + (lineHeight - 22) / 2}px`
    this.handle.style.left = `${content.left - scroller.left + view.scrollDOM.scrollLeft + padLeft - 26}px`
    this.handle.hidden = false
  }

  private onLeave = () => {
    if (!this.drag) this.hide()
  }

  /** Before which block a drop at viewport y goes */
  private targetAt(y: number): number {
    const view = this.view
    for (let i = 0; i < this.blocks.length; i++) {
      const top = view.coordsAtPos(this.blocks[i].from, 1)
      const bottom = view.coordsAtPos(this.blocks[i].to, -1)
      if (!top || !bottom) continue
      if (y < (top.top + bottom.bottom) / 2) return i
    }
    return this.blocks.length
  }

  private showDrop(target: number) {
    const view = this.view
    const b = this.blocks[Math.min(target, this.blocks.length - 1)]
    const coords = target < this.blocks.length ? view.coordsAtPos(b.from, 1) : view.coordsAtPos(b.to, -1)
    if (!coords) return
    const content = view.contentDOM.getBoundingClientRect()
    const pad = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0
    const scroller = view.scrollDOM.getBoundingClientRect()
    const y = target < this.blocks.length ? coords.top - 3 : coords.bottom + 2
    this.drop.style.top = `${this.scrollY(y)}px`
    this.drop.style.left = `${content.left - scroller.left + pad}px`
    this.drop.style.width = `${content.width - pad * 2}px`
    this.drop.hidden = false
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.current === -1) return
    e.preventDefault()
    this.handle.setPointerCapture(e.pointerId)
    this.drag = { startY: e.clientY, moved: false, target: this.current }
    const move = (ev: PointerEvent) => {
      if (!this.drag) return
      if (!this.drag.moved && Math.abs(ev.clientY - this.drag.startY) < 4) return
      this.drag.moved = true
      this.handle.classList.add('dragging')
      this.drag.target = this.targetAt(ev.clientY)
      this.showDrop(this.drag.target)
    }
    const up = () => {
      this.handle.removeEventListener('pointermove', move)
      this.handle.removeEventListener('pointerup', up)
      this.handle.removeEventListener('pointercancel', up)
      this.handle.classList.remove('dragging')
      this.drop.hidden = true
      const drag = this.drag
      this.drag = null
      const i = this.current
      if (!drag || i === -1) return
      if (drag.moved) {
        moveBlock(this.view, this.blocks, i, drag.target)
        this.hide()
      } else {
        const r = this.handle.getBoundingClientRect()
        this.view.state.facet(editorHost)?.menu(r.left, r.bottom + 4, blockMenu(this.view, this.blocks, i))
      }
    }
    this.handle.addEventListener('pointermove', move)
    this.handle.addEventListener('pointerup', up)
    this.handle.addEventListener('pointercancel', up)
  }
}

export const blockHandles: Extension = ViewPlugin.fromClass(Handles)
