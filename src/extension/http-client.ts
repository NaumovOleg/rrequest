import type { HttpError, HttpResponse, KeyValue, RestRequest } from '../shared/types'
import { interpolate } from './interpolate'
import * as fs from 'node:fs/promises'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

type Opts = { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; vars?: KeyValue[] }

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
    const full = await resp.text()
    const sizeBytes = Buffer.byteLength(full, 'utf8')
    const truncated = sizeBytes > maxBytes
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: headersToKeyValues(resp.headers),
      body: truncated ? truncateUtf8(full, maxBytes) : full,
      bodyTruncated: truncated,
      timeMs: Date.now() - started,
      sizeBytes,
      cookies: extractCookies(resp.headers),
    }
  } catch (e: any) {
    const kind: HttpError['kind'] =
      e?.name === 'AbortError' ? 'timeout'
      : e instanceof TypeError ? 'connection'
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
