import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId } from '../../../shared/types'

export function WebSocketPanel() {
  const wsUrl = useStore((s) => s.wsUrl)
  const wsInput = useStore((s) => s.wsInput)
  const wsStatus = useStore((s) => s.wsStatus)
  const wsConnId = useStore((s) => s.wsConnId)
  const wsHeaders = useStore((s) => s.wsHeaders)
  const wsLog = useStore((s) => s.wsLog)
  const setWsUrl = useStore((s) => s.setWsUrl)
  const setWsInput = useStore((s) => s.setWsInput)
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
    <div className="rm-panel" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="rm-row">
        <input className="rm-input" aria-label="websocket url" placeholder="wss://..." style={{ flex: 1 }}
          value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
        {wsStatus === 'closed'
          ? <button className="rm-btn" disabled={!wsUrl} onClick={connect}>Connect</button>
          : <button className="rm-btn" onClick={disconnect}>Disconnect</button>}
        <span>{wsStatus}</span>
      </div>
      <div className="rm-row">
        <input className="rm-input" aria-label="websocket message" placeholder="message" style={{ flex: 1 }}
          value={wsInput} onChange={(e) => setWsInput(e.target.value)} />
        <button className="rm-btn" disabled={wsStatus !== 'open'} onClick={send}>Send</button>
      </div>
      <div className="rm-panel" style={{ flex: 1, overflow: 'auto' }}>
        {wsLog.map((e, i) => (
          <div key={i} className="rm-row">
            <span style={{ opacity: 0.6, minWidth: 40 }}>{e.dir}</span>
            <span>{e.data}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
