import { describe, it, expect } from 'vitest'
import { runPreScript, runTestScript } from '../../src/extension/scripting/sandbox'
import type { HttpResponse, RestRequest } from '../../src/shared/types'

function req(over: Partial<RestRequest> = {}): RestRequest {
  return { id: '1', name: 'r', method: 'GET', url: 'https://api/x', params: [], headers: [], body: { mode: 'none' }, ...over }
}

describe('runPreScript', () => {
  it('empty script is a no-op', () => {
    const out = runPreScript('', { request: req(), vars: [] })
    expect(out.request.url).toBe('https://api/x')
    expect(out.envSets).toEqual([]); expect(out.error).toBeUndefined()
  })
  it('mutates the request url/method/headers', () => {
    const out = runPreScript(
      `pm.request.url = 'https://api/y'; pm.request.method = 'POST'; pm.request.headers.add({ key: 'X-A', value: '1' })`,
      { request: req(), vars: [] })
    expect(out.request.url).toBe('https://api/y')
    expect(out.request.method).toBe('POST')
    expect(out.request.headers.find((h) => h.key === 'X-A')?.value).toBe('1')
  })
  it('records pm.environment.set and captures console.log', () => {
    const out = runPreScript(`pm.environment.set('token', 'abc'); console.log('hello', 1)`, { request: req(), vars: [] })
    expect(out.envSets).toEqual([{ key: 'token', value: 'abc', enabled: true }])
    expect(out.logs).toEqual(['hello 1'])
  })
  it('reads pm.environment.get / pm.variables.get', () => {
    const out = runPreScript(`pm.request.url = pm.environment.get('base') + '/z'`, { request: req(), vars: [{ key: 'base', value: 'https://api', enabled: true }] })
    expect(out.request.url).toBe('https://api/z')
  })
  it('captures a thrown error without crashing', () => {
    const out = runPreScript(`throw new Error('boom')`, { request: req(), vars: [] })
    expect(out.error).toContain('boom')
  })
})

describe('runTestScript', () => {
  const resp: HttpResponse = { status: 200, statusText: 'OK', headers: [{ key: 'content-type', value: 'application/json', enabled: true }], body: '{"a":1}', bodyTruncated: false, timeMs: 12, sizeBytes: 7, cookies: [] }
  it('collects pm.test pass and fail', () => {
    const out = runTestScript(
      `pm.test('status is 200', () => { pm.expect(pm.response.code).to.equal(200) });
       pm.test('bad', () => { pm.expect(1).to.equal(2) })`,
      { response: resp, vars: [] })
    expect(out.tests).toEqual([
      { name: 'status is 200', passed: true },
      { name: 'bad', passed: false, error: expect.stringContaining('equal') },
    ])
  })
  it('pm.response.json() parses the body', () => {
    const out = runTestScript(`pm.test('json', () => { pm.expect(pm.response.json().a).to.equal(1) })`, { response: resp, vars: [] })
    expect(out.tests[0].passed).toBe(true)
  })
  it('pm.environment.set is recorded', () => {
    const out = runTestScript(`pm.environment.set('t', pm.response.json().a + '')`, { response: resp, vars: [] })
    expect(out.envSets).toEqual([{ key: 't', value: '1', enabled: true }])
  })
  it('top-level throw captured', () => {
    const out = runTestScript(`throw new Error('nope')`, { response: resp, vars: [] })
    expect(out.error).toContain('nope')
  })
})
