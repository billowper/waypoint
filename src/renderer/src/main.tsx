import { createRoot } from 'react-dom/client'
import App from './App'
import Capture from './components/Capture'
import './styles.css'

// Excalidraw serves its fonts from here (copied into public/ by scripts/copy-excalidraw-assets.mjs)
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', location.href).href

// The same page serves the main window and the small quick-capture window
const capture = location.hash === '#capture'
document.body.classList.toggle('capture-window', capture)
createRoot(document.getElementById('root')!).render(capture ? <Capture /> : <App />)
