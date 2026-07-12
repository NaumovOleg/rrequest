# restman — Phase 4 (Scripts / Hooks + Tests) Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 4 — pre-request scripts, post-request test scripts with a Postman-like `pm` API, and a Test Results view. Continues on branch `phase4-scripts` (stacked on `phase3-io`).

## Overview

Phase 4 adds request scripting: a **pre-request script** that runs before a
request is sent (can read/write environment variables and mutate the outgoing
request) and a **test script** that runs after the response arrives (asserts with
`pm.test` / `pm.expect`, can read the response, write environment variables, and
log). Results appear in a **Test Results** view and a **Console**. This mirrors
Postman's `pm` scripting model.

Phases 1-3 + the layout refactor are complete. Later: Phase 5 (WebSockets),
Phase 6 (backend + auth/sync).

## Goals

- Per-request `preRequestScript` and `testScript` (JavaScript), edited in the
  editor's request panel.
- Scripts run in the extension host in a Node `vm` sandbox with a focused `pm` API.
- Pre-request script can read/write environment variables and mutate the outgoing
  request (method/url/headers/params/body); the mutation applies to the sent
  request only — the saved request keeps its raw text.
- Test script asserts with `pm.test(name, fn)` + `pm.expect(...)`, reads
  `pm.response`, writes environment variables, and `console.log`s.
- Test results (PASS/FAIL) and console output shown in the response area.

## Decisions

- **Sandbox:** Node `vm.runInNewContext` in the extension host, with a curated
  context (no `require`, `process`, `fs`, `global`) and a timeout (5000 ms).
  Scripts are the user's own JavaScript running on their own machine, so `vm`'s
  known non-airtight isolation is acceptable; the timeout + trimmed context guard
  against accidental hangs and casual mistakes, not a determined attacker.
- **`pm` API (focused Postman set):**
  - `pm.environment.get(key)` / `pm.environment.set(key, value)` — active
    environment variables; `set` persists to the active environment.
  - `pm.variables.get(key)` — read (environment variables; alias for read).
  - `pm.request` — a mutable view of the outgoing request in the pre-request
    script: `pm.request.method`, `.url`, `.headers` (with `.add({key,value})` and
    index access), `.body`; the script may reassign these. In the test script
    `pm.request` is read-only.
  - `pm.response` (test script) — `.code`/`.status`, `.responseTime`, `.text()`,
    `.json()`, `.headers` (array of {key,value}).
  - `pm.test(name, fn)` — runs `fn`; a throw (including a failed `pm.expect`)
    marks the test failed with the error message.
  - `pm.expect(actual)` — a small chainable assertion library (see below).
  - `console.log(...)` — captured into the console output.
- **Pre-request request mutation:** the pre-request script mutates a working copy
  of the request; that mutated copy (after `{{var}}` interpolation with the
  possibly-updated env) is what gets sent. The stored request is never changed.
- **Env writes from scripts** persist to the active `EnvironmentStore` and the
  Hub broadcasts fresh `environments` to both surfaces.
- **Execution order on Send:** active env vars → run pre-request script (persist
  env writes, take the mutated request) → interpolate `{{var}}` → send → run test
  script (persist env writes) → return response + testResults + consoleLogs.

## `pm.expect` (assertion library)

A minimal chainable matcher in `src/extension/pm-expect.ts`:
`expect(actual)` returns an object with a `.to` chain supporting:
`equal(v)` / `eql(v)` (deep) / `be.a(type)` / `be.an(type)` / `include(v)` /
`be.ok` / `be.true` / `be.false` / `be.above(n)` / `be.below(n)`. Each failing
matcher throws an `Error` with a descriptive message. Negation via `.to.not.*`.

## Data model

```ts
// shared/types.ts additions
type RestRequest = {
  // …existing fields…
  preRequestScript: string   // NEW (default '')
  testScript: string         // NEW (default '')
}

type TestResult = { name: string; passed: boolean; error?: string }

type HttpResponse = {
  // …existing fields…
  testResults?: TestResult[] // NEW
  consoleLogs?: string[]     // NEW (pre + post script logs, in order)
}
```

New requests (`openNewTab`) default both scripts to `''`. Back-compat: a request
loaded without these fields is treated as empty scripts.

## Architecture

Same two-surface topology. New host pieces:

- **`pm-expect.ts`** (new, pure) — `expect(actual)` chainable matchers; throws on
  failure. Unit-tested in isolation.
- **`sandbox.ts`** (new) — runs scripts in a `vm` context:
  - `runPreScript(script, { request, vars }): { request: RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }`
    — builds a `pm` with a mutable `request` copy + `environment.get/set` (records
    sets into `envSets`) + `variables.get` + `console.log`. Returns the mutated
    request, the recorded env writes, logs, and any thrown error message. An empty
    script is a no-op that returns the request unchanged.
  - `runTestScript(script, { response, vars }): { tests: TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }`
    — builds a `pm` with `response` (from the `HttpResponse`), `test`, `expect`,
    `environment.get/set`, `console.log`. Returns the collected test results, env
    writes, logs, and any top-level thrown error.
  - Both use `vm.runInNewContext(script, sandbox, { timeout: 5000 })`; a timeout or
    thrown error is captured into `error` (never crashes the host).
- **`messaging.ts`** (modified) — the `sendRequest` route orchestrates the flow:
  load active env → `runPreScript` → persist `envSets` to the active environment
  (via EnvironmentStore) → interpolate → `sendRequest` → `runTestScript` → persist
  its `envSets` → attach `testResults` + `consoleLogs` (pre logs + post logs) to
  the returned `HttpResponse`. After env writes, the Hub's post-dispatch snapshot
  broadcast already refreshes `environments` on both surfaces.

### Webview

- **`store.ts`** — `blankRequest()` includes `preRequestScript: ''`,
  `testScript: ''`. No new slice.
- **RequestPanel** — the request sub-tabs gain **Pre-request Script** and **Tests**
  (each a `<textarea>` bound to the field via `updateActive`).
- **ResponsePanel** — the response sub-tabs gain **Test Results** (renders
  `response.testResults` as PASS/FAIL rows) and **Console** (renders
  `response.consoleLogs`).

## Message protocol

No new message arms. `sendRequest`/`response` are unchanged in shape; the
`HttpResponse` payload simply carries the new optional `testResults`/`consoleLogs`
fields, and `RestRequest` carries the two new script fields (already flowing
through the existing `sendRequest.payload`).

## Data flow (send with scripts)

```
1. Editor Send → sendRequest{payload: RestRequest(raw, with scripts)} → host.
2. Host loads active env vars.
3. runPreScript(payload.preRequestScript, {request: payload, vars}):
   - script mutates pm.request and/or pm.environment.set(...)
   - host persists env writes to the active environment (EnvironmentStore)
   - takes the mutated request.
4. interpolate {{var}} (with updated env) over the mutated request.
5. sendRequest(...) → HttpResponse.
6. runTestScript(payload.testScript, {response, vars}):
   - pm.test(...) collects results; pm.environment.set persists.
7. Host returns HttpResponse + testResults + consoleLogs to the editor.
8. Hub broadcast refreshes environments on both surfaces (env writes visible).
```

## Error handling & edge cases

- Empty script → no-op (`runPreScript` returns the request unchanged; `runTestScript`
  returns no tests). No error.
- Pre-request script throws or times out → `error` is set; the request is still
  sent with whatever mutations were applied before the throw (Postman-like), and
  the error is surfaced in the Console. (Alternative — abort send — is NOT chosen;
  sending-anyway matches Postman and keeps the flow simple.)
- Test script throws at the top level (outside a `pm.test`) → captured as an
  `error` shown in the Console; any `pm.test` results collected before the throw
  are kept.
- A `pm.test` whose `fn` throws → that test is `passed: false` with the message;
  other tests still run.
- `pm.response.json()` on a non-JSON body → throws inside the test (caught by the
  enclosing `pm.test` as a failure), never crashes the host.
- Scripts never mutate the saved request or the raw history entry — only the
  outgoing copy.
- `vm` context excludes `require`, `process`, `fs`, `global`, `globalThis`
  access to Node internals; `setTimeout`/`setInterval` are not provided.

## Testing (TDD)

- **`pm-expect`** — each matcher pass + fail (throws), negation, deep `eql`.
- **`sandbox`** — pre: mutates request (url/headers/method/body), `pm.environment.set`
  recorded, `console.log` captured, timeout/throw → error; test: `pm.test` pass +
  fail, `pm.expect` inside a test, `pm.response.json()`, env set, top-level throw
  captured.
- **`messaging`** — sendRequest runs pre-script (env persisted + request mutation
  applied + interpolation after), attaches testResults + consoleLogs, persists
  test-script env writes. (Uses injected sandbox/deps mocks.)
- **components** — RequestPanel Pre-request/Tests textareas bind to the fields;
  ResponsePanel Test Results renders pass/fail and Console renders logs.

## Files

New: `src/extension/pm-expect.ts`, `src/extension/sandbox.ts`, plus tests.
Modified: `src/shared/types.ts`, `src/extension/messaging.ts`,
`src/webview/state/store.ts`,
`src/webview/components/RequestPanel/RequestPanel.tsx`,
`src/webview/components/ResponsePanel/ResponsePanel.tsx`.

## Non-goals (Phase 4)

- Collection-level / folder-level scripts (only per-request).
- `pm.globals` / `pm.collectionVariables` / `pm.iterationData` / dynamic variables
  (`{{$guid}}`), `pm.sendRequest` (async requests from scripts).
- A full Chai API — only the focused `pm.expect` matchers above.
- npm module imports inside scripts.

## Open questions

None blocking. A stricter sandbox (isolated-vm / worker) and richer `pm` surface
are possible later.
