import { useEffect } from 'react'
import './theme.css'
import { useStore } from './state/store'
import { onHostMessage, postToHost } from './ipc'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Tabs } from './components/Tabs/Tabs'
import { RequestPanel } from './components/RequestPanel/RequestPanel'
import { ResponsePanel } from './components/ResponsePanel/ResponsePanel'
import { EnvDropdown } from './components/EnvDropdown/EnvDropdown'

export function App() {
  const setTree = useStore((s) => s.setTree)
  const setResponse = useStore((s) => s.setResponse)
  const setHistory = useStore((s) => s.setHistory)
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'response') {
        setResponse(m.requestId, m.payload)
        postToHost({ type: 'loadHistory' })
      } else if (m.type === 'history') setHistory(m.entries)
      else if (m.type === 'environments') {
        setEnvironments(m.environments)
        setActiveEnvId(m.activeId)
      }
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadHistory' })
    postToHost({ type: 'loadEnvironments' })
    return off
  }, [setTree, setResponse, setHistory, setEnvironments, setActiveEnvId])

  return (
    <div className="rm-row" style={{ alignItems: 'stretch', height: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="rm-row" style={{ justifyContent: 'flex-end', padding: '4px 8px' }}>
          <EnvDropdown />
        </div>
        <Tabs />
        <RequestPanel />
        <ResponsePanel />
      </div>
    </div>
  )
}
