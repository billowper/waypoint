import { createRoot } from 'react-dom/client'
import App from './App'
import Capture from './components/Capture'
import QuickSearch from './components/QuickSearch'
import './styles.css'

// Excalidraw serves its fonts from here (copied into public/ by scripts/copy-excalidraw-assets.mjs)
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', location.href).href

// The same page serves the main window and the small popups (quick capture, quick search)
const mode = location.hash.slice(1)
document.body.classList.toggle('capture-window', mode === 'capture')
document.body.classList.toggle('search-window', mode === 'search')
createRoot(document.getElementById('root')!).render(
  mode === 'capture' ? <Capture /> : mode === 'search' ? <QuickSearch /> : <App />
)
