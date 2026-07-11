import type { HttpError, HttpResponse, KeyValue, RestRequest } from '../shared/types'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

type Opts = { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }

function buildUrl(req: RestRequest): string {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return req.url
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return req.url.includes('?') ? `${req.url}&${qs}` : `${req.url}?${qs}`
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
  }
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

export async function sendRequest(req: RestRequest, opts: Opts = {}): Promise<HttpResponse> {
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
    } catch (e: any) {
      return {
        status: 0, statusText: '', headers: [], body: '',
        bodyTruncated: false, timeMs: Date.now() - started, sizeBytes: 0,
        cookies: [], error: { kind: 'unknown', message: `Invalid header: ${String(e?.message ?? e)}` },
      }
    }
    const { body, contentType } = buildBody(req)
    if (contentType && !headers.has('content-type')) headers.set('content-type', contentType)

    const resp = await doFetch(buildUrl(req), {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
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
