import type { ReactNode } from 'react'
import { useStore } from '../store'

/** How an icon value is drawn: an emoji, or a picture stored in the vault's .app/icons/ */
export function IconGlyph({ icon, className = '' }: { icon: string; className?: string }) {
  if (icon.startsWith('img:')) {
    return <img className={`item-icon img ${className}`} src={`wp-icon://i/${encodeURIComponent(icon.slice(4))}`} alt="" draggable={false} />
  }
  return <span className={`item-icon emoji ${className}`}>{icon}</span>
}

/** The icon chosen for a note/board/folder/task/project (by vault path), or `fallback` if none */
export default function Icon({ path, fallback, className }: { path: string; fallback?: ReactNode; className?: string }) {
  const icon = useStore((s) => s.icons[path])
  if (!icon) return <>{fallback ?? null}</>
  return <IconGlyph icon={icon} className={className} />
}
