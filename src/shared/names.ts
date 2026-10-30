/** Strip characters Windows does not allow in file names. */
export function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
}

/** The text of a note's leading "# Title" line, if it starts with one. */
export function titleOf(doc: string): string | null {
  const m = /^#[ \t]+(.+?)[ \t#]*$/m.exec(doc.slice(0, doc.indexOf('\n') + 1 || undefined))
  return m ? m[1] : null
}

/** File name (no extension) of a vault-relative path. */
export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '')
}

/** Where `p` ends up when `from` (a file or folder) is renamed to `to`; null if unaffected. */
export function movedPath(p: string, from: string, to: string): string | null {
  if (p === from) return to
  if (p.startsWith(from + '/')) return to + p.slice(from.length)
  return null
}
