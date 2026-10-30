import type { Vault } from './vault'
import { listProjects } from './projects'
import { listTasks } from './tasks'
import type { AppCommand, Task } from '@shared/types'
import type { Prefs } from '@shared/prefs'

/**
 * Periodic "prods": at most one Windows notification per interval, inside working hours, about the
 * thing most worth a nudge. Clicking it opens the task/project with a banner offering
 * "don't nag about this" and snooze.
 */

const TICK = 5 * 60_000

export interface Nudge {
  /** Stable id used for muting: a task path or "project:<slug>" */
  key: string
  title: string
  body: string
  command: AppCommand
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

function niceDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Is now a time Bill wants nudges? */
export function inQuietTime(p: Prefs, now = new Date()): boolean {
  const n = p.nudges
  if (n.snoozedUntil > now.getTime()) return true
  const day = now.getDay()
  if (n.weekdaysOnly && (day === 0 || day === 6)) return true
  const h = now.getHours()
  // endHour is exclusive; a window like 22 → 6 wraps past midnight
  const inside = n.startHour <= n.endHour ? h >= n.startHour && h < n.endHour : h >= n.startHour || h < n.endHour
  return !inside
}

/** Candidates in priority order; the caller skips muted ones and the one nudged last time */
export async function candidates(vault: Vault, p: Prefs, now = new Date()): Promise<Nudge[]> {
  const projects = await listProjects(vault)
  const live = new Map(projects.filter((x) => x.status !== 'done').map((x) => [x.slug, x]))
  const tasks = (await listTasks(vault)).filter((t) => t.status !== 'done' && live.has(t.project))
  const today = isoDay(now)
  const tomorrow = isoDay(new Date(now.getTime() + 86400000))
  const open = (t: Task, nudge: Omit<Nudge, 'command' | 'key'>): Nudge => ({
    key: t.path,
    ...nudge,
    command: { kind: 'open', path: t.path, nudge: { key: t.path, message: nudge.body } }
  })
  const out: Nudge[] = []

  for (const t of tasks.filter((t) => t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due))) {
    out.push(open(t, { title: `${t.id} is overdue`, body: `${t.title} (was due ${niceDate(t.due)}). Five minutes on it now?` }))
  }
  for (const t of tasks.filter((t) => t.due === today)) {
    out.push(open(t, { title: `${t.id} is due today`, body: `${t.title}. Want to get it done?` }))
  }
  for (const t of tasks.filter((t) => t.due === tomorrow)) {
    out.push(open(t, { title: `${t.id} is due tomorrow`, body: `${t.title}. A head start today?` }))
  }
  for (const t of tasks.filter((t) => t.status === 'doing')) {
    out.push(open(t, { title: `Still on ${t.id}?`, body: `${t.title} is in Doing. Pick it back up, or move it on.` }))
  }
  const staleBefore = now.getTime() - p.nudges.staleDays * 86400000
  for (const proj of [...live.values()].filter((x) => x.status === 'active' && x.updated && x.updated < staleBefore)) {
    const days = Math.floor((now.getTime() - proj.updated) / 86400000)
    out.push({
      key: `project:${proj.slug}`,
      title: `${proj.title} has gone quiet`,
      body: `Nothing's changed for ${days} days. Pick one small thing to move it on?`,
      command: {
        kind: 'open-project',
        slug: proj.slug,
        nudge: { key: `project:${proj.slug}`, message: `Nothing's changed for ${days} days.` }
      }
    })
  }
  // "Pick one thing": the most important thing waiting in To do
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 }
  for (const t of tasks.filter((t) => t.status === 'todo').sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 3)) {
    out.push(open(t, { title: 'Pick one thing', body: `${t.id}: ${t.title}` }))
  }
  // A task can qualify twice (overdue and waiting); keep its most urgent reason
  return out.filter((n, i) => out.findIndex((x) => x.key === n.key) === i)
}

interface Deps {
  vault(): Vault | null
  prefs(): Prefs
  lastNudge(): { at: number; key: string }
  setLastNudge(at: number, key: string): void
  show(n: Nudge): void
  nothing(): void
}

export function startNudges(d: Deps) {
  const pick = async (force: boolean) => {
    const v = d.vault()
    const p = d.prefs()
    if (!v) return null
    const last = d.lastNudge()
    const all = (await candidates(v, p)).filter((n) => !p.nudges.muted.includes(n.key))
    // Don't repeat the previous nudge if there's anything else to say
    return all.find((n) => n.key !== last.key) ?? (force ? all[0] : null) ?? null
  }

  const tick = async () => {
    const p = d.prefs()
    if (!p.nudges.enabled || inQuietTime(p)) return
    if (Date.now() - d.lastNudge().at < p.nudges.everyMinutes * 60_000) return
    const n = await pick(false).catch(() => null)
    if (!n) return
    d.setLastNudge(Date.now(), n.key)
    d.show(n)
  }

  const timer = setInterval(() => void tick(), TICK)
  setTimeout(() => void tick(), 60_000) // first check a minute after start

  return {
    stop: () => clearInterval(timer),
    /** "Nudge me now" from Settings: skips the timing rules */
    async now() {
      const n = await pick(true)
      if (!n) return d.nothing()
      d.setLastNudge(Date.now(), n.key)
      d.show(n)
    }
  }
}
