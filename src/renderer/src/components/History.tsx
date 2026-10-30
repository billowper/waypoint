import { useEffect, useState } from 'react'
import type { GitCommit } from '@shared/types'
import { baseName } from '@shared/names'
import { useStore } from '../store'

/** Coloured unified diff */
function Diff({ text }: { text: string }) {
  if (!text.trim()) return <p className="empty">No changes.</p>
  return (
    <pre className="diff">
      {text.split('\n').map((line, i) => {
        const cls = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
          ? 'meta'
          : line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'del'
                : ''
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/** Commits that touched a note (or the whole vault), with the diff of the selected one */
export default function History({ path }: { path: string }) {
  const { git, openFile, notes } = useStore()
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [selected, setSelected] = useState<string>('working')
  const [diff, setDiff] = useState('')

  useEffect(() => {
    let live = true
    window.api.gitLog(path || undefined).then((c) => live && setCommits(c))
    return () => {
      live = false
    }
  }, [path, git?.lastCommit?.hash])

  useEffect(() => {
    let live = true
    window.api
      .gitDiff(selected, path || undefined)
      .then((d) => live && setDiff(d))
      .catch((e) => live && setDiff(`Couldn't load the diff: ${(e as Error).message}`))
    return () => {
      live = false
    }
  }, [selected, path, git?.files.length])

  return (
    <div className="history-page">
      <header className="board-head">
        <h1>
          History <span className="history-of">{path ? baseName(path) : 'whole vault'}</span>
        </h1>
        {path && notes.includes(path) && (
          <button className="btn small" onClick={() => openFile(path)}>
            Open note
          </button>
        )}
      </header>
      {!git?.isRepo ? (
        <p className="empty">This vault isn't versioned yet. Turn it on from the Git panel in the sidebar.</p>
      ) : (
        <div className="history-split">
          <ul className="commit-list">
            <li>
              <button className={selected === 'working' ? 'selected' : ''} onClick={() => setSelected('working')}>
                <span className="commit-msg">Uncommitted changes</span>
              </button>
            </li>
            {commits?.map((c) => (
              <li key={c.hash}>
                <button className={selected === c.hash ? 'selected' : ''} onClick={() => setSelected(c.hash)} title={c.hash}>
                  <span className="commit-msg">{c.message}</span>
                  <span className="commit-meta">
                    {new Date(c.date).toLocaleString()} · {c.author} · {c.hash.slice(0, 7)}
                  </span>
                </button>
              </li>
            ))}
            {commits?.length === 0 && <li className="empty">No commits yet.</li>}
          </ul>
          <div className="diff-pane">
            <Diff text={diff} />
          </div>
        </div>
      )}
    </div>
  )
}
