import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type HttpResponse } from '../../../shared/types'
import { JsonTree } from '../../components/JsonTree'

type SubTab = 'body' | 'headers' | 'cookies' | 'test-results' | 'console'
type BodyView = 'pretty' | 'raw' | 'tree'

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

// Which VS Code language id the body maps to (for "Open in editor").
function bodyLanguage(resp: HttpResponse): string {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml')) return 'xml'
  return 'text'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Split `line` into plain text + <mark> runs for each case-insensitive match.
function highlight(line: string, q: string): ReactNode {
  if (!q) return line
  const parts = line.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p,
  )
}

// Whether the tree view is worth offering: content-type says JSON and the
// body actually parses. Parsing a few MB of JSON once per render is fine; the
// tree itself only renders the top level until the user expands.
function parseableJson(resp: HttpResponse): boolean {
  if (!isJson(resp) || !resp.body) return false
  try { JSON.parse(resp.body); return true } catch { return false }
}

// Try to pretty-print `text` as JSON, content-type-agnostic (servers
// occasionally return JSON labeled text/plain). null when it doesn't parse.
function tryFormatJson(text: string): string | null {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return null }
}

export function ResponsePanel() {
  const [sub, setSub] = useState<SubTab>('body')
  const [filter, setFilter] = useState<ResultFilter>('all')
  const [bodyView, setBodyView] = useState<BodyView>('pretty')
  const [htmlView, setHtmlView] = useState<'preview' | 'raw'>('preview')
  const [search, setSearch] = useState('')
  const [bodyText, setBodyText] = useState<string | null>(null)
  const requestId = useStore((s) => s.activeTabId)
  const resp = useStore((s) => (s.activeTabId ? s.responses[s.activeTabId] : undefined))
  const lastSent = useStore((s) => s.lastSent)
  const openOrReplaceBlank = useStore((s) => s.openOrReplaceBlank)
  const setInFlight = useStore((s) => s.setInFlight)
  const setLastSent = useStore((s) => s.setLastSent)
  // The Beautify action reformats the body in place; a fresh response (or a
  // different tab) starts from the server bytes again.
  useEffect(() => { setBodyText(null) }, [requestId, resp?.body])

  const repeat = () => {
    if (!lastSent) return
    // Re-run the last sent payload in a fresh request tab (the base URL +
    // params pair is exactly what `send` posts).
    const copy = structuredClone({ ...lastSent, id: newId() })
    openOrReplaceBlank(copy)
    postToHost({
      type: 'sendRequest', requestId: copy.id, payload: copy,
      collectionId: (copy as { collectionId?: string }).collectionId,
      folderId: (copy as { folderId?: string | null }).folderId ?? null,
    })
    setInFlight(copy.id, true)
    setLastSent(copy)
  }

  if (!resp) return (
    <div className="rm-panel rm-response-blank">
      <div className="rm-blank">
        <span className="codicon codicon-arrow-right rm-blank-icon" aria-hidden="true" />
        <div className="rm-blank-title">No response yet</div>
        <div className="rm-blank-hint">
          Enter the URL and click Send to get a response.
          {lastSent && (
            <>
              {" "}Or re-run the last one:{" "}
              <button className="rm-btn rm-btn--sm" onClick={repeat}>Repeat last</button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  // A script error still carries a usable response (status, body, tests) —
  // show it as a banner on top instead of replacing the whole panel. Other
  // errors (network, timeout, …) get the full-panel treatment below.
  const scriptError = resp.error?.kind === 'script' ? resp.error : undefined
  if (resp.error && !scriptError) {
    return (
      <div className="rm-panel">
        <div role="alert" className="rm-error-banner">
          {resp.error.kind}: {resp.error.message}
        </div>
      </div>
    )
  }

  const binary = !!resp.bodyBase64
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  const isImage = binary && /^image\//.test(ct)
  const displayed = bodyText ?? (bodyView === 'raw' ? resp.body : prettyBody(resp))
  const q = search.trim().toLowerCase()
  const lines = q ? displayed.split('\n').filter((l) => l.toLowerCase().includes(q)) : []
  const inPreview = isHtml(resp) && htmlView === 'preview'
  const jsonTree = bodyView === 'tree' && parseableJson(resp)
  const canBeautify = !binary && tryFormatJson(resp.body) !== null

  const beautify = () => {
    const pretty = tryFormatJson(resp.body)
    if (pretty === null) return
    setBodyText(pretty)
    setBodyView('pretty')
  }

  const saveBody = () =>
    postToHost({
      type: 'saveBody',
      requestId: requestId ?? '',
      fallbackContent: binary ? resp.bodyBase64 : displayed,
      fallbackIsBase64: binary,
      suggestName: 'response',
    })

  return (
    <div className="rm-panel">
      {scriptError && (
        <div role="alert" className="rm-error-banner">
          Script error: {scriptError.message}
        </div>
      )}
      <div className="rm-statusline" role="status" aria-live="polite">
        {resp.status === 0 && scriptError ? (
          // The request never went out (the failure was inside the pre-request
          // script), so a fake 0/time/size status line would just mislead.
          <span className="rm-status-pill is-err">Script failed</span>
        ) : (
          <>
            <span className={`rm-status-pill ${pillClass(resp.status)}`}>{resp.status} {resp.statusText}</span>
            {resp.timings ? (
              <>
                <span className="rm-meta" title="Total time: TTFB + body download">Total: {resp.timings.ttfbMs + resp.timings.downloadMs} ms</span>
                <span className="rm-meta" title="Time to first byte">TTFB: {resp.timings.ttfbMs} ms</span>
                <span className="rm-meta" title="Body download">Body: {resp.timings.downloadMs} ms</span>
              </>
            ) : (
              <span className="rm-meta">Time: {resp.timeMs} ms</span>
            )}
            <span className="rm-meta">Size: {fmtSize(resp.sizeBytes)}</span>
          </>
        )}
        {lastSent && (
          <button
            className="rm-btn rm-btn--sm"
            title="Re-send the last request (without editing)"
            aria-label="repeat last request"
            onClick={repeat}
          >
            <span className="codicon codicon-refresh" aria-hidden="true" /> Repeat
          </button>
        )}
      </div>
      <div className="rm-subtabs">
        {(['body', 'headers', 'cookies', 'test-results', 'console'] as SubTab[]).map((t) => (
          <button key={t} className={`rm-subtab ${sub === t ? 'is-active' : ''}`} onClick={() => setSub(t)}>{t.replace('-', ' ')}</button>
        ))}
      </div>
      {sub === 'body' && (
        <>
          {!binary && isJson(resp) && (
            <div className="rm-body-toolbar">
              <button className={`rm-btn rm-btn--sm ${bodyView === 'pretty' ? 'is-active' : ''}`}
                onClick={() => setBodyView('pretty')}>Pretty</button>
              {parseableJson(resp) && (
                <button className={`rm-btn rm-btn--sm ${bodyView === 'tree' ? 'is-active' : ''}`}
                  title="Browse the response as a collapsible tree"
                  onClick={() => setBodyView('tree')}>Tree</button>
              )}
              <button className={`rm-btn rm-btn--sm ${bodyView === 'raw' ? 'is-active' : ''}`}
                onClick={() => setBodyView('raw')}>Raw</button>
            </div>
          )}
          {!binary && isHtml(resp) && (
            <div className="rm-body-toolbar">
              <button className={`rm-btn rm-btn--sm ${htmlView === 'preview' ? 'is-active' : ''}`}
                onClick={() => setHtmlView('preview')}>Preview</button>
              <button className={`rm-btn rm-btn--sm ${htmlView === 'raw' ? 'is-active' : ''}`}
                onClick={() => setHtmlView('raw')}>Raw</button>
            </div>
          )}
          <div className="rm-body-toolbar">
            {!binary && (
              <>
                <input
                  className="rm-input rm-body-search"
                  aria-label="search response"
                  placeholder="Search in body"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {q && <span className="rm-meta">{lines.length} line{lines.length === 1 ? '' : 's'}</span>}
              </>
            )}
            <div className="rm-spacer" />
            {canBeautify && (
              <button className="rm-btn rm-btn--sm" title="Format the JSON body (pretty print, even from Raw view)"
                onClick={beautify}>
                Beautify
              </button>
            )}
            {!binary && (
              <button className="rm-btn rm-btn--sm" title="Copy the response body"
                onClick={() => void navigator.clipboard.writeText(displayed)}>
                Copy
              </button>
            )}
            {!binary && (
              <button className="rm-btn rm-btn--sm" title="Open the response body in a VS Code editor (search, fold, highlight)"
                onClick={() => postToHost({ type: 'openTextDocument', content: displayed, language: bodyLanguage(resp) })}>
                Open in editor
              </button>
            )}
            <button className="rm-btn rm-btn--sm" title="Save the response body to a file (the full body, even when the preview is truncated)"
              onClick={saveBody}>
              Save
            </button>
          </div>
          {resp.bodyTruncated && !binary && <div className="rm-trunc-note">Response too large — showing a truncated preview. Use Save to write the full body to a file.</div>}
          {binary ? (
            isImage ? (
              <img
                className="rm-img-preview"
                src={`data:${ct};base64,${resp.bodyBase64}`}
                alt={`response image (${fmtSize(resp.sizeBytes)})`}
              />
            ) : (
              <div className="rm-binary-note">
                <span className="codicon codicon-file-binary" aria-hidden="true" />
                <div>
                  <div className="rm-binary-title">Binary response</div>
                  <div className="rm-binary-sub">
                    {fmtSize(resp.sizeBytes)}
                    {resp.bodyTruncated ? ' (truncated preview) — use Save for the full file' : ' — use Save to write it to a file'}
                  </div>
                </div>
              </div>
            )
          ) : jsonTree ? (
            <JsonTree text={resp.body} />
          ) : inPreview ? (
            // Sandboxed with NO tokens => scripts disabled (JS-free preview), and
            // default-src 'none' in the page CSP blocks any external resources.
            <iframe
              className="rm-html-preview"
              title="HTML response preview"
              sandbox=""
              srcDoc={resp.body}
            />
          ) : q ? (
            <pre className="rm-code">
              {lines.map((l, i) => (
                <div key={i} className="rm-body-line">{highlight(l, q)}</div>
              ))}
              {lines.length === 0 && <div className="rm-body-empty">No matches</div>}
            </pre>
          ) : (
            <pre className="rm-code">{displayed}</pre>
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
