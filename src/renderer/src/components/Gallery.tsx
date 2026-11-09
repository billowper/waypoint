import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Gallery as GalleryData, GalleryItem } from '@shared/types'
import { useStore, type MenuItem } from '../store'
import { showMenu } from '../menus'

// A project's gallery: the pictures and videos in the folders its project page lists (src/main/gallery.ts).
// A grid of thumbnails, and a viewer over the window for one at a time.

const THUMB_MIN = 80
const THUMB_MAX = 420
const THUMB_KEY = 'waypoint:galleryThumb'
const SORT_KEY = 'waypoint:gallerySort'
/** Tiles drawn at first, and added each time the end of the grid scrolls into view */
const PAGE = 240

type Sort = 'newest' | 'oldest' | 'name'
const SORT_LABEL: Record<Sort, string> = { newest: 'Newest first', oldest: 'Oldest first', name: 'Name' }
type Kind = 'all' | 'image' | 'video'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function stored<T>(key: string, read: (raw: string | null) => T): T {
  try {
    return read(localStorage.getItem(key))
  } catch {
    return read(null)
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/** wp-media:// address of a file, or of a thumbnail `thumb` pixels wide (the modified time makes a changed file reload) */
const mediaUrl = (it: GalleryItem, thumb?: number) =>
  `wp-media://${thumb ? 't' : 'f'}/${encodeURIComponent(it.path)}?m=${Math.round(it.modified)}${thumb ? `&w=${thumb}` : ''}`

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
const formatDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const MIME: Record<string, string> = { jpg: 'image/jpeg', svg: 'image/svg+xml' }

/**
 * Put a picture on the clipboard as an image, ready to paste into a chat, an email, a paint program.
 * PNG and JPEG go straight from the file; anything else is drawn here first and sent over as a PNG.
 */
async function copyImage(it: GalleryItem): Promise<void> {
  if (await window.api.galleryCopy(it.path)) return
  const ext = it.name.split('.').pop()!.toLowerCase()
  const bytes = await window.api.galleryRead(it.path)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? `image/${ext}` }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1024
    canvas.height = img.naturalHeight || 1024
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
    if (!blob) throw new Error("That picture couldn't be copied")
    await window.api.galleryCopyPng(new Uint8Array(await blob.arrayBuffer()))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A tile's picture: Windows' thumbnail, else the picture itself, else a plain placeholder */
function Thumb({ item, width }: { item: GalleryItem; width: number }) {
  const [stage, setStage] = useState(0)
  if (stage === 2 || (stage === 1 && item.kind === 'video')) return <span className="gallery-blank">{item.kind === 'video' ? '▶' : '?'}</span>
  return (
    <img
      src={stage === 0 ? mediaUrl(item, width) : mediaUrl(item)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setStage(stage + 1)}
    />
  )
}

export default function Gallery({ slug }: { slug: string }) {
  const project = useStore((s) => s.projects.find((p) => p.slug === slug))
  const openProject = useStore((s) => s.openProject)
  const [data, setData] = useState<GalleryData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [thumb, setThumbState] = useState(() => stored(THUMB_KEY, (v) => clamp(Number(v) || 180, THUMB_MIN, THUMB_MAX)))
  const [sort, setSortState] = useState<Sort>(() => stored(SORT_KEY, (v) => (v && v in SORT_LABEL ? (v as Sort) : 'newest')))
  const [kind, setKind] = useState<Kind>('all')
  const [folder, setFolder] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  /** Path of the file in the viewer */
  const [viewing, setViewing] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const say = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 2200)
  }, [])
  useEffect(() => () => void (noticeTimer.current && clearTimeout(noticeTimer.current)), [])

  const setThumb = (px: number) => {
    const next = clamp(Math.round(px), THUMB_MIN, THUMB_MAX)
    setThumbState(next)
    store(THUMB_KEY, String(next))
  }
  const setSort = (s: Sort) => {
    setSortState(s)
    store(SORT_KEY, s)
  }

  // Read the folders on opening, when the project's list of them changes, and when the window comes back to the front
  // (files are added from outside: a screenshot tool, a render, Explorer)
  const folderKey = JSON.stringify(project?.galleries ?? [])
  const busy = useRef(false)
  const load = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    try {
      setData(await window.api.gallery(slug))
      setError('')
    } catch (e) {
      setError(clean(e))
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [slug])
  useEffect(() => {
    void load()
  }, [load, folderKey])
  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (data?.items ?? []).filter(
      (it) =>
        (kind === 'all' || it.kind === kind) &&
        (folder === null || it.folder === folder) &&
        (!q || it.name.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q))
    )
    const byName = (a: GalleryItem, b: GalleryItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    return list.sort((a, b) =>
      sort === 'name' ? byName(a, b) : (sort === 'newest' ? b.modified - a.modified : a.modified - b.modified) || byName(a, b)
    )
  }, [data, kind, folder, query, sort])

  // Start again from the top when what's listed changes
  useEffect(() => {
    setLimit(PAGE)
    scroller.current?.scrollTo({ top: 0 })
  }, [kind, folder, query, sort])

  // More tiles as the end of the grid comes into view
  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= shown.length) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((n) => n + PAGE), {
      root: scroller.current,
      rootMargin: '600px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [limit, shown.length])

  // Ctrl + wheel changes the thumbnail size, like Explorer
  const thumbRef = useRef(thumb)
  thumbRef.current = thumb
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setThumb(thumbRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const act = (what: string, fn: () => Promise<unknown>, done?: string) => async () => {
    try {
      await fn()
      if (done) say(done)
    } catch (e) {
      say(`${what}: ${clean(e)}`)
    }
  }
  const copy = (it: GalleryItem) => act("Couldn't copy", () => copyImage(it), `Copied ${it.name}`)()

  const itemMenu = (it: GalleryItem): MenuItem[] => [
    { label: 'Open', run: () => setViewing(it.path) },
    ...(it.kind === 'image' ? [{ label: 'Copy image', kbd: 'Ctrl C', run: () => copy(it) }] : []),
    { label: 'Copy path', run: act("Couldn't copy", () => navigator.clipboard.writeText(it.path), 'Copied the path') },
    'separator',
    { label: 'Open in default app', run: act("Couldn't open it", () => window.api.galleryAct(it.path, 'open')) },
    { label: 'Show in Explorer', run: act("Couldn't show it", () => window.api.galleryAct(it.path, 'reveal')) }
  ]

  if (!project) return <p className="empty pad">This project no longer exists.</p>

  const folders = data?.folders ?? []
  const missing = folders.filter((f) => f.missing)
  const total = data?.items.length ?? 0
  const counts = { image: 0, video: 0 }
  for (const it of data?.items ?? []) counts[it.kind]++
  // Thumbnails are asked for in two sizes, so sliding the size doesn't fetch them all again at every step
  const thumbWidth = thumb * window.devicePixelRatio <= 256 ? 256 : 512
  const viewIndex = viewing ? shown.findIndex((it) => it.path === viewing) : -1

  return (
    <div className="board-page gallery-page">
      <header className="board-head gallery-head">
        <button className="crumb-link" onClick={() => openProject(slug)}>
          {project.title}
        </button>
        <h1>Gallery</h1>
        <input className="board-filter" value={query} placeholder="Filter by name…" onChange={(e) => setQuery(e.target.value)} />
        <div className="mode-switch">
          {(['all', 'image', 'video'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'all' ? `All ${total}` : k === 'image' ? `Pictures ${counts.image}` : `Videos ${counts.video}`}
            </button>
          ))}
        </div>
        <label className="board-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="gallery-size" title="Thumbnail size (Ctrl + mouse wheel over the pictures)">
          <span className="small-pic">▪</span>
          <input type="range" min={THUMB_MIN} max={THUMB_MAX} step={10} value={thumb} onChange={(e) => setThumb(Number(e.target.value))} />
          <span className="big-pic">◼</span>
        </label>
        <button className="btn small" title="Look in the folders again" disabled={loading} onClick={() => void load()}>
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </header>

      {folders.length > 1 && (
        <div className="gallery-folders">
          <button className={`filter-chip ${folder === null ? 'on' : ''}`} onClick={() => setFolder(null)}>
            All folders
          </button>
          {folders.map((f, i) => (
            <button
              key={f.path}
              className={`filter-chip ${folder === i ? 'on' : ''}`}
              title={f.missing ? `${f.path}\nNot found on this PC` : f.path}
              disabled={f.missing}
              onClick={() => setFolder(folder === i ? null : i)}
            >
              {f.title} <span className="count">{f.missing ? 'missing' : data!.items.filter((it) => it.folder === i).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="gallery-scroll" ref={scroller}>
        {error && <p className="empty">Couldn't read the gallery: {error}</p>}
        {missing.length > 0 && (
          <p className="gallery-warning">
            Not found on this PC: {missing.map((f) => f.path).join(', ')}.{' '}
            <button className="link-btn" onClick={() => openProject(slug)}>
              Change the folders
            </button>
          </p>
        )}
        {data?.truncated && <p className="gallery-warning">Showing the first {total} files; these folders hold more.</p>}
        {data && project.galleries.length === 0 && (
          <div className="gallery-empty">
            <p className="empty">This project has no gallery folders yet.</p>
            <button className="btn small primary" onClick={() => openProject(slug)}>
              Choose folders on the project page
            </button>
          </div>
        )}
        {data && project.galleries.length > 0 && total === 0 && missing.length < folders.length && (
          <p className="empty">No pictures or videos in {folders.length === 1 ? 'this folder' : 'these folders'} yet.</p>
        )}
        {total > 0 && shown.length === 0 && <p className="empty">Nothing matches.</p>}
        {!data && !error && <p className="empty">Reading the folders…</p>}

        <div className="gallery-grid" style={{ ['--thumb' as string]: `${thumb}px` }}>
          {shown.slice(0, limit).map((it) => (
            <div
              key={it.path}
              className={`gallery-tile ${it.kind}`}
              title={`${it.name}\n${[folders[it.folder]?.title, it.sub].filter(Boolean).join(' / ')}\n${formatSize(it.size)} · ${formatDate(it.modified)}`}
              onContextMenu={(e) => showMenu(e, itemMenu(it))}
              draggable
              onDragStart={(e) => {
                // Hand the drag to Windows, so the file itself can be dropped on Explorer or another app
                e.preventDefault()
                window.api.galleryDrag(it.path)
              }}
            >
              <button className="gallery-open" aria-label={`Open ${it.name}`} onClick={() => setViewing(it.path)}>
                <Thumb item={it} width={thumbWidth} />
                {it.kind === 'video' && <span className="gallery-play">▶</span>}
                <span className="gallery-name">{it.name}</span>
              </button>
              {it.kind === 'image' && (
                <button className="gallery-copy" title="Copy image" onClick={() => copy(it)}>
                  Copy
                </button>
              )}
            </div>
          ))}
        </div>
        {limit < shown.length && <div ref={sentinel} className="gallery-more" />}
      </div>

      {viewIndex >= 0 && (
        <Lightbox
          items={shown}
          index={viewIndex}
          onIndex={(i) => setViewing(shown[i].path)}
          onClose={() => setViewing(null)}
          onCopy={copy}
          menu={itemMenu}
          act={act}
        />
      )}
      {notice && <div className="gallery-notice">{notice}</div>}
    </div>
  )
}

interface Zoom {
  /** 1 = fitted to the window; below 1 only to reach actual size, when fitting already draws the picture bigger than that */
  s: number
  x: number
  y: number
}
const FIT: Zoom = { s: 1, x: 0, y: 0 }
const MAX_ZOOM = 40

/** One picture or video over the whole window: step through, zoom, pan, copy, full screen */
function Lightbox(props: {
  items: GalleryItem[]
  index: number
  onIndex(i: number): void
  onClose(): void
  onCopy(it: GalleryItem): void
  menu(it: GalleryItem): MenuItem[]
  act(what: string, fn: () => Promise<unknown>, done?: string): () => Promise<void>
}) {
  const { items, index, onIndex, onClose, onCopy, menu, act } = props
  const it = items[index]
  const [zoom, setZoom] = useState<Zoom>(FIT)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [broken, setBroken] = useState(false)
  const [full, setFull] = useState(!!document.fullscreenElement)
  const stage = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const zoomRef = useRef(1)
  zoomRef.current = zoom.s

  useEffect(() => {
    setZoom(FIT)
    setNatural(null)
    setBroken(false)
  }, [it.path])

  /** Keep some of the picture on screen however far it's dragged */
  const bounded = useCallback((z: Zoom): Zoom => {
    const el = img.current
    const box = stage.current
    if (!el || !box) return FIT
    if (z.s <= 1) return { s: z.s, x: 0, y: 0 }
    const maxX = Math.max(0, (el.offsetWidth * z.s - box.clientWidth) / 2) + 60
    const maxY = Math.max(0, (el.offsetHeight * z.s - box.clientHeight) / 2) + 60
    return { s: z.s, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) }
  }, [])

  /**
   * Zoom at which one picture pixel is one screen pixel. Under 1 when the fitted picture is already drawn larger than
   * that: display scaling or the window's own zoom (Ctrl +) stretch a picture that fits without shrinking
   */
  const actualSize = useCallback(() => {
    const el = img.current
    // The fitted width to a fraction of a pixel, whatever the zoom is now (offsetWidth is rounded, which left 1:1 a pixel out)
    const fitted = el ? parseFloat(getComputedStyle(el).width) || 0 : 0
    return el && fitted && el.naturalWidth ? el.naturalWidth / (fitted * window.devicePixelRatio) : 1
  }, [])
  /** Zoom to `s`, keeping the point under the pointer (or the middle) where it is */
  const zoomTo = useCallback(
    (s: number, at?: { clientX: number; clientY: number }) => {
      setZoom((z) => {
        const box = stage.current?.getBoundingClientRect()
        const next = clamp(s, Math.min(1, actualSize()), MAX_ZOOM)
        const cx = at && box ? at.clientX - (box.left + box.width / 2) : 0
        const cy = at && box ? at.clientY - (box.top + box.height / 2) : 0
        const k = next / z.s
        return bounded({ s: next, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k })
      })
    },
    [bounded, actualSize]
  )
  const toggleZoom = (at?: { clientX: number; clientY: number }) => {
    if (zoom.s !== 1) return setZoom(FIT)
    const actual = actualSize()
    zoomTo(Math.abs(actual - 1) > 0.05 ? actual : 2, at)
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (it.kind !== 'image') return
      e.preventDefault()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.0016), e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [it.kind, zoomTo])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [])
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      // Closing the viewer leaves full screen too
      if (document.fullscreenElement) void document.exitFullscreen()
    }
  }, [])
  // The title bar's drag area swallows clicks even under the viewer; in full screen there's no title bar to drag
  useEffect(() => {
    document.body.classList.toggle('gallery-full', full)
    return () => document.body.classList.remove('gallery-full')
  }, [full])

  const step = useCallback(
    (by: number) => {
      const next = clamp(index + by, 0, items.length - 1)
      if (next !== index) onIndex(next)
    },
    [index, items.length, onIndex]
  )

  // Keys belong to the viewer while it's open (ahead of the app's own shortcuts)
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keys.current = (e) => {
    const s = useStore.getState()
    if (s.prompt || s.picker || s.menu || e.altKey) return
    const k = e.key
    const typing = e.target instanceof HTMLInputElement
    let done = true
    if (k === 'Escape') onClose()
    else if (k === 'ArrowLeft' || k === 'PageUp') step(-1)
    else if (k === 'ArrowRight' || k === 'PageDown') step(1)
    else if (k === 'Home') onIndex(0)
    else if (k === 'End') onIndex(items.length - 1)
    else if (e.ctrlKey && k.toLowerCase() === 'c' && it.kind === 'image' && !window.getSelection()?.toString()) onCopy(it)
    else if (e.ctrlKey || typing) done = false
    else if (k.toLowerCase() === 'f') toggleFull()
    else if (k === ' ' && it.kind === 'video') {
      const v = video.current
      if (e.target === v) done = false // the player handles its own space bar
      else if (v) void (v.paused ? v.play() : v.pause())
    } else if (it.kind === 'image' && (k === '+' || k === '=')) zoomTo(zoom.s * 1.4)
    else if (it.kind === 'image' && k === '-') zoomTo(zoom.s / 1.4)
    else if (it.kind === 'image' && k === '0') setZoom(FIT)
    else if (it.kind === 'image' && k === '1') zoomTo(actualSize())
    else done = false
    if (done) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.button !== 0 || zoom.s <= 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX - zoom.x, y: e.clientY - zoom.y, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = drag.current
    if (!d) return
    d.moved = true
    setZoom((z) => bounded({ s: z.s, x: e.clientX - d.x, y: e.clientY - d.y }))
  }
  const onPointerUp = () => (drag.current = null)

  const percent = natural ? Math.round((zoom.s / actualSize()) * 100) : null

  return (
    <div className={`lightbox ${full ? 'full' : ''}`} role="dialog" aria-label={it.name} onContextMenu={(e) => showMenu(e, menu(it).slice(1))}>
      <div className="lightbox-bar">
        <span className="lightbox-name" title={it.path}>
          {it.name}
        </span>
        <span className="lightbox-info">
          {index + 1} / {items.length}
          {natural && ` · ${natural.w} × ${natural.h}`}
          {` · ${formatSize(it.size)} · ${formatDate(it.modified)}`}
          {percent !== null && ` · ${percent}%`}
        </span>
        <span className="lightbox-actions">
          {it.kind === 'image' && (
            <>
              <button title="Fit to the window (0)" disabled={zoom.s === 1} onClick={() => setZoom(FIT)}>
                Fit
              </button>
              <button title="Actual size (1)" onClick={() => zoomTo(actualSize())}>
                1:1
              </button>
              <button className="primary" title="Copy the picture to the clipboard (Ctrl+C)" onClick={() => onCopy(it)}>
                Copy image
              </button>
            </>
          )}
          <button title="Show the file in Explorer" onClick={act("Couldn't show it", () => window.api.galleryAct(it.path, 'reveal'))}>
            Show in Explorer
          </button>
          <button title="Open in its default app" onClick={act("Couldn't open it", () => window.api.galleryAct(it.path, 'open'))}>
            Open
          </button>
          <button title={full ? 'Leave full screen (F)' : 'Full screen (F)'} onClick={toggleFull}>
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
          <button className="lightbox-close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </span>
      </div>
      <div
        className="lightbox-stage"
        ref={stage}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {broken ? (
          <div className="lightbox-broken">
            <p>{it.kind === 'video' ? "This video can't be played here." : "This picture can't be shown."}</p>
            <button className="btn small" onClick={act("Couldn't open it", () => window.api.galleryAct(it.path, 'open'))}>
              Open in its default app
            </button>
          </div>
        ) : it.kind === 'video' ? (
          <video key={it.path} ref={video} src={mediaUrl(it)} controls autoPlay onError={() => setBroken(true)} />
        ) : (
          <img
            key={it.path}
            ref={img}
            src={mediaUrl(it)}
            alt={it.name}
            draggable={false}
            className={zoom.s > 1 ? 'zoomed' : ''}
            style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
            onDoubleClick={(e) => toggleZoom(e)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
        {index > 0 && (
          <button className="lightbox-step prev" title="Previous (←)" onClick={() => step(-1)}>
            ‹
          </button>
        )}
        {index < items.length - 1 && (
          <button className="lightbox-step next" title="Next (→)" onClick={() => step(1)}>
            ›
          </button>
        )}
      </div>
    </div>
  )
}
