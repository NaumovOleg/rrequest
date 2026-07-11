# restman Phase 2 (Environment Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add environments to restman — named variable sets the user switches between, with `{{var}}` placeholders in a request resolved against the active environment at send time.

**Architecture:** Substitution happens in the extension host at send time across all request fields (url/params/headers/body); the webview always sends and stores the raw request. Environments persist as JSON in globalStorage (mirroring collections); the active environment id lives in `globalState`.

**Tech Stack:** TypeScript, VS Code Extension API, native fetch, React + Zustand, Vitest + @testing-library/react. All established in Phase 1 — no new dependencies.

## Global Constraints

- Substitution runs ONLY in the extension host, at send time. The webview sends the raw `RestRequest`; saved/history copies keep raw `{{var}}` text.
- Unresolved `{{var}}` is left as literal text (never replaced with empty string).
- Only enabled, non-empty-key variables participate in substitution. Substitution is single-pass (a substituted value that itself contains `{{x}}` is NOT re-expanded).
- Active environment id lives in `context.globalState` under key `restman.activeEnvId`; `null`/absent = No Environment.
- All shared types live in `src/shared/types.ts` (single source imported by both sides). `KeyValue` = `{ key: string; value: string; enabled: boolean }` already exists and is reused for variables.
- Storage writes are atomic (temp file + rename via existing `atomic-write.ts`); corrupt JSON on read is skipped, never fatal.
- UI colors from `--vscode-*` / existing `rm-*` classes only. No hard-coded hex on themed surfaces.
- Deleting the active environment clears the active id to `null`.
- TDD: failing test first, watch it fail, minimal implementation, watch it pass, commit. Small frequent commits. Keep ALL existing Phase-1 tests passing.

---

## File Structure

```
New:
  src/extension/interpolate.ts             // pure {{var}} substitution
  src/extension/environment-store.ts       // EnvironmentStore (mirrors CollectionStore)
  src/webview/components/EnvDropdown/EnvDropdown.tsx   // active-env selector (top bar)
  src/webview/components/Environments/Environments.tsx // env list + variable editor (sidebar)
  + colocated tests under test/

Modified:
  src/shared/types.ts                      // Environment type + new message arms
  src/extension/http-client.ts             // opts.vars, interpolate all fields
  src/extension/messaging.ts               // env routes + active-env resolution on send
  src/extension/panel.ts                   // construct EnvironmentStore + globalState accessors
  src/webview/state/store.ts               // environments + activeEnvId slice
  src/webview/App.tsx                       // handle 'environments', post loadEnvironments, mount EnvDropdown
  src/webview/components/Sidebar/Sidebar.tsx // mount Environments section
```

---

## Task 1: Shared types — Environment + message arms

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/env-types.test.ts`

**Interfaces:**
- Consumes: existing `KeyValue`, `WebviewMessage`, `HostMessage`.
- Produces: `Environment` type; new `WebviewMessage` arms (`loadEnvironments`, `createEnvironment`, `saveEnvironment`, `deleteEnvironment`, `setActiveEnv`); new `HostMessage` arm (`environments`).

- [ ] **Step 1: Write the failing test**

`test/shared/env-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newId, type Environment, type WebviewMessage, type HostMessage } from '../../src/shared/types'

describe('environment types', () => {
  it('an Environment type-checks and is usable', () => {
    const env: Environment = {
      id: newId(), name: 'Dev',
      variables: [{ key: 'base', value: 'https://api.dev', enabled: true }],
    }
    expect(env.variables[0].key).toBe('base')
  })

  it('the new message arms type-check', () => {
    const a: WebviewMessage = { type: 'setActiveEnv', id: null }
    const b: WebviewMessage = { type: 'saveEnvironment', environment: { id: '1', name: 'x', variables: [] } }
    const c: HostMessage = { type: 'environments', environments: [], activeId: null }
    expect(a.type).toBe('setActiveEnv')
    expect(b.type).toBe('saveEnvironment')
    expect(c.type).toBe('environments')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/env-types.test.ts`
Expected: FAIL — `Environment` is not exported / the message arms don't type-check.

- [ ] **Step 3: Add the types**

In `src/shared/types.ts`, add after the existing `Collection` type:
```ts
export type Environment = {
  id: string
  name: string
  variables: KeyValue[]
}
```

Add these arms to the `WebviewMessage` union (append inside the union):
```ts
  | { type: 'loadEnvironments' }
  | { type: 'createEnvironment'; name: string }
  | { type: 'saveEnvironment'; environment: Environment }
  | { type: 'deleteEnvironment'; id: string }
  | { type: 'setActiveEnv'; id: string | null }
```

Add this arm to the `HostMessage` union:
```ts
  | { type: 'environments'; environments: Environment[]; activeId: string | null }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/env-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/env-types.test.ts
git commit -m "feat: Environment type and environment message arms"
```

---

## Task 2: interpolate helper

**Files:**
- Create: `src/extension/interpolate.ts`
- Test: `test/extension/interpolate.test.ts`

**Interfaces:**
- Consumes: `KeyValue` from `shared/types`.
- Produces: `interpolate(text: string, vars: KeyValue[]): string`.

- [ ] **Step 1: Write the failing test**

`test/extension/interpolate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { interpolate } from '../../src/extension/interpolate'
import type { KeyValue } from '../../src/shared/types'

const vars: KeyValue[] = [
  { key: 'base', value: 'https://api.dev', enabled: true },
  { key: 'token', value: 'abc123', enabled: true },
  { key: 'off', value: 'nope', enabled: false },
  { key: '', value: 'blank', enabled: true },
]

describe('interpolate', () => {
  it('replaces a single placeholder', () => {
    expect(interpolate('{{base}}/users', vars)).toBe('https://api.dev/users')
  })
  it('replaces multiple placeholders', () => {
    expect(interpolate('{{base}}?t={{token}}', vars)).toBe('https://api.dev?t=abc123')
  })
  it('tolerates surrounding whitespace in the braces', () => {
    expect(interpolate('{{ base }}/x', vars)).toBe('https://api.dev/x')
  })
  it('leaves unknown placeholders literal', () => {
    expect(interpolate('{{missing}}/x', vars)).toBe('{{missing}}/x')
  })
  it('ignores disabled and empty-key variables', () => {
    expect(interpolate('{{off}}-{{}}', vars)).toBe('{{off}}-{{}}')
  })
  it('passes text through unchanged when no vars', () => {
    expect(interpolate('{{base}}/x', [])).toBe('{{base}}/x')
  })
  it('is single-pass — a substituted value containing braces is not re-expanded', () => {
    const v: KeyValue[] = [
      { key: 'a', value: '{{b}}', enabled: true },
      { key: 'b', value: 'B', enabled: true },
    ]
    expect(interpolate('{{a}}', v)).toBe('{{b}}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/interpolate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/interpolate.ts`:
```ts
import type { KeyValue } from '../shared/types'

export function interpolate(text: string, vars: KeyValue[]): string {
  const map = new Map<string, string>()
  for (const v of vars) if (v.enabled && v.key) map.set(v.key, v.value)
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, key: string) => {
    const hit = map.get(key)
    return hit === undefined ? whole : hit
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/interpolate.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/extension/interpolate.ts test/extension/interpolate.test.ts
git commit -m "feat: single-pass {{var}} interpolation helper"
```

---

## Task 3: EnvironmentStore

**Files:**
- Create: `src/extension/environment-store.ts`
- Test: `test/extension/environment-store.test.ts`

**Interfaces:**
- Consumes: `Environment`, `newId` from `shared/types`; `readJsonSafe`, `writeJsonAtomic` from `atomic-write`.
- Produces class `EnvironmentStore`:
  - `constructor(baseDir: string)` — files under `${baseDir}/environments/`.
  - `list(): Promise<Environment[]>` (skips corrupt files)
  - `createEnvironment(name: string): Promise<Environment>`
  - `saveEnvironment(env: Environment): Promise<Environment>` (upsert by id)
  - `deleteEnvironment(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`test/extension/environment-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { EnvironmentStore } from '../../src/extension/environment-store'

let dir: string
let store: EnvironmentStore
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-env-'))
  store = new EnvironmentStore(dir)
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('EnvironmentStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([])
  })
  it('creates and lists an environment', async () => {
    const e = await store.createEnvironment('Dev')
    expect(e.name).toBe('Dev')
    expect(e.variables).toEqual([])
    expect((await store.list()).map((x) => x.name)).toEqual(['Dev'])
  })
  it('upserts variables by environment id', async () => {
    const e = await store.createEnvironment('Dev')
    await store.saveEnvironment({ ...e, variables: [{ key: 'base', value: 'v', enabled: true }] })
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].variables[0].key).toBe('base')
  })
  it('deletes an environment', async () => {
    const e = await store.createEnvironment('Dev')
    await store.deleteEnvironment(e.id)
    expect(await store.list()).toEqual([])
  })
  it('skips a corrupt environment file when listing', async () => {
    await store.createEnvironment('Good')
    await fs.writeFile(path.join(dir, 'environments', 'bad.json'), '{ broken')
    expect((await store.list()).map((x) => x.name)).toEqual(['Good'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/environment-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/environment-store.ts`:
```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Environment } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class EnvironmentStore {
  private readonly dir: string
  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'environments')
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<Environment[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const out: Environment[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const e = await readJsonSafe<Environment>(path.join(this.dir, n))
      if (e && e.id && Array.isArray(e.variables)) out.push(e)
    }
    return out
  }

  async createEnvironment(name: string): Promise<Environment> {
    const e: Environment = { id: newId(), name, variables: [] }
    await writeJsonAtomic(this.file(e.id), e)
    return e
  }

  async saveEnvironment(env: Environment): Promise<Environment> {
    await writeJsonAtomic(this.file(env.id), env)
    return env
  }

  async deleteEnvironment(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/environment-store.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/extension/environment-store.ts test/extension/environment-store.test.ts
git commit -m "feat: environment store (CRUD, upsert, delete, corrupt-skip)"
```

---

## Task 4: http-client variable substitution

**Files:**
- Modify: `src/extension/http-client.ts`
- Test: `test/extension/http-client.test.ts` (append cases)

**Interfaces:**
- Consumes: `interpolate` from `./interpolate`; `KeyValue` from `shared/types`.
- Produces: `sendRequest(req, opts)` where `opts` gains `vars?: KeyValue[]`. When `vars` is non-empty, `{{var}}` in `req.url`, each enabled param key/value, each header key/value, raw body text, and each urlencoded item key/value is resolved before the request is built. The input `req` object is not mutated.

- [ ] **Step 1: Write the failing test (append to the existing file)**

Add to `test/extension/http-client.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/http-client.test.ts`
Expected: FAIL — `{{base}}` not substituted (first new test), because `vars` is not yet handled.

- [ ] **Step 3: Implement**

In `src/extension/http-client.ts`, add the import at the top:
```ts
import { interpolate } from './interpolate'
```

Extend the `Opts` type:
```ts
type Opts = { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; vars?: KeyValue[] }
```

At the very start of `sendRequest`, before building anything, resolve a working copy of the request. Add this right after the `sendRequest` signature line (before `const doFetch = ...`):
```ts
  const vars = opts.vars ?? []
  const sub = (s: string) => (vars.length ? interpolate(s, vars) : s)
  const req: RestRequest = vars.length
    ? {
        ...request,
        url: sub(request.url),
        params: request.params.map((p) => ({ ...p, key: sub(p.key), value: sub(p.value) })),
        headers: request.headers.map((h) => ({ ...h, key: sub(h.key), value: sub(h.value) })),
        body:
          request.body.mode === 'raw'
            ? { ...request.body, text: sub(request.body.text) }
            : request.body.mode === 'urlencoded'
            ? { ...request.body, items: request.body.items.map((i) => ({ ...i, key: sub(i.key), value: sub(i.value) })) }
            : request.body,
      }
    : request
```

IMPORTANT: rename the `sendRequest` parameter from `req` to `request` so the local resolved `req` above is the one used by the rest of the function. Change the signature:
```ts
export async function sendRequest(request: RestRequest, opts: Opts = {}): Promise<HttpResponse> {
```
The rest of the function body already refers to `req` (buildUrl(req), req.headers, req.method, req.body, buildBody(req)) — those now use the resolved local `req`. Do not change them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/http-client.test.ts && npx tsc --noEmit`
Expected: PASS (all prior + 2 new); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/extension/http-client.ts test/extension/http-client.test.ts
git commit -m "feat: http-client resolves {{var}} across all fields at send"
```

---

## Task 5: Router env routes + active-env resolution + panel wiring

**Files:**
- Modify: `src/extension/messaging.ts`
- Modify: `src/extension/panel.ts`
- Test: `test/extension/messaging.test.ts` (append cases)

**Interfaces:**
- Consumes: `EnvironmentStore`; `Environment`, message types.
- Produces: `RouterDeps` gains `environments: EnvironmentStore`, `getActiveEnvId: () => string | null`, `setActiveEnvId: (id: string | null) => void`. New routes:
  - `loadEnvironments` / `createEnvironment` / `saveEnvironment` / `deleteEnvironment` / `setActiveEnv` → return a fresh `{ type:'environments', environments, activeId }`.
  - `deleteEnvironment` of the active id clears the active id to `null`.
  - `sendRequest` resolves the active environment's variables and passes them as `opts.vars` to `send`.

- [ ] **Step 1: Write the failing test (append to the existing file)**

Add to `test/extension/messaging.test.ts`. First extend the `deps()` helper to include the environment pieces (add these keys to the returned object):
```ts
// inside deps(), add:
    environments: {
      list: vi.fn(async () => [] as any[]),
      createEnvironment: vi.fn(async (n: string) => ({ id: 'e1', name: n, variables: [] })),
      saveEnvironment: vi.fn(async (e: any) => e),
      deleteEnvironment: vi.fn(async () => {}),
    } as any,
    activeEnvId: null as string | null,
    getActiveEnvId() { return this.activeEnvId },
    setActiveEnvId(id: string | null) { this.activeEnvId = id },
```
(When you build the router pass `getActiveEnvId`/`setActiveEnvId` bound to that object: `createRouter({ ...d, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id)=>{ d.activeEnvId = id } })`.)

Then add tests:
```ts
describe('createRouter env routes', () => {
  it('setActiveEnv updates active id and returns environments with it', async () => {
    const d = deps()
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id } })
    const out = await route({ type: 'setActiveEnv', id: 'e1' })
    expect(out).toEqual({ type: 'environments', environments: [], activeId: 'e1' })
    expect(d.activeEnvId).toBe('e1')
  })

  it('deleteEnvironment of the active env clears activeId', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id } })
    const out = await route({ type: 'deleteEnvironment', id: 'e1' }) as any
    expect(d.environments.deleteEnvironment).toHaveBeenCalledWith('e1')
    expect(out.activeId).toBeNull()
  })

  it('sendRequest passes the active environment vars to send', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [{ key: 'base', value: 'V', enabled: true }] }])
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id } })
    await route({ type: 'sendRequest', requestId: 'q1', payload: req() })
    expect(d.send).toHaveBeenCalledWith(expect.anything(), { vars: [{ key: 'base', value: 'V', enabled: true }] })
  })
})
```

Note: the existing sendRequest test calls `d.send` with one arg. Updating `send` to be called with `(payload, { vars })` will change that older assertion if it used `toHaveBeenCalledWith` with a single arg — check the existing test at "routes sendRequest to send" and, if it asserts exact args, update it to `toHaveBeenCalledWith(expect.anything(), { vars: [] })`. If it only asserts `toHaveBeenCalledOnce()`, leave it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — env routes return `undefined`; `send` not called with vars.

- [ ] **Step 3: Implement — messaging.ts**

In `src/extension/messaging.ts`, add imports and extend `RouterDeps`:
```ts
import type { EnvironmentStore } from './environment-store'
```
```ts
export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
  environments: EnvironmentStore
  getActiveEnvId: () => string | null
  setActiveEnvId: (id: string | null) => void
}
```

Add a private helper inside `createRouter` (before `return async function route`):
```ts
  async function envSnapshot(): Promise<{ type: 'environments'; environments: import('../shared/types').Environment[]; activeId: string | null }> {
    return { type: 'environments', environments: await deps.environments.list(), activeId: deps.getActiveEnvId() }
  }
  async function activeVars() {
    const id = deps.getActiveEnvId()
    if (!id) return []
    const env = (await deps.environments.list()).find((e) => e.id === id)
    return env ? env.variables : []
  }
```

Change the `sendRequest` case to pass vars:
```ts
      case 'sendRequest': {
        const payload = await deps.send(msg.payload, { vars: await activeVars() })
        await deps.history.append(msg.payload, payload.status)
        return { type: 'response', requestId: msg.requestId, payload }
      }
```

Add the new cases (before `default`):
```ts
      case 'loadEnvironments':
        return await envSnapshot()
      case 'createEnvironment':
        await deps.environments.createEnvironment(msg.name)
        return await envSnapshot()
      case 'saveEnvironment':
        await deps.environments.saveEnvironment(msg.environment)
        return await envSnapshot()
      case 'deleteEnvironment':
        await deps.environments.deleteEnvironment(msg.id)
        if (deps.getActiveEnvId() === msg.id) deps.setActiveEnvId(null)
        return await envSnapshot()
      case 'setActiveEnv':
        deps.setActiveEnvId(msg.id)
        return await envSnapshot()
```

- [ ] **Step 4: Implement — panel.ts wiring**

In `src/extension/panel.ts`, import the store:
```ts
import { EnvironmentStore } from './environment-store'
```
In the constructor, extend the router deps (replace the existing `createRouter({...})` call):
```ts
    const route = createRouter({
      send: sendRequest,
      collections: new CollectionStore(base),
      history: new HistoryStore(base),
      environments: new EnvironmentStore(base),
      getActiveEnvId: () => context.globalState.get<string | null>('restman.activeEnvId', null),
      setActiveEnvId: (id) => { void context.globalState.update('restman.activeEnvId', id) },
    })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS (existing + 3 new); tsc clean; host bundle builds.

- [ ] **Step 6: Commit**

```bash
git add src/extension/messaging.ts src/extension/panel.ts test/extension/messaging.test.ts
git commit -m "feat: env routes + active-env var resolution on send"
```

---

## Task 6: Webview store — environments slice

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append cases)

**Interfaces:**
- Consumes: `Environment` from `shared/types`.
- Produces: state `environments: Environment[]` (init `[]`), `activeEnvId: string | null` (init `null`); actions `setEnvironments(list)`, `setActiveEnvId(id)`; both cleared in `__reset()`.

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/store.test.ts`:
```ts
describe('store environments slice', () => {
  it('setEnvironments and setActiveEnvId update state; __reset clears them', () => {
    const st = useStore.getState()
    st.setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    st.setActiveEnvId('e1')
    expect(useStore.getState().environments).toHaveLength(1)
    expect(useStore.getState().activeEnvId).toBe('e1')
    useStore.getState().__reset()
    expect(useStore.getState().environments).toEqual([])
    expect(useStore.getState().activeEnvId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL — `setEnvironments` is not a function.

- [ ] **Step 3: Implement**

In `src/webview/state/store.ts`, add the import for `Environment` (extend the existing import from `../../shared/types` to include `Environment`).

Add to the `State` type:
```ts
  environments: Environment[]
  activeEnvId: string | null
  setEnvironments(list: Environment[]): void
  setActiveEnvId(id: string | null): void
```

Add to the store initial state and actions (place near the other slices):
```ts
  environments: [],
  activeEnvId: null,
  setEnvironments: (environments) => set({ environments }),
  setActiveEnvId: (activeEnvId) => set({ activeEnvId }),
```

Update `__reset` to also clear them:
```ts
  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {}, history: [], environments: [], activeEnvId: null }),
```
(Keep whatever fields `__reset` already sets — add `environments: [], activeEnvId: null` to the object. If `history` is not present in your current `__reset`, keep it as-is and just add the two env fields.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: webview store environments slice"
```

---

## Task 7: EnvDropdown component

**Files:**
- Create: `src/webview/components/EnvDropdown/EnvDropdown.tsx`
- Test: `test/webview/EnvDropdown.test.tsx`

**Interfaces:**
- Consumes: `useStore` (`environments`, `activeEnvId`), `postToHost`.
- Produces: `<EnvDropdown />` — a `<select aria-label="active environment">` with a "No Environment" option (value `""`) plus one option per environment (`value={e.id}`); its value reflects `activeEnvId` (`null` → `""`); on change posts `{ type:'setActiveEnv', id }` where an empty selection maps to `null`.

- [ ] **Step 1: Write the failing test**

`test/webview/EnvDropdown.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { EnvDropdown } from '../../src/webview/components/EnvDropdown/EnvDropdown'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('EnvDropdown', () => {
  it('lists environments plus No Environment and reflects the active id', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    useStore.getState().setActiveEnvId('e1')
    render(<EnvDropdown />)
    const sel = screen.getByLabelText(/active environment/i) as HTMLSelectElement
    expect(sel.value).toBe('e1')
    expect(screen.getByText('No Environment')).toBeInTheDocument()
    expect(screen.getByText('Dev')).toBeInTheDocument()
  })

  it('posts setActiveEnv with the chosen id', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    render(<EnvDropdown />)
    fireEvent.change(screen.getByLabelText(/active environment/i), { target: { value: 'e1' } })
    expect(posted).toContainEqual({ type: 'setActiveEnv', id: 'e1' })
  })

  it('posts setActiveEnv with null when No Environment is chosen', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    useStore.getState().setActiveEnvId('e1')
    render(<EnvDropdown />)
    fireEvent.change(screen.getByLabelText(/active environment/i), { target: { value: '' } })
    expect(posted).toContainEqual({ type: 'setActiveEnv', id: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/EnvDropdown.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/components/EnvDropdown/EnvDropdown.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function EnvDropdown() {
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)

  return (
    <select
      className="rm-select"
      aria-label="active environment"
      value={activeEnvId ?? ''}
      onChange={(e) => postToHost({ type: 'setActiveEnv', id: e.target.value === '' ? null : e.target.value })}
    >
      <option value="">No Environment</option>
      {environments.map((env) => (
        <option key={env.id} value={env.id}>{env.name}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/EnvDropdown.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/EnvDropdown/EnvDropdown.tsx test/webview/EnvDropdown.test.tsx
git commit -m "feat: active-environment dropdown"
```

---

## Task 8: Environments editor component

**Files:**
- Create: `src/webview/components/Environments/Environments.tsx`
- Test: `test/webview/Environments.test.tsx`

**Interfaces:**
- Consumes: `useStore` (`environments`), `postToHost`, `Environment`/`KeyValue` types.
- Produces: `<Environments />` — an "Environments" section that:
  - shows a "New Environment" button posting `{ type:'createEnvironment', name:'New Environment' }`;
  - lists each environment with a select/click to edit it; renders the selected environment's variables in a key/value/enabled table with a trailing blank row (same pattern as RequestPanel's KeyValueTable);
  - a Save button posting `{ type:'saveEnvironment', environment }` with the edited variables;
  - a Delete button per environment posting `{ type:'deleteEnvironment', id }`.

- [ ] **Step 1: Write the failing test**

`test/webview/Environments.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { Environments } from '../../src/webview/components/Environments/Environments'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('Environments', () => {
  it('New Environment posts createEnvironment', () => {
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /new environment/i }))
    expect(posted).toContainEqual({ type: 'createEnvironment', name: 'New Environment' })
  })

  it('editing a variable and clicking Save posts saveEnvironment with the edited vars', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    render(<Environments />)
    // select the env to edit
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))
    // type a key and value into the trailing blank row
    fireEvent.change(screen.getByPlaceholderText('var key'), { target: { value: 'base' } })
    fireEvent.change(screen.getByPlaceholderText('var value'), { target: { value: 'https://api.dev' } })
    fireEvent.click(screen.getByRole('button', { name: /save environment/i }))
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg).toBeTruthy()
    expect(msg.environment.id).toBe('e1')
    expect(msg.environment.variables[0]).toMatchObject({ key: 'base', value: 'https://api.dev', enabled: true })
  })

  it('Delete posts deleteEnvironment', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /delete Dev/i }))
    expect(posted).toContainEqual({ type: 'deleteEnvironment', id: 'e1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/Environments.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/components/Environments/Environments.tsx`:
```tsx
import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { KeyValue } from '../../../shared/types'

export function Environments() {
  const environments = useStore((s) => s.environments)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [vars, setVars] = useState<KeyValue[]>([])

  const editing = environments.find((e) => e.id === editingId)

  const startEdit = (id: string) => {
    const env = environments.find((e) => e.id === id)
    setEditingId(id)
    setVars(env ? env.variables : [])
  }

  const update = (i: number, patch: Partial<KeyValue>) =>
    setVars((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const rows = [...vars, { key: '', value: '', enabled: true }]

  const save = () => {
    if (!editing) return
    postToHost({ type: 'saveEnvironment', environment: { ...editing, variables: vars } })
  }

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Environments</strong>
        <button className="rm-btn" onClick={() => postToHost({ type: 'createEnvironment', name: 'New Environment' })}>
          + New Environment
        </button>
      </div>
      <ul>
        {environments.map((env) => (
          <li key={env.id} className="rm-row">
            <button className="rm-btn" onClick={() => startEdit(env.id)}>{env.name}</button>
            <button className="rm-btn" aria-label={`delete ${env.name}`}
              onClick={() => postToHost({ type: 'deleteEnvironment', id: env.id })}>×</button>
          </li>
        ))}
      </ul>

      {editing && (
        <div>
          <div>Editing: {editing.name}</div>
          <table>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="rm-row">
                  <td>
                    <input type="checkbox" checked={r.enabled}
                      onChange={(e) => i < vars.length && update(i, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <input className="rm-input" placeholder="var key" value={r.key}
                      onChange={(e) => {
                        if (i < vars.length) update(i, { key: e.target.value })
                        else setVars([...vars, { key: e.target.value, value: '', enabled: true }])
                      }} />
                  </td>
                  <td>
                    <input className="rm-input" placeholder="var value" value={r.value}
                      onChange={(e) => i < vars.length && update(i, { value: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="rm-btn" onClick={save}>Save Environment</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/Environments.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Environments/Environments.tsx test/webview/Environments.test.tsx
git commit -m "feat: environments editor component"
```

---

## Task 9: App wiring — environments message + mount UI

**Files:**
- Modify: `src/webview/App.tsx`
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/App.test.tsx` (append), `test/webview/Sidebar.test.tsx` (append)

**Interfaces:**
- Consumes: `EnvDropdown`, `Environments`, store env actions, `onHostMessage`/`postToHost`.
- Produces: App handles the `environments` HostMessage (→ `setEnvironments` + `setActiveEnvId`), posts `{type:'loadEnvironments'}` on mount, and renders `<EnvDropdown/>` in a top bar above the tabs. Sidebar renders the `<Environments/>` section.

- [ ] **Step 1: Write the failing tests (append)**

Add to `test/webview/App.test.tsx`:
```ts
it('posts loadEnvironments on mount and routes environments into the store', () => {
  render(<App />)
  expect(posted.some((m) => m.type === 'loadEnvironments')).toBe(true)
  act(() => handler?.({ type: 'environments', environments: [{ id: 'e1', name: 'Dev', variables: [] }], activeId: 'e1' }))
  expect(useStore.getState().environments).toHaveLength(1)
  expect(useStore.getState().activeEnvId).toBe('e1')
})
```

Add to `test/webview/Sidebar.test.tsx`:
```ts
it('renders the Environments section', () => {
  render(<Sidebar />)
  expect(screen.getByText('Environments')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/App.test.tsx test/webview/Sidebar.test.tsx`
Expected: FAIL — App doesn't post loadEnvironments / handle environments; Sidebar has no Environments section.

- [ ] **Step 3: Implement — App.tsx**

In `src/webview/App.tsx`, import EnvDropdown and add env handling. Update the imports:
```tsx
import { EnvDropdown } from './components/EnvDropdown/EnvDropdown'
```
Extend the store selectors used in App:
```tsx
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)
```
In the mount effect, extend the message handler and the posts:
```tsx
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'response') { setResponse(m.requestId, m.payload); postToHost({ type: 'loadHistory' }) }
      else if (m.type === 'history') setHistory(m.entries)
      else if (m.type === 'environments') { setEnvironments(m.environments); setActiveEnvId(m.activeId) }
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadHistory' })
    postToHost({ type: 'loadEnvironments' })
    return off
```
(Adapt to match your current effect body — keep the existing tree/response/history handling and cleanup; ADD the `environments` branch, the `loadEnvironments` post, and include `setEnvironments`/`setActiveEnvId` in the effect dependency array.)

Render the top bar with the dropdown — wrap the right-hand column's header. Change the right column so it starts with a top bar:
```tsx
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="rm-row" style={{ justifyContent: 'flex-end', padding: '4px 8px' }}>
          <EnvDropdown />
        </div>
        <Tabs />
        <RequestPanel />
        <ResponsePanel />
      </div>
```

- [ ] **Step 4: Implement — Sidebar.tsx**

In `src/webview/components/Sidebar/Sidebar.tsx`, import and render the Environments section after the existing content. Add the import:
```tsx
import { Environments } from '../Environments/Environments'
```
Render `<Environments />` at the end of the Sidebar's returned markup, after the collections tree and history section (inside the outermost container, as the last child):
```tsx
      <Environments />
```

- [ ] **Step 5: Run tests + full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS; tsc clean; `dist/extension.js` + `media/webview.js` build.

- [ ] **Step 6: Commit**

```bash
git add src/webview/App.tsx src/webview/components/Sidebar/Sidebar.tsx test/webview/App.test.tsx test/webview/Sidebar.test.tsx
git commit -m "feat: wire environments into App and sidebar"
```

---

## Task 10: Manual smoke — environments end-to-end

**Files:**
- Modify: `docs/superpowers/plans/phase2-smoke-checklist.md` (create)

**Interfaces:**
- Consumes: the full built extension. No automated test — this is the F5 verification gate for Phase 2.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2: Write the smoke checklist**

`docs/superpowers/plans/phase2-smoke-checklist.md`:
```markdown
# Phase 2 Smoke Checklist

Press F5 → in the dev host, open restman (activity-bar icon or "restman: Open").

- [ ] Sidebar shows an Environments section; "New Environment" creates one.
- [ ] Editing an environment: add a variable `base = https://postman-echo.com`, Save.
- [ ] The top-bar environment dropdown lists the new environment; select it.
- [ ] In a request, set URL to `{{base}}/get` and Send → resolves to https://postman-echo.com/get, 200.
- [ ] Add a header `Authorization: Bearer {{token}}` with `token=abc` in the env → echoed response shows `Bearer abc`.
- [ ] An unknown `{{missing}}` in the URL is sent literally (echo shows `{{missing}}`).
- [ ] Switch the dropdown to "No Environment" → `{{base}}` is sent literally.
- [ ] Delete the active environment → dropdown falls back to "No Environment".
- [ ] Reopen the panel (hide/show) → the previously active environment is still selected (globalState persistence).
```

- [ ] **Step 3: Manually run the checklist**

Press F5, follow `phase2-smoke-checklist.md`, check every box. Fix failures before proceeding (return to the relevant task).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/phase2-smoke-checklist.md
git commit -m "chore: phase 2 environments smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** Environment model + storage (Tasks 1, 3); interpolate helper (2); host substitution across all fields, raw request preserved (4); router env routes + active-env resolution + globalState wiring + delete-active-clears (5); webview store slice (6); env dropdown (7); environments editor (8); App/Sidebar integration + loadEnvironments on mount (9); manual e2e (10). Unresolved-literal, single-pass, disabled-var-ignored are all covered by interpolate tests (2) and http-client tests (4).
- **Type consistency:** `Environment` (id/name/variables:KeyValue[]) used identically across store, messaging, http-client vars, and components. Message arms (`setActiveEnv` with `id: string|null`, `saveEnvironment` with `environment`, `environments` with `environments`+`activeId`) match between Task 1 definitions and their consumers in Tasks 5–9. `sendRequest(request, { vars })` signature in Task 4 matches the router call in Task 5.
- **Deferred correctly:** secret vars, global/collection vars, dynamic vars, env import/export — all Phase-2 non-goals, absent from tasks.
