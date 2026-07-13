import { useState } from 'react'
import { useStore } from '../../state/store'
import type { HttpResponse } from '../../../shared/types'

type SubTab = 'body' | 'headers' | 'cookies' | 'test-results' | 'console'

function prettyBody(resp: HttpResponse): string {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (ct.includes('json')) {
    try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { /* fall through */ }
  }
  return resp.body
}

function pillClass(status: number): string {
  if (status >= 200 && status < 300) return 'is-2xx'
  if (status >= 300 && status < 400) return 'is-3xx'
  if (status >= 400 && status < 500) return 'is-4xx'
  return 'is-5xx'
}

export function ResponsePanel() {
  const [sub, setSub] = useState<SubTab>('body')
  const resp = useStore((s) => (s.activeTabId ? s.responses[s.activeTabId] : undefined))
  if (!resp) return <div className="rm-panel">No response yet</div>

  if (resp.error) {
    return (
      <div className="rm-panel">
        <div role="alert" className="rm-error-banner">
          {resp.error.kind}: {resp.error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="rm-panel">
      <div className="rm-statusline">
        <span className={`rm-status-pill ${pillClass(resp.status)}`}>{resp.status} {resp.statusText}</span>
        <span className="rm-meta">Time: {resp.timeMs} ms</span>
        <span className="rm-meta">Size: {resp.sizeBytes} B</span>
      </div>
      <div className="rm-subtabs">
        {(['body', 'headers', 'cookies', 'test-results', 'console'] as SubTab[]).map((t) => (
          <button key={t} className={`rm-subtab ${sub === t ? 'is-active' : ''}`} onClick={() => setSub(t)}>{t.replace('-', ' ')}</button>
        ))}
      </div>
      {sub === 'body' && (
        <>
          {resp.bodyTruncated && <div>Response too large — showing a truncated preview.</div>}
          <pre className="rm-code">{prettyBody(resp)}</pre>
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
      {sub === 'test-results' && (
        <table><tbody>
          {(resp.testResults ?? []).map((t, i) => (
            <tr key={i}>
              <td>
                <span className={`rm-badge ${t.passed ? 'is-pass' : 'is-fail'}`}>{t.passed ? 'PASS' : 'FAIL'}</span>
              </td>
              <td>{t.name}{t.error ? `: ${t.error}` : ''}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {sub === 'console' && (
        <pre className="rm-code">{(resp.consoleLogs ?? []).join('\n')}</pre>
      )}
    </div>
  )
}
