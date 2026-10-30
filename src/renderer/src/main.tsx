import { createRoot } from 'react-dom/client'
import App from './App'
import Capture from './components/Capture'
import './styles.css'

// The same page serves the main window and the small quick-capture window
const capture = location.hash === '#capture'
document.body.classList.toggle('capture-window', capture)
createRoot(document.getElementById('root')!).render(capture ? <Capture /> : <App />)
