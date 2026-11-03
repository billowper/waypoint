import { useEffect, useRef } from 'react'
import type { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { sanitize } from '@shared/names'

export interface Heading {
  level: number
  text: string
  /** Where it starts in the document */
  pos: number
}

/** A heading's text without its markers and inline markdown */
function plainText(source: string, setext: boolean): string {
  const line = setext ? source.split('\n').slice(0, -1).join(' ') : source.replace(/^#+[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '')
  return line
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

/**
 * The note's headings, from the parsed document (so "# " in code or frontmatter doesn't count).
 * The title line that matches the file name is left out: the path bar already shows it.
 */
export function readHeadings(state: EditorState, noteName: string): Heading[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: Heading[] = []
  tree.iterate({
    enter(node) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name)
      if (!m) return
      const text = plainText(state.sliceDoc(node.from, node.to), m[1] === 'Setext')
      if (text && !(out.length === 0 && m[2] === '1' && sanitize(text) === noteName)) {
        out.push({ level: Number(m[2]), text, pos: node.from })
      }
      return false
    }
  })
  return out
}

interface Props {
  headings: Heading[]
  scrolledTo: number
  onJump(pos: number): void
}

/** The contents pane: click a heading to go to it; the one you're under is highlighted */
export default function Toc({ headings, scrolledTo, onJump }: Props) {
  const top = Math.min(...headings.map((h) => h.level))
  const current = headings.reduce((found, h, i) => (h.pos <= scrolledTo ? i : found), -1)
  const currentRow = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav className="toc">
      <div className="toc-title">Contents</div>
      {headings.length === 0 && <p className="empty">Headings in this note will show here.</p>}
      {headings.map((h, i) => (
        <button
          key={`${h.pos}`}
          ref={i === current ? currentRow : undefined}
          className={`toc-item ${i === current ? 'current' : ''}`}
          style={{ paddingLeft: 8 + (h.level - top) * 12 }}
          title={h.text}
          onClick={() => onJump(h.pos)}
        >
          {h.text}
        </button>
      ))}
    </nav>
  )
}
