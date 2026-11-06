import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkTextFor, parseLinks, resolveLink } from '@shared/links'
import { editorHost } from './host'
import { linkContext } from './livePreview'

// Formatting the selection: bold, italic, code, strikethrough (Notion's keys) and links (Ctrl+K).
// Used by the keys, which work in the markdown view too, and the selection toolbar (toolbar.ts).

const MARK_OF: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark'
}

/** The formatting node of this kind that holds the selection, if any */
export function formatAt(view: EditorView, node: string): SyntaxNode | null {
  const sel = view.state.selection.main
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(sel.from, 1); n; n = n.parent) {
    if (n.name === node && n.to >= sel.to) return n
  }
  return null
}

/** Takes the formatting off if the selection is in it, otherwise wraps the selection in `mark` */
export function toggleFormat(mark: string, node: string): Command {
  return (view) => {
    const { state } = view
    const sel = state.selection.main
    const found = formatAt(view, node)
    if (found) {
      const marks = found.getChildren(MARK_OF[node])
      if (marks.length >= 2) {
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

export const bold = toggleFormat('**', 'StrongEmphasis')
export const italic = toggleFormat('*', 'Emphasis')
export const code = toggleFormat('`', 'InlineCode')
export const strike = toggleFormat('~~', 'Strikethrough')

/** Looks like a web address rather than a page name */
const isUrl = (s: string) => /^[a-z][\w+.-]*:\S+$/i.test(s) || /^www\.\S+$/i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)
const withScheme = (s: string) => (/^[a-z][\w+.-]*:/i.test(s) ? s : `https://${s}`)
const inTableRow = (view: EditorView, pos: number) => {
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'TableRow' || n.name === 'TableHeader') return true
  }
  return false
}

/** The [text](url) or [[wiki link]] the selection is in */
function linkAt(view: EditorView): { from: number; to: number; text: string; target: string; wiki: boolean } | null {
  const { state } = view
  const sel = state.selection.main
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(sel.from, 1); n; n = n.parent) {
    if (n.name !== 'Link') continue
    const marks = n.getChildren('LinkMark')
    const url = n.getChild('URL')
    if (marks.length < 3 || !url || n.to < sel.to) break
    return {
      from: n.from,
      to: n.to,
      text: state.sliceDoc(marks[0].to, marks[1].from),
      target: state.sliceDoc(url.from, url.to),
      wiki: false
    }
  }
  const line = state.doc.lineAt(sel.from)
  for (const l of parseLinks(line.text)) {
    const from = line.from + l.from
    const to = line.from + l.to
    if (from > sel.from || to < sel.to) continue
    const raw = state.sliceDoc(from + 2, to - 2)
    const pipe = raw.indexOf('|')
    return { from, to, text: pipe === -1 ? raw : raw.slice(pipe + 1), target: l.target, wiki: true }
  }
  return null
}

/**
 * Ctrl+K: link the selection to a web address or a page. In a link, change where it goes, or
 * clear the box to take the link off.
 */
export const linkCommand: Command = (view) => {
  const host = view.state.facet(editorHost)
  const links = view.state.facet(linkContext)
  if (!host) return false
  const existing = linkAt(view)
  const sel = view.state.selection.main
  void host
    .ask(existing ? 'Edit link' : 'Link', {
      placeholder: existing ? 'Clear this to take the link off' : 'Paste a web address, or type a page name',
      initial: existing?.target ?? '',
      action: existing ? 'Save' : 'Link',
      allowEmpty: !!existing
    })
    .then((answer) => {
      view.focus()
      if (answer === null) return
      const target = answer.trim()
      const range = existing ?? { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to) }
      if (!target) {
        // Cleared: just the text stays
        if (existing) view.dispatch({ changes: { from: range.from, to: range.to, insert: range.text }, userEvent: 'input.format' })
        return
      }
      let insert: string
      if (isUrl(target)) {
        const url = withScheme(target)
        insert = `[${range.text || target}](${/[\s()<>]/.test(url) ? `<${url}>` : url})`
      } else {
        // A page: link to it by the shortest name that finds it (it's created on click if new)
        const notes = links?.notes() ?? []
        const found = resolveLink(target, links?.from() ?? '', notes)
        const name = found ? linkTextFor(found, notes) : target
        const pipe = inTableRow(view, range.from) ? '\\|' : '|'
        insert = !range.text || range.text === name ? `[[${name}]]` : `[[${name}${pipe}${range.text}]]`
      }
      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        selection: EditorSelection.cursor(range.from + insert.length),
        userEvent: 'input.format'
      })
    })
  return true
}

/** Goes ahead of the default keys, which use Ctrl+I to select the enclosing syntax */
export const formatKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: bold, preventDefault: true },
  { key: 'Mod-i', run: italic, preventDefault: true },
  { key: 'Mod-e', run: code, preventDefault: true },
  { key: 'Mod-Shift-s', run: strike, preventDefault: true },
  { key: 'Mod-k', run: linkCommand, preventDefault: true }
]
