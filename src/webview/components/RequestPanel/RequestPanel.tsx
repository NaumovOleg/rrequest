import { useState } from 'react'
import { useStore } from '../../state/store'
import { buildUrlFromParams } from '../../state/url-sync'
import { postToHost } from '../../ipc'
import type { HttpMethod, KeyValue } from '../../../shared/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type SubTab = 'params' | 'headers' | 'body'

function KeyValueTable({ rows, onChange }: {
  rows: KeyValue[]; onChange: (rows: KeyValue[]) => void
}) {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const withBlank = [...rows, { key: '', value: '', enabled: true }]
  return (
    <table>
      <tbody>
        {withBlank.map((r, i) => (
          <tr key={i} className="rm-row">
            <td><input type="checkbox" checked={r.enabled}
              onChange={(e) => i < rows.length && update(i, { enabled: e.target.checked })} /></td>
            <td><input className="rm-input" placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < rows.length) update(i, { key: e.target.value })
                else onChange([...rows, { key: e.target.value, value: '', enabled: true }])
              }} /></td>
            <td><input className="rm-input" placeholder="value" value={r.value}
              onChange={(e) => i < rows.length && update(i, { value: e.target.value })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RequestPanel() {
  const [sub, setSub] = useState<SubTab>('params')
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const update = useStore((s) => s.updateActive)
  if (!active) return <div className="rm-panel">No request open</div>

  const send = () => {
    const url = buildUrlFromParams(active.url, active.params)
    postToHost({ type: 'sendRequest', requestId: active.id, payload: { ...active, url } })
  }

  return (
    <div className="rm-panel">
      <div className="rm-row">
        <label>
          <span style={{ display: 'none' }}>method</span>
          <select className="rm-select" aria-label="method" value={active.method}
            onChange={(e) => update({ method: e.target.value as HttpMethod })}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <input className="rm-input" placeholder="URL" style={{ flex: 1 }} value={active.url}
          onChange={(e) => update({ url: e.target.value })} />
        <button className="rm-btn" disabled={!active.url} onClick={send}>Send</button>
      </div>

      <div className="rm-row">
        {(['params', 'headers', 'body'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
      </div>

      {sub === 'params' && (
        <KeyValueTable rows={active.params} onChange={(params) => update({ params })} />
      )}
      {sub === 'headers' && (
        <KeyValueTable rows={active.headers} onChange={(headers) => update({ headers })} />
      )}
      {sub === 'body' && (
        <textarea className="rm-input" aria-label="body" rows={8} style={{ width: '100%' }}
          value={active.body.mode === 'raw' ? active.body.text : ''}
          onChange={(e) => update({ body: { mode: 'raw', type: 'json', text: e.target.value } })} />
      )}
    </div>
  )
}
