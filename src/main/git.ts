import { simpleGit, type SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GitCommit, GitStatus } from '@shared/types'

/**
 * Git for the vault, using the installed git (so Bill's credentials and config just work).
 * Everything is vault-relative; nothing here runs arbitrary commands.
 */
export class VaultGit {
  private git: SimpleGit

  constructor(private readonly root: string) {
    this.git = simpleGit({ baseDir: root, maxConcurrentProcesses: 1, trimmed: true })
  }

  isRepo(): boolean {
    return existsSync(join(this.root, '.git'))
  }

  async status(): Promise<GitStatus> {
    const empty: GitStatus = {
      isRepo: false,
      branch: '',
      files: [],
      conflicted: [],
      ahead: 0,
      behind: 0,
      hasRemote: false,
      lastCommit: null
    }
    if (!this.isRepo()) return empty
    try {
      const [s, remotes, last] = await Promise.all([
        this.git.status(),
        this.git.getRemotes(),
        this.git.log({ maxCount: 1 }).catch(() => null)
      ])
      return {
        isRepo: true,
        branch: s.current ?? '',
        files: s.files.map((f) => ({ path: f.path, code: (f.working_dir.trim() || f.index.trim() || '?').slice(0, 1) })),
        conflicted: s.conflicted,
        ahead: s.ahead,
        behind: s.behind,
        hasRemote: remotes.length > 0,
        lastCommit: last?.latest
          ? { hash: last.latest.hash, date: last.latest.date, message: last.latest.message }
          : null
      }
    } catch (e) {
      return { ...empty, isRepo: true, error: (e as Error).message }
    }
  }

  async init(): Promise<void> {
    await this.git.init()
    // A first commit so history and diffs have something to start from
    await this.git.add(['-A'])
    await this.commitIfChanged('Start tracking this vault with git')
  }

  /** Commit everything; returns false when there was nothing to commit. */
  async commitIfChanged(message: string): Promise<boolean> {
    await this.git.add(['-A'])
    const s = await this.git.status()
    if (s.isClean()) return false
    if (s.conflicted.length) throw new Error(`Resolve the conflicts first: ${s.conflicted.join(', ')}`)
    await this.git.commit(message)
    return true
  }

  async pull(): Promise<string> {
    const r = await this.git.pull()
    return `${r.summary.changes} changed, ${r.summary.insertions} insertions, ${r.summary.deletions} deletions`
  }

  async push(): Promise<void> {
    await this.git.push()
  }

  async log(file?: string): Promise<GitCommit[]> {
    if (!this.isRepo()) return []
    const opts: Record<string, unknown> = { maxCount: 100 }
    if (file) opts['--follow'] = null
    const r = await this.git.log(file ? { ...opts, file } : opts).catch(() => null)
    return (r?.all ?? []).map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }))
  }

  /** The patch a commit made (to one file, or all of it) */
  async diff(hash: string, file?: string): Promise<string> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Bad commit id')
    const args = ['show', '--format=', '--no-color', '-M', hash]
    if (file) args.push('--', file)
    return this.git.raw(args)
  }

  /** Uncommitted changes to one file, or everything */
  async workingDiff(file?: string): Promise<string> {
    const args = ['diff', '--no-color', 'HEAD']
    if (file) args.push('--', file)
    return this.git.raw(args).catch(() => '')
  }
}
