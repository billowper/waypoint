import { useEffect, useState } from 'react'
import type { Backlink } from '@shared/types'
import { baseName } from '@shared/names'
import { useStore } from '../store'
import { noteMenu, showMenu } from '../menus'

/** Show a line of markdown roughly as it reads: link text instead of [[link|syntax]] */
const readable = (line: string) =>
  line
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]#]+)(#[^\]]*)?\]\]/g, '$1')
    .replace(/^\s*(#+|[-*+]( \[[ xX]\])?|\d+\.|>)\s+/, '')
    .trim()

/** "Linked from": notes whose [[links]] point at the open note */
export default function Backlinks({ path }: { path: string }) {
  const openFile = useStore((s) => s.openFile)
  const [links, setLinks] = useState<Backlink[] | null>(null)

  useEffect(() => {
    let live = true
    const load = () => window.api.backlinks(path).then((l) => live && setLinks(l))
    load()
    const off = window.api.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [path])

  return (
    <aside className="backlinks">
      <h2>
        Linked from <span className="count">{links?.length ?? ''}</span>
      </h2>
      {links && links.length === 0 && (
        <p className="empty">
          No notes link here yet. Type <code>[[</code> in another note to link to this one.
        </p>
      )}
      <ul>
        {links?.map((b) => (
          <li key={b.path}>
            <button
              className="bl-note"
              title={b.path}
              onClick={(e) => openFile(b.path, { newTab: e.ctrlKey })}
              onContextMenu={(e) => showMenu(e, noteMenu(b.path))}
            >
              {baseName(b.path)}
            </button>
            {b.lines.map((l) => (
              <button
                key={l.line}
                className="bl-line"
                onClick={(e) => openFile(b.path, { newTab: e.ctrlKey, reveal: { line: l.line } })}
              >
                {readable(l.text) || '…'}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </aside>
  )
}
