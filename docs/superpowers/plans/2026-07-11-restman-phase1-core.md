# restman Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that is a local, Postman-style REST client — send HTTP requests, view responses, organize requests into locally-stored collections, with a React webview UI that follows the VS Code theme.

**Architecture:** Two processes. The extension host (Node/TS) owns HTTP execution, collection/history storage, and the webview lifecycle. The webview (React/TS) renders all UI and talks to the host only through a typed `postMessage` protocol. HTTP runs in the host to avoid CORS and browser limits.

**Tech Stack:** TypeScript, VS Code Extension API, esbuild (host bundle), React + Vite (webview bundle), Zustand (webview state), native `fetch` (undici, Node 18+), Vitest + @testing-library/react (tests).

## Global Constraints

- Node 18+ required (native `fetch` / `AbortController`). Set `"engines": { "vscode": "^1.85.0" }` and `@types/node` ≥ 18.
- All domain and message types live in `src/shared/types.ts` — the single source of truth imported by both host and webview. Never redefine a shared type on one side.
- HTTP executes only in the extension host. The webview never calls `fetch`/`XMLHttpRequest` for user requests.
- `http-client` never throws into the webview: network/timeout errors return an `HttpResponse` with the `error` field set.
- Storage writes are atomic: temp file + rename. Corrupt JSON on read is skipped and logged, never fatal.
- UI colors come from `--vscode-*` CSS variables only. No hard-coded hex colors for themed surfaces.
- Defaults (hard-coded in Phase 1): request timeout 30000 ms; response body string limit 5 MB (5 * 1024 * 1024 bytes); history length 50 entries.
- TDD: write the failing test first, watch it fail, implement minimal code, watch it pass, commit. Small frequent commits.

---

## File Structure

```
restman/
  package.json            // manifest, deps, scripts (build/watch/test)
  tsconfig.json           // base TS config
  tsconfig.host.json      // host build config (CommonJS)
  vitest.config.ts        // test runner config
  esbuild.js              // host bundle -> dist/extension.js
  vite.config.ts          // webview bundle -> media/
  .gitignore
  src/
    shared/
      types.ts            // RestRequest, HttpResponse, Collection, HistoryEntry, messages
    extension/
      extension.ts        // activate/deactivate, restman.open command
      panel.ts            // WebviewPanel lifecycle + message wiring
      messaging.ts        // typed router: WebviewMessage -> service -> HostMessage
      http-client.ts      // sendRequest(): native fetch, timing, error mapping
      collection-store.ts // CRUD collections as globalStorage/collections/<id>.json
      history-store.ts    // append last N to globalStorage/history.json
      atomic-write.ts     // shared temp-file+rename helper
    webview/
      index.tsx           // React entry, mounts App
      App.tsx             // layout: rail + tree + tabs + active tab
      ipc.ts              // typed postMessage wrapper + onMessage
      state/store.ts      // Zustand: tabs, active request, tree, response cache
      state/url-sync.ts   // params <-> URL query pure helpers
      components/Sidebar/Sidebar.tsx
      components/Tabs/Tabs.tsx
      components/RequestPanel/RequestPanel.tsx
      components/ResponsePanel/ResponsePanel.tsx
      theme.css           // maps --vscode-* vars to app surfaces
  media/                  // Vite output (gitignored build artifacts kept out)
  test/                   // *.test.ts colocated by area
```

---

## Task 1: Project scaffold & build pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.host.json`, `esbuild.js`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `src/extension/extension.ts` (minimal), `src/webview/index.tsx` (minimal), `src/webview/App.tsx` (minimal)
- Test: `test/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm run build`, `npm test`, `npm run watch`; an `activate(context)` that registers `restman.open` and opens a blank webview panel.

- [ ] **Step 1: Write the failing test**

`test/scaffold.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'

describe('scaffold', () => {
  it('has a package.json declaring the restman.open command', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const cmds = pkg.contributes?.commands ?? []
    expect(cmds.some((c: any) => c.command === 'restman.open')).toBe(true)
    expect(pkg.engines?.vscode).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scaffold.test.ts`
Expected: FAIL — cannot read `package.json` (does not exist yet).

- [ ] **Step 3: Create the config files**

`.gitignore`:
```
node_modules/
dist/
media/
*.vsix
```

`package.json`:
```json
{
  "name": "restman",
  "displayName": "restman",
  "description": "A Postman-style REST client for VS Code",
  "version": "0.0.1",
  "publisher": "restman",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      { "command": "restman.open", "title": "restman: Open" }
    ]
  },
  "scripts": {
    "build": "node esbuild.js && vite build",
    "watch": "node esbuild.js --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^18.19.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/vscode": "^1.85.0",
    "@testing-library/react": "^14.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "esbuild": "^0.20.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.1.0",
    "vitest": "^1.4.0"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2021", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`tsconfig.host.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2021"]
  },
  "include": ["src/extension", "src/shared"]
}
```

`esbuild.js`:
```js
const esbuild = require('esbuild')
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log('esbuild watching...')
  } else {
    await esbuild.build(options)
    console.log('esbuild done')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'media',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/index.tsx',
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
      },
    },
  },
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
```

- [ ] **Step 4: Create minimal source files**

`src/webview/App.tsx`:
```tsx
export function App() {
  return <div>restman</div>
}
```

`src/webview/index.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
```

`src/extension/extension.ts`:
```ts
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => {
      vscode.window.showInformationMessage('restman: open (panel wired in Task 8)')
    }),
  )
}

export function deactivate() {}
```

- [ ] **Step 5: Install and run the test**

Run: `npm install && npx vitest run test/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify builds work**

Run: `npm run build`
Expected: creates `dist/extension.js` and `media/webview.js` with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold restman extension build pipeline"
```

---

## Task 2: Shared domain & message types

**Files:**
- Create: `src/shared/types.ts`
- Test: `test/shared/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all shared types used by every later task:
  - `RestRequest`, `KeyValue`, `RequestBody`, `HttpMethod`, `HttpResponse`, `Collection`, `HistoryEntry`
  - `WebviewMessage` (webview → host) and `HostMessage` (host → webview) discriminated unions
  - `newId(): string` helper

- [ ] **Step 1: Write the failing test**

`test/shared/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newId, type RestRequest, type WebviewMessage } from '../../src/shared/types'

describe('shared types', () => {
  it('newId returns unique non-empty strings', () => {
    const a = newId(); const b = newId()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('a RestRequest object type-checks and is usable', () => {
    const req: RestRequest = {
      id: newId(), name: 'r', method: 'GET', url: 'https://x',
      params: [], headers: [], body: { mode: 'none' },
    }
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req }
    expect(msg.type).toBe('sendRequest')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/types.test.ts`
Expected: FAIL — cannot resolve `../../src/shared/types`.

- [ ] **Step 3: Implement the types**

`src/shared/types.ts`:
```ts
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type KeyValue = { key: string; value: string; enabled: boolean }

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json' | 'text' | 'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }

export type RestRequest = {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
}

export type HttpError = {
  kind: 'dns' | 'connection' | 'timeout' | 'unknown'
  message: string
}

export type HttpResponse = {
  status: number
  statusText: string
  headers: KeyValue[]
  body: string
  bodyTruncated: boolean
  timeMs: number
  sizeBytes: number
  cookies: KeyValue[]
  error?: HttpError
}

export type Collection = { id: string; name: string; requests: RestRequest[] }

export type HistoryEntry = {
  id: string
  request: RestRequest
  status: number
  at: number
}

// webview -> host
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendRequest'; requestId: string; payload: RestRequest }
  | { type: 'loadTree' }
  | { type: 'saveRequest'; collectionId: string; request: RestRequest }
  | { type: 'createCollection'; name: string }
  | { type: 'loadHistory' }

// host -> webview
export type HostMessage =
  | { type: 'response'; requestId: string; payload: HttpResponse }
  | { type: 'tree'; collections: Collection[] }
  | { type: 'history'; entries: HistoryEntry[] }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/types.test.ts
git commit -m "feat: shared domain and message types"
```

---

## Task 3: Atomic write helper

**Files:**
- Create: `src/extension/atomic-write.ts`
- Test: `test/extension/atomic-write.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `writeJsonAtomic(filePath: string, data: unknown): Promise<void>` and `readJsonSafe<T>(filePath: string): Promise<T | undefined>` (returns `undefined` on missing or corrupt file).

- [ ] **Step 1: Write the failing test**

`test/extension/atomic-write.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeJsonAtomic, readJsonSafe } from '../../src/extension/atomic-write'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('atomic-write', () => {
  it('writes then reads back JSON', async () => {
    const f = path.join(dir, 'a.json')
    await writeJsonAtomic(f, { x: 1 })
    expect(await readJsonSafe<{ x: number }>(f)).toEqual({ x: 1 })
  })

  it('leaves no temp files behind', async () => {
    const f = path.join(dir, 'a.json')
    await writeJsonAtomic(f, { x: 1 })
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(['a.json'])
  })

  it('returns undefined for a missing file', async () => {
    expect(await readJsonSafe(path.join(dir, 'nope.json'))).toBeUndefined()
  })

  it('returns undefined for corrupt JSON', async () => {
    const f = path.join(dir, 'bad.json')
    await fs.writeFile(f, '{ not json')
    expect(await readJsonSafe(f)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/atomic-write.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/atomic-write.ts`:
```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, filePath)
}

export async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/atomic-write.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/extension/atomic-write.ts test/extension/atomic-write.test.ts
git commit -m "feat: atomic JSON write and safe read helpers"
```

---

## Task 4: HTTP client

**Files:**
- Create: `src/extension/http-client.ts`
- Test: `test/extension/http-client.test.ts`

**Interfaces:**
- Consumes: `RestRequest`, `HttpResponse`, `KeyValue` from `shared/types`.
- Produces: `sendRequest(req: RestRequest, opts?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }): Promise<HttpResponse>`.
  - `opts.fetchImpl` defaults to global `fetch` and exists so tests inject a mock.
  - Builds the final URL by appending enabled `params` to `req.url`.
  - Serializes body per `mode`; sets `Content-Type` for `raw`/`urlencoded` if not already present in headers.
  - Non-2xx is returned normally. Network/timeout/DNS map to `error` field with an empty `body`.

- [ ] **Step 1: Write the failing test**

`test/extension/http-client.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/http-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/http-client.ts`:
```ts
import type { HttpError, HttpResponse, KeyValue, RestRequest } from '../shared/types'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

type Opts = { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }

function buildUrl(req: RestRequest): string {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return req.url
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return req.url.includes('?') ? `${req.url}&${qs}` : `${req.url}?${qs}`
}

function buildBody(req: RestRequest): { body?: string; contentType?: string } {
  switch (req.body.mode) {
    case 'none':
      return {}
    case 'raw': {
      const ct = req.body.type === 'json' ? 'application/json'
        : req.body.type === 'xml' ? 'application/xml' : 'text/plain'
      return { body: req.body.text, contentType: ct }
    }
    case 'urlencoded': {
      const s = req.body.items
        .filter((i) => i.enabled && i.key)
        .map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value)}`)
        .join('&')
      return { body: s, contentType: 'application/x-www-form-urlencoded' }
    }
  }
}

function headersToKeyValues(h: Headers): KeyValue[] {
  const out: KeyValue[] = []
  h.forEach((value, key) => out.push({ key, value, enabled: true }))
  return out
}

function extractCookies(h: Headers): KeyValue[] {
  const raw = h.get('set-cookie')
  if (!raw) return []
  return raw.split(/,(?=[^;]+=)/).map((c) => {
    const [pair] = c.split(';')
    const idx = pair.indexOf('=')
    return { key: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), enabled: true }
  })
}

export async function sendRequest(req: RestRequest, opts: Opts = {}): Promise<HttpResponse> {
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  const headers = new Headers()
  for (const h of req.headers) if (h.enabled && h.key) headers.set(h.key, h.value)
  const { body, contentType } = buildBody(req)
  if (contentType && !headers.has('content-type')) headers.set('content-type', contentType)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const resp = await doFetch(buildUrl(req), {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    })
    const full = await resp.text()
    const sizeBytes = Buffer.byteLength(full, 'utf8')
    const truncated = sizeBytes > maxBytes
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: headersToKeyValues(resp.headers),
      body: truncated ? full.slice(0, maxBytes) : full,
      bodyTruncated: truncated,
      timeMs: Date.now() - started,
      sizeBytes,
      cookies: extractCookies(resp.headers),
    }
  } catch (e: any) {
    const kind: HttpError['kind'] =
      e?.name === 'AbortError' ? 'timeout'
      : e instanceof TypeError ? 'connection'
      : 'unknown'
    return {
      status: 0, statusText: '', headers: [], body: '',
      bodyTruncated: false, timeMs: Date.now() - started, sizeBytes: 0,
      cookies: [], error: { kind, message: String(e?.message ?? e) },
    }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/http-client.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/extension/http-client.ts test/extension/http-client.test.ts
git commit -m "feat: http client with timing, error mapping, body limit"
```

---

## Task 5: Collection store

**Files:**
- Create: `src/extension/collection-store.ts`
- Test: `test/extension/collection-store.test.ts`

**Interfaces:**
- Consumes: `Collection`, `RestRequest`, `newId` from `shared/types`; `writeJsonAtomic`, `readJsonSafe` from `atomic-write`.
- Produces class `CollectionStore` constructed with a base directory:
  - `constructor(baseDir: string)` — collections live in `${baseDir}/collections/`.
  - `list(): Promise<Collection[]>` — reads every `*.json`, skips corrupt ones.
  - `createCollection(name: string): Promise<Collection>`
  - `saveRequest(collectionId: string, request: RestRequest): Promise<Collection>` — upserts the request into the collection by `request.id`.

- [ ] **Step 1: Write the failing test**

`test/extension/collection-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { CollectionStore } from '../../src/extension/collection-store'
import { newId, type RestRequest } from '../../src/shared/types'

let dir: string
let store: CollectionStore
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-cs-'))
  store = new CollectionStore(dir)
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function req(name: string): RestRequest {
  return { id: newId(), name, method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}

describe('CollectionStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([])
  })

  it('creates a collection and lists it', async () => {
    const c = await store.createCollection('My Coll')
    expect(c.name).toBe('My Coll')
    const all = await store.list()
    expect(all.map((x) => x.name)).toEqual(['My Coll'])
  })

  it('saves a request into a collection and upserts by id', async () => {
    const c = await store.createCollection('C')
    const r = req('First')
    await store.saveRequest(c.id, r)
    const updated = { ...r, name: 'Renamed' }
    await store.saveRequest(c.id, updated)
    const all = await store.list()
    expect(all[0].requests).toHaveLength(1)
    expect(all[0].requests[0].name).toBe('Renamed')
  })

  it('skips a corrupt collection file when listing', async () => {
    await store.createCollection('Good')
    await fs.writeFile(path.join(dir, 'collections', 'bad.json'), '{ broken')
    const all = await store.list()
    expect(all.map((x) => x.name)).toEqual(['Good'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/collection-store.ts`:
```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Collection, type RestRequest } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class CollectionStore {
  private readonly dir: string
  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'collections')
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<Collection[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const out: Collection[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const c = await readJsonSafe<Collection>(path.join(this.dir, n))
      if (c && c.id && Array.isArray(c.requests)) out.push(c)
    }
    return out
  }

  async createCollection(name: string): Promise<Collection> {
    const c: Collection = { id: newId(), name, requests: [] }
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }

  async saveRequest(collectionId: string, request: RestRequest): Promise<Collection> {
    const c = (await readJsonSafe<Collection>(this.file(collectionId)))
      ?? { id: collectionId, name: 'Collection', requests: [] }
    const i = c.requests.findIndex((r) => r.id === request.id)
    if (i >= 0) c.requests[i] = request
    else c.requests.push(request)
    await writeJsonAtomic(this.file(collectionId), c)
    return c
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/extension/collection-store.ts test/extension/collection-store.test.ts
git commit -m "feat: collection store with corrupt-file skip and upsert"
```

---

## Task 6: History store

**Files:**
- Create: `src/extension/history-store.ts`
- Test: `test/extension/history-store.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `RestRequest`, `newId` from `shared/types`; `writeJsonAtomic`, `readJsonSafe` from `atomic-write`.
- Produces class `HistoryStore`:
  - `constructor(baseDir: string, max = 50)` — data in `${baseDir}/history.json`.
  - `append(request: RestRequest, status: number): Promise<void>` — newest first, capped at `max`.
  - `list(): Promise<HistoryEntry[]>`.

- [ ] **Step 1: Write the failing test**

`test/extension/history-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { HistoryStore } from '../../src/extension/history-store'
import { newId, type RestRequest } from '../../src/shared/types'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-hs-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function req(): RestRequest {
  return { id: newId(), name: 'r', method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}

describe('HistoryStore', () => {
  it('appends newest-first', async () => {
    const h = new HistoryStore(dir)
    await h.append({ ...req(), name: 'old' }, 200)
    await h.append({ ...req(), name: 'new' }, 404)
    const list = await h.list()
    expect(list.map((e) => e.request.name)).toEqual(['new', 'old'])
    expect(list[0].status).toBe(404)
  })

  it('caps at max entries', async () => {
    const h = new HistoryStore(dir, 2)
    await h.append(req(), 200)
    await h.append(req(), 200)
    await h.append(req(), 200)
    expect(await h.list()).toHaveLength(2)
  })

  it('returns empty list when no history file', async () => {
    const h = new HistoryStore(dir)
    expect(await h.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/history-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/history-store.ts`:
```ts
import * as path from 'node:path'
import { newId, type HistoryEntry, type RestRequest } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class HistoryStore {
  private readonly file: string
  private readonly max: number
  constructor(baseDir: string, max = 50) {
    this.file = path.join(baseDir, 'history.json')
    this.max = max
  }

  async list(): Promise<HistoryEntry[]> {
    return (await readJsonSafe<HistoryEntry[]>(this.file)) ?? []
  }

  async append(request: RestRequest, status: number): Promise<void> {
    const entry: HistoryEntry = { id: newId(), request, status, at: Date.now() }
    const next = [entry, ...(await this.list())].slice(0, this.max)
    await writeJsonAtomic(this.file, next)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/history-store.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/extension/history-store.ts test/extension/history-store.test.ts
git commit -m "feat: history store, newest-first, capped"
```

---

## Task 7: Message router

**Files:**
- Create: `src/extension/messaging.ts`
- Test: `test/extension/messaging.test.ts`

**Interfaces:**
- Consumes: `WebviewMessage`, `HostMessage` from `shared/types`; `sendRequest` from `http-client`; `CollectionStore`; `HistoryStore`.
- Produces `createRouter(deps): (msg: WebviewMessage) => Promise<HostMessage | undefined>` where
  `deps = { send: typeof sendRequest; collections: CollectionStore; history: HistoryStore }`.
  Unknown message types resolve to `undefined` (caller ignores). `sendRequest` responses also append to history as a side effect.

- [ ] **Step 1: Write the failing test**

`test/extension/messaging.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createRouter } from '../../src/extension/messaging'
import { newId, type HttpResponse, type RestRequest, type WebviewMessage } from '../../src/shared/types'

function req(): RestRequest {
  return { id: newId(), name: 'r', method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}
const fakeResp: HttpResponse = {
  status: 200, statusText: 'OK', headers: [], body: 'ok',
  bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
}

function deps() {
  return {
    send: vi.fn(async () => fakeResp),
    collections: { list: vi.fn(async () => []), createCollection: vi.fn(async (n: string) => ({ id: 'c1', name: n, requests: [] })), saveRequest: vi.fn(async () => ({ id: 'c1', name: 'c', requests: [] })) } as any,
    history: { append: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
  }
}

describe('createRouter', () => {
  it('routes sendRequest to send and returns a response message', async () => {
    const d = deps()
    const route = createRouter(d)
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req() }
    const out = await route(msg)
    expect(out).toEqual({ type: 'response', requestId: 'q1', payload: fakeResp })
    expect(d.send).toHaveBeenCalledOnce()
    expect(d.history.append).toHaveBeenCalledOnce()
  })

  it('routes loadTree to a tree message', async () => {
    const d = deps()
    const out = await createRouter(d)({ type: 'loadTree' })
    expect(out).toEqual({ type: 'tree', collections: [] })
  })

  it('returns undefined for an unknown message type', async () => {
    const out = await createRouter(deps())({ type: 'bogus' } as any)
    expect(out).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/messaging.ts`:
```ts
import type { HostMessage, WebviewMessage } from '../shared/types'
import type { sendRequest as SendFn } from './http-client'
import type { CollectionStore } from './collection-store'
import type { HistoryStore } from './history-store'

export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
}

export function createRouter(deps: RouterDeps) {
  return async function route(msg: WebviewMessage): Promise<HostMessage | undefined> {
    switch (msg.type) {
      case 'sendRequest': {
        const payload = await deps.send(msg.payload)
        await deps.history.append(msg.payload, payload.status)
        return { type: 'response', requestId: msg.requestId, payload }
      }
      case 'loadTree':
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createCollection':
        await deps.collections.createCollection(msg.name)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'saveRequest':
        await deps.collections.saveRequest(msg.collectionId, msg.request)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'loadHistory':
        return { type: 'history', entries: await deps.history.list() }
      case 'ready':
        return { type: 'tree', collections: await deps.collections.list() }
      default:
        return undefined
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/extension/messaging.ts test/extension/messaging.test.ts
git commit -m "feat: typed message router wiring services"
```

---

## Task 8: Webview panel & host wiring

**Files:**
- Modify: `src/extension/extension.ts`
- Create: `src/extension/panel.ts`
- Test: `test/extension/panel.test.ts`

**Interfaces:**
- Consumes: `createRouter` + deps; VS Code API.
- Produces:
  - `buildHtml(scriptUri: string, cspSource: string, nonce: string): string` — pure function returning the webview HTML (testable without VS Code).
  - `RestmanPanel.createOrShow(context)` — creates/reveals the singleton panel, wires `onDidReceiveMessage` through the router, posts results back.
- `extension.ts` `restman.open` now calls `RestmanPanel.createOrShow(context)`.

- [ ] **Step 1: Write the failing test**

`test/extension/panel.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildHtml } from '../../src/extension/panel'

describe('buildHtml', () => {
  it('embeds the script uri and a strict CSP with the nonce', () => {
    const html = buildHtml('https://cdn/webview.js', 'vscode-webview://x', 'ABC123')
    expect(html).toContain('https://cdn/webview.js')
    expect(html).toContain('nonce="ABC123"')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('<div id="root">')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/panel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement panel.ts**

`src/extension/panel.ts`:
```ts
import * as vscode from 'vscode'
import { createRouter } from './messaging'
import { sendRequest } from './http-client'
import { CollectionStore } from './collection-store'
import { HistoryStore } from './history-store'
import type { WebviewMessage } from '../shared/types'

export function buildHtml(scriptUri: string, cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
}

function nonce(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export class RestmanPanel {
  private static current: RestmanPanel | undefined

  static createOrShow(context: vscode.ExtensionContext) {
    if (RestmanPanel.current) {
      RestmanPanel.current.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      'restman', 'restman', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] },
    )
    RestmanPanel.current = new RestmanPanel(panel, context)
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    const base = context.globalStorageUri.fsPath
    const route = createRouter({
      send: sendRequest,
      collections: new CollectionStore(base),
      history: new HistoryStore(base),
    })

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'),
    ).toString()
    panel.webview.html = buildHtml(scriptUri, panel.webview.cspSource, nonce())

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      const out = await route(msg)
      if (out) panel.webview.postMessage(out)
    })

    panel.onDidDispose(() => { RestmanPanel.current = undefined })
  }
}
```

- [ ] **Step 4: Wire extension.ts**

`src/extension/extension.ts`:
```ts
import * as vscode from 'vscode'
import { RestmanPanel } from './panel'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => {
      RestmanPanel.createOrShow(context)
    }),
  )
}

export function deactivate() {}
```

- [ ] **Step 5: Run test + host build**

Run: `npx vitest run test/extension/panel.test.ts && node esbuild.js`
Expected: test PASS; `dist/extension.js` builds (note: `vscode` is external, so `buildHtml` is unit-tested but the class is only exercised at runtime).

- [ ] **Step 6: Commit**

```bash
git add src/extension/panel.ts src/extension/extension.ts test/extension/panel.test.ts
git commit -m "feat: webview panel with CSP html and router wiring"
```

---

## Task 9: Webview IPC & params/URL sync helpers

**Files:**
- Create: `src/webview/ipc.ts`
- Create: `src/webview/state/url-sync.ts`
- Test: `test/webview/url-sync.test.ts`

**Interfaces:**
- Consumes: `WebviewMessage`, `HostMessage`, `KeyValue`, `RestRequest` from `shared/types`.
- Produces:
  - `ipc.ts`: `postToHost(msg: WebviewMessage): void`; `onHostMessage(cb: (m: HostMessage) => void): () => void` (returns unsubscribe). Uses `acquireVsCodeApi()` when present, falls back to `window.postMessage` for tests.
  - `url-sync.ts`: `buildUrlFromParams(baseUrl: string, params: KeyValue[]): string`; `parseParamsFromUrl(url: string): { base: string; params: KeyValue[] }`.

- [ ] **Step 1: Write the failing test**

`test/webview/url-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildUrlFromParams, parseParamsFromUrl } from '../../src/webview/state/url-sync'

describe('url-sync', () => {
  it('builds a query string from enabled params only', () => {
    expect(buildUrlFromParams('https://x/y', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: false },
      { key: 'c', value: '3', enabled: true },
    ])).toBe('https://x/y?a=1&c=3')
  })

  it('returns the base url unchanged when no enabled params', () => {
    expect(buildUrlFromParams('https://x/y', [])).toBe('https://x/y')
  })

  it('parses params out of a url with a query string', () => {
    const { base, params } = parseParamsFromUrl('https://x/y?a=1&b=2')
    expect(base).toBe('https://x/y')
    expect(params).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ])
  })

  it('round-trips base url with no query', () => {
    const { base, params } = parseParamsFromUrl('https://x/y')
    expect(base).toBe('https://x/y')
    expect(params).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/url-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/state/url-sync.ts`:
```ts
import type { KeyValue } from '../../shared/types'

export function buildUrlFromParams(baseUrl: string, params: KeyValue[]): string {
  const enabled = params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return baseUrl
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return baseUrl.includes('?') ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`
}

export function parseParamsFromUrl(url: string): { base: string; params: KeyValue[] } {
  const i = url.indexOf('?')
  if (i < 0) return { base: url, params: [] }
  const base = url.slice(0, i)
  const params: KeyValue[] = []
  for (const pair of url.slice(i + 1).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))
    const value = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1))
    params.push({ key, value, enabled: true })
  }
  return { base, params }
}
```

`src/webview/ipc.ts`:
```ts
import type { HostMessage, WebviewMessage } from '../shared/types'

type VsCodeApi = { postMessage(msg: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

let api: VsCodeApi | undefined
try { api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined } catch { api = undefined }

export function postToHost(msg: WebviewMessage): void {
  if (api) api.postMessage(msg)
  else window.postMessage(msg, '*')
}

export function onHostMessage(cb: (m: HostMessage) => void): () => void {
  const handler = (e: MessageEvent) => cb(e.data as HostMessage)
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/url-sync.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/webview/ipc.ts src/webview/state/url-sync.ts test/webview/url-sync.test.ts
git commit -m "feat: webview ipc wrapper and params/url sync helpers"
```

---

## Task 10: Webview state store

**Files:**
- Create: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts`

**Interfaces:**
- Consumes: `RestRequest`, `HttpResponse`, `Collection`, `newId` from `shared/types`.
- Produces a Zustand store `useStore` with state and actions:
  - state: `tabs: RestRequest[]`, `activeTabId: string | undefined`, `tree: Collection[]`, `responses: Record<string, HttpResponse | undefined>` (keyed by tab/request id).
  - actions: `openNewTab()`, `closeTab(id)`, `setActive(id)`, `updateActive(patch: Partial<RestRequest>)`, `setTree(c)`, `setResponse(id, resp)`.

- [ ] **Step 1: Write the failing test**

`test/webview/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => useStore.getState().__reset())

describe('webview store', () => {
  it('opens a new tab and makes it active', () => {
    useStore.getState().openNewTab()
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  it('updateActive patches only the active request', () => {
    const st = useStore.getState()
    st.openNewTab()
    st.updateActive({ url: 'https://z', method: 'POST' })
    const active = useStore.getState().tabs[0]
    expect(active.url).toBe('https://z')
    expect(active.method).toBe('POST')
  })

  it('closeTab removes it and picks a new active', () => {
    const st = useStore.getState()
    st.openNewTab(); st.openNewTab()
    const first = useStore.getState().tabs[0].id
    st.closeTab(first)
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  it('stores a response keyed by request id', () => {
    const st = useStore.getState()
    st.openNewTab()
    const id = useStore.getState().tabs[0].id
    st.setResponse(id, {
      status: 200, statusText: 'OK', headers: [], body: 'ok',
      bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
    })
    expect(useStore.getState().responses[id]?.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/state/store.ts`:
```ts
import { create } from 'zustand'
import { newId, type Collection, type HttpResponse, type RestRequest } from '../../shared/types'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'Untitled', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }
}

type State = {
  tabs: RestRequest[]
  activeTabId: string | undefined
  tree: Collection[]
  responses: Record<string, HttpResponse | undefined>
  openNewTab(): void
  closeTab(id: string): void
  setActive(id: string): void
  updateActive(patch: Partial<RestRequest>): void
  setTree(c: Collection[]): void
  setResponse(id: string, resp: HttpResponse): void
  __reset(): void
}

export const useStore = create<State>((set) => ({
  tabs: [],
  activeTabId: undefined,
  tree: [],
  responses: {},

  openNewTab: () => set((s) => {
    const r = blankRequest()
    return { tabs: [...s.tabs, r], activeTabId: r.id }
  }),

  closeTab: (id) => set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    const activeTabId = s.activeTabId === id ? tabs[tabs.length - 1]?.id : s.activeTabId
    return { tabs, activeTabId }
  }),

  setActive: (id) => set({ activeTabId: id }),

  updateActive: (patch) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...patch } : t)),
  })),

  setTree: (tree) => set({ tree }),

  setResponse: (id, resp) => set((s) => ({ responses: { ...s.responses, [id]: resp } })),

  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {} }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: webview zustand store for tabs and responses"
```

---

## Task 11: Theme CSS

**Files:**
- Create: `src/webview/theme.css`
- Test: `test/webview/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces a stylesheet mapping `--vscode-*` variables onto app surfaces (background, foreground, borders, buttons). No hard-coded hex for themed surfaces.

- [ ] **Step 1: Write the failing test**

`test/webview/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'

describe('theme.css', () => {
  it('uses vscode css variables and no hard-coded hex on body', () => {
    const css = fs.readFileSync('src/webview/theme.css', 'utf8')
    expect(css).toContain('var(--vscode-editor-background)')
    expect(css).toContain('var(--vscode-foreground)')
    expect(css).toContain('var(--vscode-button-background)')
    expect(/body\s*{[^}]*#[0-9a-fA-F]{3,6}/.test(css)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/theme.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement**

`src/webview/theme.css`:
```css
:root {
  --app-bg: var(--vscode-editor-background);
  --app-fg: var(--vscode-foreground);
  --app-border: var(--vscode-panel-border, rgba(128,128,128,0.35));
  --app-accent: var(--vscode-button-background);
  --app-accent-fg: var(--vscode-button-foreground);
  --app-input-bg: var(--vscode-input-background);
  --app-input-fg: var(--vscode-input-foreground);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--app-bg);
  color: var(--app-fg);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.rm-btn {
  background: var(--app-accent);
  color: var(--app-accent-fg);
  border: none;
  padding: 4px 12px;
  cursor: pointer;
}
.rm-btn:disabled { opacity: 0.5; cursor: default; }

.rm-input, .rm-select {
  background: var(--app-input-bg);
  color: var(--app-input-fg);
  border: 1px solid var(--app-border);
  padding: 4px 6px;
}

.rm-panel { border: 1px solid var(--app-border); }
.rm-row { display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/theme.css test/webview/theme.test.ts
git commit -m "feat: theme css mapped to vscode variables"
```

---

## Task 12: RequestPanel component

**Files:**
- Create: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `buildUrlFromParams`, `postToHost`, `newId`, shared types.
- Produces `<RequestPanel />` rendering the active tab: method `<select>`, URL `<input>`, Send button (disabled when URL empty), and sub-tabs Params / Headers / Body. Send posts `{ type:'sendRequest', requestId, payload }` with the final URL (base + enabled params folded in) via `postToHost`.

- [ ] **Step 1: Write the failing test**

`test/webview/RequestPanel.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { RequestPanel } from '../../src/webview/components/RequestPanel/RequestPanel'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; useStore.getState().openNewTab() })

describe('RequestPanel', () => {
  it('disables Send when URL is empty', () => {
    render(<RequestPanel />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('enables Send and posts a sendRequest with folded params', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByPlaceholderText(/url/i), { target: { value: 'https://api.test/x' } })
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('sendRequest')
    expect(posted[0].payload.url).toBe('https://api.test/x')
  })

  it('changing method updates the active request', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByLabelText(/method/i), { target: { value: 'POST' } })
    expect(useStore.getState().tabs[0].method).toBe('POST')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/components/RequestPanel/RequestPanel.tsx`:
```tsx
import { useState } from 'react'
import { useStore } from '../../state/store'
import { buildUrlFromParams } from '../../state/url-sync'
import { postToHost } from '../../ipc'
import type { HttpMethod, KeyValue } from '../../../shared/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type SubTab = 'params' | 'headers' | 'body'

function KeyValueTable({ rows, onChange }: {
  rows: KeyValue[]; onChange: (rows: KeyValue[]) => void
}) {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const withBlank = [...rows, { key: '', value: '', enabled: true }]
  return (
    <table>
      <tbody>
        {withBlank.map((r, i) => (
          <tr key={i} className="rm-row">
            <td><input type="checkbox" checked={r.enabled}
              onChange={(e) => i < rows.length && update(i, { enabled: e.target.checked })} /></td>
            <td><input className="rm-input" placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < rows.length) update(i, { key: e.target.value })
                else onChange([...rows, { key: e.target.value, value: '', enabled: true }])
              }} /></td>
            <td><input className="rm-input" placeholder="value" value={r.value}
              onChange={(e) => i < rows.length && update(i, { value: e.target.value })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RequestPanel() {
  const [sub, setSub] = useState<SubTab>('params')
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const update = useStore((s) => s.updateActive)
  if (!active) return <div className="rm-panel">No request open</div>

  const send = () => {
    const url = buildUrlFromParams(active.url, active.params)
    postToHost({ type: 'sendRequest', requestId: active.id, payload: { ...active, url } })
  }

  return (
    <div className="rm-panel">
      <div className="rm-row">
        <label>
          <span style={{ display: 'none' }}>method</span>
          <select className="rm-select" aria-label="method" value={active.method}
            onChange={(e) => update({ method: e.target.value as HttpMethod })}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <input className="rm-input" placeholder="URL" style={{ flex: 1 }} value={active.url}
          onChange={(e) => update({ url: e.target.value })} />
        <button className="rm-btn" disabled={!active.url} onClick={send}>Send</button>
      </div>

      <div className="rm-row">
        {(['params', 'headers', 'body'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
      </div>

      {sub === 'params' && (
        <KeyValueTable rows={active.params} onChange={(params) => update({ params })} />
      )}
      {sub === 'headers' && (
        <KeyValueTable rows={active.headers} onChange={(headers) => update({ headers })} />
      )}
      {sub === 'body' && (
        <textarea className="rm-input" aria-label="body" rows={8} style={{ width: '100%' }}
          value={active.body.mode === 'raw' ? active.body.text : ''}
          onChange={(e) => update({ body: { mode: 'raw', type: 'json', text: e.target.value } })} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat: RequestPanel with method/url/send and param tables"
```

---

## Task 13: ResponsePanel component

**Files:**
- Create: `src/webview/components/ResponsePanel/ResponsePanel.tsx`
- Test: `test/webview/ResponsePanel.test.tsx`

**Interfaces:**
- Consumes: `useStore`, shared types.
- Produces `<ResponsePanel />` reading the response for the active tab: status/time/size line, sub-tabs Body / Headers / Cookies. Shows a red error banner when `error` is set; shows "binary / too large" note when `bodyTruncated`. JSON bodies are pretty-printed.

- [ ] **Step 1: Write the failing test**

`test/webview/ResponsePanel.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { ResponsePanel } from '../../src/webview/components/ResponsePanel/ResponsePanel'

beforeEach(() => { useStore.getState().__reset(); useStore.getState().openNewTab() })
function activeId() { return useStore.getState().tabs[0].id }

describe('ResponsePanel', () => {
  it('renders status, time and size', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: '{"a":1}',
      bodyTruncated: false, timeMs: 42, sizeBytes: 7, cookies: [],
    })
    render(<ResponsePanel />)
    expect(screen.getByText(/200/)).toBeInTheDocument()
    expect(screen.getByText(/42 ms/)).toBeInTheDocument()
    expect(screen.getByText(/7 B/)).toBeInTheDocument()
  })

  it('shows an error banner when error is set', () => {
    useStore.getState().setResponse(activeId(), {
      status: 0, statusText: '', headers: [], body: '',
      bodyTruncated: false, timeMs: 5, sizeBytes: 0, cookies: [],
      error: { kind: 'connection', message: 'fetch failed' },
    })
    render(<ResponsePanel />)
    expect(screen.getByRole('alert')).toHaveTextContent(/fetch failed/)
  })

  it('shows a truncation note when bodyTruncated', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: 'xxxx',
      bodyTruncated: true, timeMs: 1, sizeBytes: 9999999, cookies: [],
    })
    render(<ResponsePanel />)
    expect(screen.getByText(/too large|truncated/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/components/ResponsePanel/ResponsePanel.tsx`:
```tsx
import { useState } from 'react'
import { useStore } from '../../state/store'
import type { HttpResponse } from '../../../shared/types'

type SubTab = 'body' | 'headers' | 'cookies'

function prettyBody(resp: HttpResponse): string {
  const ct = resp.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (ct.includes('json')) {
    try { return JSON.stringify(JSON.parse(resp.body), null, 2) } catch { /* fall through */ }
  }
  return resp.body
}

export function ResponsePanel() {
  const [sub, setSub] = useState<SubTab>('body')
  const resp = useStore((s) => (s.activeTabId ? s.responses[s.activeTabId] : undefined))
  if (!resp) return <div className="rm-panel">No response yet</div>

  if (resp.error) {
    return (
      <div className="rm-panel">
        <div role="alert" style={{ color: 'var(--vscode-errorForeground)' }}>
          {resp.error.kind}: {resp.error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="rm-panel">
      <div className="rm-row">
        <span>Status: {resp.status} {resp.statusText}</span>
        <span>Time: {resp.timeMs} ms</span>
        <span>Size: {resp.sizeBytes} B</span>
      </div>
      <div className="rm-row">
        {(['body', 'headers', 'cookies'] as SubTab[]).map((t) => (
          <button key={t} className="rm-btn" onClick={() => setSub(t)}>{t}</button>
        ))}
      </div>
      {sub === 'body' && (
        <>
          {resp.bodyTruncated && <div>Response too large — showing a truncated preview.</div>}
          <pre className="rm-input" style={{ whiteSpace: 'pre-wrap' }}>{prettyBody(resp)}</pre>
        </>
      )}
      {sub === 'headers' && (
        <table><tbody>
          {resp.headers.map((h, i) => (
            <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>
          ))}
        </tbody></table>
      )}
      {sub === 'cookies' && (
        <table><tbody>
          {resp.cookies.map((c, i) => (
            <tr key={i}><td>{c.key}</td><td>{c.value}</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/ResponsePanel/ResponsePanel.tsx test/webview/ResponsePanel.test.tsx
git commit -m "feat: ResponsePanel with status line, tabs, error banner"
```

---

## Task 14: Sidebar (rail + collection tree) & Tabs

**Files:**
- Create: `src/webview/components/Sidebar/Sidebar.tsx`
- Create: `src/webview/components/Tabs/Tabs.tsx`
- Test: `test/webview/Sidebar.test.tsx`, `test/webview/Tabs.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `postToHost`, shared types.
- Produces:
  - `<Sidebar />` — icon rail (Collections active) + a tree of `tree` collections and their requests; clicking a request opens it as a tab (`openNewTab` then `updateActive` with the request's fields); a "New Collection" action posts `{ type:'createCollection', name }`.
  - `<Tabs />` — one button per open tab (highlighting active), a close `×` per tab, and a `+` that calls `openNewTab`.

- [ ] **Step 1: Write the failing tests**

`test/webview/Tabs.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { Tabs } from '../../src/webview/components/Tabs/Tabs'

beforeEach(() => useStore.getState().__reset())

describe('Tabs', () => {
  it('the + button opens a new tab', () => {
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(useStore.getState().tabs).toHaveLength(1)
  })

  it('close removes a tab', () => {
    useStore.getState().openNewTab()
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(useStore.getState().tabs).toHaveLength(0)
  })
})
```

`test/webview/Sidebar.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'
import { Sidebar } from '../../src/webview/components/Sidebar/Sidebar'

beforeEach(() => useStore.getState().__reset())

describe('Sidebar', () => {
  it('lists collections and opens a request as a tab on click', () => {
    useStore.getState().setTree([{
      id: 'c1', name: 'My Coll',
      requests: [{ id: newId(), name: 'Get Users', method: 'GET', url: 'https://api/users', params: [], headers: [], body: { mode: 'none' } }],
    }])
    render(<Sidebar />)
    expect(screen.getByText('My Coll')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Get Users'))
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].url).toBe('https://api/users')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/Tabs.test.tsx test/webview/Sidebar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/webview/components/Tabs/Tabs.tsx`:
```tsx
import { useStore } from '../../state/store'

export function Tabs() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const openNewTab = useStore((s) => s.openNewTab)
  const closeTab = useStore((s) => s.closeTab)
  const setActive = useStore((s) => s.setActive)

  return (
    <div className="rm-row">
      {tabs.map((t) => (
        <span key={t.id} className="rm-row">
          <button className="rm-btn" aria-pressed={t.id === activeTabId}
            onClick={() => setActive(t.id)}>
            {t.method} {t.name}
          </button>
          <button className="rm-btn" aria-label={`close ${t.name}`}
            onClick={() => closeTab(t.id)}>×</button>
        </span>
      ))}
      <button className="rm-btn" aria-label="+" onClick={openNewTab}>+</button>
    </div>
  )
}
```

`src/webview/components/Sidebar/Sidebar.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { RestRequest } from '../../../shared/types'

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const openNewTab = useStore((s) => s.openNewTab)
  const updateActive = useStore((s) => s.updateActive)

  const openRequest = (r: RestRequest) => {
    openNewTab()
    updateActive({ name: r.name, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body })
  }

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Collections</strong>
        <button className="rm-btn" onClick={() => {
          const name = 'New Collection'
          postToHost({ type: 'createCollection', name })
        }}>+ New</button>
      </div>
      {tree.map((c) => (
        <div key={c.id}>
          <div>{c.name}</div>
          <ul>
            {c.requests.map((r) => (
              <li key={r.id}>
                <button className="rm-btn" onClick={() => openRequest(r)}>{r.name}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/Tabs.test.tsx test/webview/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Sidebar/Sidebar.tsx src/webview/components/Tabs/Tabs.tsx test/webview/Sidebar.test.tsx test/webview/Tabs.test.tsx
git commit -m "feat: sidebar collection tree and request tabs bar"
```

---

## Task 15: App assembly & host-message wiring

**Files:**
- Modify: `src/webview/App.tsx`, `src/webview/index.tsx`
- Test: `test/webview/App.test.tsx`

**Interfaces:**
- Consumes: all webview components, `useStore`, `onHostMessage`, `postToHost`.
- Produces `<App />` composing Sidebar + Tabs + RequestPanel + ResponsePanel, subscribing to host messages on mount: `response` → `setResponse`, `tree` → `setTree`. On mount it posts `{ type: 'ready' }` and imports `theme.css`.

- [ ] **Step 1: Write the failing test**

`test/webview/App.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

let handler: ((m: any) => void) | undefined
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: (cb: (m: any) => void) => { handler = cb; return () => { handler = undefined } },
}))

import { App } from '../../src/webview/App'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('App', () => {
  it('posts ready on mount and applies incoming tree', () => {
    render(<App />)
    expect(posted.some((m) => m.type === 'ready')).toBe(true)
    act(() => handler?.({ type: 'tree', collections: [{ id: 'c1', name: 'Seen', requests: [] }] }))
    expect(screen.getByText('Seen')).toBeInTheDocument()
    expect(useStore.getState().tree).toHaveLength(1)
  })

  it('routes a response message into the active tab store', () => {
    useStore.getState().openNewTab()
    const id = useStore.getState().tabs[0].id
    render(<App />)
    act(() => handler?.({ type: 'response', requestId: id, payload: {
      status: 201, statusText: 'Created', headers: [], body: 'ok',
      bodyTruncated: false, timeMs: 3, sizeBytes: 2, cookies: [] } }))
    expect(useStore.getState().responses[id]?.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/App.test.tsx`
Expected: FAIL — App does not yet wire messages.

- [ ] **Step 3: Implement**

`src/webview/App.tsx`:
```tsx
import { useEffect } from 'react'
import './theme.css'
import { useStore } from './state/store'
import { onHostMessage, postToHost } from './ipc'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Tabs } from './components/Tabs/Tabs'
import { RequestPanel } from './components/RequestPanel/RequestPanel'
import { ResponsePanel } from './components/ResponsePanel/ResponsePanel'

export function App() {
  const setTree = useStore((s) => s.setTree)
  const setResponse = useStore((s) => s.setResponse)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'response') setResponse(m.requestId, m.payload)
    })
    postToHost({ type: 'ready' })
    return off
  }, [setTree, setResponse])

  return (
    <div className="rm-row" style={{ alignItems: 'stretch', height: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Tabs />
        <RequestPanel />
        <ResponsePanel />
      </div>
    </div>
  )
}
```

`src/webview/index.tsx` (unchanged from Task 1, confirm it mounts `<App />`):
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/App.test.tsx`
Expected: PASS (both).

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS; `dist/extension.js` and `media/webview.js` build clean.

- [ ] **Step 6: Commit**

```bash
git add src/webview/App.tsx src/webview/index.tsx test/webview/App.test.tsx
git commit -m "feat: assemble App and wire host messages"
```

---

## Task 16: Manual smoke test in VS Code (F5)

**Files:**
- Create: `.vscode/launch.json`
- Create: `docs/superpowers/plans/phase1-smoke-checklist.md`

**Interfaces:**
- Consumes: the full built extension.
- Produces: a launch config to run the Extension Development Host and a manual checklist. This task has no automated test — it is the end-to-end verification gate before Phase 1 is called done.

- [ ] **Step 1: Create the launch config**

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "preLaunchTask": null
    }
  ]
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Write the smoke checklist**

`docs/superpowers/plans/phase1-smoke-checklist.md`:
```markdown
# Phase 1 Smoke Checklist

Run: press F5 (Run Extension) -> in the dev host, Command Palette -> "restman: Open".

- [ ] Panel opens in the editor area, themed to match the current VS Code theme.
- [ ] Switch VS Code theme (light/dark) -> panel colors follow.
- [ ] `+` opens a new request tab; method dropdown and URL input work.
- [ ] GET https://postman-echo.com/get?a=1 -> Send -> 200, JSON body pretty-printed, time & size shown.
- [ ] Add a Params row a=1 -> it folds into the sent URL.
- [ ] POST https://postman-echo.com/post with a raw JSON body -> echoed back in the response.
- [ ] A bad host (https://nope.invalid) -> red error banner, no crash.
- [ ] New Collection -> appears in the sidebar tree after refresh.
- [ ] Reload the panel (hide/show) -> no crash.
```

- [ ] **Step 4: Manually run the checklist**

Press F5, follow `phase1-smoke-checklist.md`, check every box. Fix any failures before proceeding (return to the relevant task).

- [ ] **Step 5: Commit**

```bash
git add .vscode/launch.json docs/superpowers/plans/phase1-smoke-checklist.md
git commit -m "chore: add dev launch config and phase 1 smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** architecture split (Tasks 1,8), shared types (2), HTTP client with timing/error/limit (4), collection store globalStorage + corrupt-skip + atomic (3,5), history (6), router (7), webview panel + CSP (8), IPC + params/URL sync (9), Zustand store (10), theme via `--vscode-*` (11,15), RequestPanel Params/Headers/Body (12), ResponsePanel Body/Headers/Cookies + status/error/truncation (13), sidebar tree + tabs (14), assembly + message wiring (15), end-to-end smoke (16). Save-request path exists via router (Task 7) and store; a Save button in the UI is intentionally minimal in Phase 1 (New Collection + open-from-tree covered; explicit per-request Save UI can be a fast follow — flagged, not silently dropped).
- **Deferred correctly:** environments, import/export, multipart, scripts, WebSockets, auth — all out of Phase 1 per spec.
- **Type consistency:** `RestRequest`, `HttpResponse` (with `bodyTruncated`, `error`), `WebviewMessage`/`HostMessage` used identically across host and webview; `sendRequest` signature matches its use in the router; store action names match component usage.
