import { describe, expect, test } from 'vitest'
import { compileChecks, parseChecks, type CheckRow } from '../../src/webview/views/RequestPanel/test-compile'
import { runTestScript } from '../../src/extension/scripting/sandbox'
import type { HttpResponse } from '../../src/shared/types'

function makeResponse(over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200, statusText: 'OK', body: '{"a":{"b":5}}', bodyTruncated: false,
    timeMs: 42, sizeBytes: 11,
    headers: [{ key: 'X-Test', value: 'yes', enabled: true }],
    cookies: [],
    ...over,
  }
}

function row(patch: Partial<CheckRow>): CheckRow {
  return { id: 'x1', target: 'status', selector: '', op: 'eq', value: '200', ...patch }
}

describe('test-compile', () => {
  test('compile([]) is empty string (no marker pollution)', () => {
    expect(compileChecks([])).toBe('')
  })

  test('parseChecks returns null for hand-written scripts without marker', () => {
    expect(parseChecks('pm.test("x", () => 1)')).toBeNull()
  })

  test('round-trip: compile then parse yields same rows', () => {
    const rows = [
      row({ target: 'status', op: 'eq', value: '200' }),
      row({ target: 'header', selector: 'X-Test', op: 'eq', value: 'yes' }),
      row({ target: 'json', selector: 'a.b', op: 'gt', value: '2' }),
      row({ target: 'time', op: 'lt', value: '100' }),
    ]
    const parsed = parseChecks(compileChecks(rows))
    expect(parsed).not.toBeNull()
    expect(parsed!.rows.map((r) => ({ target: r.target, selector: r.selector, op: r.op, value: r.value })))
      .toEqual(rows.map((r) => ({ target: r.target, selector: r.selector, op: r.op, value: r.value })))
  })

  test('compiled script runs in the sandbox and yields PASS/FAIL per row', async () => {
    const script = compileChecks([
      row({ target: 'status', op: 'eq', value: '200' }),              // pass
      row({ target: 'json', selector: 'a.b', op: 'eq', value: '5' }), // pass
      row({ target: 'json', selector: 'a.b', op: 'eq', value: '9' }), // fail
      row({ target: 'header', selector: 'X-Test', op: 'eq', value: 'no' }), // fail
    ])
    const { tests, error } = await runTestScript(script, { response: makeResponse(), vars: [] })
    expect(error).toBeUndefined()
    expect(tests.map((t) => t.passed)).toEqual([true, true, false, false])
  })

  test('missing json path yields a clean FAIL (undefined comparison)', async () => {
    const { tests } = await runTestScript(
      compileChecks([row({ target: 'json', selector: 'a.missing', op: 'eq', value: '1' })]),
      { response: makeResponse(), vars: [] },
    )
    expect(tests[0].passed).toBe(false)
  })
})