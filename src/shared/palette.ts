/**
 * Builds the app's whole colour palette (the CSS variables in styles.css) from one accent colour
 * (buttons, links, cursor, focus, highlights) and light/dark. Surfaces and text are near-neutral
 * greys tinted with the accent's hue; the accent is nudged lighter/darker until it stays readable.
 */

type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return Number.isNaN(n) ? [230, 170, 80] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbToHex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255])
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Move a colour's lightness away from the background until it reaches the target contrast */
function readable(color: string, bg: string, target: number, mode: 'dark' | 'light'): string {
  const [h, s, l0] = rgbToHsl(hexToRgb(color))
  let l = l0
  let out = color
  for (let i = 0; i < 40 && contrast(out, bg) < target; i++) {
    l = mode === 'dark' ? Math.min(0.95, l + 0.02) : Math.max(0.08, l - 0.02)
    out = hsl(h, s, l)
  }
  return out
}

const rgba = (hex: string, a: number) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`

export function palette(mode: 'dark' | 'light', accent: string): Record<string, string> {
  const [h, s] = rgbToHsl(hexToRgb(accent))
  // Just a hint of the accent's hue in the greys
  const t = Math.min(s, 0.6) * (mode === 'dark' ? 0.12 : 0.16)
  const g = (l: number, sat = t) => hsl(h, sat, l)
  const surfaces =
    mode === 'dark'
      ? { bg: g(0.095), sidebar: g(0.11), panel: g(0.13), hover: g(0.165), active: g(0.195), border: g(0.18) }
      : { bg: g(0.97), sidebar: g(0.94), panel: g(0.995), hover: g(0.905), active: g(0.87), border: g(0.86) }
  const text =
    mode === 'dark'
      ? { text: g(0.83, t * 0.7), strong: g(0.94, t * 0.5), dim: g(0.6, t * 0.6), faint: g(0.41, t * 0.6) }
      : { text: g(0.2, t * 0.8), strong: g(0.08, t * 0.6), dim: g(0.42, t * 0.7), faint: g(0.62, t * 0.6) }
  const p = readable(accent, surfaces.bg, 3, mode)
  const [ah, as] = rgbToHsl(hexToRgb(p))
  const ink = contrast('#ffffff', p) >= contrast('#111111', p) ? '#ffffff' : '#141210'
  return {
    '--bg': surfaces.bg,
    '--sidebar': surfaces.sidebar,
    '--panel': surfaces.panel,
    '--hover': surfaces.hover,
    '--active': surfaces.active,
    '--border': surfaces.border,
    '--text': text.text,
    '--text-strong': text.strong,
    '--text-dim': text.dim,
    '--text-faint': text.faint,
    '--accent': p,
    '--accent-ink': ink,
    '--selection': rgba(p, mode === 'dark' ? 0.22 : 0.2),
    '--highlight': p,
    '--highlight-soft': rgba(p, mode === 'dark' ? 0.26 : 0.22),
    '--code': hsl(ah, Math.min(as, 0.7), mode === 'dark' ? 0.74 : 0.34),
    '--tint': mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
    '--scrollbar': mode === 'dark' ? g(0.24) : g(0.78),
    '--quote': mode === 'dark' ? g(0.3) : g(0.8)
  }
}
