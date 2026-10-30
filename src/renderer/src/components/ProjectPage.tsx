import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_STATUSES, TASK_STATUSES, TASK_STATUS_LABEL, type Project, type ProjectSettings } from '@shared/types'
import { byUrgency, dueState, formatDue } from './Board'
import { baseName } from '@shared/names'
import { useStore } from '../store'

const SAVE_DELAY = 500

const settingsOf = (p: Project): ProjectSettings => ({
  title: p.title,
  status: p.status,
  key: p.key,
  tags: p.tags,
  created: p.created,
  repo: { ...p.repo },
  links: p.links.map((l) => ({ ...l })),
  bookmarks: p.bookmarks.map((b) => ({ ...b }))
})

const fail = (what: string) => (e: unknown) => alert(`${what}\n\n${(e as Error).message}`)

export default function ProjectPage({ slug }: { slug: string }) {
  const { projects, notes, tasks, boards, openFile, newNote, refresh, openBoard, createTask, openCanvas, createBoard } =
    useStore()
  const project = projects.find((p) => p.slug === slug)
  const projectTasks = tasks.filter((t) => t.project === slug)
  const projectBoards = boards.filter((b) => b.startsWith(`projects/${slug}/`))
  const [s, setS] = useState<ProjectSettings | null>(project ? settingsOf(project) : null)
  const [tagText, setTagText] = useState(project?.tags.join(', ') ?? '')
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(s)
  latest.current = s

  // Take fresh values from disk unless an edit of ours is still waiting to be saved
  useEffect(() => {
    if (!project || pending.current) return
    setS(settingsOf(project))
    setTagText(project.tags.join(', '))
  }, [project])

  const save = useCallback(async () => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    if (!latest.current) return
    await window.api.saveProject(slug, latest.current).catch(fail("Couldn't save the project settings."))
    await refresh()
  }, [slug, refresh])

  // Save on leaving the page too
  useEffect(() => () => void (pending.current && save()), [save])

  if (!project || !s) {
    return (
      <div className="project-page">
        <p className="empty">This project no longer exists.</p>
      </div>
    )
  }

  const update = (patch: Partial<ProjectSettings>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur))
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(save, SAVE_DELAY)
  }
  /** Run an action that needs the latest settings on disk (opening a path checks them) */
  const thenSaved = (fn: () => Promise<unknown>, what: string) => async () => {
    await save()
    await fn().catch(fail(what))
  }

  const inDir = (sub: string) => notes.filter((n) => n.startsWith(`${project.dir}/${sub}/`))
  const wiki = inDir('wiki')
  const other = notes.filter(
    (n) =>
      n.startsWith(project.dir + '/') &&
      n !== `${project.dir}/project.md` &&
      !/\/(wiki|tasks|boards)\//.test(n.slice(project.dir.length))
  )

  return (
    <div className="project-page">
      <header className="project-head">
        <input
          className="project-title"
          value={s.title}
          onChange={(e) => update({ title: e.target.value })}
          aria-label="Project name"
        />
        <div className="status-pills" role="radiogroup" aria-label="Status">
          {PROJECT_STATUSES.map((st) => (
            <button
              key={st}
              className={`pill status-${st} ${s.status === st ? 'on' : ''}`}
              onClick={() => update({ status: st })}
            >
              {st}
            </button>
          ))}
        </div>
        <div className="project-meta">
          <label>
            Tags
            <input
              value={tagText}
              placeholder="client, web"
              onChange={(e) => {
                setTagText(e.target.value)
                update({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
              }}
            />
          </label>
          <label title="Task IDs start with this, e.g. WEB-001">
            Task prefix
            <input
              className="short"
              value={s.key}
              onChange={(e) => update({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })}
            />
          </label>
          {s.created && <span className="created">Created {s.created}</span>}
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Overview</h2>
          {project.hasFile && (
            <button className="btn small" onClick={() => openFile(`${project.dir}/project.md`)}>
              Edit overview
            </button>
          )}
        </div>
        <p className="overview">{project.overview || 'No overview yet.'}</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Tasks</h2>
          <button
            className="btn small"
            onClick={async () => {
              const path = await createTask(slug, { title: 'New task' })
              if (path) await openFile(path)
            }}
          >
            New task
          </button>
          <button className="btn small primary" onClick={(e) => openBoard(slug, { newTab: e.ctrlKey })}>
            Open board
          </button>
        </div>
        <div className="task-counts">
          {TASK_STATUSES.map((st) => (
            <span key={st}>
              <b>{projectTasks.filter((t) => t.status === st).length}</b> {TASK_STATUS_LABEL[st]}
            </span>
          ))}
        </div>
        <ul className="page-list">
          {projectTasks
            .filter((t) => t.status === 'doing' || t.status === 'todo')
            .sort(byUrgency)
            .slice(0, 6)
            .map((t) => (
              <li key={t.path}>
                <button onClick={(e) => openFile(t.path, { newTab: e.ctrlKey })}>
                  <span className="task-id">{t.id}</span>
                  {t.title}
                  {t.due && <span className={`due ${dueState(t)}`}>{formatDue(t.due)}</span>}
                </button>
              </li>
            ))}
        </ul>
      </section>

      <section className="card">
        <h2>Code repository</h2>
        <div className="field-row">
          <input
            value={s.repo.path}
            placeholder="Local folder, e.g. C:\Users\me\source\repos\my-app"
            onChange={(e) => update({ repo: { ...s.repo, path: e.target.value } })}
          />
          <button
            className="btn small"
            onClick={async () => {
              const p = await window.api.pickPath('folder')
              if (p) update({ repo: { ...s.repo, path: p } })
            }}
          >
            Choose…
          </button>
        </div>
        {s.repo.path && (
          <div className="actions">
            <button className="btn small" onClick={thenSaved(() => window.api.openPath(s.repo.path), "Couldn't open the folder.")}>
              Open folder
            </button>
            <button className="btn small" onClick={thenSaved(() => window.api.openInCode(s.repo.path), "Couldn't open VS Code.")}>
              Open in VS Code
            </button>
            <button className="btn small" onClick={thenSaved(() => window.api.revealPath(s.repo.path), "Couldn't show it in Explorer.")}>
              Show in Explorer
            </button>
          </div>
        )}
        <div className="field-row">
          <input
            value={s.repo.remote}
            placeholder="Remote URL, e.g. https://github.com/me/my-app"
            onChange={(e) => update({ repo: { ...s.repo, remote: e.target.value } })}
          />
          {/^https?:\/\//i.test(s.repo.remote) && (
            <button className="btn small" onClick={() => window.open(s.repo.remote)}>
              Open
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Links</h2>
          <button className="btn small" onClick={() => update({ links: [...s.links, { title: '', url: 'https://' }] })}>
            Add link
          </button>
        </div>
        {s.links.length === 0 && <p className="empty">Websites, docs, dashboards… anything that opens in a browser.</p>}
        {s.links.map((l, i) => (
          <div className="field-row" key={i}>
            <input
              className="link-title"
              value={l.title}
              placeholder="Title"
              onChange={(e) => update({ links: s.links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
            />
            <input
              value={l.url}
              placeholder="https://…"
              onChange={(e) => update({ links: s.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
            <button className="btn small" disabled={!/^https?:\/\/./i.test(l.url)} onClick={() => window.open(l.url)}>
              Open
            </button>
            <button className="icon-btn" title="Remove" onClick={() => update({ links: s.links.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Bookmarks</h2>
          {(['file', 'folder'] as const).map((kind) => (
            <button
              key={kind}
              className="btn small"
              onClick={async () => {
                const p = await window.api.pickPath(kind)
                if (p) update({ bookmarks: [...s.bookmarks, { title: p.split(/[\\/]/).pop() ?? p, path: p }] })
              }}
            >
              Add {kind}…
            </button>
          ))}
        </div>
        {s.bookmarks.length === 0 && <p className="empty">Files and folders on this PC that belong to the project.</p>}
        {s.bookmarks.map((b, i) => (
          <div className="field-row" key={i}>
            <input
              className="link-title"
              value={b.title}
              placeholder="Title"
              onChange={(e) =>
                update({ bookmarks: s.bookmarks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })
              }
            />
            <span className="path" title={b.path}>
              {b.path}
            </span>
            <button className="btn small" onClick={thenSaved(() => window.api.openPath(b.path), "Couldn't open it.")}>
              Open
            </button>
            <button className="btn small" onClick={thenSaved(() => window.api.revealPath(b.path), "Couldn't show it.")}>
              Show
            </button>
            <button className="icon-btn" title="Remove" onClick={() => update({ bookmarks: s.bookmarks.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Boards</h2>
          <button className="btn small" onClick={() => createBoard(`${project.dir}/boards`)}>
            New board
          </button>
        </div>
        {projectBoards.length === 0 && <p className="empty">Whiteboards for sketching, mapping and planning.</p>}
        <ul className="page-list">
          {projectBoards.map((b) => (
            <li key={b}>
              <button onClick={(e) => openCanvas(b, { newTab: e.ctrlKey })}>
                ✎ {baseName(b).replace(/.excalidraw$/i, '')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Wiki</h2>
          <button className="btn small" onClick={() => newNote(`${project.dir}/wiki`)}>
            New page
          </button>
        </div>
        {wiki.length === 0 && <p className="empty">No wiki pages yet.</p>}
        <ul className="page-list">
          {wiki.map((n) => (
            <li key={n}>
              <button onClick={(e) => openFile(n, { newTab: e.ctrlKey })}>
                {baseName(n)}
                <span className="recent-path">{n.slice(project.dir.length + 6, -baseName(n).length - 4)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {other.length > 0 && (
        <section className="card">
          <h2>Other notes</h2>
          <ul className="page-list">
            {other.map((n) => (
              <li key={n}>
                <button onClick={(e) => openFile(n, { newTab: e.ctrlKey })}>{baseName(n)}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
