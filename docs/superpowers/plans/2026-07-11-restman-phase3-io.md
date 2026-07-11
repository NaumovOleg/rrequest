# restman Phase 3 (Import/Export + File Upload + curl) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collection import/export (Postman v2.1 + native), a multipart `form-data` body mode with real file upload, and curl import/export to restman.

**Architecture:** Pure converters (`curl` in the webview, `postman` + import-export serialization in the host) are unit-tested in isolation; all filesystem and VS Code dialog I/O lives in the host and is injected into the message router as async callbacks. The webview holds only a `path`/`filename` reference for file fields; the host reads files at send time and builds multipart.

**Tech Stack:** TypeScript, VS Code Extension API (dialogs), native fetch + undici `FormData`/`Blob`, React + Zustand, Vitest. No new dependencies.

## Global Constraints

- Pure converters never do I/O and never throw on malformed input where the spec says "tolerated" (`parseCurl` returns best-effort; `parseImport` throws only inside a caught host boundary that shows an error and writes nothing).
- All file read/write and open/save dialogs run ONLY in the extension host. The webview triggers them via messages and never touches the filesystem.
- Multipart `Content-Type` is set automatically by fetch/FormData — never set manually for `form-data`.
- `{{var}}` interpolation applies to form-data text item keys/values and file item keys/filenames — never to file contents.
- Postman nested folders are FLATTENED into the flat `Collection.requests[]`; the folder path is folded into the request name (e.g. `Folder / Sub / Request`). Auth/scripts/tests/variables are dropped on convert.
- Format detection: an object with `info.schema` containing `v2.1` OR an `item` array → Postman v2.1; else an object with `id` + `requests` array → native; else invalid.
- `KeyValue` = `{ key; value; enabled }` and existing `RequestBody` modes (`none`/`raw`/`urlencoded`) are unchanged; `formdata` is added.
- All shared types live in `src/shared/types.ts`. Keep ALL existing tests passing.
- TDD: failing test first, watch fail, minimal impl, watch pass, commit. Small commits.

---

## File Structure

```
New:
  src/webview/curl.ts                                  // parseCurl + toCurl (pure)
  src/extension/postman.ts                             // toNative + fromNative (pure)
  src/extension/import-export.ts                       // detectFormat/parseImport/serializeExport (pure)
  src/webview/components/RequestPanel/FormDataEditor.tsx // form-data body editor
  + colocated tests

Modified:
  src/shared/types.ts             // FormDataItem, formdata mode, new message arms
  src/extension/collection-store.ts // saveCollection(whole collection)
  src/extension/http-client.ts    // formdata multipart send
  src/extension/messaging.ts      // import/export/pickFile routes + RouterDeps
  src/extension/panel.ts          // dialog/fs impls injected into router
  src/webview/state/store.ts      // pendingFilePick slice
  src/webview/components/RequestPanel/RequestPanel.tsx // form-data mode + curl buttons
  src/webview/components/Sidebar/Sidebar.tsx // Import / Export UI
  src/webview/App.tsx             // handle pickedFile
```

---

## Task 1: Shared types — form-data + message arms

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/io-types.test.ts`

**Interfaces:**
- Produces: `FormDataItem` type; `RequestBody` gains `{ mode:'formdata'; items: FormDataItem[] }`; new `WebviewMessage` arms `importCollection`, `exportCollection`, `pickFile`; new `HostMessage` arm `pickedFile`.

- [ ] **Step 1: Write the failing test**

`test/shared/io-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { RequestBody, FormDataItem, WebviewMessage, HostMessage } from '../../src/shared/types'

describe('io types', () => {
  it('formdata body and FormDataItem type-check', () => {
    const text: FormDataItem = { kind: 'text', key: 'a', value: '1', enabled: true }
    const file: FormDataItem = { kind: 'file', key: 'f', filename: 'x.png', path: '/tmp/x.png', enabled: true }
    const body: RequestBody = { mode: 'formdata', items: [text, file] }
    expect(body.mode).toBe('formdata')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'importCollection' }
    const b: WebviewMessage = { type: 'exportCollection', id: 'c1', format: 'postman' }
    const c: WebviewMessage = { type: 'pickFile' }
    const d: HostMessage = { type: 'pickedFile', path: '/tmp/x', filename: 'x' }
    expect([a.type, b.type, c.type, d.type]).toEqual(['importCollection', 'exportCollection', 'pickFile', 'pickedFile'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/io-types.test.ts`
Expected: FAIL — types not present.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, add before `RequestBody`:
```ts
export type FormDataItem =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | { kind: 'file'; key: string; filename: string; path: string; enabled: boolean }
```
Add the new mode to `RequestBody` (append inside the union):
```ts
  | { mode: 'formdata'; items: FormDataItem[] }
```
Append to `WebviewMessage`:
```ts
  | { type: 'importCollection' }
  | { type: 'exportCollection'; id: string; format: 'native' | 'postman' }
  | { type: 'pickFile' }
```
Append to `HostMessage`:
```ts
  | { type: 'pickedFile'; path: string; filename: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/io-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/io-types.test.ts
git commit -m "feat: form-data body type and io message arms"
```

---

## Task 2: curl parse + generate

**Files:**
- Create: `src/webview/curl.ts`
- Test: `test/webview/curl.test.ts`

**Interfaces:**
- Consumes: `RestRequest`, `HttpMethod`, `KeyValue` from `shared/types`.
- Produces: `parseCurl(cmd: string): Partial<RestRequest>` and `toCurl(req: RestRequest): string`.

- [ ] **Step 1: Write the failing test**

`test/webview/curl.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/curl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/curl.ts`:
```ts
import type { FormDataItem, HttpMethod, KeyValue, RestRequest } from '../shared/types'
import { buildUrlFromParams } from './state/url-sync'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// Split a shell-ish command into tokens, respecting single/double quotes.
function tokenize(cmd: string): string[] {
  const out: string[] = []
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

export function parseCurl(cmd: string): Partial<RestRequest> {
  const toks = tokenize(cmd.trim())
  if (toks[0] === 'curl') toks.shift()

  let method: HttpMethod | undefined
  let url: string | undefined
  const headers: KeyValue[] = []
  let dataText: string | undefined
  const formItems: FormDataItem[] = []

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === '-X' || t === '--request') {
      const v = (toks[++i] ?? '').toUpperCase()
      if (METHODS.includes(v as HttpMethod)) method = v as HttpMethod
    } else if (t === '-H' || t === '--header') {
      const raw = toks[++i] ?? ''
      const idx = raw.indexOf(':')
      if (idx > 0) headers.push({ key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim(), enabled: true })
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      dataText = toks[++i] ?? ''
    } else if (t === '-F' || t === '--form') {
      const raw = toks[++i] ?? ''
      const eq = raw.indexOf('=')
      if (eq > 0) {
        const key = raw.slice(0, eq)
        const val = raw.slice(eq + 1)
        if (val.startsWith('@')) {
          const path = val.slice(1)
          formItems.push({ kind: 'file', key, filename: path.split('/').pop() ?? path, path, enabled: true })
        } else {
          formItems.push({ kind: 'text', key, value: val, enabled: true })
        }
      }
    } else if (!t.startsWith('-')) {
      if (!url) url = t
    }
    // unknown flags are ignored
  }

  const out: Partial<RestRequest> = { method: method ?? (dataText !== undefined || formItems.length ? 'POST' : 'GET') }
  if (url) out.url = url
  if (headers.length) out.headers = headers
  if (formItems.length) out.body = { mode: 'formdata', items: formItems }
  else if (dataText !== undefined) out.body = { mode: 'raw', type: 'text', text: dataText }
  return out
}

export function toCurl(req: RestRequest): string {
  const parts: string[] = [`curl -X ${req.method} '${buildUrlFromParams(req.url, req.params)}'`]
  for (const h of req.headers) if (h.enabled && h.key) parts.push(`-H '${h.key}: ${h.value}'`)
  if (req.body.mode === 'raw' && req.body.text) parts.push(`--data '${req.body.text}'`)
  else if (req.body.mode === 'urlencoded') {
    const s = req.body.items.filter((i) => i.enabled && i.key).map((i) => `${i.key}=${i.value}`).join('&')
    if (s) parts.push(`--data '${s}'`)
  } else if (req.body.mode === 'formdata') {
    for (const it of req.body.items) {
      if (!it.enabled || !it.key) continue
      if (it.kind === 'text') parts.push(`-F '${it.key}=${it.value}'`)
      else parts.push(`-F '${it.key}=@${it.path}'`)
    }
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/curl.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/webview/curl.ts test/webview/curl.test.ts
git commit -m "feat: curl parse and generate"
```

---

## Task 3: Postman v2.1 converter

**Files:**
- Create: `src/extension/postman.ts`
- Test: `test/extension/postman.test.ts`

**Interfaces:**
- Consumes: `Collection`, `RestRequest`, `KeyValue`, `newId` from `shared/types`.
- Produces: `toNative(pm: any): Collection` and `fromNative(c: Collection): any` (Postman v2.1 shape).

- [ ] **Step 1: Write the failing test**

`test/extension/postman.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toNative, fromNative } from '../../src/extension/postman'
import type { Collection } from '../../src/shared/types'

const pm = {
  info: { name: 'API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'Get Users', request: {
      method: 'GET',
      header: [{ key: 'Accept', value: 'application/json' }],
      url: { raw: 'https://api.test/users?page=1', query: [{ key: 'page', value: '1' }] },
    } },
    { name: 'Folder', item: [
      { name: 'Create', request: {
        method: 'POST', header: [],
        url: { raw: 'https://api.test/users' },
        body: { mode: 'raw', raw: '{"a":1}' },
      } },
    ] },
  ],
}

describe('toNative', () => {
  it('flattens folders and maps requests', () => {
    const c = toNative(pm)
    expect(c.name).toBe('API')
    expect(c.requests).toHaveLength(2)
    expect(c.requests[0].name).toBe('Get Users')
    expect(c.requests[0].method).toBe('GET')
    expect(c.requests[0].url).toBe('https://api.test/users')
    expect(c.requests[0].params).toEqual([{ key: 'page', value: '1', enabled: true }])
    expect(c.requests[0].headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }])
    expect(c.requests[1].name).toBe('Folder / Create')
    expect(c.requests[1].body).toEqual({ mode: 'raw', type: 'text', text: '{"a":1}' })
  })
})

describe('fromNative', () => {
  it('emits a v2.1 collection with flat items', () => {
    const c: Collection = { id: '1', name: 'API', requests: [
      { id: 'a', name: 'Get', method: 'GET', url: 'https://api.test/x',
        params: [{ key: 'q', value: '1', enabled: true }],
        headers: [{ key: 'Accept', value: 'json', enabled: true }], body: { mode: 'none' } },
    ] }
    const pmOut = fromNative(c)
    expect(pmOut.info.name).toBe('API')
    expect(pmOut.info.schema).toContain('v2.1.0')
    expect(pmOut.item).toHaveLength(1)
    expect(pmOut.item[0].name).toBe('Get')
    expect(pmOut.item[0].request.method).toBe('GET')
    expect(pmOut.item[0].request.url.raw).toContain('https://api.test/x')
    expect(pmOut.item[0].request.header).toEqual([{ key: 'Accept', value: 'json' }])
  })
  it('round-trips method/url/headers', () => {
    const c = toNative(fromNative(toNative(pm)))
    expect(c.requests[0].method).toBe('GET')
    expect(c.requests[0].url).toBe('https://api.test/users')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/postman.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/postman.ts`:
```ts
import { newId, type Collection, type KeyValue, type RequestBody, type RestRequest, type HttpMethod } from '../shared/types'

const V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function pmUrlRaw(url: any): string {
  if (typeof url === 'string') return url
  if (url && typeof url.raw === 'string') return url.raw.split('?')[0]
  return ''
}
function pmParams(url: any): KeyValue[] {
  if (url && Array.isArray(url.query)) {
    return url.query.map((q: any) => ({ key: String(q.key ?? ''), value: String(q.value ?? ''), enabled: q.disabled !== true }))
  }
  return []
}
function pmHeaders(header: any): KeyValue[] {
  if (!Array.isArray(header)) return []
  return header.map((h: any) => ({ key: String(h.key ?? ''), value: String(h.value ?? ''), enabled: h.disabled !== true }))
}
function pmBody(body: any): RequestBody {
  if (!body || !body.mode) return { mode: 'none' }
  if (body.mode === 'raw') return { mode: 'raw', type: 'text', text: String(body.raw ?? '') }
  if (body.mode === 'urlencoded') {
    return { mode: 'urlencoded', items: (body.urlencoded ?? []).map((i: any) => ({ key: String(i.key ?? ''), value: String(i.value ?? ''), enabled: i.disabled !== true })) }
  }
  if (body.mode === 'formdata') {
    return { mode: 'formdata', items: (body.formdata ?? []).map((i: any) =>
      i.type === 'file'
        ? { kind: 'file', key: String(i.key ?? ''), filename: String(i.src ?? '').split('/').pop() ?? '', path: String(i.src ?? ''), enabled: i.disabled !== true }
        : { kind: 'text', key: String(i.key ?? ''), value: String(i.value ?? ''), enabled: i.disabled !== true }) }
  }
  return { mode: 'none' }
}

function flatten(items: any[], prefix: string, out: RestRequest[]): void {
  for (const it of items ?? []) {
    if (Array.isArray(it.item)) {
      flatten(it.item, prefix ? `${prefix} / ${it.name ?? ''}` : String(it.name ?? ''), out)
    } else if (it.request) {
      const r = it.request
      const method = (String(r.method ?? 'GET').toUpperCase()) as HttpMethod
      out.push({
        id: newId(),
        name: prefix ? `${prefix} / ${it.name ?? ''}` : String(it.name ?? 'Request'),
        method: METHODS.includes(method) ? method : 'GET',
        url: pmUrlRaw(r.url),
        params: pmParams(r.url),
        headers: pmHeaders(r.header),
        body: pmBody(r.body),
      })
    }
  }
}

export function toNative(pm: any): Collection {
  const out: RestRequest[] = []
  flatten(pm?.item ?? [], '', out)
  return { id: newId(), name: String(pm?.info?.name ?? 'Imported'), requests: out }
}

function nativeUrl(req: RestRequest): any {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  const raw = enabled.length
    ? `${req.url}${req.url.includes('?') ? '&' : '?'}${enabled.map((p) => `${p.key}=${p.value}`).join('&')}`
    : req.url
  const url: any = { raw }
  if (enabled.length) url.query = enabled.map((p) => ({ key: p.key, value: p.value }))
  return url
}
function nativeBody(body: RequestBody): any {
  if (body.mode === 'raw') return { mode: 'raw', raw: body.text }
  if (body.mode === 'urlencoded') return { mode: 'urlencoded', urlencoded: body.items.map((i) => ({ key: i.key, value: i.value, disabled: !i.enabled })) }
  if (body.mode === 'formdata') return { mode: 'formdata', formdata: body.items.map((i) =>
    i.kind === 'file' ? { key: i.key, type: 'file', src: i.path, disabled: !i.enabled } : { key: i.key, type: 'text', value: i.value, disabled: !i.enabled }) }
  return undefined
}

export function fromNative(c: Collection): any {
  return {
    info: { name: c.name, schema: V21 },
    item: c.requests.map((r) => {
      const request: any = {
        method: r.method,
        header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value })),
        url: nativeUrl(r),
      }
      const body = nativeBody(r.body)
      if (body) request.body = body
      return { name: r.name, request }
    }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/postman.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/extension/postman.ts test/extension/postman.test.ts
git commit -m "feat: postman v2.1 <-> native converter"
```

---

## Task 4: import-export serialization (pure)

**Files:**
- Create: `src/extension/import-export.ts`
- Test: `test/extension/import-export.test.ts`

**Interfaces:**
- Consumes: `toNative`, `fromNative` from `./postman`; `Collection`, `newId` from `shared/types`.
- Produces:
  - `detectFormat(parsed: any): 'postman' | 'native' | null`
  - `parseImport(text: string): Collection` (throws on invalid — caller catches)
  - `serializeExport(c: Collection, format: 'native' | 'postman'): string`

- [ ] **Step 1: Write the failing test**

`test/extension/import-export.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { detectFormat, parseImport, serializeExport } from '../../src/extension/import-export'
import type { Collection } from '../../src/shared/types'

const native: Collection = { id: 'c1', name: 'N', requests: [
  { id: 'r', name: 'x', method: 'GET', url: 'https://a/x', params: [], headers: [], body: { mode: 'none' } },
] }
const pm = { info: { name: 'P', schema: 'v2.1.0' }, item: [{ name: 'x', request: { method: 'GET', url: { raw: 'https://a/x' }, header: [] } }] }

describe('detectFormat', () => {
  it('detects postman by schema/item', () => { expect(detectFormat(pm)).toBe('postman') })
  it('detects native by id+requests', () => { expect(detectFormat(native)).toBe('native') })
  it('returns null for garbage', () => { expect(detectFormat({ nope: 1 })).toBeNull() })
})

describe('parseImport', () => {
  it('imports native JSON as-is', () => {
    const c = parseImport(JSON.stringify(native))
    expect(c.name).toBe('N'); expect(c.requests[0].url).toBe('https://a/x')
  })
  it('imports postman JSON via converter', () => {
    const c = parseImport(JSON.stringify(pm))
    expect(c.name).toBe('P'); expect(c.requests[0].method).toBe('GET')
  })
  it('throws on garbage', () => {
    expect(() => parseImport('{"nope":1}')).toThrow()
    expect(() => parseImport('not json')).toThrow()
  })
})

describe('serializeExport', () => {
  it('native export round-trips', () => {
    const c = JSON.parse(serializeExport(native, 'native')) as Collection
    expect(c.name).toBe('N')
  })
  it('postman export has v2.1 schema', () => {
    const p = JSON.parse(serializeExport(native, 'postman'))
    expect(p.info.schema).toContain('v2.1.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/import-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/import-export.ts`:
```ts
import { newId, type Collection } from '../shared/types'
import { fromNative, toNative } from './postman'

export function detectFormat(parsed: any): 'postman' | 'native' | null {
  if (parsed && typeof parsed === 'object') {
    const schema = parsed.info?.schema
    if ((typeof schema === 'string' && schema.includes('v2.1')) || Array.isArray(parsed.item)) return 'postman'
    if (typeof parsed.id === 'string' && Array.isArray(parsed.requests)) return 'native'
  }
  return null
}

export function parseImport(text: string): Collection {
  const parsed = JSON.parse(text) // throws on non-JSON
  const fmt = detectFormat(parsed)
  if (fmt === 'postman') return toNative(parsed)
  if (fmt === 'native') return { ...(parsed as Collection), id: (parsed as Collection).id || newId() }
  throw new Error('Unrecognized collection format')
}

export function serializeExport(c: Collection, format: 'native' | 'postman'): string {
  const obj = format === 'postman' ? fromNative(c) : c
  return JSON.stringify(obj, null, 2)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/import-export.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/extension/import-export.ts test/extension/import-export.test.ts
git commit -m "feat: import/export format detection and serialization"
```

---

## Task 5: CollectionStore.saveCollection

**Files:**
- Modify: `src/extension/collection-store.ts`
- Test: `test/extension/collection-store.test.ts` (append)

**Interfaces:**
- Produces: `CollectionStore.saveCollection(c: Collection): Promise<Collection>` — atomically writes the whole collection to `<id>.json` (used by import).

- [ ] **Step 1: Write the failing test (append)**

Add to `test/extension/collection-store.test.ts`:
```ts
it('saveCollection writes a whole collection and lists it', async () => {
  const c = { id: 'imp1', name: 'Imported', requests: [
    { id: 'r', name: 'x', method: 'GET' as const, url: 'https://a', params: [], headers: [], body: { mode: 'none' as const } },
  ] }
  await store.saveCollection(c)
  const all = await store.list()
  expect(all.find((x) => x.id === 'imp1')?.requests).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: FAIL — `saveCollection` is not a function.

- [ ] **Step 3: Implement**

In `src/extension/collection-store.ts`, add a method to the class:
```ts
  async saveCollection(c: import('../shared/types').Collection): Promise<import('../shared/types').Collection> {
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension/collection-store.ts test/extension/collection-store.test.ts
git commit -m "feat: CollectionStore.saveCollection for whole-collection import"
```

---

## Task 6: http-client form-data multipart send

**Files:**
- Modify: `src/extension/http-client.ts`
- Test: `test/extension/http-client.test.ts` (append)

**Interfaces:**
- Consumes: existing `interpolate`, `sendRequest`. Node `fs`.
- Produces: `sendRequest` builds a `FormData` when `body.mode==='formdata'`: enabled text items → string fields (interpolated); enabled file items → `new Blob([await fs.readFile(path)])` appended with the interpolated `filename`. Content-Type is NOT set manually. A missing file path yields the existing structured error (no throw).

- [ ] **Step 1: Write the failing test (append)**

Add to `test/extension/http-client.test.ts` (this file already imports `sendRequest`, `baseReq`):
```ts
import * as fsp from 'node:fs/promises'
import * as ospath from 'node:path'
import * as osmod from 'node:os'

describe('sendRequest form-data', () => {
  it('sends text and file fields as multipart FormData', async () => {
    const dir = await fsp.mkdtemp(ospath.join(osmod.tmpdir(), 'rm-fd-'))
    const fpath = ospath.join(dir, 'a.txt')
    await fsp.writeFile(fpath, 'FILEBODY')

    let seenBody: any
    let seenHeaders: Headers
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/http-client.test.ts`
Expected: FAIL — formdata not handled (body would be undefined or wrong).

- [ ] **Step 3: Implement**

In `src/extension/http-client.ts`, add the import:
```ts
import * as fs from 'node:fs/promises'
```

The current code computes `const { body, contentType } = buildBody(req)` and later sets `body` on the fetch init. For form-data we need an async FormData and must NOT set content-type. Add a helper and branch.

Add this async helper near `buildBody`:
```ts
async function buildFormData(req: RestRequest, sub: (s: string) => string): Promise<FormData> {
  const fd = new FormData()
  if (req.body.mode !== 'formdata') return fd
  for (const it of req.body.items) {
    if (!it.enabled || !it.key) continue
    if (it.kind === 'text') fd.append(sub(it.key), sub(it.value))
    else {
      const buf = await fs.readFile(it.path)
      fd.append(sub(it.key), new Blob([buf]), sub(it.filename))
    }
  }
  return fd
}
```
(Note: `sub` is the same interpolation closure already defined in `sendRequest` as `const sub = (s: string) => (vars.length ? interpolate(s, vars) : s)` from Phase 2. If that closure is not in scope where you need it, pass `vars` and inline the same `sub`.)

In `sendRequest`, inside the `try` (where headers/body are built), branch for form-data BEFORE the normal body build. Replace the body assembly so that:
```ts
    let fetchBody: BodyInit | undefined
    if (req.body.mode === 'formdata') {
      fetchBody = await buildFormData(req, sub)   // fs.readFile may throw -> caught by the existing try/catch -> error result
      // do NOT set content-type; FormData sets the multipart boundary
    } else {
      const { body, contentType } = buildBody(req)
      if (contentType && !headers.has('content-type')) headers.set('content-type', contentType)
      fetchBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    }
```
Then use `fetchBody` in the `doFetch(..., { ..., body: fetchBody, ... })` call (replace the existing `body: ...` argument with `body: fetchBody`).

IMPORTANT: keep this inside the existing `try` block so a missing-file `fs.readFile` rejection is mapped to the structured `error` result by the existing `catch` (kind `'unknown'`), preserving the never-throws contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/http-client.test.ts && npx tsc --noEmit`
Expected: PASS (all prior + 2 new); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/extension/http-client.ts test/extension/http-client.test.ts
git commit -m "feat: http-client multipart form-data with file upload"
```

---

## Task 7: Store — pendingFilePick slice

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append)

**Interfaces:**
- Produces: state `pendingFilePick: { tabId: string; index: number } | null` (init null); action `setPendingFilePick(p)`; cleared in `__reset`.

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/store.test.ts`:
```ts
describe('store pendingFilePick', () => {
  it('sets and resets pendingFilePick', () => {
    useStore.getState().setPendingFilePick({ tabId: 't1', index: 2 })
    expect(useStore.getState().pendingFilePick).toEqual({ tabId: 't1', index: 2 })
    useStore.getState().__reset()
    expect(useStore.getState().pendingFilePick).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL — `setPendingFilePick` not a function.

- [ ] **Step 3: Implement**

In `src/webview/state/store.ts` add to the `State` type:
```ts
  pendingFilePick: { tabId: string; index: number } | null
  setPendingFilePick(p: { tabId: string; index: number } | null): void
```
Add to the store body:
```ts
  pendingFilePick: null,
  setPendingFilePick: (pendingFilePick) => set({ pendingFilePick }),
```
Add `pendingFilePick: null` to the object passed in `__reset` (keep all existing reset fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: store pendingFilePick slice for file uploads"
```

---

## Task 8: Router import/export/pickFile routes + panel dialog wiring

**Files:**
- Modify: `src/extension/messaging.ts`
- Modify: `src/extension/panel.ts`
- Test: `test/extension/messaging.test.ts` (append)

**Interfaces:**
- Produces: `RouterDeps` gains three OPTIONAL deps `openImport?`, `runExport?`, `pickFile?` (optional so existing `createRouter(...)` constructions in the test file keep compiling; `panel.ts` always supplies them). Signatures: `openImport?: () => Promise<Collection | null>`, `runExport?: (c: Collection, format: 'native'|'postman') => Promise<void>`, `pickFile?: () => Promise<{ path: string; filename: string } | null>`. New routes guard on the dep being present. New routes:
  - `importCollection` → `const c = await deps.openImport(); if (c) await deps.collections.saveCollection(c); return tree`.
  - `exportCollection` → find the collection by id in the store list; if found `await deps.runExport(c, format)`; return `undefined`.
  - `pickFile` → `const f = await deps.pickFile(); return f ? { type:'pickedFile', ...f } : undefined`.

- [ ] **Step 1: Write the failing test (append)**

Extend the `deps()` helper in `test/extension/messaging.test.ts` to add:
```ts
    openImport: vi.fn(async () => ({ id: 'imp', name: 'Imp', requests: [] })),
    runExport: vi.fn(async () => {}),
    pickFile: vi.fn(async () => ({ path: '/tmp/a', filename: 'a' })),
```
Add `saveCollection: vi.fn(async (c:any)=>c)` to the `collections` mock object. When building the router in the new tests pass these through.

Add tests:
```ts
describe('createRouter io routes', () => {
  function fullRouter(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      openImport: d.openImport, runExport: d.runExport, pickFile: d.pickFile })
  }
  it('importCollection saves the imported collection and returns tree', async () => {
    const d = deps()
    const out = await fullRouter(d)({ type: 'importCollection' }) as any
    expect(d.openImport).toHaveBeenCalledOnce()
    expect(d.collections.saveCollection).toHaveBeenCalledWith({ id: 'imp', name: 'Imp', requests: [] })
    expect(out.type).toBe('tree')
  })
  it('exportCollection runs export for the found collection', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', requests: [] }])
    await fullRouter(d)({ type: 'exportCollection', id: 'c1', format: 'postman' })
    expect(d.runExport).toHaveBeenCalledWith({ id: 'c1', name: 'C', requests: [] }, 'postman')
  })
  it('pickFile returns a pickedFile message', async () => {
    const d = deps()
    const out = await fullRouter(d)({ type: 'pickFile' })
    expect(out).toEqual({ type: 'pickedFile', path: '/tmp/a', filename: 'a' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — routes return undefined; deps missing.

- [ ] **Step 3: Implement — messaging.ts**

Add to `RouterDeps` (OPTIONAL — so existing test router constructions still compile):
```ts
  openImport?: () => Promise<import('../shared/types').Collection | null>
  runExport?: (c: import('../shared/types').Collection, format: 'native' | 'postman') => Promise<void>
  pickFile?: () => Promise<{ path: string; filename: string } | null>
```
Add cases (before `default`) — each guards on its dep:
```ts
      case 'importCollection': {
        const c = deps.openImport ? await deps.openImport() : null
        if (c) await deps.collections.saveCollection(c)
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'exportCollection': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.id)
        if (c && deps.runExport) await deps.runExport(c, msg.format)
        return undefined
      }
      case 'pickFile': {
        const f = deps.pickFile ? await deps.pickFile() : null
        return f ? { type: 'pickedFile', path: f.path, filename: f.filename } : undefined
      }
```

- [ ] **Step 4: Implement — panel.ts dialog/fs impls**

In `src/extension/panel.ts`, import Node fs + the pure helpers:
```ts
import * as fs from 'node:fs/promises'
import { parseImport, serializeExport } from './import-export'
```
Add the three async impls to the `createRouter({...})` deps (alongside the existing env deps). Use the collection store instance you already construct (assign it to a const so both `collections` and the dialog impls share it if needed — the router's `deps.collections` is enough for import save, but export/import dialogs need their own fs/dialog work):
```ts
      openImport: async () => {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } })
        if (!picked || !picked[0]) return null
        try {
          const text = await fs.readFile(picked[0].fsPath, 'utf8')
          return parseImport(text)
        } catch (e: any) {
          void vscode.window.showErrorMessage(`restman import failed: ${e?.message ?? e}`)
          return null
        }
      },
      runExport: async (c, format) => {
        const target = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, saveLabel: 'Export' })
        if (!target) return
        try {
          await fs.writeFile(target.fsPath, serializeExport(c, format), 'utf8')
        } catch (e: any) {
          void vscode.window.showErrorMessage(`restman export failed: ${e?.message ?? e}`)
        }
      },
      pickFile: async () => {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false })
        if (!picked || !picked[0]) return null
        const p = picked[0].fsPath
        return { path: p, filename: p.split(/[\\/]/).pop() ?? p }
      },
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS (existing + 3 new); tsc clean; host bundle builds.

- [ ] **Step 6: Commit**

```bash
git add src/extension/messaging.ts src/extension/panel.ts test/extension/messaging.test.ts
git commit -m "feat: import/export/pickFile routes + host dialog wiring"
```

---

## Task 9: FormDataEditor + RequestPanel form-data mode

**Files:**
- Create: `src/webview/components/RequestPanel/FormDataEditor.tsx`
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/FormDataEditor.test.tsx`

**Interfaces:**
- Consumes: `useStore` (active tab, `updateActive`, `setPendingFilePick`), `postToHost`, `FormDataItem`.
- Produces: `<FormDataEditor />` rendering the active request's `formdata` items with a trailing blank row; per-row a type select (text/file), key input, and either a value input (text) or a "Choose file" button + filename label (file). "Choose file" sets `pendingFilePick` for `{ tabId, index }` and posts `{type:'pickFile'}`. RequestPanel's Body sub-tab offers a `form-data` mode that renders `<FormDataEditor/>`.

- [ ] **Step 1: Write the failing test**

`test/webview/FormDataEditor.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))

import { FormDataEditor } from '../../src/webview/components/RequestPanel/FormDataEditor'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; useStore.getState().openNewTab() })

describe('FormDataEditor', () => {
  it('adds a text field into the active request body', () => {
    render(<FormDataEditor />)
    fireEvent.change(screen.getByLabelText('form key 0'), { target: { value: 'name' } })
    const body = useStore.getState().tabs[0].body
    expect(body).toMatchObject({ mode: 'formdata' })
    expect((body as any).items[0]).toMatchObject({ kind: 'text', key: 'name', enabled: true })
  })

  it('switching a row to file shows Choose file which sets pendingFilePick and posts pickFile', () => {
    // seed one file-row
    useStore.getState().updateActive({ body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: '', path: '', enabled: true }] } })
    render(<FormDataEditor />)
    fireEvent.click(screen.getByRole('button', { name: /choose file/i }))
    expect(posted).toContainEqual({ type: 'pickFile' })
    const tabId = useStore.getState().tabs[0].id
    expect(useStore.getState().pendingFilePick).toEqual({ tabId, index: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/FormDataEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — FormDataEditor.tsx**

`src/webview/components/RequestPanel/FormDataEditor.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { FormDataItem } from '../../../shared/types'

export function FormDataEditor() {
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const update = useStore((s) => s.updateActive)
  const setPendingFilePick = useStore((s) => s.setPendingFilePick)
  if (!active) return null

  const items: FormDataItem[] = active.body.mode === 'formdata' ? active.body.items : []
  const setItems = (next: FormDataItem[]) => update({ body: { mode: 'formdata', items: next } })
  const patch = (i: number, next: FormDataItem) => setItems(items.map((r, j) => (j === i ? next : r)))
  const rows: FormDataItem[] = [...items, { kind: 'text', key: '', value: '', enabled: true }]

  return (
    <table><tbody>
      {rows.map((r, i) => (
        <tr key={i} className="rm-row">
          <td>
            <input type="checkbox" checked={r.enabled}
              onChange={(e) => i < items.length && patch(i, { ...r, enabled: e.target.checked })} />
          </td>
          <td>
            <select className="rm-select" aria-label={`form type ${i}`} value={r.kind}
              onChange={(e) => {
                if (i >= items.length) return
                const kind = e.target.value as 'text' | 'file'
                patch(i, kind === 'file'
                  ? { kind: 'file', key: r.key, filename: '', path: '', enabled: r.enabled }
                  : { kind: 'text', key: r.key, value: '', enabled: r.enabled })
              }}>
              <option value="text">text</option>
              <option value="file">file</option>
            </select>
          </td>
          <td>
            <input className="rm-input" aria-label={`form key ${i}`} placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < items.length) patch(i, { ...r, key: e.target.value })
                else setItems([...items, { kind: 'text', key: e.target.value, value: '', enabled: true }])
              }} />
          </td>
          <td>
            {r.kind === 'text' ? (
              <input className="rm-input" aria-label={`form value ${i}`} placeholder="value" value={r.value}
                onChange={(e) => i < items.length && patch(i, { ...r, value: e.target.value })} />
            ) : (
              <span className="rm-row">
                <button className="rm-btn" onClick={() => {
                  if (i >= items.length) return
                  setPendingFilePick({ tabId: active.id, index: i })
                  postToHost({ type: 'pickFile' })
                }}>Choose file</button>
                <span>{r.filename || 'no file'}</span>
              </span>
            )}
          </td>
        </tr>
      ))}
    </tbody></table>
  )
}
```

- [ ] **Step 4: Implement — RequestPanel form-data mode**

In `src/webview/components/RequestPanel/RequestPanel.tsx`, import the editor:
```tsx
import { FormDataEditor } from './FormDataEditor'
```
In the Body sub-tab area, add a body-mode selector and render form-data when chosen. The current Body sub-tab renders a raw `<textarea>`. Replace the body sub-tab block with a mode selector plus conditional editors:
```tsx
      {sub === 'body' && (
        <div>
          <div className="rm-row">
            <select className="rm-select" aria-label="body mode"
              value={active.body.mode}
              onChange={(e) => {
                const mode = e.target.value
                if (mode === 'none') update({ body: { mode: 'none' } })
                else if (mode === 'raw') update({ body: { mode: 'raw', type: 'json', text: active.body.mode === 'raw' ? active.body.text : '' } })
                else if (mode === 'formdata') update({ body: { mode: 'formdata', items: active.body.mode === 'formdata' ? active.body.items : [] } })
              }}>
              <option value="none">none</option>
              <option value="raw">raw</option>
              <option value="formdata">form-data</option>
            </select>
          </div>
          {active.body.mode === 'raw' && (
            <textarea className="rm-input" aria-label="body" rows={8} style={{ width: '100%' }}
              value={active.body.text}
              onChange={(e) => update({ body: { mode: 'raw', type: 'json', text: e.target.value } })} />
          )}
          {active.body.mode === 'formdata' && <FormDataEditor />}
        </div>
      )}
```
(Keep the existing method/url/send row, params/headers tables, and Save/curl controls intact — only the `sub === 'body'` block changes. Note: the existing Body test typed into `aria-label="body"`; that textarea now only renders in `raw` mode, so if an existing RequestPanel test relies on the textarea being present by default, update that test to first switch the body mode select to `raw` — do NOT weaken assertions; add the mode switch.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/webview/FormDataEditor.test.tsx test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (FormDataEditor 2/2, RequestPanel still green after any needed mode-switch adjustment).

- [ ] **Step 6: Commit**

```bash
git add src/webview/components/RequestPanel/FormDataEditor.tsx src/webview/components/RequestPanel/RequestPanel.tsx test/webview/FormDataEditor.test.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat: form-data body editor with file rows"
```

---

## Task 10: Sidebar Import / Export UI

**Files:**
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/Sidebar.test.tsx` (append)

**Interfaces:**
- Consumes: `postToHost`, store `tree`.
- Produces: an "Import" button posting `{type:'importCollection'}`; per-collection "Export native" and "Export postman" controls posting `{type:'exportCollection', id, format}`.

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/Sidebar.test.tsx`:
```ts
it('Import button posts importCollection', () => {
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
  expect(posted).toContainEqual({ type: 'importCollection' })
})

it('Export posts exportCollection with the collection id and format', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C', requests: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: /export postman for C/i }))
  expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'postman' })
})
```
(The Sidebar test file mocks `ipc` with a `posted` capture — if it does not yet, add the same `vi.mock('../../src/webview/ipc', ...)` block used by the other webview tests, capturing into a `posted` array, and reset it in `beforeEach`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/Sidebar.test.tsx`
Expected: FAIL — no Import/Export controls.

- [ ] **Step 3: Implement**

In `src/webview/components/Sidebar/Sidebar.tsx`:
- Ensure `postToHost` is imported (it already is, used for createCollection).
- Add an Import button in the Collections header row:
```tsx
        <button className="rm-btn" onClick={() => postToHost({ type: 'importCollection' })}>Import</button>
```
- For each collection in the tree, add export controls next to its name (inside the collection's rendered block):
```tsx
            <button className="rm-btn" aria-label={`export native for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'native' })}>Export native</button>
            <button className="rm-btn" aria-label={`export postman for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' })}>Export postman</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Sidebar/Sidebar.tsx test/webview/Sidebar.test.tsx
git commit -m "feat: sidebar import and export controls"
```

---

## Task 11: RequestPanel curl controls

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx` (append)

**Interfaces:**
- Consumes: `parseCurl`, `toCurl` from `../../curl`; `useStore` (`openNewTab`, `updateActive`).
- Produces: a "Copy as cURL" button that writes `toCurl(active)` to the clipboard (via `navigator.clipboard.writeText`); an "Import from cURL" control: a textarea + button that runs `parseCurl` on the text and applies it to a new tab (`openNewTab` then `updateActive` with the parsed fields).

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/RequestPanel.test.tsx`:
```ts
it('Copy as cURL writes the request as a curl command to the clipboard', async () => {
  const writeText = vi.fn()
  Object.assign(navigator, { clipboard: { writeText } })
  useStore.getState().updateActive({ method: 'GET', url: 'https://api.test/x' })
  render(<RequestPanel />)
  fireEvent.click(screen.getByRole('button', { name: /copy as curl/i }))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`curl -X GET 'https://api.test/x'`))
})

it('Import from cURL creates a new tab from the pasted command', () => {
  render(<RequestPanel />)
  fireEvent.change(screen.getByLabelText(/curl command/i), { target: { value: `curl -X POST https://api.test/y` } })
  fireEvent.click(screen.getByRole('button', { name: /import from curl/i }))
  const tabs = useStore.getState().tabs
  const active = tabs.find((t) => t.id === useStore.getState().activeTabId)!
  expect(active.url).toBe('https://api.test/y')
  expect(active.method).toBe('POST')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: FAIL — no curl controls.

- [ ] **Step 3: Implement**

In `src/webview/components/RequestPanel/RequestPanel.tsx`:
- Add imports:
```tsx
import { useState } from 'react'   // if not already imported
import { parseCurl, toCurl } from '../../curl'
```
- Add local state for the curl import box:
```tsx
  const [curlText, setCurlText] = useState('')
  const openNewTab = useStore((s) => s.openNewTab)
```
- Add a curl controls row (e.g. below the method/url/send row):
```tsx
      <div className="rm-row">
        <button className="rm-btn" onClick={() => { void navigator.clipboard.writeText(toCurl(active)) }}>Copy as cURL</button>
        <input className="rm-input" aria-label="curl command" placeholder="Paste curl command" value={curlText}
          onChange={(e) => setCurlText(e.target.value)} />
        <button className="rm-btn" onClick={() => {
          const parsed = parseCurl(curlText)
          openNewTab()
          update(parsed)
          setCurlText('')
        }}>Import from cURL</button>
      </div>
```
(`update` is the existing `updateActive` selector already in RequestPanel. `parseCurl` returns a `Partial<RestRequest>`; `updateActive` accepts a partial, so `update(parsed)` applies it to the newly opened tab.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat: copy-as-curl and import-from-curl in RequestPanel"
```

---

## Task 12: App handles pickedFile

**Files:**
- Modify: `src/webview/App.tsx`
- Test: `test/webview/App.test.tsx` (append)

**Interfaces:**
- Consumes: `onHostMessage`, store (`pendingFilePick`, `tabs`, `updateActive`/direct tab update, `setPendingFilePick`).
- Produces: App's message handler routes `pickedFile` → applies `{ path, filename }` to the form-data file item at `pendingFilePick.{tabId,index}`, then clears `pendingFilePick`. If there is no pending pick or the tab/item is gone, it is a no-op.

- [ ] **Step 1: Write the failing test (append)**

Add to `test/webview/App.test.tsx`:
```ts
it('applies a pickedFile to the pending form-data file row', () => {
  // set up a tab with a file row and a pending pick
  useStore.getState().openNewTab()
  const tabId = useStore.getState().tabs[0].id
  useStore.getState().updateActive({ body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: '', path: '', enabled: true }] } })
  useStore.getState().setPendingFilePick({ tabId, index: 0 })
  render(<App />)
  act(() => handler?.({ type: 'pickedFile', path: '/tmp/a.png', filename: 'a.png' }))
  const item = (useStore.getState().tabs[0].body as any).items[0]
  expect(item).toMatchObject({ kind: 'file', path: '/tmp/a.png', filename: 'a.png' })
  expect(useStore.getState().pendingFilePick).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/App.test.tsx`
Expected: FAIL — App doesn't handle pickedFile.

- [ ] **Step 3: Implement**

In `src/webview/App.tsx`, extend the message handler in the mount effect. Add a `pickedFile` branch that reads the store directly (via `useStore.getState()`), applies the path/filename to the target tab's form-data item, and clears the pending pick:
```tsx
      else if (m.type === 'pickedFile') {
        const st = useStore.getState()
        const pending = st.pendingFilePick
        if (pending) {
          const tab = st.tabs.find((t) => t.id === pending.tabId)
          if (tab && tab.body.mode === 'formdata') {
            const items = tab.body.items.map((it, i) =>
              i === pending.index && it.kind === 'file'
                ? { ...it, path: m.path, filename: m.filename }
                : it)
            // write back: set the active tab if it is the target, else update via a targeted setter
            st.setTabBody(pending.tabId, { mode: 'formdata', items })
          }
          st.setPendingFilePick(null)
        }
      }
```
This needs a small store setter `setTabBody(tabId, body)` because the pick may resolve for a tab that is not currently active (so `updateActive` is not safe). Add it to the store in this task:

In `src/webview/state/store.ts` add to the `State` type:
```ts
  setTabBody(tabId: string, body: RestRequest['body']): void
```
And to the store body:
```ts
  setTabBody: (tabId, body) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, body } : t)) })),
```
(Import `RestRequest` type in store.ts if not already imported.)

Also ensure `useStore` is imported in `App.tsx` (it already is) and that `setEnvironments`/etc. dependency array is unaffected — the `pickedFile` branch uses `useStore.getState()` so it needs no new deps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/App.test.tsx test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; both bundles build.

- [ ] **Step 6: Commit**

```bash
git add src/webview/App.tsx src/webview/state/store.ts test/webview/App.test.tsx
git commit -m "feat: apply picked file to pending form-data row"
```

---

## Task 13: Manual smoke — Phase 3 end-to-end

**Files:**
- Create: `docs/superpowers/plans/phase3-smoke-checklist.md`

**Interfaces:**
- Consumes: the full built extension. No automated test — F5 verification gate.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2: Write the smoke checklist**

`docs/superpowers/plans/phase3-smoke-checklist.md`:
```markdown
# Phase 3 Smoke Checklist

Press F5 → open restman.

- [ ] Sidebar "Import" → pick a Postman v2.1 collection JSON → its requests appear (folders flattened into names).
- [ ] Sidebar "Import" → pick a native restman JSON → imports.
- [ ] "Export postman" on a collection → save → the file is valid Postman v2.1 (info.schema v2.1.0).
- [ ] "Export native" → save → re-import round-trips.
- [ ] Body → form-data: add a text field `name=bob` and a file field, "Choose file" → pick a file → filename shows.
- [ ] Send to https://postman-echo.com/post → response echoes the multipart form (file + fields).
- [ ] "Copy as cURL" → paste elsewhere → a valid curl command with method/url/headers/body.
- [ ] "Import from cURL": paste `curl -X POST https://postman-echo.com/post -d '{"a":1}'` → new tab populated → Send works.
- [ ] `{{var}}` in a form-data text field resolves against the active environment.
```

- [ ] **Step 3: Manually run the checklist**

Press F5, follow the checklist, check every box. Fix failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/phase3-smoke-checklist.md
git commit -m "chore: phase 3 smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** form-data model + message arms (Task 1); curl parse/gen (2); Postman v2.1 converter with folder flattening (3); import/export detection + serialization (4); whole-collection save for import (5); multipart send with file read + interpolation + never-throws (6); pendingFilePick (7); import/export/pickFile routes + host dialog/fs wiring (8); form-data editor + body-mode selector (9); sidebar import/export UI (10); copy-as-curl + import-from-curl (11); pickedFile application to the right tab/row (12); manual e2e (13).
- **Type consistency:** `FormDataItem` (kind text/file) used identically across curl, postman, http-client, FormDataEditor. Message arms (`importCollection`, `exportCollection{id,format}`, `pickFile`, `pickedFile{path,filename}`) match between Task 1 and consumers in Tasks 8-12. `RouterDeps` additions (openImport/runExport/pickFile) in Task 8 match panel wiring. `setTabBody`/`setPendingFilePick`/`pendingFilePick` consistent between store (7,12) and App (12)/FormDataEditor (9). `parseImport`/`serializeExport`/`detectFormat` signatures (4) match panel usage (8).
- **Deferred correctly:** Postman folder hierarchy (flattened), auth/scripts/tests on convert, env import/export, streaming large files — all Phase-3 non-goals, absent from tasks.
- **Never-throws preserved:** the form-data `fs.readFile` runs inside the existing http-client try/catch (Task 6), so a missing file maps to the structured error result, not a throw.
