import type { HttpError, HttpResponse, KeyValue, RestRequest } from '../../shared/types'
import { interpolate } from '../scripting/interpolate'
import * as fs from 'node:fs/promises'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

type Opts = {
  timeoutMs?: number
  maxBytes?: number
  fetchImpl?: typeof fetch
  vars?: KeyValue[]
  // Called with the FULL body (before truncation) once it has been read, so the
  // caller can cache it for a later "save response body to file" without the
  // full payload ever crossing the webview IPC (which is truncated to maxBytes).
  onFullBody?: (full: { text?: string; base64?: string }) => void
  // External abort signal (e.g. the user clicking Cancel). Aborting it cancels
  // the fetch and the response comes back as a `canceled` error, not a timeout.
  externalSignal?: AbortSignal
}

// Content types whose payload can't be shown as UTF-8 text. Images get a
// preview, everything else shows a "binary response" note. JSON/XML/SVG stay
// text so the existing pretty/raw views keep working.
function isBinaryContentType(ct: string): boolean {
  const t = ct.toLowerCase()
  return (
    /^(image|audio|video)\//.test(t) ||
    t === 'application/octet-stream' ||
    t === 'application/pdf' ||
    t === 'application/zip'
  )
}

function buildUrl(req: RestRequest): string {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return req.url
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return req.url.includes('?') ? `${req.url}&${qs}` : `${req.url}?${qs}`
}

// Applies request auth: mutates `headers` for header-based auth, returns a query
// fragment (no leading ? or &) for query-based api-key auth, else ''.
function applyAuth(req: RestRequest, headers: Headers, sub: (s: string) => string): string {
  const a = req.auth
  if (!a || a.type === 'none') return ''
  if (a.type === 'bearer') {
    if (a.token && !headers.has('authorization')) headers.set('authorization', `Bearer ${sub(a.token)}`)
    return ''
  }
  if (a.type === 'basic') {
    if (!headers.has('authorization')) {
      const token = Buffer.from(`${sub(a.username)}:${sub(a.password)}`).toString('base64')
      headers.set('authorization', `Basic ${token}`)
    }
    return ''
  }
  // oauth2: the resolved Bearer token was injected into headers by messaging
  // before send (resolveOAuthToken) — nothing to do here.
  if (a.type === 'oauth2') return ''
  // apikey
  if (!a.key) return ''
  if (a.in === 'header') { headers.set(sub(a.key), sub(a.value)); return '' }
  return `${encodeURIComponent(sub(a.key))}=${encodeURIComponent(sub(a.value))}`
}

function buildBody(req: RestRequest): { body?: string; contentType?: string } {
  switch (req.body.mode) {
    case 'none':
      return {}
    case 'raw': {
      const ct = req.body.type === 'json' ? 'application/json'
        : req.body.type === 'xml' ? 'application/xml' : 'text/plain'
      return { body: req.body.text, contentType: ct }
    }
    case 'urlencoded': {
      const s = req.body.items
        .filter((i) => i.enabled && i.key)
        .map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value)}`)
        .join('&')
      return { body: s, contentType: 'application/x-www-form-urlencoded' }
    }
    case 'graphql': {
      let variables: unknown = {}
      try { variables = req.body.variables ? JSON.parse(req.body.variables) : {} } catch { variables = {} }
      return { body: JSON.stringify({ query: req.body.query, variables }), contentType: 'application/json' }
    }
    case 'formdata':
      // Multipart is assembled separately in sendRequest (fetch sets the boundary Content-Type).
      return {}
  }
}

async function buildFormData(req: RestRequest, sub: (s: string) => string): Promise<FormData> {
  const fd = new FormData()
  if (req.body.mode !== 'formdata') return fd
  for (const it of req.body.items) {
    if (!it.enabled || !it.key) continue
    if (it.kind === 'text') fd.append(sub(it.key), sub(it.value))
    else {
      const buf = await fs.readFile(it.path)
      fd.append(sub(it.key), new Blob([new Uint8Array(buf)]), sub(it.filename))
    }
  }
  return fd
}

function truncateUtf8(full: string, maxBytes: number): string {
  const buf = Buffer.from(full, 'utf8')
  let end = maxBytes
  // back off if we're in the middle of a multi-byte sequence (continuation byte 0b10xxxxxx)
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

function headersToKeyValues(h: Headers): KeyValue[] {
  const out: KeyValue[] = []
  h.forEach((value, key) => out.push({ key, value, enabled: true }))
  return out
}

function extractCookies(h: Headers): KeyValue[] {
  const raw = h.get('set-cookie')
  if (!raw) return []
  return raw.split(/,(?=[^;]+=)/).map((c) => {
    const [pair] = c.split(';')
    const idx = pair.indexOf('=')
    return { key: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), enabled: true }
  })
}

export async function sendRequest(request: RestRequest, opts: Opts = {}): Promise<HttpResponse> {
  const vars = opts.vars ?? []
  const sub = (s: string) => (vars.length ? interpolate(s, vars) : s)
  const req: RestRequest = vars.length
    ? {
        ...request,
        url: sub(request.url),
        params: request.params.map((p) => ({ ...p, key: sub(p.key), value: sub(p.value) })),
        headers: request.headers.map((h) => ({ ...h, key: sub(h.key), value: sub(h.value) })),
        cookies: request.cookies?.map((c) => ({ ...c, key: sub(c.key), value: sub(c.value) })),
        body:
          request.body.mode === 'raw'
            ? { ...request.body, text: sub(request.body.text) }
            : request.body.mode === 'urlencoded'
            ? { ...request.body, items: request.body.items.map((i) => ({ ...i, key: sub(i.key), value: sub(i.value) })) }
            : request.body.mode === 'graphql'
            ? { ...request.body, query: sub(request.body.query), variables: sub(request.body.variables) }
            : request.body,
      }
    : request
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // A user click on Cancel propagates into the same abort path; abort from the
  // external signal is reported as `canceled`, the timeout one as `timeout`.
  if (opts.externalSignal) {
    if (opts.externalSignal.aborted) controller.abort()
    else {
      const onAbort = () => controller.abort()
      opts.externalSignal.addEventListener('abort', onAbort, { once: true })
    }
  }
  const started = Date.now()

  try {
    let headers: Headers
    try {
      headers = new Headers()
      for (const h of req.headers) if (h.enabled && h.key) headers.set(h.key, h.value)
      const cookiePairs = (req.cookies ?? []).filter((c) => c.enabled && c.key).map((c) => `${c.key}=${c.value}`)
      if (cookiePairs.length) headers.set('cookie', cookiePairs.join('; '))
    } catch (e: any) {
      return {
        status: 0, statusText: '', headers: [], body: '',
        bodyTruncated: false, timeMs: Date.now() - started, sizeBytes: 0,
        cookies: [], error: { kind: 'unknown', message: `Invalid header: ${String(e?.message ?? e)}` },
      }
    }
    const authQuery = applyAuth(req, headers, sub)
    let fetchBody: BodyInit | undefined
    if (req.body.mode === 'formdata') {
      fetchBody = await buildFormData(req, sub)   // fs.readFile may throw -> caught by the existing try/catch -> error result
      // do NOT set content-type; FormData sets the multipart boundary
    } else {
      const { body, contentType } = buildBody(req)
      if (contentType && !headers.has('content-type')) headers.set('content-type', contentType)
      fetchBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    }

    const baseUrl = buildUrl(req)
    const finalUrl = authQuery ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${authQuery}` : baseUrl
    const resp = await doFetch(finalUrl, {
      method: req.method,
      headers,
      body: fetchBody,
      signal: controller.signal,
    })
    // fetch() resolves once the response HEADERS are in — that's the TTFB mark.
    // Reading the body (arrayBuffer) completes the total; the delta is the
    // download phase. Both are wall-clock, matching the pre-existing timeMs.
    const ttfbMs = Date.now() - started
    const bytes = new Uint8Array(await resp.arrayBuffer())
    const totalMs = Date.now() - started
    const sizeBytes = bytes.byteLength
    const truncated = sizeBytes > maxBytes
    const ct = resp.headers.get('content-type') ?? ''
    const binary = isBinaryContentType(ct)
    let body = ''
    let bodyBase64: string | undefined
    if (binary) {
      const slice = truncated ? bytes.subarray(0, maxBytes) : bytes
      bodyBase64 = Buffer.from(slice).toString('base64')
    } else {
      const full = Buffer.from(bytes).toString('utf8')
      body = truncated ? truncateUtf8(full, maxBytes) : full
    }
    // Full payload goes only to the caller's cache, never into the response
    // message (which is capped at maxBytes on purpose).
    opts.onFullBody?.(binary ? { base64: Buffer.from(bytes).toString('base64') } : { text: Buffer.from(bytes).toString('utf8') })
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: headersToKeyValues(resp.headers),
      body,
      bodyTruncated: truncated,
      timeMs: totalMs,
      sizeBytes,
      cookies: extractCookies(resp.headers),
      timings: { ttfbMs, downloadMs: totalMs - ttfbMs },
      bodyIsBinary: binary,
      bodyBase64,
    }
  } catch (e: any) {
    const kind: HttpError['kind'] =
      e?.name === 'AbortError'
        ? opts.externalSignal?.aborted
          ? 'canceled'
          : 'timeout'
        : e instanceof TypeError
        ? 'connection'
        : 'unknown'
    return {
      status: 0, statusText: '', headers: [], body: '',
      bodyTruncated: false, timeMs: Date.now() - started, sizeBytes: 0,
      cookies: [], error: { kind, message: String(e?.message ?? e) },
    }
  } finally {
    clearTimeout(timer)
  }
}
