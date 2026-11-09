import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'path'
import type { Vault } from './vault'
import { PROJECTS_DIR, readProject } from './projects'
import type { LinkedDoc } from '@shared/types'
import { joinFrontmatter, splitFrontmatter, str } from '@shared/frontmatter'

/**
 * Linked docs: a doc in the vault whose frontmatter names a file in the project's repo,
 *
 *   ---
 *   source: pipeline/README.md
 *   ---
 *
 * and which shows that file (read-only) instead of its own text, so the repo stays the one source.
 * `source` is relative to the project's repo.path; an absolute path also works. Markdown only for now.
 * No Electron here: the connector (src/mcp) reads linked docs the same way.
 */

const MARKDOWN = ['.md', '.markdown']
const MAX = 2 * 1024 * 1024

export const isMarkdownFile = (p: string) => MARKDOWN.includes(extname(p).toLowerCase())

/** The file a doc's text links to (its frontmatter `source`), or null for an ordinary doc */
export function sourceOf(text: string): string | null {
  const { data } = splitFrontmatter(text)
  return str(data.source).trim() || null
}

/** The project a vault path belongs to, if any */
export const projectOfPath = (rel: string) => new RegExp(`^${PROJECTS_DIR}/([^/]+)/`).exec(rel)?.[1] ?? null

const inside = (dir: string, p: string) => {
  const [d, f] = [resolve(dir).toLowerCase(), resolve(p).toLowerCase()]
  return f === d || f.startsWith(d.endsWith(sep) ? d : d + sep)
}

/** How a doc in a project writes `file`: relative to the repo when it's in there, else the full path */
export function sourceFor(repo: string, file: string): string {
  return repo && inside(repo, file) ? relative(resolve(repo), resolve(file)).split(sep).join('/') : resolve(file)
}

/** The body under a linked doc's frontmatter, without a "# Title" line: shown as a note above the file */
const noteOf = (text: string) => splitFrontmatter(text).body.replace(/^\s*#[ \t]+[^\n]*\n?/, '').trim()

/**
 * What a doc links to: null for an ordinary doc (or one that can't be read), else the file's text, or
 * `problem` saying why there's nothing to show. Never throws.
 */
export async function readLinked(vault: Vault, rel: string): Promise<LinkedDoc | null> {
  if (!vault.isNote(rel)) return null
  const text = await vault.read(rel).catch(() => null)
  const source = text === null ? null : sourceOf(text)
  if (text === null || !source) return null
  const doc: LinkedDoc = { source, file: '', root: '', content: null, modified: 0, note: noteOf(text) }
  const fail = (problem: string): LinkedDoc => ({ ...doc, problem })

  if (isAbsolute(source)) {
    doc.file = resolve(source)
    doc.root = dirname(doc.file)
  } else {
    const slug = projectOfPath(rel)
    if (!slug) return fail(`"${source}" is relative to a project's repository folder, and this doc isn't in a project. Use a full path.`)
    const repo = (await readProject(vault, slug)).repo.path
    if (!repo) return fail(`This project has no repository folder yet. Set it on the project page, and "${source}" will be looked for in there.`)
    doc.file = resolve(repo, source)
    doc.root = resolve(repo)
    if (!inside(repo, doc.file)) return fail(`"${source}" points outside the project's repository folder (${repo}). Use a full path for a file kept elsewhere.`)
  }
  if (!isMarkdownFile(doc.file)) return fail(`Only markdown files (.md) can be shown for now, and this links to ${doc.file}.`)
  try {
    const stat = await fs.stat(doc.file)
    if (!stat.isFile()) return fail(`${doc.file} is a folder, not a file.`)
    if (stat.size > MAX) return fail(`${doc.file} is too big to show (over 2 MB).`)
    return { ...doc, content: await fs.readFile(doc.file, 'utf8'), modified: stat.mtimeMs }
  } catch (e: any) {
    return fail(e?.code === 'ENOENT' ? `The file isn't there: ${doc.file}` : `Couldn't read ${doc.file}: ${e?.message ?? e}`)
  }
}

/** The full path a link written in a linked file points at (links are relative to the file's folder). Null for web links, anchors and the like. */
export function linkTarget(doc: LinkedDoc, href: string): string | null {
  let h = href.trim()
  if (h.startsWith('<') && h.endsWith('>')) h = h.slice(1, -1)
  h = h.replace(/[#?].*$/, '')
  if (!h || !doc.file || /^[a-z][\w+.-]+:/i.test(h)) return null
  try {
    h = decodeURI(h)
  } catch {
    /* as written */
  }
  // A leading slash means from the top of the repo, as on GitHub
  return /^[\\/]/.test(h) ? resolve(doc.root, `.${h}`) : resolve(dirname(doc.file), h)
}

/** A new doc that shows `source`: just the frontmatter, optionally with a note under it. Returns its path. */
export async function createLinked(vault: Vault, dir: string, name: string, source: string, note = ''): Promise<string> {
  const rel = await vault.createNote(dir, name)
  await vault.write(rel, joinFrontmatter({ source }, note.trim() ? `\n${note.trim()}\n` : ''))
  return rel
}

/** A name for the doc that shows `file`: its own name, or its folder's for a README */
export function nameFor(file: string): string {
  const base = basename(file, extname(file))
  const folder = basename(dirname(resolve(file)))
  return /^(readme|index)$/i.test(base) && folder ? `${folder} ${base}` : base
}

export { inside as isInside }
