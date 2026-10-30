import MiniSearch from 'minisearch'
import type { Vault } from './vault'
import type { Backlink, SearchHit } from '@shared/types'
import { parseLinks, resolveLink, type WikiLink } from '@shared/links'
import { baseName, titleOf } from '@shared/names'

interface Entry {
  text: string
  links: WikiLink[]
}

const MAX_HITS = 50
const MAX_LINES_PER_HIT = 3

/**
 * In-memory index of every note in the vault: text for full-text search and the wiki links
 * each note makes, for backlinks and link updating. Rebuilt from disk, never the source of truth.
 */
export class NotesIndex {
  private entries = new Map<string, Entry>()
  private search = this.newSearch()
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly vault: Vault) {}

  private newSearch() {
    return new MiniSearch<{ id: string; name: string; title: string; text: string }>({
      fields: ['name', 'title', 'text'],
      searchOptions: { boost: { name: 3, title: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' }
    })
  }

  /** Resolves once queued updates have been applied. */
  idle(): Promise<unknown> {
    return this.pending
  }

  private queue(fn: () => Promise<void>) {
    this.pending = this.pending.then(fn).catch((e) => console.error('[index]', e))
    return this.pending
  }

  paths(): string[] {
    return [...this.entries.keys()].sort()
  }

  rebuild() {
    return this.queue(async () => {
      const entries = new Map<string, Entry>()
      const search = this.newSearch()
      for (const rel of await this.vault.notePaths()) {
        const text = await this.vault.read(rel).catch(() => null)
        if (text === null) continue
        entries.set(rel, { text, links: parseLinks(text) })
        search.add(doc(rel, text))
      }
      this.entries = entries
      this.search = search
    })
  }

  update(rel: string) {
    return this.queue(async () => {
      const text = await this.vault.read(rel).catch(() => null)
      if (this.search.has(rel)) this.search.discard(rel)
      if (text === null) {
        this.entries.delete(rel)
        return
      }
      this.entries.set(rel, { text, links: parseLinks(text) })
      this.search.add(doc(rel, text))
    })
  }

  /** Forget a note, or every note under a folder. */
  remove(rel: string) {
    return this.queue(async () => {
      for (const p of [...this.entries.keys()]) {
        if (p === rel || p.startsWith(rel + '/')) {
          this.entries.delete(p)
          if (this.search.has(p)) this.search.discard(p)
        }
      }
    })
  }

  /** Notes whose links (as indexed) resolve to one of `targets`. */
  linkersOf(targets: Set<string>, notes = this.paths()): string[] {
    const out: string[] = []
    for (const [p, e] of this.entries) {
      if (e.links.some((l) => targets.has(resolveLink(l.target, p, notes) ?? ''))) out.push(p)
    }
    return out
  }

  backlinks(rel: string): Backlink[] {
    const notes = this.paths()
    const out: Backlink[] = []
    for (const [p, e] of this.entries) {
      if (p === rel) continue
      const hits = e.links.filter((l) => resolveLink(l.target, p, notes) === rel)
      if (!hits.length) continue
      const lines = new Map<number, string>()
      for (const l of hits) {
        const { line, text } = lineAt(e.text, l.from)
        lines.set(line, text)
      }
      out.push({ path: p, lines: [...lines].map(([line, text]) => ({ line, text })) })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  find(query: string): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return this.search
      .search(q)
      .slice(0, MAX_HITS)
      .map((r) => {
        const text = this.entries.get(r.id)?.text ?? ''
        const lines: SearchHit['lines'] = []
        text.split('\n').some((line, i) => {
          const lower = line.toLowerCase()
          const ranges: [number, number][] = []
          for (const t of terms) {
            for (let at = lower.indexOf(t); at !== -1; at = lower.indexOf(t, at + t.length)) {
              ranges.push([at, at + t.length])
            }
          }
          if (ranges.length) lines.push({ line: i + 1, text: line, ranges: ranges.sort((a, b) => a[0] - b[0]) })
          return lines.length >= MAX_LINES_PER_HIT
        })
        return { path: r.id, lines }
      })
  }
}

function doc(rel: string, text: string) {
  return { id: rel, name: baseName(rel), title: titleOf(text) ?? '', text }
}

function lineAt(text: string, pos: number) {
  const start = text.lastIndexOf('\n', pos - 1) + 1
  const end = text.indexOf('\n', pos)
  return { line: text.slice(0, start).split('\n').length, text: text.slice(start, end === -1 ? undefined : end) }
}
