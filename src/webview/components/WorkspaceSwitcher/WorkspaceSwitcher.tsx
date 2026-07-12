import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  return (
    <div className="rm-row">
      <select className="rm-select" aria-label="active workspace" value={activeWorkspaceId ?? ''}
        onChange={(e) => postToHost({ type: 'setActiveWorkspace', id: e.target.value })}>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <button className="rm-btn" onClick={() => postToHost({ type: 'createWorkspace', name: 'New Workspace' })}>+ New Workspace</button>
    </div>
  )
}
