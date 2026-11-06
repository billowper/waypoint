import { startCompletion } from '@codemirror/autocomplete'
import { EditorSelection, type EditorState, type Line } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { editorHost } from './host'

// Notion-style blocks on top of markdown lines: turning lines into another kind of block (the
// toolbar's and block menu's "Turn into") and inserting new ones (the slash menu). Everything
// here writes the markdown you'd type yourself.

export type LineKind = 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'callout'

export const LINE_KINDS: { kind: LineKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'h1', label: 'Heading 1' },
  { kind: 'h2', label: 'Heading 2' },
  { kind: 'h3', label: 'Heading 3' },
  { kind: 'bullet', label: 'Bulleted list' },
  { kind: 'numbered', label: 'Numbered list' },
  { kind: 'todo', label: 'To-do list' },
  { kind: 'quote', label: 'Quote' },
  { kind: 'callout', label: 'Callout' }
]

const PREFIX: Record<LineKind, string> = {
  text: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  bullet: '- ',
  numbered: '1. ',
  todo: '- [ ] ',
  quote: '> ',
  callout: '> [!note] '
}

/** A line's markers: heading #s, quote >s and callout tags, list and task markers */
const MARKERS = /^(?:#{1,6}(?:\s+|$)|>\s?(?:\[![\w-]+\][+-]?\s?)?|[-*+]\s+\[[ xX]\]\s+|[-*+](?:\s+|$)|\d+[.)](?:\s+|$))/

/** Splits a line into its indentation, its markers and its text */
export function splitLine(text: string): { indent: string; markers: string; rest: string } {
  const indent = /^\s*/.exec(text)![0]
  let rest = text.slice(indent.length)
  let markers = ''
  for (let m = MARKERS.exec(rest); m && m[0]; m = MARKERS.exec(rest)) {
    markers += m[0]
    rest = rest.slice(m[0].length)
  }
  return { indent, markers, rest }
}

/** The lines a selection covers */
function selectedLines(state: EditorState): Line[] {
  const { from, to } = state.selection.main
  const lines: Line[] = []
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) lines.push(state.doc.line(n))
  return lines
}

/** Turns the selected lines into another kind of block, keeping their text */
export function turnInto(view: EditorView, kind: LineKind, lines = selectedLines(view.state)): void {
  let number = 1
  const changes = lines.map((line, i) => {
    const { indent, markers } = splitLine(line.text)
    let prefix = PREFIX[kind]
    if (kind === 'numbered') prefix = `${number++}. `
    if (kind === 'callout' && i > 0) prefix = '> '
    return { from: line.from + indent.length, to: line.from + indent.length + markers.length, insert: prefix }
  })
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true })
  view.focus()
}

/** Wraps the selected lines in a code block */
export function turnIntoCode(view: EditorView, lines = selectedLines(view.state)): void {
  const first = lines[0]
  const last = lines[lines.length - 1]
  view.dispatch({
    changes: [
      { from: first.from, insert: '```\n' },
      { from: last.to, insert: '\n```' }
    ],
    userEvent: 'input.format'
  })
  view.focus()
}

/** What the line before needs so a new block starts cleanly: --- under a paragraph would make it a heading */
const blankBefore = (state: EditorState, line: Line) =>
  line.number > 1 && state.doc.line(line.number - 1).text.trim() !== ''

/**
 * Puts a block where "/command" was typed: on that line if it was alone there, otherwise on a new
 * line below. `text` is the block's markdown; `cursor` is where the cursor goes, counted from the
 * block's start (an [from, to] pair selects).
 */
function placeBlock(view: EditorView, from: number, to: number, text: string, cursor: number | [number, number], spaced: boolean) {
  const { state } = view
  const line = state.doc.lineAt(from)
  const rest = (state.sliceDoc(line.from, from) + state.sliceDoc(to, line.to)).trim()
  let start: number
  let insert: string
  let replaceFrom: number
  let replaceTo: number
  if (!rest) {
    // Alone on the line: the block takes the line's place
    const pad = spaced && blankBefore(state, line) ? '\n' : ''
    replaceFrom = line.from
    replaceTo = line.to
    insert = pad + text
    start = line.from + pad.length
  } else {
    const pad = spaced ? '\n\n' : '\n'
    // Take the "/command" (and the space before it) out, then add the block after the line
    let cut = from
    while (cut > line.from && state.sliceDoc(cut - 1, cut) === ' ') cut--
    view.dispatch({ changes: { from: cut, to }, userEvent: 'input' })
    const after = view.state.doc.lineAt(cut)
    replaceFrom = replaceTo = after.to
    insert = pad + text
    start = after.to + pad.length
  }
  // A blank line after a block, if text follows it straight away (a table would take it as a row)
  const below = view.state.doc.lineAt(replaceTo)
  if (spaced && below.number < view.state.doc.lines && view.state.doc.line(below.number + 1).text.trim()) {
    insert += '\n'
  }
  const [a, b] = typeof cursor === 'number' ? [cursor, cursor] : cursor
  view.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert },
    selection: EditorSelection.range(start + a, start + b),
    userEvent: 'input',
    scrollIntoView: true
  })
}

/** Turns the line "/command" was typed on into a kind of line, or adds one below if it has text */
function placeLine(view: EditorView, from: number, to: number, kind: LineKind) {
  const { state } = view
  const line = state.doc.lineAt(from)
  const { indent, markers, rest } = splitLine(state.sliceDoc(line.from, from) + state.sliceDoc(to, line.to))
  const prefix = PREFIX[kind]
  if (!rest.trim() || from === line.from + indent.length + markers.length) {
    // At the start of the text, or alone: this line becomes the new kind
    const text = indent + prefix + rest
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: text },
      selection: EditorSelection.cursor(line.from + indent.length + prefix.length),
      userEvent: 'input',
      scrollIntoView: true
    })
    return
  }
  placeBlock(view, from, to, indent + prefix, (indent + prefix).length, false)
}

export interface SlashItem {
  label: string
  /** Shown faintly beside it: the markdown it writes */
  hint: string
  run(view: EditorView, from: number, to: number): void
}

/** The slash menu: `from`..`to` is the "/command" text, which each item replaces */
export const SLASH_ITEMS: SlashItem[] = [
  ...LINE_KINDS.map(({ kind, label }) => ({
    label,
    hint: PREFIX[kind].trim() || 'plain',
    run: (view: EditorView, from: number, to: number) => placeLine(view, from, to, kind)
  })),
  {
    label: 'Code block',
    hint: '```',
    run: (view, from, to) => placeBlock(view, from, to, '```\n\n```', 4, true)
  },
  {
    label: 'Divider',
    hint: '---',
    run: (view, from, to) => placeBlock(view, from, to, '---\n', 4, true)
  },
  {
    label: 'Table',
    hint: '| |',
    run: (view, from, to) =>
      placeBlock(view, from, to, '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |', [2, 10], true)
  },
  {
    label: 'Link to page',
    hint: '[[ ]]',
    run: (view, from, to) => {
      view.dispatch({
        changes: { from, to, insert: '[[' },
        selection: EditorSelection.cursor(from + 2),
        userEvent: 'input'
      })
      startCompletion(view)
    }
  },
  {
    label: 'Image',
    hint: '![]()',
    run: (view, from, to) => {
      view.dispatch({ changes: { from, to }, userEvent: 'input' })
      const host = view.state.facet(editorHost)
      void host?.pickImage().then((path) => {
        if (!path) return view.focus()
        const at = view.state.selection.main.head
        const insert = `![](${pathForMarkdown(path)})`
        view.dispatch({ changes: { from: at, insert }, selection: EditorSelection.cursor(at + insert.length), userEvent: 'input' })
        view.focus()
      })
    }
  }
]

/** A path as markdown wants it in ( ): in <> if it has spaces or brackets */
export const pathForMarkdown = (path: string) => (/[\s()<>]/.test(path) ? `<${path}>` : path)
