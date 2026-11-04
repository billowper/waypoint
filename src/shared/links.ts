import { baseName } from './names'

/** A [[wiki link]] found in a note: [[target#heading|alias]] */
export interface WikiLink {
  from: number
  to: number
  target: string
  heading?: string
  alias?: string
  /** Written [[target\|alias]], which a markdown table needs so the | doesn't end the cell */
  escapedPipe?: boolean
}

const WIKILINK = /\[\[([^[\]\n|#]+)(#[^[\]\n|]*)?(\|[^[\]\n]*)?\]\]/g

/** Blank out fenced and inline code (keeping offsets) so links inside code are ignored. */
function maskCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, blank).replace(/`[^`\n]+`/g, blank)
}

export function parseLinks(text: string): WikiLink[] {
  const links: WikiLink[] = []
  const masked = maskCode(text)
  for (const m of masked.matchAll(WIKILINK)) {
    const escapedPipe = !!m[3] && (m[2] ?? m[1]).endsWith('\\')
    const unescape = (s: string) => (escapedPipe ? s.replace(/\\$/, '') : s)
    links.push({
      from: m.index!,
      to: m.index! + m[0].length,
      target: (m[2] ? m[1] : unescape(m[1])).trim(),
      heading: (m[2] && unescape(m[2]).slice(1)) || undefined,
      alias: m[3]?.slice(1) || undefined,
      ...(escapedPipe ? { escapedPipe } : {})
    })
  }
  return links
}

export function formatLink(target: string, heading?: string, alias?: string, escapedPipe?: boolean): string {
  const pipe = escapedPipe ? '\\|' : '|'
  return `[[${target}${heading ? `#${heading}` : ''}${alias ? `${pipe}${alias}` : ''}]]`
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * Resolve a link target to a note path. Targets are note names ("Standup") or, when two notes
 * share a name, a path ("Journal/Standup"). Ties go to the note nearest the linking note.
 */
export function resolveLink(target: string, fromPath: string, notes: string[]): string | null {
  const t = target.trim().replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase()
  if (!t) return null
  const candidates = t.includes('/')
    ? notes.filter((p) => {
        const s = p.replace(/\.md$/i, '').toLowerCase()
        return s === t || s.endsWith('/' + t)
      })
    : notes.filter((p) => baseName(p).toLowerCase() === t)
  if (candidates.length <= 1) return candidates[0] ?? null
  const here = dirOf(fromPath)
  return [...candidates].sort(
    (a, b) =>
      Number(dirOf(b) === here) - Number(dirOf(a) === here) ||
      a.split('/').length - b.split('/').length ||
      a.localeCompare(b)
  )[0]
}

/**
 * The shortest link text that points at `path`: its name, or when the name is shared, the
 * shortest end of its path that no other note has ("a/Dup" rather than "notes/a/Dup").
 */
export function linkTextFor(path: string, notes: string[]): string {
  const parts = path.replace(/\.md$/i, '').split('/')
  const others = notes.filter((p) => p !== path).map((p) => p.replace(/\.md$/i, '').toLowerCase())
  for (let n = 1; n < parts.length; n++) {
    const tail = parts.slice(-n).join('/')
    const t = tail.toLowerCase()
    if (!others.some((o) => o === t || o.endsWith('/' + t))) return tail
  }
  return parts.join('/')
}
