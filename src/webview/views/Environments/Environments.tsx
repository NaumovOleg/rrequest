import { useState, useEffect } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { KeyValue } from '../../../shared/types'
import { IconButton } from '../../elements/IconButton'
import { RenameInput } from '../../elements/RenameInput'

function blankVar(secret: boolean): KeyValue {
  return { key: '', value: '', enabled: true, secret }
}

export function Environments() {
  const environments = useStore((s) => s.environments)
  const envEditId = useStore((s) => s.envEditId)
  const setEnvEditId = useStore((s) => s.setEnvEditId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [vars, setVars] = useState<KeyValue[]>([])
  const [dirty, setDirty] = useState(false)

  const editing = environments.find((e) => e.id === editingId) ?? null

  const startEdit = (id: string) => {
    const env = environments.find((e) => e.id === id)
    setEditingId(id)
    setVars(env ? env.variables.map((v) => ({ ...v })) : [])
    setDirty(false)
  }

  // Open the environment requested from the sidebar, then clear the request.
  useEffect(() => {
    if (envEditId && environments.some((e) => e.id === envEditId)) {
      startEdit(envEditId)
      setEnvEditId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envEditId, environments])

  const update = (i: number, patch: Partial<KeyValue>) => {
    setVars((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  const addVar = (secret: boolean) => { setVars((rows) => [...rows, blankVar(secret)]); setDirty(true) }
  const removeVar = (i: number) => { setVars((rows) => rows.filter((_, j) => j !== i)); setDirty(true) }

  const save = () => {
    if (!editing) return
    postToHost({ type: 'saveEnvironment', environment: { ...editing, variables: vars } })
    setDirty(false)
  }

  return (
    <div className="rm-envmgr">
      <aside className="rm-env-list">
        <div className="rm-tree-head">
          <span className="rm-section-title">Environments</span>
          <IconButton icon="add" label="add environment"
            onClick={() => postToHost({ type: 'createEnvironment', name: 'New Environment' })} />
        </div>
        {environments.map((env) => (
          <div key={env.id} className={`rm-tree-row${editingId === env.id ? ' is-active' : ''}`}>
            {renamingId === env.id
              ? <RenameInput initial={env.name}
                  onCommit={(name) => { postToHost({ type: 'saveEnvironment', environment: { ...env, name } }); setRenamingId(null) }}
                  onCancel={() => setRenamingId(null)} />
              : <button type="button" className="rm-tree-label rm-linklike" onClick={() => startEdit(env.id)}>{env.name}</button>}
            <div className="rm-actions">
              <IconButton icon="edit" label={`rename ${env.name}`} onClick={() => setRenamingId(env.id)} />
              <IconButton icon="trash" label={`delete ${env.name}`}
                onClick={() => { postToHost({ type: 'deleteEnvironment', id: env.id }); if (editingId === env.id) setEditingId(null) }} />
            </div>
          </div>
        ))}
        {environments.length === 0 && <div className="rm-empty">No environments yet.</div>}
      </aside>

      <section className="rm-env-editor">
        {!editing ? (
          <div className="rm-empty">Select an environment to edit its variables.</div>
        ) : (
          <>
            <div className="rm-env-editor-head">
              <span className="rm-env-title">{editing.name}</span>
              <button className="rm-btn rm-btn--primary" onClick={save} disabled={!dirty}>Save</button>
            </div>
            <table className="rm-kvtable">
              <thead>
                <tr><th></th><th>Variable</th><th>Value</th><th>Type</th><th></th></tr>
              </thead>
              <tbody>
                {vars.map((r, i) => (
                  <tr key={i} className="rm-row">
                    <td>
                      <input type="checkbox" aria-label={`enabled ${i}`} checked={r.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })} />
                    </td>
                    <td>
                      <input className="rm-input rm-kv-input" placeholder="name" aria-label={`var key ${i}`} value={r.key}
                        onChange={(e) => update(i, { key: e.target.value })} />
                    </td>
                    <td>
                      <input className="rm-input rm-kv-input" placeholder="value" aria-label={`var value ${i}`}
                        type={r.secret ? 'password' : 'text'} value={r.value}
                        onChange={(e) => update(i, { value: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className={`rm-envtype${r.secret ? ' is-secret' : ''}`}
                        aria-label={`toggle secret ${i}`} title={r.secret ? 'Secret' : 'Default'}
                        onClick={() => update(i, { secret: !r.secret })}>
                        <span className={`codicon codicon-${r.secret ? 'lock' : 'symbol-key'}`} />
                        {r.secret ? 'Secret' : 'Default'}
                      </button>
                    </td>
                    <td>
                      <IconButton icon="trash" label={`remove var ${i}`} onClick={() => removeVar(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rm-env-add">
              <button className="rm-btn" onClick={() => addVar(false)}>
                <span className="codicon codicon-add" /> Variable
              </button>
              <button className="rm-btn" onClick={() => addVar(true)}>
                <span className="codicon codicon-lock" /> Secret
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
