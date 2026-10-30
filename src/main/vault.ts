import { promises as fs, existsSync } from 'fs'
import { join, resolve, relative, sep, basename, extname, dirname } from 'path'
import type { TreeNode, VaultSettings, VaultStats } from '@shared/types'
import { sanitize } from '@shared/names'

const IGNORED = new Set(['.git', 'node_modules', '.app', '.obsidian', '.trash'])

export class Vault {
  readonly root: string

  constructor(root: string) {
    // Normalise (separators, trailing slash) so the escape check in abs() compares like with like
    this.root = resolve(root)
  }

  get name(): string {
    return basename(this.root)
  }

  /** Resolve a vault-relative path, refusing anything that escapes the vault. */
  abs(rel: string): string {
    const p = resolve(this.root, rel || '.')
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new Error(`Path escapes vault: ${rel}`)
    }
    return p
  }

  /** Is this a note the app shows (and indexes)? Same rules as the tree. */
  isNote(rel: string): boolean {
    if (!rel.toLowerCase().endsWith('.md')) return false
    return rel.split('/').every((part) => !IGNORED.has(part) && !part.startsWith('.'))
  }

  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/')
  }

  isSetUp(): boolean {
    return existsSync(join(this.root, '.app'))
  }

  /** Non-destructive: only creates what is missing. */
  async setUp(): Promise<void> {
    await fs.mkdir(join(this.root, '.app', 'cache'), { recursive: true })
    await fs.mkdir(join(this.root, 'notes'), { recursive: true })
    await fs.mkdir(join(this.root, 'projects'), { recursive: true })
    await writeIfMissing(
      join(this.root, '.app', 'settings.json'),
      JSON.stringify({ version: 1 }, null, 2) + '\n'
    )
    await writeIfMissing(join(this.root, '.gitignore'), '.app/cache/\n')
    await writeIfMissing(
      join(this.root, 'inbox.md'),
      '# Inbox\n\nQuick captures land here. Sort them into notes or projects later.\n'
    )
    await writeIfMissing(
      join(this.root, 'notes', 'Welcome.md'),
      [
        '# Welcome to Waypoint',
        '',
        'Everything here is a plain Markdown file in a normal folder, so you can',
        'edit it anywhere and version it with git.',
        '',
        '- **notes/** — free-form notes, nest folders as deep as you like',
        '- **projects/** — one folder per project (wikis, resources, tasks)',
        '- **inbox.md** — quick capture',
        ''
      ].join('\n')
    )
  }

  /** Quick capture: add a bullet to inbox.md (created if missing), stamped with the time */
  async appendToInbox(text: string): Promise<void> {
    const clean = text.trim()
    if (!clean) return
    const file = join(this.root, 'inbox.md')
    const current = await fs.readFile(file, 'utf8').catch(() => '# Inbox\n\n')
    const when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const entry = `- ${clean.replace(/\r?\n/g, '\n  ')} _(${when})_\n`
    await fs.writeFile(file, (current.endsWith('\n') ? current : current + '\n') + entry, 'utf8')
  }

  /** .app/settings.json, with defaults for anything missing (the file is optional) */
  async settings(): Promise<VaultSettings> {
    let data: Partial<VaultSettings> = {}
    try {
      data = JSON.parse(await fs.readFile(join(this.root, '.app', 'settings.json'), 'utf8'))
    } catch {
      /* missing or unreadable: defaults */
    }
    return {
      ...data,
      version: 1,
      git: {
        autoCommit: data.git?.autoCommit === true,
        intervalMinutes: Math.max(5, Number(data.git?.intervalMinutes) || 15)
      }
    }
  }

  async saveSettings(settings: VaultSettings): Promise<void> {
    await fs.mkdir(join(this.root, '.app'), { recursive: true })
    await fs.writeFile(join(this.root, '.app', 'settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8')
  }

  async tree(dirRel = ''): Promise<TreeNode[]> {
    const dir = this.abs(dirRel)
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: TreeNode[] = []
    for (const e of entries) {
      if (IGNORED.has(e.name) || e.name.startsWith('.')) continue
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: rel, type: 'dir', children: await this.tree(rel) })
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: rel, type: 'file' })
      }
    }
    nodes.sort((a, b) =>
      a.type !== b.type
        ? a.type === 'dir'
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
    return nodes
  }

  async stats(): Promise<VaultStats> {
    const count = (nodes: TreeNode[]): number =>
      nodes.reduce(
        (n, x) => n + (x.type === 'dir' ? count(x.children ?? []) : extname(x.name) === '.md' ? 1 : 0),
        0
      )
    const all = await this.tree()
    // Reuse the walk rather than reading projects/ again
    const projectsDir = all.find((n) => n.type === 'dir' && n.path === 'projects')
    const projects = (projectsDir?.children ?? []).filter((n) => n.type === 'dir').length
    return { notes: count(all), projects }
  }

  read(rel: string): Promise<string> {
    return fs.readFile(this.abs(rel), 'utf8')
  }

  async write(rel: string, content: string): Promise<void> {
    await fs.writeFile(this.abs(rel), content, 'utf8')
  }

  /** Every markdown note in the vault (same rules as the tree), as vault-relative paths. */
  async notePaths(dirRel = ''): Promise<string[]> {
    const out: string[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'dir') walk(n.children ?? [])
        else if (extname(n.name).toLowerCase() === '.md') out.push(n.path)
      }
    }
    walk(await this.tree(dirRel))
    return out
  }

  async createNote(dirRel: string, name = 'Untitled'): Promise<string> {
    const dir = this.abs(dirRel)
    await fs.mkdir(dir, { recursive: true })
    const file = await uniqueName(dir, sanitize(name) || 'Untitled', '.md')
    await fs.writeFile(join(dir, file), `# ${basename(file, '.md')}\n\n`, { flag: 'wx' })
    return this.rel(join(dir, file))
  }

  /** Move a file or folder into another folder, keeping its name (numbered if taken). */
  async move(rel: string, destDirRel: string): Promise<string> {
    const src = this.abs(rel)
    const destDir = this.abs(destDirRel)
    if (src === this.root) throw new Error('Cannot move the vault itself')
    if (destDir === src || destDir.startsWith(src + sep)) throw new Error("Can't move a folder into itself")
    if (dirname(src) === destDir) return rel
    const isFile = (await fs.stat(src)).isFile()
    const ext = isFile ? extname(src) : ''
    const final = await uniqueName(destDir, basename(src, ext), ext)
    const dest = join(destDir, final)
    await renameWithRetry(src, dest)
    // A numbered name ("Plan 1") means the old "# Plan" title no longer matches
    if (isFile) await retitle(dest, basename(src, ext), basename(final, ext))
    return this.rel(dest)
  }

  /** Copy a note or folder next to itself as "<name> copy". */
  async duplicate(rel: string): Promise<string> {
    const src = this.abs(rel)
    if (src === this.root) throw new Error('Cannot duplicate the vault itself')
    const isFile = (await fs.stat(src)).isFile()
    const ext = isFile ? extname(src) : ''
    const oldBase = basename(src, ext)
    const final = await uniqueName(dirname(src), `${oldBase} copy`, ext)
    const dest = join(dirname(src), final)
    if (isFile) {
      await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
      await retitle(dest, oldBase, basename(final, ext))
    } else {
      await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false })
    }
    return this.rel(dest)
  }

  /**
   * Rename a file or folder in place. Files keep their extension; a name that is taken gets a
   * number appended. With `syncHeading`, a note whose "# Title" matched its old name gets the
   * new title too (the editor does this itself for the note it has open).
   */
  async rename(rel: string, newName: string, syncHeading: boolean): Promise<string> {
    const src = this.abs(rel)
    if (src === this.root) throw new Error('Cannot rename the vault itself')
    const ext = (await fs.stat(src)).isFile() ? extname(src) : ''
    const wanted = ext && newName.toLowerCase().endsWith(ext.toLowerCase()) ? newName.slice(0, -ext.length) : newName
    const base = sanitize(wanted)
    const oldBase = basename(src, ext)
    if (!base || base === oldBase) return rel

    const dir = dirname(src)
    // Windows file names are case-insensitive, so a case-only change must not be "taken"
    const final = base.toLowerCase() === oldBase.toLowerCase() ? base + ext : await uniqueName(dir, base, ext)
    const dest = join(dir, final)

    if (syncHeading) await retitle(src, oldBase, basename(final, ext))
    await renameWithRetry(src, dest)
    return this.rel(dest)
  }

  async createFolder(dirRel: string, name: string): Promise<string> {
    const clean = sanitize(name) || 'New folder'
    const dir = this.abs(dirRel)
    const final = await uniqueName(dir, clean, '')
    await fs.mkdir(join(dir, final), { recursive: true })
    return this.rel(join(dir, final))
  }
}

async function writeIfMissing(p: string, content: string) {
  try {
    await fs.writeFile(p, content, { flag: 'wx' })
  } catch (e: any) {
    if (e.code !== 'EEXIST') throw e
  }
}

async function uniqueName(dir: string, base: string, ext: string): Promise<string> {
  for (let i = 0; ; i++) {
    const name = i === 0 ? `${base}${ext}` : `${base} ${i}${ext}`
    if (!existsSync(join(dir, name))) return name
  }
}

/** If a note's first line is "# <oldTitle>", change it to "# <newTitle>". */
async function retitle(abs: string, oldTitle: string, newTitle: string) {
  if (oldTitle === newTitle || extname(abs).toLowerCase() !== '.md') return
  const text = await fs.readFile(abs, 'utf8')
  const first = new RegExp(`^# ${escapeRegExp(oldTitle)}[ \\t]*(\\r?\\n|$)`)
  if (first.test(text)) {
    await fs.writeFile(abs, text.replace(first, (_m, eol: string) => `# ${newTitle}${eol}`), 'utf8')
  }
}

/** Antivirus, indexers and Explorer briefly lock files on Windows; give them a moment. */
async function renameWithRetry(src: string, dest: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(src, dest)
    } catch (e: any) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
