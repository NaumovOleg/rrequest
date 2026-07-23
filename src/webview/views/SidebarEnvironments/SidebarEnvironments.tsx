import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { IconButton } from '../../elements/IconButton'
import { RenameInput } from '../../elements/RenameInput'

export function SidebarEnvironments() {
  const environments = useStore((s) => s.environments)
  const isViewer = useStore((s) => s.isViewer())
  const [renamingId, setRenamingId] = useState<string | null>(null)

  return (
    <div className="rm-tree">
      <div className="rm-tree-head">
        <span className="rm-section-title">Environments</span>
        {!isViewer && (
          <IconButton icon="add" label="add environment"
            onClick={() => postToHost({ type: 'createEnvironment', name: 'New Environment' })} />
        )}
      </div>
      {environments.map((env) => (
        <div key={env.id} className="rm-tree-row">
          {renamingId === env.id
            ? <RenameInput initial={env.name}
                onCommit={(name) => { postToHost({ type: 'saveEnvironment', environment: { ...env, name } }); setRenamingId(null) }}
                onCancel={() => setRenamingId(null)} />
            : <button type="button" className="rm-tree-label rm-linklike"
                onClick={() => postToHost({ type: 'openEnvironments', id: env.id })}>{env.name}</button>}
          {!isViewer && (
            <div className="rm-actions">
              <IconButton icon="edit" label={`rename ${env.name}`} onClick={() => setRenamingId(env.id)} />
              <IconButton icon="trash" label={`delete ${env.name}`}
                onClick={() => postToHost({ type: 'deleteEnvironment', id: env.id })} />
            </div>
          )}
        </div>
      ))}
      {environments.length === 0 && <div className="rm-empty">No environments yet.</div>}
    </div>
  )
}
