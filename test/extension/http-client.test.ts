import { describe, it, expect } from 'vitest'
import { sendRequest } from '../../src/extension/http-client'
import type { RestRequest } from '../../src/shared/types'

function baseReq(over: Partial<RestRequest> = {}): RestRequest {
  return {
    id: '1', name: 'r', method: 'GET', url: 'https://api.test/x',
    params: [], headers: [], body: { mode: 'none' }, ...over,
  }
}

describe('sendRequest', () => {
  it('appends enabled params to the URL and maps a 200 response', async () => {
    let seenUrl = ''
    const fetchImpl = (async (url: string) => {
      seenUrl = url
      return new Response('{"ok":true}', {
        status: 200, statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const res = await sendRequest(
      baseReq({ params: [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
      ] }),
      { fetchImpl },
    )
    expect(seenUrl).toBe('https://api.test/x?a=1')
    expect(res.status).toBe(200)
    expect(res.body).toBe('{"ok":true}')
    expect(res.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value)
      .toContain('application/json')
    expect(res.timeMs).toBeGreaterThanOrEqual(0)
    expect(res.error).toBeUndefined()
  })

  it('returns non-2xx as a normal response, not an error', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' })
    ) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl })
    expect(res.status).toBe(404)
    expect(res.error).toBeUndefined()
  })

  it('maps a thrown network error to error.kind connection', async () => {
    const fetchImpl = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl })
    expect(res.error?.kind).toBe('connection')
    expect(res.status).toBe(0)
  })

  it('maps an abort to error.kind timeout', async () => {
    const fetchImpl = (async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e
    }) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl, timeoutMs: 5 })
    expect(res.error?.kind).toBe('timeout')
  })

  it('truncates a body larger than maxBytes and flags it', async () => {
    const big = 'x'.repeat(1000)
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl, maxBytes: 100 })
    expect(res.bodyTruncated).toBe(true)
    expect(res.body.length).toBeLessThanOrEqual(100)
    expect(res.sizeBytes).toBe(1000)
  })

  it('returns an error response instead of throwing when a header is invalid', async () => {
    const fetchImpl = (async () =>
      new Response('ok', { status: 200 })
    ) as unknown as typeof fetch
    const res = await sendRequest(
      baseReq({ headers: [{ key: 'bad header', value: 'x', enabled: true }] }),
      { fetchImpl },
    )
    expect(res.error?.kind).toBe('unknown')
    expect(res.status).toBe(0)
    expect(res.body).toBe('')
  })

  it('truncates non-ASCII bodies by byte length, not character length', async () => {
    const big = 'é'.repeat(1000) // 2 bytes each in utf8 -> 2000 bytes total
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl, maxBytes: 100 })
    expect(res.bodyTruncated).toBe(true)
    expect(Buffer.byteLength(res.body, 'utf8')).toBeLessThanOrEqual(100)
    expect(res.sizeBytes).toBe(2000)
  })

  it('serializes a raw json body and defaults content-type', async () => {
    let seenInit: RequestInit = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenInit = init
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(
      baseReq({ method: 'POST', body: { mode: 'raw', type: 'json', text: '{"a":1}' } }),
      { fetchImpl },
    )
    expect(seenInit.body).toBe('{"a":1}')
    const headers = new Headers(seenInit.headers)
    expect(headers.get('content-type')).toBe('application/json')
  })
})
