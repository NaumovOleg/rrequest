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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

type ResultFilter = 'all' | 'passed' | 'failed'

function isJson(resp: HttpResponse): boolean {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  return ct.includes('json')
}

function isHtml(resp: HttpResponse): boolean {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  return ct.includes('html')
}

export function ResponsePanel() {
  const [sub, setSub] = useState<SubTab>('body')
  const [filter, setFilter] = useState<ResultFilter>('all')
  const [bodyView, setBodyView] = useState<'pretty' | 'raw'>('pretty')
  const [htmlView, setHtmlView] = useState<'preview' | 'raw'>('preview')
  const resp = useStore((s) => (s.activeTabId ? s.responses[s.activeTabId] : undefined))
  if (!resp) return (
    <div className="rm-panel rm-response-blank">
      <div className="rm-blank">
        <span className="codicon codicon-arrow-right rm-blank-icon" aria-hidden="true" />
        <div className="rm-blank-title">No response yet</div>
        <div className="rm-blank-hint">Enter the URL and click Send to get a response.</div>
      </div>
    </div>
  )

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
        <span className="rm-meta">Size: {fmtSize(resp.sizeBytes)}</span>
      </div>
      <div className="rm-subtabs">
        {(['body', 'headers', 'cookies', 'test-results', 'console'] as SubTab[]).map((t) => (
          <button key={t} className={`rm-subtab ${sub === t ? 'is-active' : ''}`} onClick={() => setSub(t)}>{t.replace('-', ' ')}</button>
        ))}
      </div>
      {sub === 'body' && (
        <>
          {isJson(resp) && (
            <div className="rm-body-toolbar">
              <button className={`rm-btn rm-btn--sm ${bodyView === 'pretty' ? 'is-active' : ''}`}
                onClick={() => setBodyView('pretty')}>Beautify</button>
              <button className={`rm-btn rm-btn--sm ${bodyView === 'raw' ? 'is-active' : ''}`}
                onClick={() => setBodyView('raw')}>Raw</button>
            </div>
          )}
          {isHtml(resp) && (
            <div className="rm-body-toolbar">
              <button className={`rm-btn rm-btn--sm ${htmlView === 'preview' ? 'is-active' : ''}`}
                onClick={() => setHtmlView('preview')}>Preview</button>
              <button className={`rm-btn rm-btn--sm ${htmlView === 'raw' ? 'is-active' : ''}`}
                onClick={() => setHtmlView('raw')}>Raw</button>
            </div>
          )}
          {resp.bodyTruncated && <div>Response too large — showing a truncated preview.</div>}
          {isHtml(resp) && htmlView === 'preview' ? (
            // Sandboxed with NO tokens => scripts disabled (JS-free preview), and
            // default-src 'none' in the page CSP blocks any external resources.
            <iframe
              className="rm-html-preview"
              title="HTML response preview"
              sandbox=""
              srcDoc={resp.body}
            />
          ) : (
            <pre className="rm-code">{bodyView === 'raw' ? resp.body : prettyBody(resp)}</pre>
          )}
        </>
      )}
      {sub === 'headers' && (
        <table className="rm-kvtable">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>
            {resp.headers.map((h, i) => (
              <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {sub === 'cookies' && (
        <table className="rm-kvtable">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>
            {resp.cookies.map((c, i) => (
              <tr key={i}><td>{c.key}</td><td>{c.value}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {sub === 'test-results' && (() => {
        const results = resp.testResults ?? []
        const passed = results.filter((t) => t.passed).length
        const failed = results.length - passed
        const shown = results.filter((t) =>
          filter === 'all' ? true : filter === 'passed' ? t.passed : !t.passed)
        const chips: { id: ResultFilter; label: string }[] = [
          { id: 'all', label: `All (${results.length})` },
          { id: 'passed', label: `Passed (${passed})` },
          { id: 'failed', label: `Failed (${failed})` },
        ]
        return (
          <div className="rm-section">
            <div className="rm-chips">
              {chips.map((c) => (
                <button key={c.id} className={`rm-chip ${filter === c.id ? 'is-active' : ''}`}
                  aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>{c.label}</button>
              ))}
            </div>
            <table><tbody>
              {shown.map((t, i) => (
                <tr key={i}>
                  <td>
                    <span className={`rm-pill-badge ${t.passed ? 'is-pass' : 'is-fail'}`}>{t.passed ? 'PASS' : 'FAIL'}</span>
                  </td>
                  <td>{t.name}{t.error ? `: ${t.error}` : ''}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )
      })()}
      {sub === 'console' && (
        <pre className="rm-code">{(resp.consoleLogs ?? []).join('\n')}</pre>
      )}
    </div>
  )
}
