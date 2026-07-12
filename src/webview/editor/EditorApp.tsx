import { useEffect } from 'react'
import '../theme.css'
import { useStore } from '../state/store'
import { onHostMessage, postToHost } from '../ipc'
import { EnvDropdown } from '../components/EnvDropdown/EnvDropdown'
import { Tabs } from '../components/Tabs/Tabs'
import { RequestPanel } from '../components/RequestPanel/RequestPanel'
import { ResponsePanel } from '../components/ResponsePanel/ResponsePanel'

export function EditorApp() {
  const setTree = useStore((s) => s.setTree)
  const setResponse = useStore((s) => s.setResponse)
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)
  const openNewTab = useStore((s) => s.openNewTab)
  const updateActive = useStore((s) => s.updateActive)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'environments') { setEnvironments(m.environments); setActiveEnvId(m.activeId) }
      else if (m.type === 'response') setResponse(m.requestId, m.payload)
      else if (m.type === 'openInEditor') {
        const r = m.request
        openNewTab()
        updateActive({ name: r.name, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body })
      } else if (m.type === 'pickedFile') {
        const st = useStore.getState()
        const pending = st.pendingFilePick
        if (pending) {
          const tab = st.tabs.find((t) => t.id === pending.tabId)
          if (tab && tab.body.mode === 'formdata') {
            const items = tab.body.items.map((it, i) =>
              i === pending.index && it.kind === 'file' ? { ...it, path: m.path, filename: m.filename } : it)
            st.setTabBody(pending.tabId, { mode: 'formdata', items })
          }
          st.setPendingFilePick(null)
        }
      }
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadEnvironments' })
    return off
  }, [setTree, setResponse, setEnvironments, setActiveEnvId, openNewTab, updateActive])

  return (
    <div className="rm-row" style={{ alignItems: 'stretch', height: '100vh' }}>
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
