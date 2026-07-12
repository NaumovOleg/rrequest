import { describe, it, expect } from 'vitest'
import type { RestRequest, TestResult, HttpResponse } from '../../src/shared/types'

describe('script types', () => {
  it('RestRequest carries optional script fields', () => {
    const r: RestRequest = { id: '1', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' }, preRequestScript: 'pm.environment.set("a","1")', testScript: 'pm.test("ok", () => {})' }
    expect(r.preRequestScript).toContain('pm.environment')
  })
  it('HttpResponse carries optional testResults + consoleLogs', () => {
    const t: TestResult = { name: 'status is 200', passed: true }
    const resp: HttpResponse = { status: 200, statusText: 'OK', headers: [], body: '', bodyTruncated: false, timeMs: 1, sizeBytes: 0, cookies: [], testResults: [t], consoleLogs: ['hi'] }
    expect(resp.testResults?.[0].passed).toBe(true)
    expect(resp.consoleLogs).toEqual(['hi'])
  })
})
