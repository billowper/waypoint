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

/** Line icon in the same style as DocIcon (fixed icon colour in every theme) */
export function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="item-icon doc-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

/**
 * Default icons for the first-level subsections under a project in the sidebar tree, by what they hold.
 * Display only, and a custom icon (the icon picker) always replaces them. Unknown folders get the plain folder.
 */
const SECTION_ICONS: Record<string, () => ReactNode> = {
  docs: () => <DocIcon />,
  wiki: () => (
    <LineIcon>
      <path d="M3 2.5h8.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12z" />
      <path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H13M6 5.5h4" />
    </LineIcon>
  ),
  tasks: () => (
    <LineIcon>
      <path d="M2.5 4.5l1.2 1.2 2-2.2M2.5 10.5l1.2 1.2 2-2.2M8 5h5.5M8 11h5.5" />
    </LineIcon>
  ),
  boards: () => (
    <LineIcon>
      <rect x="2" y="2.5" width="3.6" height="11" rx="0.8" />
      <rect x="6.2" y="2.5" width="3.6" height="7" rx="0.8" />
      <rect x="10.4" y="2.5" width="3.6" height="9" rx="0.8" />
    </LineIcon>
  ),
  gallery: () => (
    <LineIcon>
      <rect x="2" y="2.75" width="12" height="10.5" rx="1.2" />
      <circle cx="5.6" cy="6.3" r="1.1" />
      <path d="M2.5 12l3.4-3.4 2.4 2.3 2-1.9 3.2 3" />
    </LineIcon>
  )
}

/** The default icon for a project subsection folder or entry, by its (lower-case) name */
export const sectionIcon = (name: string): ReactNode =>
  (SECTION_ICONS[name.toLowerCase()] ?? (() => (
    <LineIcon>
      <path d="M2 4.5V12.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.6 3.5H3a1 1 0 0 0-1 1z" />
    </LineIcon>
  )))()

/** Display name of a project subsection: first letter capitalised, anything the user capitalised left alone */
export const sectionLabel = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)
