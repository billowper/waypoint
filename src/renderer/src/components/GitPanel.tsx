import { useState } from 'react'
import { useStore } from '../store'

const CODE_LABEL: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', U: 'conflict' }

/** Footer chip in the sidebar: branch, pending changes, ahead/behind. Click for the Git panel. */
export function GitIndicator() {
  const { git, gitBusy, setSidebarMode, sidebarMode } = useStore()
  if (!git) return null
  const label = !git.isRepo
    ? 'Not versioned'
    : gitBusy
      ? gitBusy + '…'
      : git.conflicted.length
        ? `${git.conflicted.length} conflict${git.conflicted.length === 1 ? '' : 's'}`
        : git.files.length
          ? `${git.files.length} change${git.files.length === 1 ? '' : 's'}`
          : 'All committed'
  return (
    <button
      className={`git-indicator ${git.conflicted.length ? 'conflict' : git.files.length ? 'dirty' : ''}`}
      title="Version history (git)"
      onClick={() => setSidebarMode(sidebarMode === 'git' ? 'files' : 'git')}
    >
      <span className="git-icon">⎇</span>
      {git.isRepo && <span className="git-branch">{git.branch}</span>}
      <span>{label}</span>
      {git.ahead > 0 && <span title="Commits to push">↑{git.ahead}</span>}
      {git.behind > 0 && <span title="Commits to pull">↓{git.behind}</span>}
    </button>
  )
}

export default function GitPanel() {
  const { git, gitBusy, runGit, vaultSettings, saveVaultSettings, openFile, openHistory, notes } = useStore()
  const [message, setMessage] = useState('')

  if (!git) return null
  if (git.error && !git.isRepo) return <div className="git-panel"><p className="empty">Git isn't available: {git.error}</p></div>

  if (!git.isRepo) {
    return (
      <div className="git-panel">
        <p className="empty">
          This vault isn't versioned yet. Turning on git keeps a history of every note, so you can see and undo
          changes, and sync to GitHub or another remote if you add one.
        </p>
        <button className="btn primary" disabled={!!gitBusy} onClick={() => runGit('Setting up git', window.api.gitInit)}>
          Start versioning this vault
        </button>
      </div>
    )
  }

  const commit = async () => {
    if (await runGit('Committing', () => window.api.gitCommit(message))) setMessage('')
  }
  const auto = vaultSettings?.git

  return (
    <div className="git-panel">
      {git.conflicted.length > 0 && (
        <p className="git-warning">
          Conflicts after a pull. Open each file below, keep the parts you want (remove the &lt;&lt;&lt;&lt;&lt;&lt;&lt; /
          ======= / &gt;&gt;&gt;&gt;&gt;&gt;&gt; markers), then commit.
        </p>
      )}
      <textarea
        className="git-message"
        value={message}
        placeholder="What changed? (optional)"
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && commit()}
        rows={2}
      />
      <div className="git-actions">
        <button className="btn small primary" disabled={!!gitBusy || git.files.length === 0} onClick={commit} title="Ctrl+Enter">
          Commit {git.files.length > 0 ? git.files.length : ''}
        </button>
        <button
          className="btn small"
          disabled={!!gitBusy || !git.hasRemote}
          title={git.hasRemote ? 'Pull from the remote' : 'No remote set up for this vault'}
          onClick={() => runGit('Pulling', window.api.gitPull)}
        >
          Pull{git.behind ? ` ↓${git.behind}` : ''}
        </button>
        <button
          className="btn small"
          disabled={!!gitBusy || !git.hasRemote}
          title={git.hasRemote ? 'Push to the remote' : 'No remote set up for this vault'}
          onClick={() => runGit('Pushing', window.api.gitPush)}
        >
          Push{git.ahead ? ` ↑${git.ahead}` : ''}
        </button>
      </div>
      {auto && (
        <label className="git-auto">
          <input
            type="checkbox"
            checked={auto.autoCommit}
            onChange={(e) => saveVaultSettings({ ...vaultSettings!, git: { ...auto, autoCommit: e.target.checked } })}
          />
          Auto-commit every
          <select
            value={auto.intervalMinutes}
            onChange={(e) =>
              saveVaultSettings({ ...vaultSettings!, git: { ...auto, intervalMinutes: Number(e.target.value) } })
            }
          >
            {[5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      )}

      <h3>Changes</h3>
      {git.files.length === 0 && <p className="empty">Everything is committed.</p>}
      <ul className="git-files">
        {git.files.map((f) => (
          <li key={f.path}>
            <button
              title={f.path}
              onClick={() => (notes.includes(f.path) ? openFile(f.path) : openHistory(f.path))}
            >
              <span className={`git-code code-${f.code === '?' ? 'new' : f.code}`} title={CODE_LABEL[f.code] ?? f.code}>
                {f.code === '?' ? 'N' : f.code}
              </span>
              <span className="git-path">{f.path}</span>
            </button>
          </li>
        ))}
      </ul>

      <button className="btn small history-btn" onClick={() => openHistory('')}>
        Vault history…
      </button>
      {git.lastCommit && (
        <p className="git-last" title={git.lastCommit.hash}>
          Last commit: {git.lastCommit.message} · {new Date(git.lastCommit.date).toLocaleString()}
        </p>
      )}
    </div>
  )
}
