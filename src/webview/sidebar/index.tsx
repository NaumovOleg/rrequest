import { createRoot } from 'react-dom/client'
import { SidebarApp } from './SidebarApp'
const el = document.getElementById('root')
if (el) createRoot(el).render(<SidebarApp />)
