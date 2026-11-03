// Retakes the website screenshots from the real app, using a throwaway demo vault and app profile.
// Your own vault and settings are never touched. Build the app first (npm run build), then:
//   node site/tools/capture.mjs [work folder]
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVault } from './demo-vault.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const outDir = join(repo, 'site/img')
const work = resolve(process.argv[2] ?? join(tmpdir(), 'waypoint-site-capture'))
const electron = join(repo, 'node_modules/electron/dist/electron.exe')
const PORT = 9347
const WIDTH = 1440
const HEIGHT = 900
const SCALE = 1.5
const SLUG = 'harbour-cycles'
const PLAN = `projects/${SLUG}/docs/Launch plan.md`

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
    if (r.exceptionDetails) throw new Error(`${expression}\n${JSON.stringify(r.exceptionDetails)}`)
    return r.result.value
  }
  async waitFor(selector, ms = 15000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await this.js(`!!document.querySelector(${JSON.stringify(selector)})`)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${selector}`)
  }
  /** Click the first element matching the selector, optionally with this text inside */
  async click(selector, text) {
    const found = await this.js(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!found) throw new Error(`Nothing to click: ${selector} ${text ?? ''}`)
    await sleep(350)
  }
  async keydown(key, mods = {}) {
    await this.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, altKey: ${!!mods.alt} }))`)
    await sleep(350)
  }
  async type(text) {
    await this.send('Input.insertText', { text })
    await sleep(350)
  }
  /** One screenshot, whole window or the box of a selector with some margin */
  /** The box around the sections whose headings match, in page coordinates */
  rect(headings, root) {
    return this.js(`(() => {
      const boxes = [...document.querySelectorAll(${JSON.stringify(`${root} h2`)})]
        .filter((h) => ${JSON.stringify(headings)}.some((t) => h.textContent.trim().toLowerCase() === t))
        .map((h) => h.closest('section').getBoundingClientRect())
      const x = Math.min(...boxes.map((b) => b.left)) - 12
      const y = Math.min(...boxes.map((b) => b.top)) - 12
      return { x, y, width: Math.max(...boxes.map((b) => b.right)) + 12 - x, height: Math.max(...boxes.map((b) => b.bottom)) + 12 - y }
    })()`)
  }
  async shot(name, clip) {
    await this.js(`document.activeElement && document.activeElement.blur && document.activeElement.tagName === 'BUTTON' && document.activeElement.blur()`)
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'webp',
      quality: 88,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    writeFileSync(join(outDir, `${name}.webp`), Buffer.from(data, 'base64'))
    console.log('  ', name)
  }
}

async function connect(match = () => true) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl && match(x))
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

function launch(vault, profile, extra = []) {
  return spawn(electron, [repo, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, ...extra], {
    stdio: 'ignore',
    // WAYPOINT_CLAUDE_HOME: connector state goes to a scratch file, not the real ~/.claude.json
    env: { ...process.env, ELECTRON_RENDERER_URL: '', WAYPOINT_CLAUDE_HOME: join(profile, 'claude-home') }
  })
}

async function captureTheme(theme, vault) {
  console.log(theme)
  const profile = join(work, `profile-${theme}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(join(profile, 'claude-home'), { recursive: true })
  writeFileSync(
    join(profile, 'config.json'),
    JSON.stringify({
      vaultPath: vault,
      recent: {
        [vault]: [PLAN, 'notes/Weekly review.md', `projects/${SLUG}/docs/Booking flow.md`, 'notes/Reading list.md', `projects/${SLUG}/tasks/HC-005.md`]
      },
      bounds: { width: WIDTH, height: HEIGHT },
      trayHintShown: true,
      lastNudge: Date.now(),
      prefs: { theme, closeToTray: false, captureHotkey: '', searchHotkey: '', nudges: { enabled: false } }
    })
  )

  const app = launch(vault, profile)
  try {
    const page = await connect()
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.waitFor('.sidebar')
    // Same tabs, contents pane and sidebar every time
    await page.js(`(() => {
      localStorage.setItem('waypoint:tabs:' + ${JSON.stringify(vault)}, JSON.stringify({
        paths: [null, ${JSON.stringify(PLAN)}, 'project:${SLUG}', 'board:${SLUG}', ${JSON.stringify(`canvas:projects/${SLUG}/boards/Launch map.excalidraw`)}],
        active: 0
      }))
      localStorage.setItem('waypoint:toc', '1')
      localStorage.setItem('waypoint:sidebar', JSON.stringify({ files: false, notes: true, ideas: true, projects: { '${SLUG}': true } }))
    })()`)
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
    await page.send('Page.reload')
    await sleep(1500)
    await page.waitFor('.home')
    await sleep(800)
    await page.shot(`home-${theme}`)

    // Note: live preview, contents pane, nested pages, tabs
    await page.click('.tab-title', 'Launch plan')
    await page.waitFor('.cm-content')
    await sleep(900)
    // Show the nested pages in the sidebar
    await page.click(`[data-path="projects/${SLUG}/docs"]`)
    await page.js(`document.querySelector('[data-path="${PLAN}"] .chev')?.click()`)
    await sleep(500)
    await page.js(`document.querySelector('.cm-content').blur()`)
    await sleep(300)
    await page.shot(`note-${theme}`)

    // Project page
    await page.click('.tab-title', 'Harbour Cycles')
    await page.waitFor('.project-page')
    await sleep(600)
    await page.shot(`project-${theme}`)

    // Kanban
    const tabs = await page.js(`[...document.querySelectorAll('.tab-title')].map((t) => t.textContent)`)
    console.log('   tabs:', tabs.join(' | '))
    await page.js(`document.querySelectorAll('.tab-title')[3].click()`)
    await sleep(700)
    await page.shot(`tasks-${theme}`)

    // Canvas (Excalidraw loads lazily)
    await page.js(`document.querySelectorAll('.tab-title')[4].click()`)
    await page.waitFor('.excalidraw canvas', 30000)
    await sleep(2000)
    await page.js(`document.head.insertAdjacentHTML('beforeend', '<style>.HintViewer{display:none!important}</style>')`)
    for (let i = 0; i < 3; i++) await page.click('.zoom-out-button')
    await sleep(1200)
    await page.shot(`canvas-${theme}`)

    // Quick switcher over the note
    await page.click('.tab-title', 'Launch plan')
    await sleep(500)
    await page.keydown('p', { ctrl: true })
    await page.type('launch')
    await sleep(400)
    await page.shot(`switcher-${theme}`)
    await page.keydown('Escape')
    await page.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    const stillOpen = await page.js(`!!document.querySelector('.picker-input, .picker input')`)
    if (stillOpen) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(300)
    }

    // Settings, past the vault path
    await page.keydown(',', { ctrl: true })
    await sleep(700)
    await page.js(`[...document.querySelectorAll('.settings-page h2')].find((h) => /appearance/i.test(h.textContent))?.scrollIntoView()`)
    await sleep(400)
    await page.shot(`settings-${theme}`, await page.rect(['appearance', 'fonts and size'], '.settings-page'))
    await page.click('.tab-title', 'Launch plan')

    // Git panel + history of the note
    await page.click('.mode-switch button', 'Git')
    await sleep(900)
    await page.click('.pathbar [title="History of this note"]')
    await page.waitFor('.history-page')
    await sleep(900)
    await page.js(`document.querySelectorAll('.commit-list li button')[document.querySelectorAll('.commit-list li button').length > 2 ? 2 : 0]?.click()`)
    await sleep(900)
    await page.shot(`history-${theme}`)
    // Back to a tidy window: Git panel shut, the extra tabs closed
    await page.click('.mode-switch button', 'Git')
    for (const title of ['History', 'Settings']) {
      await page.js(`[...document.querySelectorAll('.tab-title')].find((t) => t.textContent.includes('${title}')).parentElement.querySelector('.tab-close').click()`)
      await sleep(300)
    }

    // Changed by Claude, on the project page
    await page.click('.tab-title', 'Harbour Cycles')
    await sleep(600)
    await page.js(`[...document.querySelectorAll('.project-page h2')].find((h) => /claude code/i.test(h.textContent))?.scrollIntoView()`)
    await sleep(500)
    await page.shot(`claude-${theme}`, await page.rect(['claude code', 'changed by claude'], '.project-page'))

    // An open task: properties bar and Send to Claude
    await page.js(`document.querySelector('.project-page').scrollTop = 0`)
    await page.click('.page-list button', 'Build the booking form')
    await page.waitFor('.cm-content')
    await sleep(800)

    // A nudge (only shows in the app while the window has focus; a dev build's toast goes nowhere)
    await page.send('Page.bringToFront')
    await page.js(`window.api.nudgeNow()`)
    await sleep(900)
    if (await page.js(`!!document.querySelector('.nudge-banner')`)) {
      const r = await page.js(`(() => { const b = document.querySelector('.nudge-banner').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height } })()`)
      await page.shot(`nudge-${theme}`, r)
    }
    else console.log('   (no nudge banner: window not focused)')

    // Quick capture: the small popup, opened the way the jump list does
    const second = spawn(electron, [repo, '--capture', `--user-data-dir=${profile}`], { stdio: 'ignore', env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
    second.on('error', () => undefined)
    const pop = await connect((t) => t.url.includes('#capture'))
    await pop.send('Runtime.enable')
    await pop.send('Page.enable')
    await pop.waitFor('textarea, input')
    await pop.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 190, deviceScaleFactor: 2, mobile: false })
    await pop.js(`document.querySelector('textarea, input').focus()`)
    await pop.type('Half-price hire if it rains before 10am?')
    await sleep(300)
    await pop.shot(`capture-${theme}`)
  } finally {
    await sleep(500)
    app.kill()
    await sleep(800)
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(work, { recursive: true })
const vault = buildVault(join(work, 'vault', 'Workshop'))
const themes = process.env.CAPTURE_THEMES?.split(',') ?? ['dark', 'light']
for (const theme of themes) await captureTheme(theme, vault)
console.log('Screenshots in', outDir)
process.exit(0)
