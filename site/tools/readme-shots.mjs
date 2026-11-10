// Retakes the README's screenshots (notes, tasks, boards, gallery) from the real app, using the same throwaway
// demo vault as capture.mjs plus two folders of made-up pictures for the gallery. Your own vault and settings are
// never touched. Build the app first (npm run build), then:
//   node site/tools/readme-shots.mjs [work folder]
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVault } from './demo-vault.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const outDir = join(repo, 'docs/screenshots')
const work = resolve(process.argv[2] ?? join(tmpdir(), 'waypoint-readme-shots'))
const electron = join(repo, 'node_modules/electron/dist/electron.exe')
const PORT = 9348
const WIDTH = 1440
const HEIGHT = 900
const SCALE = 1.5
const SLUG = 'harbour-cycles'
const PLAN = `projects/${SLUG}/docs/Launch plan.md`
const CANVAS = `canvas:projects/${SLUG}/boards/Launch map.excalidraw`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Page {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.waiting = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      const p = this.waiting.get(msg.id)
      if (!p) return
      this.waiting.delete(msg.id)
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async js(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`${expression.slice(0, 200)}\n${JSON.stringify(r.exceptionDetails)}`)
    return r.result.value
  }
  /** Wait until the expression is truthy */
  async until(expression, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await this.js(`!!(${expression})`)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }
  waitFor(selector, ms) {
    return this.until(`document.querySelector(${JSON.stringify(selector)})`, ms)
  }
  async click(selector) {
    await this.waitFor(selector)
    await this.js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await sleep(350)
  }
  /** Show the tab at this position */
  async tab(index) {
    await this.js(`document.querySelectorAll('.tab-title')[${index}].click()`)
    await sleep(500)
  }
  async shot(name) {
    await this.js(`document.activeElement?.blur?.()`)
    await sleep(200)
    const { data } = await this.send('Page.captureScreenshot', { format: 'webp', quality: 88 })
    writeFileSync(join(outDir, `${name}.webp`), Buffer.from(data, 'base64'))
    console.log('  ', name)
  }
}

async function connect() {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl)
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true })
          ws.addEventListener('error', rej, { once: true })
        })
        return new Page(ws)
      }
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('App window never appeared')
}

// ---- Made-up pictures for the gallery, drawn on a canvas in the app's own page

/** Runs in the page. `spec` is { kind: 'photo' | 'mockup', w, h, seed, colours } */
const DRAW = `(spec) => {
  const { w, h } = spec
  let seed = spec.seed
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const g = c.getContext('2d')
  const fade = (y0, y1, a, b) => { const f = g.createLinearGradient(0, y0, 0, y1); f.addColorStop(0, a); f.addColorStop(1, b); return f }
  if (spec.kind === 'mockup') {
    const [page, ink, accent, soft] = spec.colours
    g.fillStyle = page; g.fillRect(0, 0, w, h)
    g.fillStyle = ink; g.fillRect(0, 0, w, h * 0.09)
    g.fillStyle = accent; g.beginPath(); g.arc(w * 0.05, h * 0.045, h * 0.022, 0, 7); g.fill()
    g.fillStyle = page; for (let i = 0; i < 4; i++) g.fillRect(w * (0.6 + i * 0.09), h * 0.038, w * 0.06, h * 0.014)
    g.fillStyle = fade(h * 0.09, h * 0.5, accent, soft); g.fillRect(0, h * 0.09, w, h * 0.41)
    g.fillStyle = page; g.fillRect(w * 0.08, h * 0.2, w * (0.3 + r() * 0.2), h * 0.05); g.fillRect(w * 0.08, h * 0.28, w * 0.28, h * 0.02)
    g.fillStyle = ink; g.fillRect(w * 0.08, h * 0.35, w * 0.16, h * 0.06)
    const n = 2 + Math.floor(r() * 3), gap = w * 0.04, cw = (w * 0.84 - gap * (n - 1)) / n
    for (let i = 0; i < n; i++) {
      const x = w * 0.08 + i * (cw + gap)
      g.fillStyle = soft; g.fillRect(x, h * 0.58, cw, h * 0.2)
      g.fillStyle = ink; g.fillRect(x, h * 0.81, cw * 0.7, h * 0.02)
      g.fillStyle = accent; g.fillRect(x, h * 0.86, cw * 0.4, h * 0.035)
    }
    return c.toDataURL('image/png')
  }
  const [skyTop, skyLow, sun, far, near, seaLow] = spec.colours
  const horizon = h * (0.48 + r() * 0.16)
  g.fillStyle = fade(0, horizon, skyTop, skyLow); g.fillRect(0, 0, w, horizon)
  const sx = w * (0.2 + r() * 0.6), sy = horizon - h * (0.04 + r() * 0.22), sr = h * (0.05 + r() * 0.03)
  const glow = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 7)
  glow.addColorStop(0, sun + 'cc'); glow.addColorStop(1, sun + '00')
  g.fillStyle = glow; g.fillRect(0, 0, w, horizon)
  g.fillStyle = sun; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill()
  // Clouds
  g.fillStyle = '#ffffff30'
  for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(r() * w, r() * horizon * 0.6, w * (0.08 + r() * 0.12), h * (0.012 + r() * 0.015), 0, 0, 7); g.fill() }
  // Far hills
  const ridge = (colour, base, height, wave) => {
    const a = r() * 6, b = r() * 6
    g.fillStyle = colour; g.beginPath(); g.moveTo(0, horizon)
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base - height * (0.5 + 0.3 * Math.sin(a + x / w * wave) + 0.2 * Math.sin(b + x / w * wave * 2.7)))
    g.lineTo(w, horizon); g.fill()
  }
  ridge(far, horizon, h * (0.08 + r() * 0.1), 5 + r() * 5)
  // Sea, with the sun's reflection
  g.fillStyle = fade(horizon, h, skyLow, seaLow); g.fillRect(0, horizon, w, h - horizon)
  for (let i = 0; i < 46; i++) {
    const t = r(), y = horizon + (h - horizon) * t * t, half = w * (0.01 + t * 0.07) * (0.4 + r())
    g.fillStyle = sun + (i % 2 ? '70' : '40'); g.fillRect(sx - half + (r() - 0.5) * w * 0.05 * t, y, half * 2, Math.max(2, h * 0.004))
  }
  // Boats
  const boats = 1 + Math.floor(r() * 3)
  for (let i = 0; i < boats; i++) {
    const x = w * (0.1 + r() * 0.8), y = horizon + (h - horizon) * (0.08 + r() * 0.3), s = h * (0.03 + (y - horizon) / h * 0.25)
    g.fillStyle = near; g.fillRect(x - s * 0.6, y, s * 1.2, s * 0.16)
    g.fillStyle = '#f4efe6'; g.beginPath(); g.moveTo(x, y - s * 0.05); g.lineTo(x, y - s * 1.1); g.lineTo(x + s * 0.55, y - s * 0.05); g.fill()
    g.fillStyle = '#e3dccd'; g.beginPath(); g.moveTo(x - s * 0.06, y - s * 0.05); g.lineTo(x - s * 0.06, y - s * 0.85); g.lineTo(x - s * 0.42, y - s * 0.05); g.fill()
  }
  // Harbour wall and lighthouse in front
  const left = r() < 0.5, wallTop = h * (0.8 + r() * 0.08), reach = w * (0.35 + r() * 0.3)
  g.fillStyle = near; g.beginPath()
  if (left) { g.moveTo(0, wallTop); g.lineTo(reach, wallTop + h * 0.03); g.lineTo(reach + w * 0.04, h); g.lineTo(0, h) }
  else { g.moveTo(w, wallTop); g.lineTo(w - reach, wallTop + h * 0.03); g.lineTo(w - reach - w * 0.04, h); g.lineTo(w, h) }
  g.fill()
  const lx = left ? reach - w * 0.05 : w - reach + w * 0.05, lh = h * 0.2, lw = h * 0.035
  g.beginPath(); g.moveTo(lx - lw, wallTop + h * 0.03); g.lineTo(lx - lw * 0.6, wallTop - lh); g.lineTo(lx + lw * 0.6, wallTop - lh); g.lineTo(lx + lw, wallTop + h * 0.03); g.fill()
  g.fillRect(lx - lw * 0.8, wallTop - lh - lw * 0.9, lw * 1.6, lw * 0.3)
  g.beginPath(); g.moveTo(lx - lw * 0.7, wallTop - lh - lw * 0.9); g.lineTo(lx, wallTop - lh - lw * 1.9); g.lineTo(lx + lw * 0.7, wallTop - lh - lw * 0.9); g.fill()
  g.fillStyle = '#ffe9a8'; g.fillRect(lx - lw * 0.4, wallTop - lh - lw * 0.6, lw * 0.8, lw * 0.6)
  return c.toDataURL('image/jpeg', 0.9)
}`

const DUSK = ['#2b2d5b', '#f2a65a', '#ffd9a0', '#5a4a78', '#1d1b33', '#1f3352']
const NOON = ['#3d8fd1', '#bfe3f5', '#fff6d6', '#5f8f8a', '#1f3d4d', '#1b6a8f']
const DAWN = ['#6d7fc4', '#f7c7b3', '#fff0d0', '#8a7fa8', '#2d2f4f', '#3b6a8c']
const STORM = ['#39424e', '#9aa7b0', '#e6e9ea', '#56636b', '#1c2329', '#2d4250']
const GOLD = ['#e0873e', '#fbd786', '#fff3c4', '#a2633f', '#3a2418', '#7a5a3a']
const NIGHT = ['#0b1030', '#34407a', '#e9eefc', '#232a57', '#080b1c', '#0f1b3d']

const SITE_A = ['#f7f4ec', '#1f3d4d', '#2f7fb5', '#d7e6ee']
const SITE_B = ['#fbfaf7', '#2b2d5b', '#e07a3e', '#f3dcc9']
const SITE_C = ['#101820', '#e8eef2', '#3aa6a0', '#22313d']

/** [folder, file name, kind, width, height, colours] in the order they should show (newest first) */
const PICTURES = [
  ['Photo shoot', 'Harbour wall at dusk.jpg', 'photo', 1600, 1067, DUSK],
  ['Mock-ups', 'Home page v3.png', 'mockup', 1440, 1000, SITE_A],
  ['Photo shoot', 'Lighthouse, noon.jpg', 'photo', 1600, 1067, NOON],
  ['Photo shoot', 'First hire of the day.jpg', 'photo', 1200, 1500, DAWN],
  ['Mock-ups', 'Booking form, phone.png', 'mockup', 800, 1400, SITE_B],
  ['Photo shoot', 'Rain coming in.jpg', 'photo', 1600, 1067, STORM],
  ['Photo shoot', 'Golden hour ride.jpg', 'photo', 1600, 1067, GOLD],
  ['Photo shoot', 'Sunset route, end.jpg', 'photo', 1600, 900, DUSK],
  ['Mock-ups', 'Bikes page, dark.png', 'mockup', 1440, 1000, SITE_C],
  ['Photo shoot', 'Night ferry.jpg', 'photo', 1600, 1067, NIGHT],
  ['Photo shoot', 'Regatta morning.jpg', 'photo', 1500, 1500, NOON],
  ['Photo shoot', 'Shop front, early.jpg', 'photo', 1600, 1067, DAWN],
  ['Mock-ups', 'Visit page.png', 'mockup', 1440, 1000, SITE_B],
  ['Photo shoot', 'Low tide.jpg', 'photo', 1600, 1067, GOLD],
  ['Photo shoot', 'Squall off the point.jpg', 'photo', 1200, 1500, STORM],
  ['Photo shoot', 'Evening moorings.jpg', 'photo', 1600, 1067, DUSK],
  ['Mock-ups', 'Home page v2.png', 'mockup', 1440, 1000, SITE_C],
  ['Photo shoot', 'Harbour lights.jpg', 'photo', 1600, 1067, NIGHT]
]

async function drawPictures(page, root) {
  for (const [i, [folder, name, kind, w, h, colours]] of PICTURES.entries()) {
    const url = await page.js(`(${DRAW})(${JSON.stringify({ kind, w, h, seed: 7 + i * 131, colours })})`)
    const file = join(root, folder, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    // The gallery shows the newest first
    const when = new Date(Date.now() - (i * 26 + 3) * 3600000)
    utimesSync(file, when, when)
  }
}

async function captureTheme(theme, vault, pictures, first) {
  console.log(theme)
  const profile = join(work, `profile-${theme}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(join(profile, 'claude-home'), { recursive: true })
  writeFileSync(
    join(profile, 'config.json'),
    JSON.stringify({
      vaultPath: vault,
      recent: { [vault]: [PLAN, 'notes/Weekly review.md', `projects/${SLUG}/docs/Booking flow.md`] },
      bounds: { width: WIDTH, height: HEIGHT },
      trayHintShown: true,
      lastNudge: Date.now(),
      prefs: { theme, closeToTray: false, captureHotkey: '', searchHotkey: '', nudges: { enabled: false } }
    })
  )

  // The last three switches keep a covered window drawing, or lazy thumbnails never load
  const app = spawn(
    electron,
    [
      repo,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    {
      stdio: 'ignore',
      // WAYPOINT_CLAUDE_HOME: connector state goes to a scratch file, not the real ~/.claude.json
      env: { ...process.env, ELECTRON_RENDERER_URL: '', WAYPOINT_CLAUDE_HOME: join(profile, 'claude-home') }
    }
  )
  try {
    const page = await connect()
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.waitFor('.sidebar')
    if (first) await drawPictures(page, pictures)
    await page.js(`(() => {
      localStorage.setItem('waypoint:tabs:' + ${JSON.stringify(vault)}, JSON.stringify({
        paths: [${JSON.stringify(PLAN)}, 'board:${SLUG}', ${JSON.stringify(CANVAS)}, 'gallery:${SLUG}'],
        active: 0
      }))
      localStorage.setItem('waypoint:toc', '1')
      localStorage.setItem('waypoint:sidebar', JSON.stringify({ files: false, notes: true, ideas: true, projects: { '${SLUG}': true } }))
      localStorage.setItem('waypoint:boardFilters:${SLUG}', JSON.stringify({ status: [], priority: [], labels: [], due: '', open: true }))
    })()`)
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
    await page.send('Page.reload')
    await sleep(1500)

    // Notes: the page editor, contents pane, nested pages in the sidebar
    await page.waitFor('.cm-content')
    await sleep(900)
    await page.click(`[data-path="projects/${SLUG}/docs"]`)
    await page.js(`document.querySelector('[data-path="${PLAN}"] .chev')?.click()`)
    await sleep(500)
    await page.js(`document.querySelector('.cm-content').blur()`)
    await page.shot(`notes-${theme}`)

    // Tasks: the kanban board with its filter row open
    await page.tab(1)
    await page.waitFor('.board-filters')
    await sleep(500)
    await page.shot(`tasks-${theme}`)

    // Boards: an Excalidraw canvas (loads lazily)
    await page.tab(2)
    await page.waitFor('.excalidraw canvas', 30000)
    await sleep(2000)
    await page.js(`document.head.insertAdjacentHTML('beforeend', '<style>.HintViewer{display:none!important}</style>')`)
    for (let i = 0; i < 3; i++) await page.click('.zoom-out-button')
    await sleep(1200)
    await page.shot(`boards-${theme}`)

    // Gallery: every thumbnail loaded
    await page.tab(3)
    await page.waitFor('.gallery-tile img')
    await page.until(`[...document.querySelectorAll('.gallery-tile img')].every((i) => i.complete && i.naturalWidth)`)
    await sleep(600)
    await page.shot(`gallery-${theme}`)
  } finally {
    await sleep(500)
    app.kill()
    await sleep(800)
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(work, { recursive: true })
const vault = buildVault(join(work, 'vault', 'Workshop'))
const pictures = join(work, 'pictures')
rmSync(pictures, { recursive: true, force: true })
// The gallery reads folders named in the project's settings
const projectFile = join(vault, `projects/${SLUG}/project.md`)
writeFileSync(
  projectFile,
  readFileSync(projectFile, 'utf8').replace(
    'bookmarks:',
    `galleries:\n  - { title: Photo shoot, path: '${join(pictures, 'Photo shoot')}' }\n  - { title: Mock-ups, path: '${join(pictures, 'Mock-ups')}' }\nbookmarks:`
  )
)
const themes = process.env.CAPTURE_THEMES?.split(',') ?? ['dark', 'light']
for (const [i, theme] of themes.entries()) await captureTheme(theme, vault, pictures, i === 0)
console.log('Screenshots in', outDir)
process.exit(0)
