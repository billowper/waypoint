import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type Task, type TaskStatus } from '@shared/types'
import { useStore } from '../store'

/** Pixels the pointer must move before a press on a card becomes a drag */
const DRAG_THRESHOLD = 5

interface Drag {
  task: Task
  /** Top-left of the floating card, following the pointer */
  x: number
  y: number
  width: number
}

function CardBody({ t }: { t: Task }) {
  return (
    <>
      <div className="task-title">{t.title}</div>
      <div className="task-meta">
        <span className="task-id">{t.id}</span>
        {t.priority !== 'medium' && <span className={`badge priority-${t.priority}`}>{t.priority}</span>}
        {t.due && <span className={`due ${dueState(t)}`}>{formatDue(t.due)}</span>}
        {t.labels.map((l) => (
          <span key={l} className="label">
            {l}
          </span>
        ))}
      </div>
    </>
  )
}
const PRIORITY_RANK: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const todayIso = () => new Date().toISOString().slice(0, 10)

/** "overdue" / "today" / "soon" (within 3 days) for colouring due dates */
export function dueState(t: Task): string {
  if (!t.due || t.status === 'done') return ''
  const today = todayIso()
  if (t.due < today) return 'overdue'
  if (t.due === today) return 'today'
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  return t.due <= soon ? 'soon' : ''
}

export function formatDue(due: string): string {
  if (!due) return ''
  const d = new Date(due + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Default card order: most urgent first, then soonest due, then ID */
export const byUrgency = (a: Task, b: Task) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  (a.due || '9999').localeCompare(b.due || '9999') ||
  a.id.localeCompare(b.id, undefined, { numeric: true })

type SortKey = 'id' | 'title' | 'status' | 'priority' | 'due'

function loadMode(slug: string): 'board' | 'list' {
  try {
    return localStorage.getItem(`waypoint:boardMode:${slug}`) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

export default function Board({ slug }: { slug: string }) {
  const { tasks, projects, openFile, openProject, createTask, updateTask } = useStore()
  const project = projects.find((p) => p.slug === slug)
  const mine = tasks.filter((t) => t.project === slug)
  const [mode, setMode] = useState<'board' | 'list'>(() => loadMode(slug))
  const [filter, setFilter] = useState('')
  const [dropOn, setDropOn] = useState<TaskStatus | null>(null)
  const [adding, setAdding] = useState<TaskStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'id', asc: true })

  const q = filter.trim().toLowerCase()
  const shown = q
    ? mine.filter((t) => `${t.id} ${t.title} ${t.labels.join(' ')}`.toLowerCase().includes(q))
    : mine

  const switchMode = (m: 'board' | 'list') => {
    setMode(m)
    try {
      localStorage.setItem(`waypoint:boardMode:${slug}`, m)
    } catch {
      /* ignore */
    }
  }

  const open = (t: Task) => (e: MouseEvent) => openFile(t.path, { newTab: e.ctrlKey })

  const add = async (status: TaskStatus) => {
    const title = draft.trim()
    setDraft('')
    setAdding(null)
    if (title) await createTask(slug, { title, status })
  }

  // Cards are dragged with pointer events rather than HTML drag-and-drop: the card follows the
  // pointer and lands on the column under it. Smoother, and no OS drag loop to get stuck in.
  const [drag, setDrag] = useState<Drag | null>(null)

  const columnAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-status]')?.getAttribute('data-status') as TaskStatus | null) ?? null

  const onCardPointerDown = (t: Task) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    let started = false
    const move = (ev: globalThis.PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
      started = true
      setDrag({ task: t, x: ev.clientX - (start.x - r.left), y: ev.clientY - (start.y - r.top), width: r.width })
      setDropOn(columnAt(ev.clientX, ev.clientY))
    }
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', cancel)
      if (!started) return // a plain click: onClick opens the task
      // Swallow the click that may follow this pointerup (only if it lands on the same card),
      // then stop swallowing, so the next real click still works
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      const target = columnAt(ev.clientX, ev.clientY)
      setDrag(null)
      setDropOn(null)
      if (target && target !== t.status) updateTask(t.path, { status: target })
    }
    const cancel = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      started = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', cancel)
      setDrag(null)
      setDropOn(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', cancel)
  }
  const suppressClick = useRef(false)

  if (!project) return <div className="board-page"><p className="empty">This project no longer exists.</p></div>

  const sorted = [...shown].sort((a, b) => {
    const k = sort.key
    const cmp =
      k === 'priority'
        ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        : k === 'status'
          ? TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status)
          : k === 'due'
            ? (a.due || '9999').localeCompare(b.due || '9999')
            : a[k].localeCompare(b[k], undefined, { numeric: true, sensitivity: 'base' })
    return sort.asc ? cmp : -cmp
  })
  const header = (key: SortKey, label: string) => (
    <th>
      <button onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label}
        {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )

  return (
    <div className="board-page">
      <header className="board-head">
        <button className="crumb-link" onClick={() => openProject(slug)}>
          {project.title}
        </button>
        <h1>Tasks</h1>
        <input className="board-filter" value={filter} placeholder="Filter…" onChange={(e) => setFilter(e.target.value)} />
        <div className="mode-switch">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => switchMode('board')}>
            Board
          </button>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => switchMode('list')}>
            List
          </button>
        </div>
        <button className="btn small primary" onClick={() => setAdding('todo')}>
          New task
        </button>
      </header>

      {mode === 'board' ? (
        <div className="columns">
          {TASK_STATUSES.map((status) => {
            const cards = shown.filter((t) => t.status === status).sort(byUrgency)
            return (
              <section
                key={status}
                data-status={status}
                className={`column ${drag && dropOn === status && drag.task.status !== status ? 'drop-target' : ''}`}
              >
                <h2>
                  {TASK_STATUS_LABEL[status]} <span className="count">{cards.length}</span>
                </h2>
                {cards.map((t) => (
                  <article
                    key={t.path}
                    className={`task-card priority-${t.priority} ${drag?.task.path === t.path ? 'dragging' : ''}`}
                    onPointerDown={onCardPointerDown(t)}
                    onClick={(e) => {
                      if (suppressClick.current) return void (suppressClick.current = false)
                      open(t)(e)
                    }}
                    title="Click to open · drag to another column"
                  >
                    <CardBody t={t} />
                  </article>
                ))}
                {adding === status ? (
                  <input
                    className="quick-add"
                    autoFocus
                    value={draft}
                    placeholder="Task title, Enter to add"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') add(status)
                      else if (e.key === 'Escape') setAdding(null)
                    }}
                    onBlur={() => add(status)}
                  />
                ) : (
                  <button className="add-card" onClick={() => setAdding(status)}>
                    + Add task
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <>
          {adding && (
            <input
              className="quick-add list-add"
              autoFocus
              value={draft}
              placeholder="Task title, Enter to add"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add(adding)
                else if (e.key === 'Escape') setAdding(null)
              }}
              onBlur={() => add(adding)}
            />
          )}
          <table className="task-table">
            <thead>
              <tr>
                {header('id', 'ID')}
                {header('title', 'Title')}
                {header('status', 'Status')}
                {header('priority', 'Priority')}
                {header('due', 'Due')}
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.path}>
                  <td className="task-id">{t.id}</td>
                  <td>
                    <button className="row-title" onClick={open(t)}>
                      {t.title}
                    </button>
                  </td>
                  <td>
                    <select value={t.status} onChange={(e) => updateTask(t.path, { status: e.target.value as TaskStatus })}>
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={t.priority}
                      onChange={(e) => updateTask(t.path, { priority: e.target.value as Task['priority'] })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`due ${dueState(t)}`}>{formatDue(t.due)}</td>
                  <td>{t.labels.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <p className="empty">No tasks{q ? ' match the filter' : ' yet'}.</p>}
        </>
      )}
      {drag && (
        <article
          className={`task-card priority-${drag.task.priority} floating`}
          style={{ left: drag.x, top: drag.y, width: drag.width }}
        >
          <CardBody t={drag.task} />
        </article>
      )}
    </div>
  )
}
