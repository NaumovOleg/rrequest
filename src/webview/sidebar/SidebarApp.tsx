import { useEffect } from 'react'
import '../theme.css'
import { useStore } from '../state/store'
import { onHostMessage, postToHost } from '../ipc'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher/WorkspaceSwitcher'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { Environments } from '../components/Environments/Environments'
import { History } from '../components/History/History'

export function SidebarApp() {
  const setTree = useStore((s) => s.setTree)
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)
  const setWorkspaces = useStore((s) => s.setWorkspaces)
  const setHistory = useStore((s) => s.setHistory)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'environments') { setEnvironments(m.environments); setActiveEnvId(m.activeId) }
      else if (m.type === 'workspaces') setWorkspaces(m.workspaces, m.activeId)
      else if (m.type === 'history') setHistory(m.entries)
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadWorkspaces' })
    postToHost({ type: 'loadEnvironments' })
    postToHost({ type: 'loadHistory' })
    return off
  }, [setTree, setEnvironments, setActiveEnvId, setWorkspaces, setHistory])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <WorkspaceSwitcher />
      <Sidebar />
      <Environments />
      <History />
    </div>
  )
}
