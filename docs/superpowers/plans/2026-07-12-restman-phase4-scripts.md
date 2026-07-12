# restman Phase 4 (Scripts / Hooks + Tests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-request pre-request and test scripts (Postman-like `pm` API) that run in a Node `vm` sandbox in the extension host — the pre-request script can mutate the outgoing request and write env vars, the test script asserts with `pm.test`/`pm.expect` — and show Test Results + Console in the response area.

**Architecture:** Scripts run in the host via `vm.runInNewContext` (curated context, 5s timeout). `sendRequest` orchestrates: run pre-script (persist env writes, take the mutated request) → interpolate `{{var}}` → send → run test-script (persist env writes) → attach `testResults` + `consoleLogs` to the response. The saved request and history entry keep their raw text; env writes persist to the active environment and the Hub broadcasts them.

**Tech Stack:** TypeScript, Node `vm`, existing VS Code + React + Zustand + Vitest. No new dependencies.

## Global Constraints

- Scripts run ONLY in the extension host, in `vm.runInNewContext(script, sandbox, { timeout: 5000 })` with a context that excludes `require`, `process`, `fs`, `global`, `globalThis`, `setTimeout`, `setInterval`. A thrown error or timeout is captured into an `error` string — the host never crashes.
- The pre-request script mutates a WORKING COPY of the request; the sent request is that copy after `{{var}}` interpolation. The stored request and the history entry keep their raw text (raw `msg.payload` is what history records).
- `pm.environment.set(k,v)` writes persist to the ACTIVE environment via EnvironmentStore; after writes the Hub's snapshot broadcast refreshes `environments` on both surfaces.
- Execution order on send: load active env → pre-script (persist env, take mutated request) → interpolate → send → test-script (persist env) → return response + testResults + consoleLogs (pre logs then post logs, in order).
- New `RestRequest` script fields and `HttpResponse` result fields are OPTIONAL (absent = empty) to avoid churning every existing request/response literal; `blankRequest()` sets scripts to `''`.
- `pm.expect` is the focused matcher set only (equal/eql/be.a/include/be.ok/be.true/be.false/be.above/be.below + `.not`). No full Chai.
- All shared types in `src/shared/types.ts`. `--vscode-*`/`rm-*` styling only. TDD; keep the suite green; small commits. Run `npx tsc --noEmit` yourself each task and confirm clean.

---

## File Structure

```
New:
  src/extension/pm-expect.ts     // chainable assertion lib (pure)
  src/extension/sandbox.ts       // runPreScript + runTestScript (vm)
  + colocated tests

Modified:
  src/shared/types.ts            // optional script fields + TestResult + response fields
  src/extension/messaging.ts     // sendRequest orchestration + runPreScript/runTestScript deps + env persist
  src/extension/panel.ts         // inject the real sandbox fns into the router
  src/webview/state/store.ts     // blankRequest sets preRequestScript/testScript ''
  src/webview/components/RequestPanel/RequestPanel.tsx  // Pre-request Script + Tests sub-tabs
  src/webview/components/ResponsePanel/ResponsePanel.tsx // Test Results + Console sub-tabs
```

---

## Task 1: Shared types — script fields + TestResult + response fields

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/script-types.test.ts`

**Interfaces:**
- Produces: `RestRequest.preRequestScript?: string`, `RestRequest.testScript?: string`; `TestResult = { name; passed; error? }`; `HttpResponse.testResults?: TestResult[]`, `HttpResponse.consoleLogs?: string[]`. All new fields OPTIONAL.

- [ ] **Step 1: Write the failing test**

`test/shared/script-types.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/script-types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`:
- Add to the `RestRequest` type (as optional fields):
```ts
  preRequestScript?: string
  testScript?: string
```
- Add the `TestResult` type near `HttpResponse`:
```ts
export type TestResult = { name: string; passed: boolean; error?: string }
```
- Add to the `HttpResponse` type (optional):
```ts
  testResults?: TestResult[]
  consoleLogs?: string[]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/script-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (optional fields → no existing literal breaks).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/script-types.test.ts
git commit -m "feat: optional script fields, TestResult, response test/console fields"
```

---

## Task 2: pm.expect assertion library

**Files:**
- Create: `src/extension/pm-expect.ts`
- Test: `test/extension/pm-expect.test.ts`

**Interfaces:**
- Produces: `expect(actual: any)` returning a chainable with a `.to` object and `.to.not`; matchers `equal(v)`, `eql(v)`, `be.a(type)`/`be.an(type)`, `include(v)`, `be.ok`, `be.true`, `be.false`, `be.above(n)`, `be.below(n)`. Each failing matcher throws an `Error`; negated forms throw when the base would pass.

- [ ] **Step 1: Write the failing test**

`test/extension/pm-expect.test.ts`:
```ts
import { describe, it, expect as vExpect } from 'vitest'
import { expect } from '../../src/extension/pm-expect'

describe('pm.expect', () => {
  it('equal passes and fails', () => {
    expect(1).to.equal(1)
    vExpect(() => expect(1).to.equal(2)).toThrow()
  })
  it('eql does deep equality', () => {
    expect({ a: 1 }).to.eql({ a: 1 })
    vExpect(() => expect({ a: 1 }).to.eql({ a: 2 })).toThrow()
  })
  it('be.a checks type', () => {
    expect('x').to.be.a('string')
    vExpect(() => expect(1).to.be.a('string')).toThrow()
  })
  it('include works for arrays and strings', () => {
    expect([1, 2]).to.include(2)
    expect('hello').to.include('ell')
    vExpect(() => expect([1]).to.include(9)).toThrow()
  })
  it('be.ok / be.true / be.false', () => {
    expect(1).to.be.ok
    expect(true).to.be.true
    expect(false).to.be.false
    vExpect(() => { expect(0).to.be.ok }).toThrow()
  })
  it('be.above / be.below', () => {
    expect(5).to.be.above(3)
    expect(2).to.be.below(3)
    vExpect(() => expect(2).to.be.above(3)).toThrow()
  })
  it('negation via .to.not', () => {
    expect(1).to.not.equal(2)
    vExpect(() => expect(1).to.not.equal(1)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/pm-expect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/pm-expect.ts`:
```ts
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual(a[k], b[k]))
}

function fail(msg: string): never { throw new Error(msg) }

function makeChain(actual: any, negate: boolean) {
  const check = (ok: boolean, msg: string) => {
    if (negate ? ok : !ok) fail(negate ? `expected NOT: ${msg}` : msg)
  }
  const be: any = {
    a: (t: string) => check(typeof actual === t, `expected ${JSON.stringify(actual)} to be a ${t}`),
    an: (t: string) => check(typeof actual === t, `expected ${JSON.stringify(actual)} to be an ${t}`),
    above: (n: number) => check(actual > n, `expected ${actual} to be above ${n}`),
    below: (n: number) => check(actual < n, `expected ${actual} to be below ${n}`),
    get ok() { check(!!actual, `expected ${JSON.stringify(actual)} to be ok`); return undefined },
    get true() { check(actual === true, `expected ${JSON.stringify(actual)} to be true`); return undefined },
    get false() { check(actual === false, `expected ${JSON.stringify(actual)} to be false`); return undefined },
  }
  return {
    equal: (v: any) => check(actual === v, `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(v)}`),
    eql: (v: any) => check(deepEqual(actual, v), `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(v)}`),
    include: (v: any) => check(
      typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.includes(v) : false,
      `expected ${JSON.stringify(actual)} to include ${JSON.stringify(v)}`),
    be,
  }
}

export function expect(actual: any) {
  return { to: { ...makeChain(actual, false), not: makeChain(actual, true) } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/pm-expect.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/extension/pm-expect.ts test/extension/pm-expect.test.ts
git commit -m "feat: pm.expect chainable assertion library"
```

---

## Task 3: sandbox — runPreScript + runTestScript

**Files:**
- Create: `src/extension/sandbox.ts`
- Test: `test/extension/sandbox.test.ts`

**Interfaces:**
- Consumes: `expect` from `./pm-expect`; `RestRequest`, `HttpResponse`, `KeyValue`, `TestResult` from `shared/types`; Node `vm`.
- Produces:
  - `runPreScript(script: string, ctx: { request: RestRequest; vars: KeyValue[] }): { request: RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }`
  - `runTestScript(script: string, ctx: { response: HttpResponse; vars: KeyValue[] }): { tests: TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }`

- [ ] **Step 1: Write the failing test**

`test/extension/sandbox.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runPreScript, runTestScript } from '../../src/extension/sandbox'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sandbox.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/sandbox.ts`:
```ts
import * as vm from 'node:vm'
import { expect } from './pm-expect'
import type { HttpResponse, KeyValue, RestRequest, TestResult } from '../shared/types'

const TIMEOUT = 5000

function varsMap(vars: KeyValue[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const v of vars) if (v.enabled && v.key) m.set(v.key, v.value)
  return m
}

function makeConsole(logs: string[]) {
  return { log: (...args: any[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) }
}

function makeEnv(map: Map<string, string>, envSets: KeyValue[]) {
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: any) => { const val = String(v); map.set(k, val); envSets.push({ key: k, value: val, enabled: true }) },
  }
}

export function runPreScript(script: string, ctx: { request: RestRequest; vars: KeyValue[] }): { request: RestRequest; envSets: KeyValue[]; logs: string[]; error?: string } {
  const request: RestRequest = JSON.parse(JSON.stringify(ctx.request))
  const envSets: KeyValue[] = []
  const logs: string[] = []
  if (!script.trim()) return { request, envSets, logs }
  const map = varsMap(ctx.vars)
  const env = makeEnv(map, envSets)
  const pmRequest = {
    get method() { return request.method }, set method(v: any) { request.method = v },
    get url() { return request.url }, set url(v: any) { request.url = v },
    get body() { return request.body }, set body(v: any) { request.body = v },
    headers: {
      add: (h: { key: string; value: string }) => { request.headers.push({ key: h.key, value: h.value, enabled: true }) },
      get: (k: string) => request.headers.find((h) => h.key === k)?.value,
    },
    params: request.params,
  }
  const sandbox: any = { pm: { request: pmRequest, environment: env, variables: { get: (k: string) => map.get(k) } }, console: makeConsole(logs) }
  try {
    vm.runInNewContext(script, sandbox, { timeout: TIMEOUT })
  } catch (e: any) {
    return { request, envSets, logs, error: String(e?.message ?? e) }
  }
  return { request, envSets, logs }
}

export function runTestScript(script: string, ctx: { response: HttpResponse; vars: KeyValue[] }): { tests: TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string } {
  const tests: TestResult[] = []
  const envSets: KeyValue[] = []
  const logs: string[] = []
  if (!script.trim()) return { tests, envSets, logs }
  const map = varsMap(ctx.vars)
  const r = ctx.response
  const pmResponse = {
    code: r.status, status: r.statusText, responseTime: r.timeMs,
    headers: r.headers,
    text: () => r.body,
    json: () => JSON.parse(r.body),
  }
  const pmTest = (name: string, fn: () => void) => {
    try { fn(); tests.push({ name, passed: true }) }
    catch (e: any) { tests.push({ name, passed: false, error: String(e?.message ?? e) }) }
  }
  const sandbox: any = {
    pm: { response: pmResponse, test: pmTest, expect, environment: makeEnv(map, envSets), variables: { get: (k: string) => map.get(k) } },
    console: makeConsole(logs),
  }
  try {
    vm.runInNewContext(script, sandbox, { timeout: TIMEOUT })
  } catch (e: any) {
    return { tests, envSets, logs, error: String(e?.message ?? e) }
  }
  return { tests, envSets, logs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sandbox.test.ts && npx tsc --noEmit`
Expected: PASS (all 9); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/extension/sandbox.ts test/extension/sandbox.test.ts
git commit -m "feat: vm sandbox for pre-request and test scripts"
```

---

## Task 4: messaging — script orchestration on sendRequest

**Files:**
- Modify: `src/extension/messaging.ts`
- Modify: `src/extension/panel.ts`
- Test: `test/extension/messaging.test.ts` (extend)

**Interfaces:**
- Produces: `RouterDeps` gains OPTIONAL `runPreScript?` and `runTestScript?` (signatures from Task 3). `sendRequest` route: run pre-script (persist env writes to the active env, use the mutated request), interpolate happens inside `deps.send` as today, run test-script (persist env writes), attach `testResults` + `consoleLogs` (pre logs then post logs) to the returned response. History still records the RAW `msg.payload`.

- [ ] **Step 1: Write the failing test (extend)**

Extend the messaging `deps()` helper: add
```ts
    runPreScript: vi.fn((_s: string, c: any) => ({ request: { ...c.request, url: c.request.url + '?pre=1' }, envSets: [{ key: 'x', value: '1', enabled: true }], logs: ['pre log'] })),
    runTestScript: vi.fn(() => ({ tests: [{ name: 't', passed: true }], envSets: [], logs: ['post log'] })),
```
When building the router in the new test, pass `runPreScript: d.runPreScript, runTestScript: d.runTestScript` through. Also ensure the `environments` mock has `saveEnvironment: vi.fn(async (e:any)=>e)` and `list` returns an env so env-persist can run (add if missing).

Add a test:
```ts
describe('createRouter sendRequest with scripts', () => {
  function router(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id },
      runPreScript: d.runPreScript, runTestScript: d.runTestScript })
  }
  it('runs pre-script (mutated request sent), test-script, and attaches testResults + consoleLogs', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [] }])
    const payload = { id: 'r', name: 'x', method: 'GET', url: 'https://api/x', params: [], headers: [], body: { mode: 'none' }, preRequestScript: 'x', testScript: 'y' }
    const out = await router(d)({ type: 'sendRequest', requestId: 'q1', payload }) as any
    // the mutated request (url + ?pre=1) was sent, not the raw one:
    expect(d.send.mock.calls[0][0].url).toBe('https://api/x?pre=1')
    // response carries test results + logs (pre then post):
    expect(out.payload.testResults).toEqual([{ name: 't', passed: true }])
    expect(out.payload.consoleLogs).toEqual(['pre log', 'post log'])
    // pre-script env write persisted:
    expect(d.environments.saveEnvironment).toHaveBeenCalled()
    // history recorded the RAW payload (no ?pre=1):
    expect(d.history.append.mock.calls[0][0].url).toBe('https://api/x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — scripts not run; response has no testResults.

- [ ] **Step 3: Implement — messaging.ts**

Add to `RouterDeps` (OPTIONAL):
```ts
  runPreScript?: (script: string, ctx: { request: import('../shared/types').RestRequest; vars: KeyValue[] }) => { request: import('../shared/types').RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }
  runTestScript?: (script: string, ctx: { response: import('../shared/types').HttpResponse; vars: KeyValue[] }) => { tests: import('../shared/types').TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }
```
Add a helper inside `createRouter` to persist env writes to the active environment:
```ts
  async function persistEnvSets(sets: KeyValue[]): Promise<void> {
    if (!sets.length) return
    const id = deps.getActiveEnvId()
    if (!id) return
    const env = (await deps.environments.list()).find((e) => e.id === id)
    if (!env) return
    const vars = [...env.variables]
    for (const s of sets) {
      const i = vars.findIndex((v) => v.key === s.key)
      if (i >= 0) vars[i] = { ...vars[i], value: s.value, enabled: true }
      else vars.push(s)
    }
    await deps.environments.saveEnvironment({ ...env, variables: vars })
  }
```
Replace the `sendRequest` case with:
```ts
      case 'sendRequest': {
        const raw = msg.payload
        const logs: string[] = []
        let vars = await activeVars()
        let effective = raw
        if (raw.preRequestScript && deps.runPreScript) {
          const pre = deps.runPreScript(raw.preRequestScript, { request: raw, vars })
          logs.push(...pre.logs)
          if (pre.error) logs.push(`[pre-request error] ${pre.error}`)
          if (pre.envSets.length) { await persistEnvSets(pre.envSets); vars = await activeVars() }
          effective = pre.request
        }
        const payload = await deps.send(effective, { vars })
        let testResults: import('../shared/types').TestResult[] = []
        if (raw.testScript && deps.runTestScript) {
          const post = deps.runTestScript(raw.testScript, { response: payload, vars })
          logs.push(...post.logs)
          if (post.error) logs.push(`[test error] ${post.error}`)
          testResults = post.tests
          if (post.envSets.length) await persistEnvSets(post.envSets)
        }
        const withMeta = { ...payload, testResults, consoleLogs: logs }
        await deps.history.append(raw, payload.status)
        return { type: 'response', requestId: msg.requestId, payload: withMeta }
      }
```
(Note: `activeVars()` already exists from Phase 2. `KeyValue` is already imported.)

- [ ] **Step 4: Implement — panel.ts wiring**

In `src/extension/panel.ts` (inside `ensureBootstrap`, where the router is built), import and inject the real sandbox functions:
```ts
import { runPreScript, runTestScript } from './sandbox'
```
Add to the `createRouter({...})` deps:
```ts
    runPreScript,
    runTestScript,
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS (existing + new); tsc clean; host bundle builds.

- [ ] **Step 6: Commit**

```bash
git add src/extension/messaging.ts src/extension/panel.ts test/extension/messaging.test.ts
git commit -m "feat: run pre/test scripts on send, persist env writes, attach results"
```

---

## Task 5: RequestPanel — Pre-request Script + Tests sub-tabs; store blankRequest

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/RequestPanel.test.tsx` (append), `test/webview/store.test.ts` (append)

**Interfaces:**
- `blankRequest()` sets `preRequestScript: ''`, `testScript: ''`.
- RequestPanel's sub-tab row adds `pre-request` and `tests` tabs; each renders a `<textarea>` (aria-labels `pre-request script` / `test script`) bound to the field via `updateActive`.

- [ ] **Step 1: Write the failing tests (append)**

Add to `test/webview/store.test.ts`:
```ts
it('openNewTab seeds empty script fields', () => {
  useStore.getState().openNewTab()
  const t = useStore.getState().tabs[0]
  expect(t.preRequestScript).toBe('')
  expect(t.testScript).toBe('')
})
```

Add to `test/webview/RequestPanel.test.tsx`:
```ts
it('edits the pre-request and test scripts', () => {
  render(<RequestPanel />)
  fireEvent.click(screen.getByRole('button', { name: /pre-request/i }))
  fireEvent.change(screen.getByLabelText(/pre-request script/i), { target: { value: 'pm.environment.set("a","1")' } })
  expect(useStore.getState().tabs[0].preRequestScript).toBe('pm.environment.set("a","1")')
  fireEvent.click(screen.getByRole('button', { name: /^tests$/i }))
  fireEvent.change(screen.getByLabelText(/test script/i), { target: { value: 'pm.test("t", () => {})' } })
  expect(useStore.getState().tabs[0].testScript).toBe('pm.test("t", () => {})')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/store.test.ts test/webview/RequestPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement — store blankRequest**

In `src/webview/state/store.ts`, in `blankRequest()`, add the two fields to the returned object:
```ts
    preRequestScript: '', testScript: '',
```

- [ ] **Step 4: Implement — RequestPanel sub-tabs**

In `src/webview/components/RequestPanel/RequestPanel.tsx`, extend the `SubTab` type and the sub-tab buttons, and render the two script textareas.

Change the sub-tab type:
```ts
type SubTab = 'params' | 'headers' | 'body' | 'pre-request' | 'tests'
```
Add the two tabs to the sub-tab button row (extend the array):
```tsx
        {(['params', 'headers', 'body', 'pre-request', 'tests'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
```
Add the two panels after the existing `body` block:
```tsx
      {sub === 'pre-request' && (
        <textarea className="rm-input" aria-label="pre-request script" rows={8} style={{ width: '100%' }}
          value={active.preRequestScript ?? ''}
          onChange={(e) => update({ preRequestScript: e.target.value })} />
      )}
      {sub === 'tests' && (
        <textarea className="rm-input" aria-label="test script" rows={8} style={{ width: '100%' }}
          value={active.testScript ?? ''}
          onChange={(e) => update({ testScript: e.target.value })} />
      )}
```
(Note: the "Tests" tab button label is `tests`; the RequestPanel test selects it by `name: /^tests$/i`. Ensure no other button matches `/^tests$/i`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/webview/store.test.ts test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx src/webview/state/store.ts test/webview/store.test.ts test/webview/RequestPanel.test.tsx
git commit -m "feat: pre-request and test script editors in RequestPanel"
```

---

## Task 6: ResponsePanel — Test Results + Console sub-tabs

**Files:**
- Modify: `src/webview/components/ResponsePanel/ResponsePanel.tsx`
- Test: `test/webview/ResponsePanel.test.tsx` (append)

**Interfaces:**
- Adds `test-results` and `console` sub-tabs. Test Results renders `resp.testResults` as PASS/FAIL rows (text like `PASS <name>` / `FAIL <name>: <error>`). Console renders `resp.consoleLogs` lines.

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/ResponsePanel.test.tsx`:
```ts
it('renders test results and console logs', () => {
  useStore.getState().setResponse(activeId(), {
    status: 200, statusText: 'OK', headers: [], body: '{}',
    bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
    testResults: [{ name: 'status is 200', passed: true }, { name: 'has id', passed: false, error: 'expected undefined to equal 1' }],
    consoleLogs: ['log line one'],
  })
  render(<ResponsePanel />)
  fireEvent.click(screen.getByRole('button', { name: /test results/i }))
  expect(screen.getByText(/PASS/)).toBeInTheDocument()
  expect(screen.getByText(/status is 200/)).toBeInTheDocument()
  expect(screen.getByText(/FAIL/)).toBeInTheDocument()
  expect(screen.getByText(/expected undefined to equal 1/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /console/i }))
  expect(screen.getByText('log line one')).toBeInTheDocument()
})
```
(The ResponsePanel test file already imports React Testing Library and `useStore`; `activeId()` helper exists in that file from Phase 1. If `fireEvent` is not imported there, add it to the import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/components/ResponsePanel/ResponsePanel.tsx`, extend the `SubTab` type and the sub-tab buttons, and render the two panels.

Change the sub-tab type:
```ts
type SubTab = 'body' | 'headers' | 'cookies' | 'test-results' | 'console'
```
Extend the sub-tab button row:
```tsx
        {(['body', 'headers', 'cookies', 'test-results', 'console'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
```
Add the panels (after the existing cookies block):
```tsx
      {sub === 'test-results' && (
        <table><tbody>
          {(resp.testResults ?? []).map((t, i) => (
            <tr key={i}>
              <td style={{ color: t.passed ? 'var(--vscode-testing-iconPassed, green)' : 'var(--vscode-errorForeground)' }}>
                {t.passed ? 'PASS' : 'FAIL'}
              </td>
              <td>{t.name}{t.error ? `: ${t.error}` : ''}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {sub === 'console' && (
        <pre className="rm-input" style={{ whiteSpace: 'pre-wrap' }}>{(resp.consoleLogs ?? []).join('\n')}</pre>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/ResponsePanel/ResponsePanel.tsx test/webview/ResponsePanel.test.tsx
git commit -m "feat: test results and console sub-tabs in ResponsePanel"
```

---

## Task 7: Manual smoke — scripts end-to-end

**Files:**
- Create: `docs/superpowers/plans/phase4-smoke-checklist.md`

**Interfaces:**
- Consumes: the full built extension. No automated test — F5 gate.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build (editor.js + sidebar.js).

- [ ] **Step 2: Write the smoke checklist**

`docs/superpowers/plans/phase4-smoke-checklist.md`:
```markdown
# Phase 4 Scripts Smoke Checklist

Press F5 → open restman → open a request in the editor.

- [ ] Pre-request Script tab: `pm.environment.set('ts', String(Date.now()))` with an active environment → Send → the env variable `ts` updates in the sidebar Environments editor.
- [ ] Pre-request mutation: `pm.request.headers.add({ key: 'X-Test', value: '1' })` → Send to https://postman-echo.com/get → the echoed headers include X-Test.
- [ ] Pre-request sets a var used in the URL: env `base`, script `pm.environment.set('base','https://postman-echo.com')`, URL `{{base}}/get` → resolves and 200.
- [ ] Tests tab: `pm.test('status is 200', () => pm.expect(pm.response.code).to.equal(200))` → Send → Response → Test Results shows PASS.
- [ ] A failing test: `pm.test('bad', () => pm.expect(pm.response.code).to.equal(500))` → Test Results shows FAIL with the message.
- [ ] `pm.response.json()` in a test reads the body; `console.log('hi', pm.response.code)` → Console tab shows the line.
- [ ] A script `throw new Error('x')` → Console shows the error; the app does not crash.
- [ ] The saved request still shows the raw `{{var}}`/unmutated values after sending.
```

- [ ] **Step 3: Manually run the checklist**

Press F5, follow it, check every box. Fix failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/phase4-smoke-checklist.md
git commit -m "chore: phase 4 scripts smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** script fields + TestResult + response fields (Task 1); pm.expect matchers (2); sandbox runPreScript/runTestScript with vm, request mutation, env writes, console, timeout/throw capture (3); messaging orchestration — pre-script + persist env + mutated request sent + test-script + attach results/logs + raw history (4); RequestPanel Pre-request/Tests editors + blankRequest seed (5); ResponsePanel Test Results + Console (6); manual e2e (7).
- **Type consistency:** optional `preRequestScript`/`testScript` on `RestRequest`, `TestResult`, `HttpResponse.testResults`/`consoleLogs` (Task 1) match the sandbox return types (3), the router deps + attachment (4), and the components (5, 6). `runPreScript`/`runTestScript` signatures identical between sandbox (3), router deps (4), and panel injection (4).
- **Never-crashes:** vm errors/timeouts are captured into `error` strings (3) and surfaced in the Console (4/6); a failing `pm.test` is a FAIL row, not a throw; `pm.response.json()` on non-JSON throws inside the enclosing test (caught as a failure).
- **Raw preserved:** history records `raw` (msg.payload); only the mutated copy is sent; env writes persist to the active environment and broadcast via the Hub snapshot.
- **Deferred:** collection/folder scripts, pm.globals/collectionVariables/dynamic vars/pm.sendRequest, full Chai, module imports — all non-goals.
