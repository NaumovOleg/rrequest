import { describe, expect, test } from 'vitest'
import { generateCode, toCurlString, toJsFetch, toPythonRequests, toGoHttp } from '../../src/webview/codegen'
import type { RestRequest } from '../../src/shared/types'

function req(patch: Partial<RestRequest> = {}): RestRequest {
  return {
    id: 'r1',
    name: 'test',
    method: 'GET',
    url: 'https://api.example.com/users',
    params: [],
    headers: [],
    body: { mode: 'none' },
    ...patch,
  }
}

describe('codegen', () => {
  test('curl: method, custom header, raw json body', () => {
    const out = toCurlString(req({
      method: 'POST',
      headers: [{ key: 'X-Token', value: 'abc', enabled: true }],
      body: { mode: 'raw', type: 'json', text: '{"a":1}' },
    }))
    expect(out).toContain("curl --request POST 'https://api.example.com/users'")
    expect(out).toContain("--header 'X-Token: abc'")
    expect(out).toContain("--data '{\"a\":1}'")
  })

  test('curl: single-quotes in url are shell-escaped', () => {
    const out = toCurlString(req({ url: "https://x.test/a'b" }))
    expect(out).toContain(`'https://x.test/a'\\''b'`)
  })

  test('curl: formdata with files is refused (comment instead of broken command)', () => {
    const out = toCurlString(req({
      body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: 'f.png', path: '/tmp/f.png', enabled: true }] },
    }))
    expect(out).toContain('not supported')
  })

  test('js: fetch with method, headers and raw body', () => {
    const out = toJsFetch(req({
      method: 'PUT',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { mode: 'raw', type: 'json', text: '{"a":1}' },
    }))
    expect(out).toContain('fetch("https://api.example.com/users", {')
    expect(out).toContain('"Content-Type": "application/json"')
    expect(out).toContain('body: "{\\"a\\":1}",')
  })

  test('python: json-parseable raw body becomes json= kwarg, other becomes data=', () => {
    const json = toPythonRequests(req({
      method: 'POST',
      headers: [],
      body: { mode: 'raw', type: 'json', text: '{"a":1}' },
    }))
    expect(json).toContain('json={"a":1}')
    const plain = toPythonRequests(req({
      method: 'POST',
      body: { mode: 'raw', type: 'text', text: 'hello' },
    }))
    expect(plain).toContain('data="hello"')
  })

  test('go: newline-free round-trip via http.NewRequest', () => {
    const out = toGoHttp(req({ body: { mode: 'raw', type: 'json', text: '{"a":1}' } }))
    expect(out).toContain('http.NewRequest("GET", "https://api.example.com/users",')
    expect(out).toContain('io.ReadAll(resp.Body)')
  })

  test('generateCode dispatches all four languages', () => {
    const base = req()
    expect(generateCode(base, 'curl')).toContain('curl ')
    expect(generateCode(base, 'javascript')).toContain('fetch(')
    expect(generateCode(base, 'python')).toContain('requests.get')
    expect(generateCode(base, 'go')).toContain('package main')
  })
})