# restman Phase 5 (WebSockets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone WebSocket panel — connect to a `ws://`/`wss://` endpoint (with custom handshake headers), send text messages, and watch a live log — with the connection owned by the extension host (via the `ws` library) and events streamed to the editor through the Hub.

**Architecture:** The host `WsManager` owns `Map<connId, WebSocket>` and emits WS events to the editor via `Hub.emitToEditor`. The router's `wsConnect`/`wsSend`/`wsDisconnect` routes call the manager (no reply — events stream async). The editor toggles a `WebSocketPanel` from the top bar; it posts connect/send/disconnect and renders a log fed by streamed `wsOpen`/`wsMessage`/`wsClosed`/`wsError` messages plus locally-appended `out` entries.

**Tech Stack:** TypeScript, `ws` (new runtime dep), Node, existing VS Code + React + Zustand + Vitest.

## Global Constraints

- The WebSocket connection lives ONLY in the extension host via the `ws` library. The webview never opens a socket; CSP stays `default-src 'none'`.
- WS events (`wsOpen`/`wsMessage`/`wsClosed`/`wsError`) are asynchronous host→editor pushes via `Hub.emitToEditor` (posts to the `'editor'` sink if registered, else no-op) — NOT router replies.
- The editor generates `connId` on Connect (`newId()`); the host keys the socket by it. Sent messages are logged locally by the editor (`out`); the host streams `in`/status.
- `ws` native optional deps `bufferutil`/`utf-8-validate` are marked `external` in esbuild (`ws` runs pure-JS without them).
- One active connection at a time (MVP): the panel's Connect is available only when status is `closed`.
- New message arms and store fields are additive; keep ALL existing tests passing. `rm-*` styling only. TDD; run `npx tsc --noEmit` each task and confirm clean; small commits.

---

## File Structure

```
New:
  src/extension/ws-manager.ts                        // WsManager (host connection registry)
  src/webview/components/WebSocket/WebSocketPanel.tsx // WS UI
  + colocated tests

Modified:
  package.json                     // + ws, + @types/ws
  esbuild.js                       // external: bufferutil, utf-8-validate
  src/shared/types.ts              // WS message arms
  src/extension/hub.ts             // emitToEditor
  src/extension/messaging.ts       // ws routes + RouterDeps.ws?
  src/extension/panel.ts           // construct WsManager + inject
  src/webview/state/store.ts       // WS slice
  src/webview/editor/EditorApp.tsx // WS toggle + WS event handling
```

---

## Task 1: Shared types — WS message arms

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/ws-types.test.ts`

- [ ] **Step 1: Write the failing test**

`test/shared/ws-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { WebviewMessage, HostMessage } from '../../src/shared/types'

describe('ws types', () => {
  it('ws webview + host arms type-check', () => {
    const a: WebviewMessage = { type: 'wsConnect', connId: 'x', url: 'wss://e', headers: [] }
    const b: WebviewMessage = { type: 'wsSend', connId: 'x', data: 'hi' }
    const c: WebviewMessage = { type: 'wsDisconnect', connId: 'x' }
    const d: HostMessage = { type: 'wsOpen', connId: 'x' }
    const e: HostMessage = { type: 'wsMessage', connId: 'x', data: 'hi', at: 1 }
    const f: HostMessage = { type: 'wsClosed', connId: 'x', code: 1000, reason: 'bye' }
    const g: HostMessage = { type: 'wsError', connId: 'x', message: 'boom' }
    expect([a.type, b.type, c.type, d.type, e.type, f.type, g.type]).toEqual(
      ['wsConnect', 'wsSend', 'wsDisconnect', 'wsOpen', 'wsMessage', 'wsClosed', 'wsError'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/ws-types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `WebviewMessage` in `src/shared/types.ts`:
```ts
  | { type: 'wsConnect'; connId: string; url: string; headers: KeyValue[] }
  | { type: 'wsSend'; connId: string; data: string }
  | { type: 'wsDisconnect'; connId: string }
```
Append to `HostMessage`:
```ts
  | { type: 'wsOpen'; connId: string }
  | { type: 'wsMessage'; connId: string; data: string; at: number }
  | { type: 'wsClosed'; connId: string; code: number; reason: string }
  | { type: 'wsError'; connId: string; message: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/ws-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/ws-types.test.ts
git commit -m "feat: websocket message arms"
```

---

## Task 2: Add the `ws` dependency + esbuild externals

**Files:**
- Modify: `package.json`, `esbuild.js`
- Test: `test/extension/ws-dep.test.ts`

- [ ] **Step 1: Write the failing test**

`test/extension/ws-dep.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'

describe('ws dependency', () => {
  it('the ws library is installed and importable', () => {
    expect(typeof WebSocket).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/ws-dep.test.ts`
Expected: FAIL — cannot resolve `ws`.

- [ ] **Step 3: Implement**

In `package.json`, add to `dependencies`:
```json
    "ws": "^8.16.0"
```
Add to `devDependencies`:
```json
    "@types/ws": "^8.5.10"
```
Install:
```bash
npm install
```
In `esbuild.js`, change the `external` line to also exclude `ws`'s optional native deps:
```js
  external: ['vscode', 'bufferutil', 'utf-8-validate'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/ws-dep.test.ts && node esbuild.js`
Expected: PASS; `dist/extension.js` builds (with `ws` bundled and its optional native deps left external).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json esbuild.js test/extension/ws-dep.test.ts
git commit -m "chore: add ws dependency and esbuild externals"
```

---

## Task 3: WsManager

**Files:**
- Create: `src/extension/ws-manager.ts`
- Test: `test/extension/ws-manager.test.ts`

**Interfaces:**
- Consumes: `HostMessage`, `KeyValue` from `shared/types`.
- Produces:
  - types `WsSocket` (`on(event, cb)`, `send(data)`, `close()`), `WsFactory = (url, opts:{headers}) => WsSocket`.
  - `class WsManager` — `constructor(emit: (m: HostMessage) => void, factory: WsFactory)`; `connect(connId, url, headers)`, `send(connId, data)`, `disconnect(connId)`.

- [ ] **Step 1: Write the failing test**

`test/extension/ws-manager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { WsManager, type WsSocket, type WsFactory } from '../../src/extension/ws-manager'
import type { HostMessage } from '../../src/shared/types'

function fakeSocket() {
  const handlers: Record<string, Function> = {}
  const socket: WsSocket = {
    on: (event: string, cb: Function) => { handlers[event] = cb },
    send: vi.fn(),
    close: vi.fn(),
  } as any
  return { socket, fire: (event: string, ...args: any[]) => handlers[event]?.(...args) }
}

describe('WsManager', () => {
  it('connect wires handlers; open/message/close/error emit the right messages', () => {
    const emitted: HostMessage[] = []
    const fk = fakeSocket()
    const factory: WsFactory = () => fk.socket
    const m = new WsManager((msg) => emitted.push(msg), factory)
    m.connect('c1', 'wss://e', [{ key: 'X-A', value: '1', enabled: true }])

    fk.fire('open')
    fk.fire('message', 'hello')
    fk.fire('close', 1000, 'bye')
    fk.fire('error', new Error('boom'))

    expect(emitted[0]).toEqual({ type: 'wsOpen', connId: 'c1' })
    expect(emitted[1]).toMatchObject({ type: 'wsMessage', connId: 'c1', data: 'hello' })
    expect(emitted[2]).toEqual({ type: 'wsClosed', connId: 'c1', code: 1000, reason: 'bye' })
    expect(emitted[3]).toEqual({ type: 'wsError', connId: 'c1', message: 'boom' })
  })
  it('passes enabled headers to the factory', () => {
    const factory = vi.fn(() => fakeSocket().socket)
    const m = new WsManager(() => {}, factory as any)
    m.connect('c1', 'wss://e', [{ key: 'A', value: '1', enabled: true }, { key: 'B', value: '2', enabled: false }])
    expect(factory).toHaveBeenCalledWith('wss://e', { headers: { A: '1' } })
  })
  it('send and disconnect call the socket; unknown id is a no-op', () => {
    const fk = fakeSocket()
    const m = new WsManager(() => {}, () => fk.socket)
    m.connect('c1', 'wss://e', [])
    m.send('c1', 'data'); expect(fk.socket.send).toHaveBeenCalledWith('data')
    m.disconnect('c1'); expect(fk.socket.close).toHaveBeenCalled()
    expect(() => { m.send('nope', 'x'); m.disconnect('nope') }).not.toThrow()
  })
  it('removes the socket from the registry on close', () => {
    const fk = fakeSocket()
    const send = fk.socket.send as any
    const m = new WsManager(() => {}, () => fk.socket)
    m.connect('c1', 'wss://e', [])
    fk.fire('close', 1000, '')
    m.send('c1', 'after-close')
    expect(send).not.toHaveBeenCalled()
  })
  it('emits wsError + wsClosed when the factory throws', () => {
    const emitted: HostMessage[] = []
    const m = new WsManager((msg) => emitted.push(msg), () => { throw new Error('bad url') })
    m.connect('c1', 'not a url', [])
    expect(emitted[0]).toMatchObject({ type: 'wsError', connId: 'c1' })
    expect(emitted[1]).toMatchObject({ type: 'wsClosed', connId: 'c1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/ws-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/ws-manager.ts`:
```ts
import type { HostMessage, KeyValue } from '../shared/types'

export type WsSocket = {
  on(event: 'open', cb: () => void): void
  on(event: 'message', cb: (data: unknown) => void): void
  on(event: 'close', cb: (code: number, reason: unknown) => void): void
  on(event: 'error', cb: (err: unknown) => void): void
  send(data: string): void
  close(): void
}
export type WsFactory = (url: string, opts: { headers: Record<string, string> }) => WsSocket

export class WsManager {
  private readonly conns = new Map<string, WsSocket>()
  constructor(
    private readonly emit: (m: HostMessage) => void,
    private readonly factory: WsFactory,
  ) {}

  connect(connId: string, url: string, headers: KeyValue[]): void {
    const hdrs: Record<string, string> = {}
    for (const h of headers) if (h.enabled && h.key) hdrs[h.key] = h.value
    let socket: WsSocket
    try {
      socket = this.factory(url, { headers: hdrs })
    } catch (e: any) {
      this.emit({ type: 'wsError', connId, message: String(e?.message ?? e) })
      this.emit({ type: 'wsClosed', connId, code: 0, reason: 'connect failed' })
      return
    }
    this.conns.set(connId, socket)
    socket.on('open', () => this.emit({ type: 'wsOpen', connId }))
    socket.on('message', (data) => this.emit({ type: 'wsMessage', connId, data: typeof data === 'string' ? data : String(data), at: Date.now() }))
    socket.on('close', (code, reason) => { this.conns.delete(connId); this.emit({ type: 'wsClosed', connId, code: code ?? 0, reason: String(reason ?? '') }) })
    socket.on('error', (err: any) => this.emit({ type: 'wsError', connId, message: String(err?.message ?? err) }))
  }

  send(connId: string, data: string): void { this.conns.get(connId)?.send(data) }
  disconnect(connId: string): void { this.conns.get(connId)?.close() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/ws-manager.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/extension/ws-manager.ts test/extension/ws-manager.test.ts
git commit -m "feat: WsManager host connection registry"
```

---

## Task 4: Hub.emitToEditor + router ws routes + panel wiring

**Files:**
- Modify: `src/extension/hub.ts`, `src/extension/messaging.ts`, `src/extension/panel.ts`
- Test: `test/extension/hub.test.ts` (append), `test/extension/messaging.test.ts` (append)

**Interfaces:**
- `Hub.emitToEditor(m: HostMessage): void` — posts to the `'editor'` sink if present, else no-op.
- `RouterDeps.ws?: WsManager`; routes `wsConnect`/`wsSend`/`wsDisconnect` call it, return `undefined`.
- `panel.ts` constructs `new WsManager((m) => hub.emitToEditor(m), realFactory)` and injects it as `ws`; the Hub must exist before the WsManager (built after the Hub in `ensureBootstrap`).

- [ ] **Step 1: Write the failing tests (append)**

Add to `test/extension/hub.test.ts` (the file already has a `setup(route)` helper returning `{ hub, editor, sidebar }`):
```ts
it('emitToEditor posts only to the editor sink', () => {
  const { hub, editor, sidebar } = setup(async () => undefined)
  hub.emitToEditor({ type: 'wsOpen', connId: 'c1' })
  expect(editor).toContainEqual({ type: 'wsOpen', connId: 'c1' })
  expect(sidebar.find((m) => m.type === 'wsOpen')).toBeUndefined()
})
```

Add to `test/extension/messaging.test.ts` a describe (build the router with a mock `ws`):
```ts
describe('createRouter ws routes', () => {
  function wsRouter(d: any, ws: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id },
      ws })
  }
  it('wsConnect/wsSend/wsDisconnect call the manager and return undefined', async () => {
    const ws = { connect: vi.fn(), send: vi.fn(), disconnect: vi.fn() }
    const route = wsRouter(deps(), ws)
    expect(await route({ type: 'wsConnect', connId: 'c1', url: 'wss://e', headers: [] })).toBeUndefined()
    expect(await route({ type: 'wsSend', connId: 'c1', data: 'hi' })).toBeUndefined()
    expect(await route({ type: 'wsDisconnect', connId: 'c1' })).toBeUndefined()
    expect(ws.connect).toHaveBeenCalledWith('c1', 'wss://e', [])
    expect(ws.send).toHaveBeenCalledWith('c1', 'hi')
    expect(ws.disconnect).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/extension/hub.test.ts test/extension/messaging.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — hub.ts**

Add a public method to the `Hub` class:
```ts
  emitToEditor(m: HostMessage): void { this.postTo('editor', m) }
```

- [ ] **Step 4: Implement — messaging.ts**

Import the type and extend `RouterDeps`:
```ts
import type { WsManager } from './ws-manager'
```
```ts
  ws?: WsManager
```
Add cases (before `default`):
```ts
      case 'wsConnect':
        deps.ws?.connect(msg.connId, msg.url, msg.headers)
        return undefined
      case 'wsSend':
        deps.ws?.send(msg.connId, msg.data)
        return undefined
      case 'wsDisconnect':
        deps.ws?.disconnect(msg.connId)
        return undefined
```

- [ ] **Step 5: Implement — panel.ts wiring**

In `src/extension/panel.ts`, import:
```ts
import WebSocket from 'ws'
import { WsManager, type WsFactory } from './ws-manager'
```
In `ensureBootstrap`, AFTER the `Hub` (`hubSingleton`/`hub`) is created (the WsManager needs `hub.emitToEditor`), construct the manager and inject it. If the current code creates the Hub and then returns it, restructure so the router is built with a `ws` that references the hub. Since `createRouter` is called before the Hub in the current bootstrap, use a lazily-bound emit: build the `WsManager` with an emit closure that calls the eventual hub, and set the hub reference when created. Concretely:
```ts
  const wsFactory: WsFactory = (url, opts) => new WebSocket(url, { headers: opts.headers }) as unknown as import('./ws-manager').WsSocket
  let hubRef: Hub | undefined
  const wsManager = new WsManager((m) => hubRef?.emitToEditor(m), wsFactory)
```
Pass `ws: wsManager` into the `createRouter({...})` deps. Then where the Hub is constructed, assign `hubRef = <the hub>` immediately after it is created (before returning). (If the bootstrap already keeps the hub in a local `const hub = new Hub(...)`, add `hubRef = hub` right after that line.)

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run test/extension/hub.test.ts test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS; tsc clean; host bundle builds.

- [ ] **Step 7: Commit**

```bash
git add src/extension/hub.ts src/extension/messaging.ts src/extension/panel.ts test/extension/hub.test.ts test/extension/messaging.test.ts
git commit -m "feat: hub emitToEditor, ws router routes, WsManager wiring"
```

---

## Task 5: Store — WS slice

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append)

**Interfaces:**
- Adds state `wsMode: boolean` (false), `wsUrl: string` (''), `wsHeaders: KeyValue[]` ([]), `wsInput: string` (''), `wsStatus: 'closed'|'connecting'|'open'` ('closed'), `wsConnId: string|null` (null), `wsLog: { dir:'in'|'out'|'status'; data:string; at:number }[]` ([]); actions `setWsMode`, `setWsUrl`, `setWsHeaders`, `setWsInput`, `wsStartConnect(connId)` (status→connecting, wsConnId=connId, log cleared), `wsSetStatus(status)`, `wsAppendLog(entry)`, `wsClear()` (log []). All cleared in `__reset`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('store ws slice', () => {
  it('ws actions update state and __reset clears them', () => {
    const s = useStore.getState()
    s.setWsMode(true); s.setWsUrl('wss://e'); s.setWsInput('hi')
    s.wsStartConnect('c1')
    s.wsSetStatus('open')
    s.wsAppendLog({ dir: 'in', data: 'hello', at: 1 })
    const st = useStore.getState()
    expect(st.wsMode).toBe(true); expect(st.wsUrl).toBe('wss://e'); expect(st.wsInput).toBe('hi')
    expect(st.wsConnId).toBe('c1'); expect(st.wsStatus).toBe('open')
    expect(st.wsLog).toEqual([{ dir: 'in', data: 'hello', at: 1 }])
    useStore.getState().__reset()
    const r = useStore.getState()
    expect(r.wsMode).toBe(false); expect(r.wsStatus).toBe('closed'); expect(r.wsLog).toEqual([]); expect(r.wsConnId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/state/store.ts`, add to the `State` type:
```ts
  wsMode: boolean
  wsUrl: string
  wsHeaders: KeyValue[]
  wsInput: string
  wsStatus: 'closed' | 'connecting' | 'open'
  wsConnId: string | null
  wsLog: { dir: 'in' | 'out' | 'status'; data: string; at: number }[]
  setWsMode(v: boolean): void
  setWsUrl(v: string): void
  setWsHeaders(v: KeyValue[]): void
  setWsInput(v: string): void
  wsStartConnect(connId: string): void
  wsSetStatus(status: 'closed' | 'connecting' | 'open'): void
  wsAppendLog(entry: { dir: 'in' | 'out' | 'status'; data: string; at: number }): void
  wsClear(): void
```
Add to the store body:
```ts
  wsMode: false,
  wsUrl: '',
  wsHeaders: [],
  wsInput: '',
  wsStatus: 'closed',
  wsConnId: null,
  wsLog: [],
  setWsMode: (wsMode) => set({ wsMode }),
  setWsUrl: (wsUrl) => set({ wsUrl }),
  setWsHeaders: (wsHeaders) => set({ wsHeaders }),
  setWsInput: (wsInput) => set({ wsInput }),
  wsStartConnect: (connId) => set({ wsConnId: connId, wsStatus: 'connecting', wsLog: [] }),
  wsSetStatus: (wsStatus) => set({ wsStatus }),
  wsAppendLog: (entry) => set((s) => ({ wsLog: [...s.wsLog, entry] })),
  wsClear: () => set({ wsLog: [] }),
```
Add to `__reset` (keep all existing fields):
```ts
  wsMode: false, wsUrl: '', wsHeaders: [], wsInput: '', wsStatus: 'closed', wsConnId: null, wsLog: [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: webview store websocket slice"
```

---

## Task 6: WebSocketPanel component

**Files:**
- Create: `src/webview/components/WebSocket/WebSocketPanel.tsx`
- Test: `test/webview/WebSocketPanel.test.tsx`

**Interfaces:**
- Consumes: `useStore` (ws slice), `postToHost`, `newId`.
- Produces `<WebSocketPanel/>` — a URL input (aria-label "websocket url" bound to wsUrl), a Connect button (posts `wsConnect{connId,url,headers}` and calls `wsStartConnect(connId)`; shown when status is `closed`), a Disconnect button (posts `wsDisconnect{connId}`; shown when status is `open`/`connecting`), a message composer (input aria-label "websocket message" bound to wsInput + Send button posting `wsSend{connId,data}` and appending an `out` log entry, enabled only when status `open`), and a log list rendering `wsLog` (each entry shows dir + data).

- [ ] **Step 1: Write the failing test**

`test/webview/WebSocketPanel.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WebSocketPanel } from '../../src/webview/components/WebSocket/WebSocketPanel'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('WebSocketPanel', () => {
  it('Connect posts wsConnect and starts connecting', () => {
    useStore.getState().setWsUrl('wss://echo')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    const msg = posted.find((m) => m.type === 'wsConnect')
    expect(msg).toBeTruthy()
    expect(msg.url).toBe('wss://echo')
    expect(useStore.getState().wsStatus).toBe('connecting')
    expect(useStore.getState().wsConnId).toBe(msg.connId)
  })
  it('when open, Send posts wsSend and logs an out entry', () => {
    useStore.getState().setWsUrl('wss://echo')
    useStore.getState().wsStartConnect('c1')
    useStore.getState().wsSetStatus('open')
    useStore.getState().setWsInput('ping')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    expect(posted).toContainEqual({ type: 'wsSend', connId: 'c1', data: 'ping' })
    expect(useStore.getState().wsLog.at(-1)).toMatchObject({ dir: 'out', data: 'ping' })
  })
  it('when open, Disconnect posts wsDisconnect', () => {
    useStore.getState().wsStartConnect('c1'); useStore.getState().wsSetStatus('open')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(posted).toContainEqual({ type: 'wsDisconnect', connId: 'c1' })
  })
  it('renders log entries', () => {
    useStore.getState().wsAppendLog({ dir: 'in', data: 'hello-in', at: 1 })
    render(<WebSocketPanel />)
    expect(screen.getByText(/hello-in/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/WebSocketPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/components/WebSocket/WebSocketPanel.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId } from '../../../shared/types'

export function WebSocketPanel() {
  const wsUrl = useStore((s) => s.wsUrl)
  const wsInput = useStore((s) => s.wsInput)
  const wsStatus = useStore((s) => s.wsStatus)
  const wsConnId = useStore((s) => s.wsConnId)
  const wsHeaders = useStore((s) => s.wsHeaders)
  const wsLog = useStore((s) => s.wsLog)
  const setWsUrl = useStore((s) => s.setWsUrl)
  const setWsInput = useStore((s) => s.setWsInput)
  const wsStartConnect = useStore((s) => s.wsStartConnect)
  const wsAppendLog = useStore((s) => s.wsAppendLog)

  const connect = () => {
    const connId = newId()
    wsStartConnect(connId)
    postToHost({ type: 'wsConnect', connId, url: wsUrl, headers: wsHeaders })
  }
  const disconnect = () => { if (wsConnId) postToHost({ type: 'wsDisconnect', connId: wsConnId }) }
  const send = () => {
    if (!wsConnId) return
    postToHost({ type: 'wsSend', connId: wsConnId, data: wsInput })
    wsAppendLog({ dir: 'out', data: wsInput, at: Date.now() })
    setWsInput('')
  }

  return (
    <div className="rm-panel" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="rm-row">
        <input className="rm-input" aria-label="websocket url" placeholder="wss://..." style={{ flex: 1 }}
          value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
        {wsStatus === 'closed'
          ? <button className="rm-btn" disabled={!wsUrl} onClick={connect}>Connect</button>
          : <button className="rm-btn" onClick={disconnect}>Disconnect</button>}
        <span>{wsStatus}</span>
      </div>
      <div className="rm-row">
        <input className="rm-input" aria-label="websocket message" placeholder="message" style={{ flex: 1 }}
          value={wsInput} onChange={(e) => setWsInput(e.target.value)} />
        <button className="rm-btn" disabled={wsStatus !== 'open'} onClick={send}>Send</button>
      </div>
      <div className="rm-panel" style={{ flex: 1, overflow: 'auto' }}>
        {wsLog.map((e, i) => (
          <div key={i} className="rm-row">
            <span style={{ opacity: 0.6, minWidth: 40 }}>{e.dir}</span>
            <span>{e.data}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/WebSocketPanel.test.tsx`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/WebSocket/WebSocketPanel.tsx test/webview/WebSocketPanel.test.tsx
git commit -m "feat: WebSocketPanel UI"
```

---

## Task 7: EditorApp — WS toggle + WS event handling

**Files:**
- Modify: `src/webview/editor/EditorApp.tsx`
- Test: `test/webview/EditorApp.test.tsx` (append)

**Interfaces:**
- Adds a "WebSocket" toggle button in the top bar that flips `wsMode`; when `wsMode` is true, render `<WebSocketPanel/>` instead of Tabs + RequestPanel + ResponsePanel. The mount message handler gains: `wsOpen` → `wsSetStatus('open')` + append a `status` log ("connected"); `wsMessage` → append an `in` log with the data; `wsClosed` → `wsSetStatus('closed')` + append a `status` log ("closed: <code>"); `wsError` → append a `status` log ("error: <message>").

- [ ] **Step 1: Write the failing tests (append)**

```ts
it('toggles the WebSocket panel and handles ws events', () => {
  render(<EditorApp />)
  // toggle to WS mode
  fireEvent.click(screen.getByRole('button', { name: /websocket/i }))
  expect(useStore.getState().wsMode).toBe(true)
  expect(screen.getByLabelText(/websocket url/i)).toBeInTheDocument()
  // ws events
  act(() => handler?.({ type: 'wsOpen', connId: 'c1' }))
  expect(useStore.getState().wsStatus).toBe('open')
  act(() => handler?.({ type: 'wsMessage', connId: 'c1', data: 'srv-msg', at: 1 }))
  expect(useStore.getState().wsLog.some((e) => e.dir === 'in' && e.data === 'srv-msg')).toBe(true)
  act(() => handler?.({ type: 'wsClosed', connId: 'c1', code: 1000, reason: 'bye' }))
  expect(useStore.getState().wsStatus).toBe('closed')
})
```
(Ensure `fireEvent` is imported in the EditorApp test file; add it to the RTL import if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/EditorApp.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/editor/EditorApp.tsx`:
- Import the panel and the ws store actions:
```tsx
import { WebSocketPanel } from '../components/WebSocket/WebSocketPanel'
```
- Add selectors:
```tsx
  const wsMode = useStore((s) => s.wsMode)
  const setWsMode = useStore((s) => s.setWsMode)
  const wsSetStatus = useStore((s) => s.wsSetStatus)
  const wsAppendLog = useStore((s) => s.wsAppendLog)
```
- In the `onHostMessage` handler, add the WS branches (alongside the existing `tree`/`response`/etc.):
```tsx
      else if (m.type === 'wsOpen') { wsSetStatus('open'); wsAppendLog({ dir: 'status', data: 'connected', at: Date.now() }) }
      else if (m.type === 'wsMessage') { wsAppendLog({ dir: 'in', data: m.data, at: m.at }) }
      else if (m.type === 'wsClosed') { wsSetStatus('closed'); wsAppendLog({ dir: 'status', data: `closed: ${m.code}`, at: Date.now() }) }
      else if (m.type === 'wsError') { wsAppendLog({ dir: 'status', data: `error: ${m.message}`, at: Date.now() }) }
```
- Add `wsSetStatus`, `wsAppendLog` to the effect dependency array.
- Render the toggle + conditional body. In the right-hand column, add the toggle to the top bar and switch the body on `wsMode`:
```tsx
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="rm-row" style={{ justifyContent: 'space-between', padding: '4px 8px' }}>
          <button className="rm-btn" aria-pressed={wsMode} onClick={() => setWsMode(!wsMode)}>WebSocket</button>
          <EnvDropdown />
        </div>
        {wsMode ? (
          <WebSocketPanel />
        ) : (
          <>
            <Tabs />
            <RequestPanel />
            <ResponsePanel />
          </>
        )}
      </div>
```
(Keep the existing outer layout; only the right-hand column's top bar + body change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/EditorApp.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Full suite + build + commit**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; both bundles build.
```bash
git add src/webview/editor/EditorApp.tsx test/webview/EditorApp.test.tsx
git commit -m "feat: WebSocket toggle and event handling in the editor"
```

---

## Task 8: Manual smoke — WebSockets end-to-end

**Files:**
- Create: `docs/superpowers/plans/phase5-websockets-smoke-checklist.md`

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Write the checklist**

`docs/superpowers/plans/phase5-websockets-smoke-checklist.md`:
```markdown
# Phase 5 WebSockets Smoke Checklist

Press F5 → open restman → in the editor top bar, click "WebSocket".

- [ ] The WebSocket panel shows: URL input, Connect button, message composer, log.
- [ ] Connect to `wss://echo.websocket.org` (or `wss://ws.postman-echo.com/raw`) → status becomes "open"; a "connected" status entry appears.
- [ ] Type a message + Send → an "out" entry appears; the echo server's reply appears as an "in" entry.
- [ ] Disconnect → status "closed"; a "closed" status entry appears.
- [ ] Connect to a bad url (`wss://nope.invalid`) → an "error"/"closed" status entry appears; the app does not crash.
- [ ] Toggle "WebSocket" off → the HTTP request editor returns; toggle on → the WS panel + its log are still there.
- [ ] Custom header: add a header in the WS panel (if the headers UI is present) and connect to an echo that reflects headers → the header is sent on the handshake.
```

- [ ] **Step 3: Manually run it**

Press F5, follow the checklist. Fix failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/phase5-websockets-smoke-checklist.md
git commit -m "chore: phase 5 websockets smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** WS message arms (Task 1); `ws` dep + esbuild externals (2); WsManager registry with open/message/close/error emits + header passing + factory-throw handling (3); Hub.emitToEditor + router routes + panel WsManager wiring with lazily-bound emit (4); store WS slice (5); WebSocketPanel connect/send/disconnect/log (6); EditorApp toggle + WS event handling (7); manual e2e (8).
- **Type consistency:** WS arms (Task 1) match WsManager emits (3), router routes (4), store log entry shape (5), WebSocketPanel posts (6), and EditorApp handlers (7). `WsManager` signature (3) matches the router dep (4) and panel construction (4). The store log entry `{ dir; data; at }` is identical across store (5), panel (6), and EditorApp (7).
- **Streaming vs reply:** WS routes return `undefined`; events flow only via `emitToEditor` — never as router replies. The panel Connect is gated to `status==='closed'` so only one connection is opened at a time.
- **Never-crash:** the WsManager catches a factory throw into `wsError`+`wsClosed`; `send`/`disconnect` on an unknown/closed id are no-ops; the host `ws` errors surface as `wsError` events, never uncaught.
- **Deferred:** collection-saved WS requests, multiple connections, subprotocols, binary composing, reconnect, `{{var}}` in ws url/headers — all non-goals.
