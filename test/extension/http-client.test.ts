// @vitest-environment node
//
// This file is switched off the default jsdom environment because jsdom's
// File/Blob implementation (returned from FormData#get) does not implement
// `.text()` / `.arrayBuffer()`, which the form-data multipart tests below
// need. None of the tests in this file rely on DOM globals, so running them
// under Node's native fetch/FormData/Blob/File is both necessary and safe.
import { describe, it, expect } from 'vitest'
import { sendRequest } from '../../src/extension/net/http-client'
import type { RestRequest } from '../../src/shared/types'
import * as fsp from 'node:fs/promises'
import * as ospath from 'node:path'
import * as osmod from 'node:os'

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

  it('sends a request body for the QUERY method (GET-with-a-body semantics)', async () => {
    let seenInit: any
    const fetchImpl = (async (_url: string, init: any) => {
      seenInit = init
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    await sendRequest(
      baseReq({ method: 'QUERY', body: { mode: 'raw', type: 'json', text: '{"q":"x"}' } }),
      { fetchImpl },
    )
    expect(seenInit.method).toBe('QUERY')
    expect(seenInit.body).toBe('{"q":"x"}')
  })
  it('sends a GraphQL body as JSON { query, variables }', async () => {
    let seenInit: any
    const fetchImpl = (async (_url: string, init: any) => {
      seenInit = init
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(
      baseReq({ method: 'POST', body: { mode: 'graphql', query: '{ me { id } }', variables: '{"x":1}' } }),
      { fetchImpl },
    )
    expect((seenInit.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(seenInit.body)).toEqual({ query: '{ me { id } }', variables: { x: 1 } })
  })
  it('sends enabled cookies as a Cookie header', async () => {
    let seenInit: any
    const fetchImpl = (async (_url: string, init: any) => {
      seenInit = init
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(
      baseReq({ cookies: [
        { key: 'sid', value: 'abc', enabled: true },
        { key: 'skip', value: 'x', enabled: false },
      ] }),
      { fetchImpl },
    )
    expect((seenInit.headers as Headers).get('cookie')).toBe('sid=abc')
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

  it('maps an abort from the external signal to error.kind canceled (user cancel)', async () => {
    const fetchImpl = (async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e
    }) as unknown as typeof fetch
    const controller = new AbortController()
    controller.abort()
    const res = await sendRequest(baseReq(), { fetchImpl, externalSignal: controller.signal })
    expect(res.error?.kind).toBe('canceled')
  })

  it('aborts the live fetch when the external signal fires after the request started', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      // Let the caller abort while this fetch is in flight.
      await new Promise((r) => setTimeout(r, 20))
      // The transport must have forwarded the external signal to fetch and the
      // click must have aborted it before the fetch body finished.
      expect(init?.signal?.aborted).toBe(true)
      const e = new Error('aborted'); e.name = 'AbortError'; throw e
    }) as unknown as typeof fetch
    const controller = new AbortController()
    const pending = sendRequest(baseReq(), { fetchImpl, externalSignal: controller.signal })
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    const res = await pending
    expect(res.error?.kind).toBe('canceled')
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

  it('never exceeds maxBytes even when the cut lands mid multi-byte sequence', async () => {
    // '😀' is 4 bytes in utf8; 50 repeats = 200 bytes. maxBytes 101 is NOT a
    // multiple of 4, so a naive byte-slice lands mid-sequence.
    const big = '😀'.repeat(50)
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch
    const res = await sendRequest(baseReq(), { fetchImpl, maxBytes: 101 })
    expect(res.bodyTruncated).toBe(true)
    expect(Buffer.byteLength(res.body, 'utf8')).toBeLessThanOrEqual(101)
    expect(res.sizeBytes).toBe(200)
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

describe('sendRequest with env vars', () => {
  it('interpolates {{var}} into url, params, headers and raw body without mutating req', async () => {
    let seenUrl = ''
    let seenInit: RequestInit = {}
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url; seenInit = init
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const req = baseReq({
      method: 'POST',
      url: '{{base}}/users',
      params: [{ key: 'q', value: '{{term}}', enabled: true }],
      headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      body: { mode: 'raw', type: 'json', text: '{"t":"{{token}}"}' },
    })
    const vars = [
      { key: 'base', value: 'https://api.dev', enabled: true },
      { key: 'term', value: 'hi', enabled: true },
      { key: 'token', value: 'abc', enabled: true },
    ]
    await sendRequest(req, { fetchImpl, vars })

    expect(seenUrl).toBe('https://api.dev/users?q=hi')
    expect(new Headers(seenInit.headers).get('authorization')).toBe('Bearer abc')
    expect(seenInit.body).toBe('{"t":"abc"}')
    // req not mutated:
    expect(req.url).toBe('{{base}}/users')
    expect(req.headers[0].value).toBe('Bearer {{token}}')
  })

  it('leaves unknown placeholders literal and works with no vars', async () => {
    let seenUrl = ''
    const fetchImpl = (async (url: string) => { seenUrl = url; return new Response('', { status: 200 }) }) as unknown as typeof fetch
    await sendRequest(baseReq({ url: '{{nope}}/x' }), { fetchImpl })
    expect(seenUrl).toBe('{{nope}}/x')
  })
})

describe('sendRequest form-data', () => {
  it('sends text and file fields as multipart FormData', async () => {
    const dir = await fsp.mkdtemp(ospath.join(osmod.tmpdir(), 'rm-fd-'))
    const fpath = ospath.join(dir, 'a.txt')
    await fsp.writeFile(fpath, 'FILEBODY')

    let seenBody: any
    let seenHeaders: Headers = new Headers()
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenBody = init.body; seenHeaders = new Headers(init.headers)
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await sendRequest(baseReq({
      method: 'POST',
      body: { mode: 'formdata', items: [
        { kind: 'text', key: 'name', value: 'bob', enabled: true },
        { kind: 'file', key: 'file', filename: 'a.txt', path: fpath, enabled: true },
        { kind: 'text', key: 'off', value: 'x', enabled: false },
      ] },
    }), { fetchImpl })

    expect(seenBody).toBeInstanceOf(FormData)
    expect(seenBody.get('name')).toBe('bob')
    expect(seenBody.get('off')).toBeNull()
    const file = seenBody.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect(await (file as Blob).text()).toBe('FILEBODY')
    // Content-Type not manually set (fetch/undici sets multipart boundary itself)
    expect(seenHeaders.get('content-type')).toBeNull()
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('interpolates {{var}} in text fields and returns an error (no throw) for a missing file', async () => {
    let seenBody: any
    const fetchImpl = (async (_u: string, init: RequestInit) => { seenBody = init.body; return new Response('', { status: 200 }) }) as unknown as typeof fetch
    await sendRequest(baseReq({ method: 'POST', body: { mode: 'formdata', items: [{ kind: 'text', key: 'k', value: '{{v}}', enabled: true }] } }),
      { fetchImpl, vars: [{ key: 'v', value: 'V', enabled: true }] })
    expect(seenBody.get('k')).toBe('V')

    const res = await sendRequest(baseReq({ method: 'POST', body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: 'x', path: '/no/such/file', enabled: true }] } }),
      { fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch })
    expect(res.error).toBeTruthy()
    expect(res.status).toBe(0)
  })

  it('applies bearer auth as an Authorization header', async () => {
    let seenAuth: string | null = null
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seenAuth = (init.headers as Headers).get('authorization'); return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(baseReq({ auth: { type: 'bearer', token: 'abc' } }), { fetchImpl })
    expect(seenAuth).toBe('Bearer abc')
  })

  it('applies basic auth as base64 and interpolates vars', async () => {
    let seenAuth: string | null = null
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seenAuth = (init.headers as Headers).get('authorization'); return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(baseReq({ auth: { type: 'basic', username: 'u', password: '{{pw}}' } }),
      { fetchImpl, vars: [{ key: 'pw', value: 'p', enabled: true }] })
    expect(seenAuth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('applies api-key auth in a header or the query string', async () => {
    let seenHeader: string | null = null
    let seenUrl = ''
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url; seenHeader = (init.headers as Headers).get('x-api-key'); return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await sendRequest(baseReq({ auth: { type: 'apikey', key: 'X-API-Key', value: 'k', in: 'header' } }), { fetchImpl })
    expect(seenHeader).toBe('k')
    await sendRequest(baseReq({ auth: { type: 'apikey', key: 'token', value: 'k', in: 'query' } }), { fetchImpl })
    expect(seenUrl).toBe('https://api.test/x?token=k')
  })
})
