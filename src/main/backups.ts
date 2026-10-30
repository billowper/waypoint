import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Vault } from './vault'

/**
 * Zip snapshots of the vault into a folder Bill picks (e.g. OneDrive or another drive).
 * Uses Windows' built-in tar (bsdtar), which writes .zip when the name ends in .zip.
 * .git is left out (the history is its own backup) and so is the disposable cache.
 */

const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const prefix = (vault: Vault) => `${vault.name.replace(/[^\w.-]+/g, '-')}-backup-`

export async function backupNow(vault: Vault, dir: string, keep: number): Promise<string> {
  if (!dir) throw new Error('Choose a backup folder first')
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, `${prefix(vault)}${stamp()}.zip`)
  await new Promise<void>((resolve, reject) => {
    execFile(
      TAR,
      ['-a', '-c', '-f', file, '--exclude=.git', '--exclude=node_modules', '--exclude=.app/cache', '-C', vault.root, '.'],
      { windowsHide: true, timeout: 10 * 60_000 },
      (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
    )
  })
  await prune(vault, dir, keep)
  return file
}

/** Keep the newest `keep` backups of this vault; older ones are deleted */
async function prune(vault: Vault, dir: string, keep: number) {
  const mine = (await fs.readdir(dir))
    .filter((f) => f.startsWith(prefix(vault)) && f.endsWith('.zip'))
    .sort()
    .reverse()
  for (const old of mine.slice(Math.max(1, keep))) await fs.rm(join(dir, old)).catch(() => {})
}
