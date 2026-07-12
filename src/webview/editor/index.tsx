import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'
const el = document.getElementById('root')
if (el) createRoot(el).render(<EditorApp />)
