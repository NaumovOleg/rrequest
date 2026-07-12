import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const [renameValue, setRenameValue] = useState(active?.name ?? '')

  useEffect(() => {
    setRenameValue(active?.name ?? '')
  }, [active?.id, active?.name])

  return (
    <div className="rm-row">
      <select className="rm-select" aria-label="active workspace" value={activeWorkspaceId ?? ''}
        onChange={(e) => postToHost({ type: 'setActiveWorkspace', id: e.target.value })}>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <button className="rm-btn" onClick={() => postToHost({ type: 'createWorkspace', name: 'New Workspace' })}>+ New Workspace</button>
      <input className="rm-input" aria-label="rename workspace" value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)} />
      <button className="rm-btn" onClick={() => {
        if (activeWorkspaceId && renameValue.trim()) postToHost({ type: 'renameWorkspace', id: activeWorkspaceId, name: renameValue })
      }}>Rename</button>
      <button className="rm-btn" onClick={() => {
        if (activeWorkspaceId) postToHost({ type: 'deleteWorkspace', id: activeWorkspaceId })
      }}>Delete Workspace</button>
    </div>
  )
}
