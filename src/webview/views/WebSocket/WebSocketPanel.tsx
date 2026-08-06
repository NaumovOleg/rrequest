import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type KeyValue, type WsRequest } from '../../../shared/types'

function fmtWsData(data: string): string {
  try {
    const parsed = JSON.parse(data)
    if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
  } catch { /* not JSON, keep raw */ }
  return data
}

function WsHeadersTable({ rows, onChange }: {
  rows: KeyValue[]; onChange: (rows: KeyValue[]) => void
}) {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const withBlank = [...rows, { key: '', value: '', enabled: true }]
  return (
    <table className="rm-kvtable">
      <thead>
        <tr><th></th><th>Key</th><th>Value</th></tr>
      </thead>
      <tbody>
        {withBlank.map((r, i) => (
          <tr key={i}>
            <td><input type="checkbox" aria-label={`ws header enabled ${i}`} checked={r.enabled}
              onChange={(e) => i < rows.length && update(i, { enabled: e.target.checked })} /></td>
            <td><input className="rm-input rm-kv-input" aria-label={`ws header key ${i}`} placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < rows.length) update(i, { key: e.target.value })
                else onChange([...rows, { key: e.target.value, value: '', enabled: true }])
              }} /></td>
            <td><input className="rm-input rm-kv-input" aria-label={`ws header value ${i}`} placeholder="value" value={r.value}
              onChange={(e) => i < rows.length && update(i, { value: e.target.value })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WebSocketPanel() {
  const wsUrl = useStore((s) => s.wsUrl)
  const wsInput = useStore((s) => s.wsInput)
  const wsStatus = useStore((s) => s.wsStatus)
  const wsConnId = useStore((s) => s.wsConnId)
  const wsHeaders = useStore((s) => s.wsHeaders)
  const wsLog = useStore((s) => s.wsLog)
  const setWsUrl = useStore((s) => s.setWsUrl)
  const setWsInput = useStore((s) => s.setWsInput)
  const setWsHeaders = useStore((s) => s.setWsHeaders)
  const wsStartConnect = useStore((s) => s.wsStartConnect)
  const wsAppendLog = useStore((s) => s.wsAppendLog)
  const wsClear = useStore((s) => s.wsClear)
  const tree = useStore((s) => s.tree)

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [wsLog.length])

  const [id, setId] = useState(() => newId())
  const [name, setName] = useState('New WebSocket Request')
  const [linkedCollectionId, setLinkedCollectionId] = useState<string | null>(null)
  const [linkedFolderId, setLinkedFolderId] = useState<string | null>(null)
  const [saveCollectionId, setSaveCollectionId] = useState('')
  const [saveFolderId, setSaveFolderId] = useState('')

  // The WS editor panel is a single reused view; EditorApp stashes the opened
  // request in the store (wsOpen) BEFORE this panel mounts, so read from there
  // rather than a live message that we'd race and miss on first open. `seq`
  // re-applies even when the same request is reopened.
  const wsOpen = useStore((s) => s.wsOpen)
  useEffect(() => {
    if (!wsOpen) return
    const r = wsOpen.request
    if (r) {
      setId(r.id)
      setName(r.name)
      setWsUrl(r.url)
      setWsHeaders(r.headers ?? [])
      setLinkedCollectionId(wsOpen.collectionId)
      setLinkedFolderId(wsOpen.folderId)
      setSaveCollectionId(wsOpen.collectionId ?? '')
      setSaveFolderId(wsOpen.folderId ?? '')
    } else {
      // Fresh "New WebSocket" request.
      setId(newId())
      setName('New WebSocket Request')
      setWsUrl('')
      setWsHeaders([])
      setLinkedCollectionId(null)
      setLinkedFolderId(null)
      setSaveCollectionId('')
      setSaveFolderId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsOpen?.seq])

  useEffect(() => {
    postToHost({ type: 'setTitle', title: `WS ${name}` })
  }, [name])

  const save = () => {
    const collectionId = linkedCollectionId || saveCollectionId
    if (!collectionId) return
    const item: WsRequest = { id, name, kind: 'ws', url: wsUrl, headers: wsHeaders }
    postToHost({ type: 'saveRequest', collectionId, folderId: linkedCollectionId ? linkedFolderId : saveFolderId || null, request: item })
    setLinkedCollectionId(collectionId)
    setLinkedFolderId(linkedCollectionId ? linkedFolderId : saveFolderId || null)
  }

  const saveFolders = tree.find((c) => c.id === saveCollectionId)?.folders ?? []
  const linkedCollection = linkedCollectionId ? tree.find((c) => c.id === linkedCollectionId) : undefined
  const linkedFolder = linkedCollection && linkedFolderId ? (linkedCollection.folders ?? []).find((f) => f.id === linkedFolderId) : undefined

  const connect = () => {
    const connId = newId()
    wsStartConnect(connId)
    postToHost({ type: 'wsConnect', connId, url: wsUrl, headers: wsHeaders })
  }
  const disconnect = () => { if (wsConnId) postToHost({ type: 'wsDisconnect', connId: wsConnId }) }
  const send = () => {
    if (!wsConnId) return
    postToHost({ type: 'wsSend', connId: wsConnId, data: wsInput })
    wsAppendLog({ dir: 'out', data: wsInput, at: Date.now() })
    setWsInput('')
  }

  return (
    <div className="rm-surface">
      <header className="rm-req-meta">
        <input className="rm-input rm-req-name" aria-label="websocket name" placeholder="Request name"
          value={name} onChange={(e) => setName(e.target.value)} />
        <div className="rm-req-meta-actions">
          {linkedCollectionId ? (
            <span className="rm-req-target">
              {linkedCollection?.name ?? 'Collection'}{linkedFolder ? ` / ${linkedFolder.name}` : ''}
            </span>
          ) : (
            <>
              <select className="rm-select" aria-label="save to collection" value={saveCollectionId}
                onChange={(e) => setSaveCollectionId(e.target.value)}>
                <option value="" disabled>Select collection</option>
                {tree.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
              <select className="rm-select" aria-label="save to folder" value={saveFolderId}
                onChange={(e) => setSaveFolderId(e.target.value)}>
                <option value="">(root)</option>
                {saveFolders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </>
          )}
          <button className="rm-btn" disabled={!linkedCollectionId && !saveCollectionId} onClick={save}>Save</button>
        </div>
      </header>
      <div className="rm-urlbar">
        <input className="rm-input rm-url-input" aria-label="websocket url" placeholder="wss://..."
          value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
        {wsStatus === 'closed'
          ? <button className="rm-btn rm-btn--primary" disabled={!wsUrl} onClick={connect}>Connect</button>
          : <button className="rm-btn" onClick={disconnect}>Disconnect</button>}
        <span className={`rm-status-pill ${wsStatus === 'open' ? 'is-2xx' : wsStatus === 'connecting' ? 'is-4xx' : 'is-err'}`}>{wsStatus}</span>
      </div>
      <WsHeadersTable rows={wsHeaders} onChange={setWsHeaders} />
      <div className="rm-urlbar">
        <input className="rm-input" aria-label="websocket message" placeholder="message" style={{ flex: 1 }}
          value={wsInput} onChange={(e) => setWsInput(e.target.value)} />
        <button className="rm-btn rm-btn--primary" disabled={wsStatus !== 'open'} onClick={send}>Send</button>
      </div>
      <div className="rm-log-head">
        <span className="rm-section-title">Log</span>
        <button className="rm-icon-btn" aria-label="clear log" title="Clear log" disabled={wsLog.length === 0}
          onClick={wsClear}>
          <span className="codicon codicon-clear-all" aria-hidden="true" />
        </button>
      </div>
      <div className="rm-log" ref={logRef}>
        {wsLog.length === 0 && (
          <div className="rm-blank rm-log-empty">
            <span className="codicon codicon-radio-tower rm-blank-icon" aria-hidden="true" />
            <div className="rm-blank-hint">Connect to see the message log.</div>
          </div>
        )}
        {wsLog.map((e, i) => (
          <div key={i} className={`rm-log-row is-${e.dir}`}>
            <span className="rm-log-dir">{e.dir}</span>
            <span className="rm-log-time">{new Date(e.at).toLocaleTimeString()}</span>
            <pre className="rm-log-data">{fmtWsData(e.data)}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
