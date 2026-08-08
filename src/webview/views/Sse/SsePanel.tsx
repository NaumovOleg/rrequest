import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type KeyValue } from '../../../shared/types'

function fmtSseData(data: string): string {
  try {
    const parsed = JSON.parse(data)
    if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
  } catch { /* not JSON, keep raw */ }
  return data
}

function SseHeadersTable({ rows, onChange }: {
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
            <td><input type="checkbox" aria-label={`sse header enabled ${i}`} checked={r.enabled}
              onChange={(e) => i < rows.length && update(i, { enabled: e.target.checked })} /></td>
            <td><input className="rm-input rm-kv-input" aria-label={`sse header key ${i}`} placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < rows.length) update(i, { key: e.target.value })
                else onChange([...rows, { key: e.target.value, value: '', enabled: true }])
              }} /></td>
            <td><input className="rm-input rm-kv-input" aria-label={`sse header value ${i}`} placeholder="value" value={r.value}
              onChange={(e) => i < rows.length && update(i, { value: e.target.value })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SsePanel() {
  const sseUrl = useStore((s) => s.sseUrl)
  const sseHeaders = useStore((s) => s.sseHeaders)
  const sseStatus = useStore((s) => s.sseStatus)
  const sseConnId = useStore((s) => s.sseConnId)
  const sseLog = useStore((s) => s.sseLog)
  const setSseUrl = useStore((s) => s.setSseUrl)
  const setSseHeaders = useStore((s) => s.setSseHeaders)
  const sseStartConnect = useStore((s) => s.sseStartConnect)
  const sseSetStatus = useStore((s) => s.sseSetStatus)
  const sseAppendLog = useStore((s) => s.sseAppendLog)
  const sseClear = useStore((s) => s.sseClear)

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sseLog.length])

  // SSE is an ad hoc debugging surface: no save-to-collection, no persistence.
  // Behavior mirrors the WebSocket panel — a connector with a live event log.
  useEffect(() => {
    postToHost({ type: 'setTitle', title: 'SSE Stream', icon: 'ws' })
  }, [])

  const connect = () => {
    const connId = newId()
    sseStartConnect(connId)
    postToHost({ type: 'sseConnect', connId, url: sseUrl, headers: sseHeaders })
  }
  const disconnect = () => {
    if (sseConnId) postToHost({ type: 'sseDisconnect', connId: sseConnId })
    sseSetStatus('closed')
    sseAppendLog({ dir: 'status', event: 'status', data: 'disconnected', at: Date.now() })
  }

  return (
    <div className="rm-surface">
      <header className="rm-req-meta">
        <span className="rm-section-title">Server-Sent Events</span>
        <div className="rm-req-meta-actions">
          <span className="rm-req-target">Ad-hoc stream — events are not saved</span>
        </div>
      </header>
      <div className="rm-urlbar">
        <input className="rm-input rm-url-input" aria-label="sse url" placeholder="https://.../events"
          value={sseUrl} onChange={(e) => setSseUrl(e.target.value)} />
        {sseStatus === 'closed'
          ? <button className="rm-btn rm-btn--primary" disabled={!sseUrl} onClick={connect}>Connect</button>
          : <button className="rm-btn" onClick={disconnect}>Disconnect</button>}
        <span className={`rm-status-pill ${sseStatus === 'open' ? 'is-2xx' : sseStatus === 'connecting' ? 'is-4xx' : 'is-err'}`}>{sseStatus}</span>
      </div>
      <SseHeadersTable rows={sseHeaders} onChange={setSseHeaders} />
      <div className="rm-log-head">
        <span className="rm-section-title">Events</span>
        <button className="rm-icon-btn" aria-label="clear events" title="Clear events" disabled={sseLog.length === 0}
          onClick={sseClear}>
          <span className="codicon codicon-clear-all" aria-hidden="true" />
        </button>
      </div>
      <div className="rm-log" ref={logRef}>
        {sseLog.length === 0 && (
          <div className="rm-blank rm-log-empty">
            <span className="codicon codicon-radio-tower rm-blank-icon" aria-hidden="true" />
            <div className="rm-blank-hint">Connect to see streamed events.</div>
          </div>
        )}
        {sseLog.map((e, i) => (
          <div key={i} className={`rm-log-row is-${e.dir}`}>
            <span className="rm-log-dir">{e.event}</span>
            <span className="rm-log-time">{new Date(e.at).toLocaleTimeString()}</span>
            <pre className="rm-log-data">{fmtSseData(e.data)}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}