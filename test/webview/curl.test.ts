import { describe, it, expect } from 'vitest'
import { parseCurl, toCurl } from '../../src/webview/curl'
import type { RestRequest } from '../../src/shared/types'

describe('parseCurl', () => {
  it('parses method, headers, url and data', () => {
    const r = parseCurl(`curl -X POST https://api.test/users -H 'Content-Type: application/json' -H "X-A: 1" --data '{"a":1}'`)
    expect(r.method).toBe('POST')
    expect(r.url).toBe('https://api.test/users')
    expect(r.headers).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'X-A', value: '1', enabled: true },
    ])
    expect(r.body).toEqual({ mode: 'raw', type: 'text', text: '{"a":1}' })
  })
  it('defaults to GET and tolerates just a url', () => {
    const r = parseCurl('curl https://api.test/x')
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://api.test/x')
  })
  it('parses -F form fields into a formdata body', () => {
    const r = parseCurl(`curl https://api.test/up -F name=bob -F file=@/tmp/a.png`)
    expect(r.body).toEqual({ mode: 'formdata', items: [
      { kind: 'text', key: 'name', value: 'bob', enabled: true },
      { kind: 'file', key: 'file', filename: 'a.png', path: '/tmp/a.png', enabled: true },
    ] })
  })
  it('never throws on malformed input', () => {
    expect(() => parseCurl('curl')).not.toThrow()
  })
  it('rebrands Postman-generated headers to rrequest', () => {
    const r = parseCurl(`curl https://api.test/x -H 'User-Agent: PostmanRuntime/7.39.1' -H 'Postman-Token: 5f4dcc3b-5aa0-474d-9b0e-8c5c9a2f3b1a' -H 'X-A: 1'`)
    expect(r.headers).toEqual([
      { key: 'User-Agent', value: 'rrequest', enabled: true },
      { key: 'Rrequest-Token', value: '5f4dcc3b-5aa0-474d-9b0e-8c5c9a2f3b1a', enabled: true },
      { key: 'X-A', value: '1', enabled: true },
    ])
  })
  it('keeps other User-Agent values', () => {
    const r = parseCurl(`curl https://api.test/x -H 'user-agent: my-agent/2.0'`)
    expect(r.headers).toEqual([{ key: 'user-agent', value: 'my-agent/2.0', enabled: true }])
  })
})

describe('toCurl', () => {
  const base: RestRequest = {
    id: '1', name: 'r', method: 'POST', url: 'https://api.test/users',
    params: [], headers: [{ key: 'X-A', value: '1', enabled: true }],
    body: { mode: 'raw', type: 'json', text: '{"a":1}' },
  }
  it('generates a curl command with method, header and data', () => {
    const s = toCurl(base)
    expect(s).toContain(`curl -X POST 'https://api.test/users'`)
    expect(s).toContain(`-H 'X-A: 1'`)
    expect(s).toContain(`--data '{"a":1}'`)
  })
  it('folds enabled params into the url', () => {
    const s = toCurl({ ...base, method: 'GET', body: { mode: 'none' }, params: [{ key: 'q', value: '1', enabled: true }] })
    expect(s).toContain(`'https://api.test/users?q=1'`)
  })
})
