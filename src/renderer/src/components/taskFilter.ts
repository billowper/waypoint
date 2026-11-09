import { PRIORITIES, TASK_STATUSES, isForClaude, type Priority, type Task, type TaskStatus } from '@shared/types'

export const DUE_FILTERS = ['', 'overdue', 'today', 'week', 'dated', 'none'] as const
export type DueFilter = (typeof DUE_FILTERS)[number]
export const DUE_FILTER_LABEL: Record<DueFilter, string> = {
  '': 'Any',
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Next 7 days',
  dated: 'Has a date',
  none: 'No date'
}

/** What the board shows. An empty list means "all of them"; a task must pass every part */
export interface TaskFilters {
  status: TaskStatus[]
  priority: Priority[]
  /** Any of these labels */
  labels: string[]
  due: DueFilter
}

export const NO_FILTERS: TaskFilters = { status: [], priority: [], labels: [], due: '' }

/** Filters as saved (localStorage), with anything unknown dropped */
export function parseFilters(raw: unknown): TaskFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    status: TASK_STATUSES.filter((s) => list(r.status).includes(s)),
    priority: PRIORITIES.filter((p) => list(r.priority).includes(p)),
    labels: [...new Set(list(r.labels).filter((l): l is string => typeof l === 'string'))],
    due: DUE_FILTERS.includes(r.due as DueFilter) ? (r.due as DueFilter) : ''
  }
}

/** The labels in use (the Claude one aside: it has its own filter), A to Z */
export function labelsOf(tasks: Task[]): string[] {
  const all = new Set<string>()
  for (const t of tasks) for (const l of t.labels) if (!isForClaude({ labels: [l] })) all.add(l)
  return [...all].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Chosen labels no task has any more are ignored, so a stale choice can't hide everything */
export const liveFilters = (f: TaskFilters, tasks: Task[]): TaskFilters => {
  const known = labelsOf(tasks)
  return { ...f, labels: f.labels.filter((l) => known.includes(l)) }
}

/** How many parts of the filter are narrowing the list */
export const activeCount = (f: TaskFilters) =>
  (f.status.length ? 1 : 0) + (f.priority.length ? 1 : 0) + (f.labels.length ? 1 : 0) + (f.due ? 1 : 0)

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

function dueMatches(t: Task, due: DueFilter, today: string): boolean {
  switch (due) {
    case '':
      return true
    case 'none':
      return !t.due
    case 'dated':
      return !!t.due
    case 'overdue':
      return !!t.due && t.due < today && t.status !== 'done'
    case 'today':
      return t.due === today
    case 'week':
      return !!t.due && t.due >= today && t.due <= addDays(today, 7)
  }
}

/** `today` is YYYY-MM-DD */
export const matcher = (f: TaskFilters, today: string) => (t: Task) =>
  (!f.status.length || f.status.includes(t.status)) &&
  (!f.priority.length || f.priority.includes(t.priority)) &&
  (!f.labels.length || t.labels.some((l) => f.labels.includes(l))) &&
  dueMatches(t, f.due, today)

/** A list with one value switched on or off */
export const toggled = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
