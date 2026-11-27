import type { ReactNode } from 'react'
import { LineIcon } from './Icon'

/**
 * The icon names a plugin's view may use in plugin.json ("icon": "inbox"): SVG line icons in the same style and
 * size as the sidebar's section icons (Icon.tsx sectionIcon). Anything unknown shows a puzzle piece.
 * The names are listed in docs/plugins.md.
 */
const GLYPHS: Record<string, () => ReactNode> = {
  puzzle: () => <path d="M6 2.5h3v1.6a1.2 1.2 0 1 1 0 2.4V8h1.5a1.2 1.2 0 1 1 2.4 0h.1v5.5H6.5v-1.6a1.2 1.2 0 1 0-2.4 0v1.6H2.5V9H4a1.2 1.2 0 1 0 0-2.4H2.5V4A1.5 1.5 0 0 1 4 2.5z" />,
  inbox: () => <path d="M2 9l1.8-5.5h8.4L14 9v4H2zM2 9h3.8l.7 1.6h3l.7-1.6H14" />,
  chart: () => <path d="M2.5 2.5v11h11M5.5 10.5V8M8.5 10.5V5.5M11.5 10.5V7" />,
  list: () => <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" />,
  table: () => <path d="M2.5 3h11v10h-11zM2.5 6.5h11M2.5 10h11M7 3v10" />,
  calendar: () => <path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3" />,
  clock: () => <><circle cx="8" cy="8" r="5.8" /><path d="M8 4.5V8l2.3 1.5" /></>,
  folder: () => <path d="M2 4.5V12.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.6 3.5H3a1 1 0 0 0-1 1z" />,
  file: () => <path d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5" />,
  note: () => <path d="M3 2.5h10v8l-3 3H3zM10 13.5v-3h3M5.5 5.5h5M5.5 8h3" />,
  book: () => <><path d="M3 2.5h8.5A1.5 1.5 0 0 1 13 4v9.5H4.5A1.5 1.5 0 0 1 3 12z" /><path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H13M6 5.5h4" /></>,
  search: () => <><circle cx="7" cy="7" r="4.3" /><path d="M10.2 10.2L13.5 13.5" /></>,
  settings: () => <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3" />,
  star: () => <path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z" />,
  flag: () => <path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6 1.6 2.6h-8" />,
  bug: () => <><path d="M5.5 5.5a2.5 2.5 0 0 1 5 0v4a2.5 2.5 0 0 1-5 0zM5.5 7.5h-3M10.5 7.5h3M5.5 10.5L3.5 12.5M10.5 10.5l2 2M6 3.5L4.5 2M10 3.5L11.5 2M8 6v6" /></>,
  bolt: () => <path d="M9 1.8L3.8 9h3.7l-.6 5.2L12.2 7H8.5z" />,
  bell: () => <path d="M3.5 11.5h9l-1.2-1.8V7a3.3 3.3 0 0 0-6.6 0v2.7zM6.7 13.5h2.6" />,
  mail: () => <path d="M2 3.5h12v9H2zM2.5 4l5.5 4.5L13.5 4" />,
  link: () => <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />,
  globe: () => <><circle cx="8" cy="8" r="5.8" /><path d="M2.2 8h11.6M8 2.2c-2.2 2.3-2.2 9.3 0 11.6M8 2.2c2.2 2.3 2.2 9.3 0 11.6" /></>,
  tag: () => <><path d="M2.5 2.5h5.3l6 6-5.3 5.3-6-6z" /><circle cx="5.5" cy="5.5" r="0.9" /></>,
  image: () => <><rect x="2" y="2.75" width="12" height="10.5" rx="1.2" /><circle cx="5.6" cy="6.3" r="1.1" /><path d="M2.5 12l3.4-3.4 2.4 2.3 2-1.9 3.2 3" /></>,
  code: () => <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3.5L7 12.5" />,
  terminal: () => <path d="M2 3h12v10H2zM4.5 6l2.2 2-2.2 2M8 10.5h3" />,
  heart: () => <path d="M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z" />,
  home: () => <path d="M2 7.5L8 2.5l6 5M3.5 6.8V13.5h3.2V10h2.6v3.5h3.2V6.8" />,
  user: () => <><circle cx="8" cy="5.5" r="2.7" /><path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0z" /></>,
  chat: () => <path d="M2 3h12v8H8.5L5.5 13.5V11H2z" />,
  tool: () => <path d="M10.5 2.5a3 3 0 0 0-2.8 4L2.5 11.7a1.4 1.4 0 0 0 2 2L9.7 8.5a3 3 0 0 0 4-2.8L11.9 7.5 9.5 6.5 8.5 4.1z" />,
  database: () => <><ellipse cx="8" cy="4" rx="5" ry="1.8" /><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></>,
  map: () => <path d="M2 3.5l4 1.5 4-1.5 4 1.5v8l-4-1.5-4 1.5-4-1.5zM6 5v8M10 3.5v8" />
}

export const PLUGIN_ICON_NAMES = Object.keys(GLYPHS)

/** The icon for a plugin view's icon name (a puzzle piece when unknown) */
export const pluginGlyph = (name?: string): ReactNode => <LineIcon>{(GLYPHS[name ?? ''] ?? GLYPHS.puzzle)()}</LineIcon>
