import type { ReactNode } from 'react'
import { useStore } from '../store'

/** How an icon value is drawn: an emoji, or a picture stored in the vault's .app/icons/ */
export function IconGlyph({ icon, className = '' }: { icon: string; className?: string }) {
  if (icon.startsWith('img:')) {
    return <img className={`item-icon img ${className}`} src={`wp-icon://i/${encodeURIComponent(icon.slice(4))}`} alt="" draggable={false} />
  }
  return <span className={`item-icon emoji ${className}`}>{icon}</span>
}

/** Default icon for a note without one: a page outline in the fixed icon colour */
export function DocIcon() {
  return (
    <svg className="item-icon doc-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.75h5.25L12.5 5v9.25H4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 1.75V5.25h3.5M6 8.25h4.5M6 10.75h4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** A note gets the page icon by default; tasks show their ID instead, so they get none */
export const noteDefault = (path: string, isTask: boolean) =>
  path.toLowerCase().endsWith('.md') && !isTask ? <DocIcon /> : null

/** The icon chosen for a note/board/folder/task/project (by vault path), or `fallback` if none */
export default function Icon({ path, fallback, className }: { path: string; fallback?: ReactNode; className?: string }) {
  const icon = useStore((s) => s.icons[path])
  if (!icon) return <>{fallback ?? null}</>
  return <IconGlyph icon={icon} className={className} />
}
