import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { buildUrlFromParams } from '../../state/url-sync'
import { postToHost } from '../../ipc'
import type { HttpMethod, KeyValue } from '../../../shared/types'
import { FormDataEditor } from './FormDataEditor'
import { parseCurl, toCurl } from '../../curl'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type SubTab = 'params' | 'headers' | 'body' | 'pre-request' | 'tests'

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
  const [saveCollectionId, setSaveCollectionId] = useState('')
  const [curlText, setCurlText] = useState('')
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const update = useStore((s) => s.updateActive)
  const openNewTab = useStore((s) => s.openNewTab)
  const tree = useStore((s) => s.tree)
  const pendingSaveCollectionId = useStore((s) => s.pendingSaveCollectionId)
  useEffect(() => {
    if (pendingSaveCollectionId) setSaveCollectionId(pendingSaveCollectionId)
  }, [pendingSaveCollectionId])
  if (!active) return <div className="rm-panel">No request open</div>

  const send = () => {
    const url = buildUrlFromParams(active.url, active.params)
    postToHost({ type: 'sendRequest', requestId: active.id, payload: { ...active, url } })
  }

  const save = () => {
    postToHost({ type: 'saveRequest', collectionId: saveCollectionId, request: active })
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
        <input className="rm-input" aria-label="request name" placeholder="Request name"
          value={active.name} onChange={(e) => update({ name: e.target.value })} />
        <select className="rm-select" aria-label="save to collection" value={saveCollectionId}
          onChange={(e) => setSaveCollectionId(e.target.value)}>
          <option value="" disabled>Select collection</option>
          {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="rm-btn" disabled={!saveCollectionId} onClick={save}>Save</button>
      </div>

      <div className="rm-row">
        <button className="rm-btn" onClick={() => { void navigator.clipboard.writeText(toCurl(active)) }}>Copy as cURL</button>
        <input className="rm-input" aria-label="curl command" placeholder="Paste curl command" value={curlText}
          onChange={(e) => setCurlText(e.target.value)} />
        <button className="rm-btn" onClick={() => { const p = parseCurl(curlText); openNewTab(); update(p); setCurlText('') }}>Import from cURL</button>
      </div>

      <div className="rm-row">
        {(['params', 'headers', 'body', 'pre-request', 'tests'] as SubTab[]).map((t) => (
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
        <div>
          <div className="rm-row">
            <select className="rm-select" aria-label="body mode"
              value={active.body.mode}
              onChange={(e) => {
                const mode = e.target.value
                if (mode === 'none') update({ body: { mode: 'none' } })
                else if (mode === 'raw') update({ body: { mode: 'raw', type: 'json', text: active.body.mode === 'raw' ? active.body.text : '' } })
                else if (mode === 'formdata') update({ body: { mode: 'formdata', items: active.body.mode === 'formdata' ? active.body.items : [] } })
              }}>
              <option value="none">none</option>
              <option value="raw">raw</option>
              <option value="formdata">form-data</option>
            </select>
          </div>
          {active.body.mode === 'raw' && (
            <textarea className="rm-input" aria-label="body" rows={8} style={{ width: '100%' }}
              value={active.body.text}
              onChange={(e) => update({ body: { mode: 'raw', type: 'json', text: e.target.value } })} />
          )}
          {active.body.mode === 'formdata' && <FormDataEditor />}
        </div>
      )}
      {sub === 'pre-request' && (
        <textarea className="rm-input" aria-label="pre-request script" rows={8} style={{ width: '100%' }}
          value={active.preRequestScript ?? ''}
          onChange={(e) => update({ preRequestScript: e.target.value })} />
      )}
      {sub === 'tests' && (
        <textarea className="rm-input" aria-label="test script" rows={8} style={{ width: '100%' }}
          value={active.testScript ?? ''}
          onChange={(e) => update({ testScript: e.target.value })} />
      )}
    </div>
  )
}
