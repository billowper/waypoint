import { useStore } from '../store'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { stats, recent, openFile, newNote, tree, projects, openProject, createProject } = useStore()
  const active = projects.filter((p) => p.status === 'active')
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
        <div className="stat muted">
          <span className="stat-num">—</span>
          <span className="stat-label">tasks due · phase 3</span>
        </div>
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
