import { Facet } from '@codemirror/state'
import type { MenuItem } from '../store'
import type { Suggestion } from './Prompt'

/**
 * What the editor asks of the app around it: the prompt box, right-click style menus, and the
 * vault for pictures. Editor.tsx provides it.
 */
export interface EditorHost {
  ask(
    title: string,
    opts?: { placeholder?: string; initial?: string; action?: string; allowEmpty?: boolean; suggest?: (text: string) => Suggestion[] }
  ): Promise<string | null>
  /** A menu at a point on screen */
  menu(x: number, y: number, items: MenuItem[]): void
  /** Save a pasted or dropped picture for this note; resolves to its path relative to the note */
  saveImage(data: Blob, name: string): Promise<string | null>
  /** Ask for a picture file and save it like a pasted one */
  pickImage(): Promise<string | null>
  /** A URL the page can show for a picture's path as written in the note */
  imageSrc(path: string): string
  /** A URL for an embedded picture, ![[name]], found by name anywhere in the vault; null if there's none */
  embedSrc(name: string): string | null
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({ combine: (v) => v[0] ?? null })

const parts = (p: string) => p.split('/').filter((s) => s && s !== '.')

/** A path written in a note in `dir`, as a vault-relative path */
export function resolvePath(dir: string, path: string): string {
  const out = parts(dir)
  for (const s of parts(path)) {
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}

/** How a note in `dir` writes the vault-relative path `to` */
export function relativePath(dir: string, to: string): string {
  const from = parts(dir)
  const target = parts(to)
  let same = 0
  while (same < from.length && same < target.length - 1 && from[same] === target[same]) same++
  return [...from.slice(same).map(() => '..'), ...target.slice(same)].join('/')
}
