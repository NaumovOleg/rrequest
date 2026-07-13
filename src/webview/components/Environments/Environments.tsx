import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { KeyValue } from '../../../shared/types'

export function Environments() {
  const environments = useStore((s) => s.environments)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [vars, setVars] = useState<KeyValue[]>([])

  const editing = environments.find((e) => e.id === editingId)

  const startEdit = (id: string) => {
    const env = environments.find((e) => e.id === id)
    setEditingId(id)
    setVars(env ? env.variables : [])
  }

  const update = (i: number, patch: Partial<KeyValue>) =>
    setVars((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const rows = [...vars, { key: '', value: '', enabled: true }]

  const save = () => {
    if (!editing) return
    postToHost({ type: 'saveEnvironment', environment: { ...editing, variables: vars } })
  }

  return (
    <div className="rm-section">
      <div className="rm-row">
        <span className="rm-section-title">Environments</span>
        <button className="rm-btn--ghost" onClick={() => postToHost({ type: 'createEnvironment', name: 'New Environment' })}>
          + New Environment
        </button>
      </div>
      <div className="rm-tree">
        {environments.map((env) => (
          <div key={env.id} className="rm-tree-row">
            <button className="rm-btn--ghost" onClick={() => startEdit(env.id)}>{env.name}</button>
            <button className="rm-btn--ghost" aria-label={`delete ${env.name}`}
              onClick={() => postToHost({ type: 'deleteEnvironment', id: env.id })}>×</button>
          </div>
        ))}
      </div>

      {editing && (
        <div>
          <div>Editing: {editing.name}</div>
          <table className="rm-kvtable">
            <thead>
              <tr><th></th><th>Key</th><th>Value</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="rm-row">
                  <td>
                    <input type="checkbox" checked={r.enabled}
                      onChange={(e) => i < vars.length && update(i, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <input className="rm-input rm-kv-input" placeholder="var key" aria-label={`var key ${i}`} value={r.key}
                      onChange={(e) => {
                        if (i < vars.length) update(i, { key: e.target.value })
                        else setVars([...vars, { key: e.target.value, value: '', enabled: true }])
                      }} />
                  </td>
                  <td>
                    <input className="rm-input rm-kv-input" placeholder="var value" aria-label={`var value ${i}`} value={r.value}
                      onChange={(e) => i < vars.length && update(i, { value: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="rm-btn" onClick={save}>Save Environment</button>
        </div>
      )}
    </div>
  )
}
