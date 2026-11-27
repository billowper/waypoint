/**
 * The messages between Waypoint's main process and a plugin's process (a utilityProcess running runner.ts),
 * over the process's parent port. Both sides import these types; nothing else does.
 *
 * Calls match answers by `id`, in each direction: `req`/`res` are the plugin calling Waypoint (host.*),
 * `call`/`ret` are Waypoint calling the plugin (a page's waypoint.call, answered by a host.handle function).
 */

export interface RunnerInit {
  id: string
  dir: string
  version: string
  /** Absolute path of the plugin's main module, or null when it has none (then there is no process at all) */
  main: string
  appVersion: string
  dataDir: string
  vaultRoot: string | null
}

export type Failure = { error: string; status?: number }

/** Waypoint → plugin process */
export type ToRunner =
  | ({ t: 'init' } & RunnerInit)
  | { t: 'stop' }
  /** The answer to a `req` */
  | ({ t: 'res'; id: number; ok: true; value?: unknown } | ({ t: 'res'; id: number; ok: false } & Failure))
  | { t: 'call'; id: number; method: string; params: unknown }
  /** Task files changed (only sent after the plugin subscribed with tasks.onChange) */
  | { t: 'tasks-changed'; ids: string[] }
  /** Projects were added, renamed or had their project.md changed (only sent after projects.onChange) */
  | { t: 'projects-changed'; slugs: string[] }

/** Plugin process → Waypoint */
export type FromRunner =
  /** activate finished */
  | { t: 'ready' }
  /** activate threw; the process is about to exit */
  | { t: 'failed'; error: string }
  /** deactivate finished (or threw); the process is about to exit */
  | { t: 'stopped' }
  | { t: 'req'; id: number; method: string; params: unknown[] }
  | ({ t: 'ret'; id: number; ok: true; value?: unknown } | ({ t: 'ret'; id: number; ok: false } & Failure))
  | { t: 'emit'; event: string; data: unknown }
