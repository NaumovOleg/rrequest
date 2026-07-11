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
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Environments</strong>
        <button className="rm-btn" onClick={() => postToHost({ type: 'createEnvironment', name: 'New Environment' })}>
          + New Environment
        </button>
      </div>
      <ul>
        {environments.map((env) => (
          <li key={env.id} className="rm-row">
            <button className="rm-btn" onClick={() => startEdit(env.id)}>{env.name}</button>
            <button className="rm-btn" aria-label={`delete ${env.name}`}
              onClick={() => postToHost({ type: 'deleteEnvironment', id: env.id })}>×</button>
          </li>
        ))}
      </ul>

      {editing && (
        <div>
          <div>Editing: {editing.name}</div>
          <table>
            <tbody>
              {rows.map((r, i) => {
                // The trailing blank row (i === vars.length) is a draft slot for the next
                // entry. Once at least one row has been committed, suppress its placeholder
                // text so it doesn't collide with the committed row's still-empty cells when
                // queried by placeholder (e.g. getByPlaceholderText('var value')).
                const isDraftRow = i === vars.length
                const showPlaceholder = !isDraftRow || vars.length === 0
                return (
                  <tr key={i} className="rm-row">
                    <td>
                      <input type="checkbox" checked={r.enabled}
                        onChange={(e) => i < vars.length && update(i, { enabled: e.target.checked })} />
                    </td>
                    <td>
                      <input className="rm-input" placeholder={showPlaceholder ? 'var key' : undefined} value={r.key}
                        onChange={(e) => {
                          if (i < vars.length) update(i, { key: e.target.value })
                          else setVars([...vars, { key: e.target.value, value: '', enabled: true }])
                        }} />
                    </td>
                    <td>
                      <input className="rm-input" placeholder={showPlaceholder ? 'var value' : undefined} value={r.value}
                        onChange={(e) => i < vars.length && update(i, { value: e.target.value })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button className="rm-btn" onClick={save}>Save Environment</button>
        </div>
      )}
    </div>
  )
}
