import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type KeyValue } from '../../../shared/types'

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
      <div className="rm-log">
        {wsLog.map((e, i) => (
          <div key={i} className={`rm-log-row is-${e.dir}`}>
            <span className="rm-log-dir">{e.dir}</span>
            <span className="rm-log-time">{new Date(e.at).toLocaleTimeString()}</span>
            <span>{e.data}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
