// Excalidraw loads its fonts from a CDN unless they're served locally. The app's CSP (and offline
// use) means local: copy them into the renderer's public folder before dev/build.
// Runs automatically via the predev/prebuild npm scripts; the copy is git-ignored.
import { cpSync, existsSync, mkdirSync } from 'fs'

const from = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'
const to = 'src/renderer/public/excalidraw/fonts'
if (!existsSync(from)) {
  console.warn('[excalidraw] fonts not found; run npm install first')
  process.exit(0)
}
if (!existsSync(to)) {
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log('[excalidraw] fonts copied')
}
