import { useState } from 'react'
import { useStore } from '../../state/store'
import type { HttpResponse } from '../../../shared/types'

type SubTab = 'body' | 'headers' | 'cookies'

function prettyBody(resp: HttpResponse): string {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (ct.includes('json')) {
    try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { /* fall through */ }
  }
  return resp.body
}

export function ResponsePanel() {
  const [sub, setSub] = useState<SubTab>('body')
  const resp = useStore((s) => (s.activeTabId ? s.responses[s.activeTabId] : undefined))
  if (!resp) return <div className="rm-panel">No response yet</div>

  if (resp.error) {
    return (
      <div className="rm-panel">
        <div role="alert" style={{ color: 'var(--vscode-errorForeground)' }}>
          {resp.error.kind}: {resp.error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="rm-panel">
      <div className="rm-row">
        <span>Status: {resp.status} {resp.statusText}</span>
        <span>Time: {resp.timeMs} ms</span>
        <span>Size: {resp.sizeBytes} B</span>
      </div>
      <div className="rm-row">
        {(['body', 'headers', 'cookies'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
      </div>
      {sub === 'body' && (
        <>
          {resp.bodyTruncated && <div>Response too large — showing a truncated preview.</div>}
          <pre className="rm-input" style={{ whiteSpace: 'pre-wrap' }}>{prettyBody(resp)}</pre>
        </>
      )}
      {sub === 'headers' && (
        <table><tbody>
          {resp.headers.map((h, i) => (
            <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>
          ))}
        </tbody></table>
      )}
      {sub === 'cookies' && (
        <table><tbody>
          {resp.cookies.map((c, i) => (
            <tr key={i}><td>{c.key}</td><td>{c.value}</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  )
}
