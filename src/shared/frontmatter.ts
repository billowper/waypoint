import { parse, stringify } from 'yaml'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** Split "---\nyaml\n---\nbody" into data and body. Bad YAML yields empty data, body untouched. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string; hasFrontmatter: boolean } {
  const m = FRONTMATTER.exec(text)
  if (!m) return { data: {}, body: text, hasFrontmatter: false }
  let data: unknown
  try {
    data = parse(m[1])
  } catch {
    data = null
  }
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body: text.slice(m[0].length),
    hasFrontmatter: true
  }
}

export function joinFrontmatter(data: Record<string, unknown>, body: string): string {
  return `---\n${stringify(data, { lineWidth: 0 })}---\n${body}`
}

// Loose readers so hand-edited YAML of the wrong shape degrades gracefully
export const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : typeof v === 'string' && v ? [v] : []
export const objList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
