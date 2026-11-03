/** Ideas: every quick capture is a note in here */
export const IDEAS_DIR = 'ideas'

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

/** Folders the vault's layout depends on: a note beside one of these never owns it */
const LAYOUT_FOLDER = /^(notes|ideas|projects|projects\/[^/]+\/(docs|wiki|tasks|boards|claude))$/

/** The folder holding a note's sub-pages: same name, right beside it. Null for anything that can't have any. */
export function pagesFolder(rel: string): string | null {
  if (!/\.md$/i.test(rel)) return null
  const folder = rel.slice(0, -3)
  return LAYOUT_FOLDER.test(folder) ? null : folder
}

/** Where `p` ends up when `from` (a file or folder) is renamed to `to`; null if unaffected. A note's sub-pages go with it. */
export function movedPath(p: string, from: string, to: string): string | null {
  if (p === from) return to
  if (p.startsWith(from + '/')) return to + p.slice(from.length)
  const pages = pagesFolder(from)
  const pagesTo = pagesFolder(to)
  if (pages && pagesTo) {
    if (p === pages) return pagesTo
    if (p.startsWith(pages + '/')) return pagesTo + p.slice(pages.length)
  }
  return null
}
