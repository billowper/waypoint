import { useStore } from '../store'
import { byUrgency, dueState, formatDue } from './Board'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { stats, recent, openFile, newNote, tree, projects, openProject, createProject, tasks } = useStore()
  const active = projects.filter((p) => p.status === 'active')
  // My work: open tasks in projects that aren't finished, overdue first
  const liveProjects = new Set(projects.filter((p) => p.status !== 'done').map((p) => p.slug))
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'backlog' && liveProjects.has(t.project))
  const myWork = [...open].sort(
    (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || byUrgency(a, b)
  )
  const dueSoon = open.filter((t) => ['overdue', 'today', 'soon'].includes(dueState(t))).length
  const projectTitle = (slug: string) => projects.find((p) => p.slug === slug)?.title ?? slug
  const hasInbox = tree.some((n) => n.path === 'inbox.md')
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  return (
    <div className="home">
      <header className="home-head">
        <p className="eyebrow">{date}</p>
        <h1>{greeting()}.</h1>
      </header>

      <div className="home-actions">
        <button className="btn primary" onClick={() => newNote('notes')}>
          New note <kbd>Ctrl N</kbd>
        </button>
        <button className="btn" onClick={createProject}>
          New project
        </button>
        {hasInbox && (
          <button className="btn" onClick={() => openFile('inbox.md')}>
            Open inbox
          </button>
        )}
      </div>

      <section className="stat-row">
        <div className="stat">
          <span className="stat-num">{stats.notes}</span>
          <span className="stat-label">notes</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.projects}</span>
          <span className="stat-label">projects</span>
        </div>
        <div className={`stat ${dueSoon ? 'alert' : ''}`}>
          <span className="stat-num">{dueSoon}</span>
          <span className="stat-label">tasks due soon or overdue</span>
        </div>
      </section>

      <section className="panel">
        <h2>My work</h2>
        {myWork.length === 0 ? (
          <p className="empty">Nothing to do in To do or Doing. Enjoy it.</p>
        ) : (
          <ul className="recent">
            {myWork.slice(0, 12).map((t) => (
              <li key={t.path}>
                <button onClick={(e) => openFile(t.path, { newTab: e.ctrlKey })}>
                  <span className="task-id">{t.id}</span>
                  <span className="recent-name">{t.title}</span>
                  <span className="recent-path">
                    {projectTitle(t.project)} · {t.status === 'doing' ? 'doing' : 'to do'}
                  </span>
                  {t.due && <span className={`due ${dueState(t)}`}>{formatDue(t.due)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Active projects</h2>
        {active.length === 0 ? (
          <p className="empty">No active projects. Create one to keep its notes, links and tasks together.</p>
        ) : (
          <ul className="project-cards">
            {active.map((p) => (
              <li key={p.slug}>
                <button onClick={(e) => openProject(p.slug, { newTab: e.ctrlKey })}>
                  <span className="recent-name">{p.title}</span>
                  <span className="recent-path">
                    {p.tags.join(' · ')}
                    {p.tags.length ? ' · ' : ''}updated {new Date(p.updated || Date.now()).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Recent</h2>
        {recent.length === 0 ? (
          <p className="empty">Notes you open will show up here.</p>
        ) : (
          <ul className="recent">
            {recent.slice(0, 10).map((r) => (
              <li key={r}>
                <button onClick={() => openFile(r)}>
                  <span className="recent-name">{r.split('/').pop()!.replace(/\.md$/, '')}</span>
                  <span className="recent-path">{r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
