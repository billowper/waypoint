import { simpleGit, type SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GitCommit, GitStatus } from '@shared/types'

/**
 * Git for the vault, using the installed git (so Bill's credentials and config just work).
 * Everything is vault-relative; nothing here runs arbitrary commands.
 */
/** A push that says nothing for this long is stuck, e.g. on a passphrase prompt nobody can see */
const PUSH_SILENCE_LIMIT_MS = 5 * 60_000

/** Git's messages can quote the remote URL, which may hold a password or token */
export const hideCredentials = (text: string): string => text.replace(/(\/\/)[^/@\s]+@/g, '$1')

/** Plain transports only, so a pasted value can't be read as an option or run a helper (ext::) */
const REMOTE_URL = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|[a-z]:[\\/]|\\\\|\/)\S*$/i

export class VaultGit {
  private git: SimpleGit
  private pushGit: SimpleGit

  constructor(private readonly root: string) {
    this.git = simpleGit({ baseDir: root, maxConcurrentProcesses: 1, trimmed: true })
    this.pushGit = simpleGit({
      baseDir: root,
      maxConcurrentProcesses: 1,
      trimmed: true,
      timeout: { block: PUSH_SILENCE_LIMIT_MS }
    })
  }

  /** The remote to push to: origin if there is one, otherwise the first */
  private async remote(): Promise<{ name: string; url: string } | null> {
    const remotes = await this.git.getRemotes(true)
    const r = remotes.find((x) => x.name === 'origin') ?? remotes[0]
    return r ? { name: r.name, url: r.refs.push || r.refs.fetch } : null
  }

  /** Add origin, or repoint the remote pushes already go to */
  async setRemote(url: string): Promise<void> {
    const clean = url.trim()
    if (!REMOTE_URL.test(clean)) throw new Error("That doesn't look like a git remote URL.")
    const cur = await this.remote()
    if (cur) await this.git.remote(['set-url', cur.name, clean])
    else await this.git.addRemote('origin', clean)
  }

  /** There's a remote, no merge is in progress, and it's missing commits (or the branch isn't on it yet) */
  async needsPush(): Promise<boolean> {
    if (!this.isRepo() || !(await this.remote())) return false
    const s = await this.git.status()
    return !s.conflicted.length && (!s.tracking || s.ahead > 0)
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
      const [s, remote, last] = await Promise.all([
        this.git.status(),
        this.remote(),
        this.git.log({ maxCount: 1 }).catch(() => null)
      ])
      return {
        isRepo: true,
        branch: s.current ?? '',
        files: s.files.map((f) => ({ path: f.path, code: (f.working_dir.trim() || f.index.trim() || '?').slice(0, 1) })),
        conflicted: s.conflicted,
        ahead: s.ahead,
        behind: s.behind,
        hasRemote: !!remote,
        remoteUrl: remote ? hideCredentials(remote.url) : undefined,
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

  /**
   * Push the current branch and track it, so the first push to a new remote works. Never forces.
   * Background pushes must not pop up a sign-in window every few minutes, so they fail instead.
   */
  async push(background = false): Promise<void> {
    const remote = await this.remote()
    if (!remote) throw new Error('No remote set up for this vault')
    const quiet = background ? ['-c', 'credential.interactive=false'] : []
    try {
      await this.pushGit.raw([...quiet, 'push', '-u', remote.name, 'HEAD'])
    } catch (e) {
      const message = hideCredentials((e as Error).message)
      throw new Error(
        /rejected|non-fast-forward|fetch first/i.test(message)
          ? 'The remote has commits this vault doesn’t have. Pull first, and pushing will carry on.'
          : message
      )
    }
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
