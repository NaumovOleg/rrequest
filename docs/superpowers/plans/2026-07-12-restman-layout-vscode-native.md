# restman VS Code-native Layout Refactor + Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split restman's UI into two VS Code surfaces — a React WebviewView in the activity-bar sidebar (collections/environments/history/import-export/workspace switcher) and the editor-area WebviewPanel (single-request editor) — with the host as the state hub broadcasting to both; and add Workspaces to group collections. Also finishes the paused Phase-3 curl + picked-file items in the new structure.

**Architecture:** Two webviews, each its own bundle and its own Zustand store instance (same store module, separate JS contexts). The host owns all state (stores + globalState) and a `Hub` that runs the router for messages from either surface, delivers targeted replies (`response`/`pickedFile`/`openInEditor`), and after every action broadcasts a fresh state snapshot (`tree` filtered by active workspace, `environments`, `workspaces`, `history`) to both surfaces. Clicking a request in the sidebar posts `openRequest`; the host reveals the editor panel and sends `openInEditor`.

**Tech Stack:** TypeScript, VS Code Extension API (WebviewView + WebviewPanel), React + Zustand, Vite (multi-entry), Vitest. No new deps.

## Global Constraints

- Two webviews: sidebar `WebviewView` (view id `restman.sidebar`, `"type":"webview"`) and the editor `WebviewPanel`. Each loads its own bundle (`media/sidebar.js`, `media/editor.js`).
- Host is the single source of truth. After ANY message it handles, the Hub broadcasts a fresh state snapshot to ALL live webviews: `tree` (only collections whose `workspaceId === activeWorkspaceId`), `environments{activeId}`, `workspaces{activeId}`, `history`. Targeted replies (`response`, `pickedFile`) go to the sender; `openInEditor` goes to the editor panel (revealing it).
- `Workspace = { id: string; name: string }`. `Collection` gains `workspaceId: string`. `createCollection`/`importCollection` stamp the active workspace id. A collection missing `workspaceId` is treated as belonging to the active workspace (back-compat).
- Bootstrap: if no workspaces exist, the host creates a `Default` workspace and makes it active before serving state.
- Environments and history are NOT workspace-scoped (global).
- Active ids in globalState: `restman.activeEnvId` (existing), `restman.activeWorkspaceId` (new).
- No change to `http-client`, `interpolate`, `postman`, `import-export`, `curl` logic. Their tests stay green.
- All shared types in `src/shared/types.ts`. `--vscode-*`/`rm-*` styling only. TDD; keep the suite green; small commits.

---

## File Structure

```
New:
  src/extension/workspace-store.ts          // WorkspaceStore (mirrors CollectionStore)
  src/extension/hub.ts                       // Hub: dispatch + broadcast state to all webviews
  src/extension/sidebar-view.ts              // SidebarViewProvider (WebviewViewProvider)
  src/webview/editor/index.tsx               // editor bundle entry
  src/webview/editor/EditorApp.tsx           // editor surface composition
  src/webview/sidebar/index.tsx              // sidebar bundle entry
  src/webview/sidebar/SidebarApp.tsx         // sidebar surface composition
  src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx
  src/webview/components/History/History.tsx // extracted history list (was inline in Sidebar)
  + colocated tests

Modified:
  src/shared/types.ts                        // Workspace, Collection.workspaceId, new arms
  src/extension/collection-store.ts          // createCollection(name, workspaceId)
  src/extension/messaging.ts                 // workspace routes, openRequest, stamp workspaceId
  src/extension/panel.ts                     // load editor bundle, register with Hub, be openInEditor target
  src/extension/extension.ts                 // register SidebarViewProvider; drop welcome tree view
  package.json                               // restman.sidebar webview view (replace restman.launch)
  vite.config.ts                             // two entries -> media/{editor,sidebar}.js
  src/webview/state/store.ts                 // workspaces slice
  src/webview/components/Sidebar/Sidebar.tsx // request click -> openRequest (not local tab)

Removed (after migration):
  src/webview/App.tsx  + test/webview/App.test.tsx   // superseded by EditorApp
  the welcome-only LaunchViewProvider in extension.ts
```

---

## Task 1: Shared types — Workspace + workspaceId + new arms

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/workspace-types.test.ts`

**Interfaces:**
- Produces: `Workspace` type; `Collection.workspaceId: string`; `WebviewMessage` arms `openRequest`, `loadWorkspaces`, `createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `setActiveWorkspace`; `HostMessage` arms `openInEditor`, `workspaces`.

- [ ] **Step 1: Write the failing test**

`test/shared/workspace-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { Workspace, Collection, WebviewMessage, HostMessage } from '../../src/shared/types'

describe('workspace types', () => {
  it('Workspace and Collection.workspaceId type-check', () => {
    const w: Workspace = { id: 'w1', name: 'Default' }
    const c: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }
    expect(c.workspaceId).toBe('w1')
    expect(w.name).toBe('Default')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'openRequest', request: { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } }
    const b: WebviewMessage = { type: 'setActiveWorkspace', id: 'w1' }
    const c: HostMessage = { type: 'openInEditor', request: { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } }
    const d: HostMessage = { type: 'workspaces', workspaces: [], activeId: 'w1' }
    expect([a.type, b.type, c.type, d.type]).toEqual(['openRequest', 'setActiveWorkspace', 'openInEditor', 'workspaces'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/workspace-types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`:
- Add `workspaceId: string` to the `Collection` type:
```ts
export type Collection = { id: string; name: string; workspaceId: string; requests: RestRequest[] }
```
- Add the `Workspace` type near `Collection`:
```ts
export type Workspace = { id: string; name: string }
```
- Append to `WebviewMessage`:
```ts
  | { type: 'openRequest'; request: RestRequest }
  | { type: 'loadWorkspaces' }
  | { type: 'createWorkspace'; name: string }
  | { type: 'renameWorkspace'; id: string; name: string }
  | { type: 'deleteWorkspace'; id: string }
  | { type: 'setActiveWorkspace'; id: string }
```
- Append to `HostMessage`:
```ts
  | { type: 'openInEditor'; request: RestRequest }
  | { type: 'workspaces'; workspaces: Workspace[]; activeId: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/workspace-types.test.ts && npx tsc --noEmit`
Expected: test PASS; tsc will now report errors in existing code that constructs `Collection` without `workspaceId` (collection-store, postman, import-export, tests). That is expected — those are fixed in Tasks 2-4. If you want a green tsc at THIS commit, add `workspaceId: ''` to the `Collection` literals the compiler flags (they will be corrected in later tasks); otherwise proceed and let Task 2-4 resolve them. Prefer: make `workspaceId` required and fix the two non-test construction sites now — `collection-store.createCollection` (Task 3 will finalize) and `postman.toNative`/`import-export.parseImport`. To keep this task self-contained and tsc-green, in this task also:
  - `src/extension/postman.ts` `toNative`: add `workspaceId: ''` to the returned `Collection` (the router stamps the real id on import — Task 4).
  - `src/extension/import-export.ts` `parseImport` native branch already spreads parsed; ensure the returned object has `workspaceId: (parsed as any).workspaceId ?? ''`.
  - `src/extension/collection-store.ts` `createCollection`: temporarily set `workspaceId: ''` (Task 3 changes the signature).
  - Fix any `Collection` literals in existing tests (`messaging.test.ts`, `collection-store.test.ts`, `postman.test.ts`, `import-export.test.ts`) by adding `workspaceId: ''` (or a value) so tsc + tests pass.

- [ ] **Step 5: Verify full suite + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (with the `workspaceId: ''` back-fills above).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Workspace type, Collection.workspaceId, layout message arms"
```

---

## Task 2: WorkspaceStore

**Files:**
- Create: `src/extension/workspace-store.ts`
- Test: `test/extension/workspace-store.test.ts`

**Interfaces:**
- Produces `WorkspaceStore`:
  - `constructor(baseDir: string)` — files under `${baseDir}/workspaces/`.
  - `list(): Promise<Workspace[]>` (skips corrupt files)
  - `create(name: string): Promise<Workspace>`
  - `rename(id: string, name: string): Promise<void>`
  - `delete(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`test/extension/workspace-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceStore } from '../../src/extension/workspace-store'

let dir: string, store: WorkspaceStore
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rm-ws-')); store = new WorkspaceStore(dir) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('WorkspaceStore', () => {
  it('starts empty', async () => { expect(await store.list()).toEqual([]) })
  it('creates and lists', async () => {
    const w = await store.create('Default')
    expect(w.name).toBe('Default')
    expect((await store.list()).map((x) => x.name)).toEqual(['Default'])
  })
  it('renames', async () => {
    const w = await store.create('A'); await store.rename(w.id, 'B')
    expect((await store.list())[0].name).toBe('B')
  })
  it('deletes', async () => {
    const w = await store.create('A'); await store.delete(w.id)
    expect(await store.list()).toEqual([])
  })
  it('skips corrupt files', async () => {
    await store.create('Good')
    await fs.writeFile(path.join(dir, 'workspaces', 'bad.json'), '{ broken')
    expect((await store.list()).map((x) => x.name)).toEqual(['Good'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/workspace-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/workspace-store.ts`:
```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Workspace } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class WorkspaceStore {
  private readonly dir: string
  constructor(baseDir: string) { this.dir = path.join(baseDir, 'workspaces') }
  private file(id: string): string { return path.join(this.dir, `${id}.json`) }

  async list(): Promise<Workspace[]> {
    let names: string[]
    try { names = await fs.readdir(this.dir) } catch { return [] }
    const out: Workspace[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const w = await readJsonSafe<Workspace>(path.join(this.dir, n))
      if (w && w.id && typeof w.name === 'string') out.push(w)
    }
    return out
  }
  async create(name: string): Promise<Workspace> {
    const w: Workspace = { id: newId(), name }
    await writeJsonAtomic(this.file(w.id), w)
    return w
  }
  async rename(id: string, name: string): Promise<void> {
    const w = await readJsonSafe<Workspace>(this.file(id))
    if (w) await writeJsonAtomic(this.file(id), { ...w, name })
  }
  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/workspace-store.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/extension/workspace-store.ts test/extension/workspace-store.test.ts
git commit -m "feat: workspace store (CRUD, corrupt-skip)"
```

---

## Task 3: CollectionStore workspace-aware create

**Files:**
- Modify: `src/extension/collection-store.ts`
- Test: `test/extension/collection-store.test.ts` (adjust)

**Interfaces:**
- Produces: `createCollection(name: string, workspaceId: string): Promise<Collection>` — the new collection carries `workspaceId`.

- [ ] **Step 1: Update the failing test**

In `test/extension/collection-store.test.ts`, change the create test(s) to pass a workspace id and assert it. Replace the existing "creates a collection and lists it" body:
```ts
  it('creates a collection with a workspace id and lists it', async () => {
    const c = await store.createCollection('My Coll', 'ws1')
    expect(c.name).toBe('My Coll')
    expect(c.workspaceId).toBe('ws1')
    expect((await store.list()).map((x) => x.name)).toEqual(['My Coll'])
  })
```
Also update any other call to `createCollection('X')` in this test file to `createCollection('X', 'ws1')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: FAIL — `createCollection` takes one arg / `workspaceId` undefined.

- [ ] **Step 3: Implement**

In `src/extension/collection-store.ts`, change `createCollection`:
```ts
  async createCollection(name: string, workspaceId: string): Promise<Collection> {
    const c: Collection = { id: newId(), name, workspaceId, requests: [] }
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }
```
Remove any temporary `workspaceId: ''` you set in Task 1 here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/collection-store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc will flag the router's `createCollection(msg.name)` call — that is fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/extension/collection-store.ts test/extension/collection-store.test.ts
git commit -m "feat: collection create carries workspaceId"
```

---

## Task 4: Router — workspace routes, workspace-stamping, openRequest

**Files:**
- Modify: `src/extension/messaging.ts`
- Test: `test/extension/messaging.test.ts` (extend)

**Interfaces:**
- Produces: `RouterDeps` gains `workspaces: WorkspaceStore`, `getActiveWorkspaceId: () => string`, `setActiveWorkspaceId: (id: string) => void`. New routes:
  - `loadWorkspaces` / `createWorkspace` / `renameWorkspace` / `deleteWorkspace` / `setActiveWorkspace` → return `{ type:'workspaces', workspaces, activeId }`.
  - `openRequest` → `{ type:'openInEditor', request: msg.request }`.
  - `createCollection` and `importCollection` stamp `workspaceId = getActiveWorkspaceId()` on the new/imported collection.
  - `deleteWorkspace` of the active id: pick another workspace as active (or create `Default`); reassign the deleted workspace's collections to the new active id (load each, set workspaceId, saveCollection).

- [ ] **Step 1: Write the failing tests (extend deps + add cases)**

Extend the `deps()` helper: add
```ts
    workspaces: {
      list: vi.fn(async () => [{ id: 'w1', name: 'Default' }]),
      create: vi.fn(async (n: string) => ({ id: 'w2', name: n })),
      rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    } as any,
    activeWorkspaceId: 'w1',
```
When constructing the router in the new tests, pass `workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id }`. Also update the collections mock: `createCollection: vi.fn(async (n:string, ws:string)=>({ id:'c1', name:n, workspaceId:ws, requests:[] }))`.

Add tests (build the router with all deps including io + workspaces):
```ts
describe('createRouter workspace + openRequest', () => {
  function router(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      openImport: d.openImport, runExport: d.runExport, pickFile: d.pickFile,
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
  }
  it('setActiveWorkspace updates active id and returns workspaces', async () => {
    const d = deps()
    const out = await router(d)({ type: 'setActiveWorkspace', id: 'w9' }) as any
    expect(d.activeWorkspaceId).toBe('w9')
    expect(out.type).toBe('workspaces')
  })
  it('createCollection stamps the active workspace id', async () => {
    const d = deps(); d.activeWorkspaceId = 'w1'
    await router(d)({ type: 'createCollection', name: 'New' })
    expect(d.collections.createCollection).toHaveBeenCalledWith('New', 'w1')
  })
  it('openRequest returns an openInEditor message', async () => {
    const d = deps()
    const req = { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    const out = await router(d)({ type: 'openRequest', request: req })
    expect(out).toEqual({ type: 'openInEditor', request: req })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/extension/messaging.ts`:
- Import: `import type { WorkspaceStore } from './workspace-store'`.
- Extend `RouterDeps`:
```ts
  workspaces: WorkspaceStore
  getActiveWorkspaceId: () => string
  setActiveWorkspaceId: (id: string) => void
```
- Add a helper inside `createRouter`:
```ts
  async function wsSnapshot(): Promise<HostMessage> {
    return { type: 'workspaces', workspaces: await deps.workspaces.list(), activeId: deps.getActiveWorkspaceId() }
  }
```
- Change the `createCollection` case to stamp the workspace:
```ts
      case 'createCollection':
        await deps.collections.createCollection(msg.name, deps.getActiveWorkspaceId())
        return { type: 'tree', collections: await deps.collections.list() }
```
- Change the `importCollection` case to stamp the imported collection:
```ts
      case 'importCollection': {
        const c = deps.openImport ? await deps.openImport() : null
        if (c) await deps.collections.saveCollection({ ...c, workspaceId: deps.getActiveWorkspaceId() })
        return { type: 'tree', collections: await deps.collections.list() }
      }
```
- Add the new cases (before `default`):
```ts
      case 'openRequest':
        return { type: 'openInEditor', request: msg.request }
      case 'loadWorkspaces':
        return await wsSnapshot()
      case 'createWorkspace':
        await deps.workspaces.create(msg.name)
        return await wsSnapshot()
      case 'renameWorkspace':
        await deps.workspaces.rename(msg.id, msg.name)
        return await wsSnapshot()
      case 'setActiveWorkspace':
        deps.setActiveWorkspaceId(msg.id)
        return await wsSnapshot()
      case 'deleteWorkspace': {
        await deps.workspaces.delete(msg.id)
        if (deps.getActiveWorkspaceId() === msg.id) {
          const remaining = await deps.workspaces.list()
          const fallback = remaining[0] ?? (await deps.workspaces.create('Default'))
          deps.setActiveWorkspaceId(fallback.id)
          // reassign orphaned collections to the fallback workspace
          for (const c of await deps.collections.list()) {
            if (c.workspaceId === msg.id) await deps.collections.saveCollection({ ...c, workspaceId: fallback.id })
          }
        }
        return await wsSnapshot()
      }
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS; tsc clean (panel.ts still needs the workspace deps — it will be updated in Task 10; if tsc flags panel.ts, add the workspace deps there now with a temporary WorkspaceStore + globalState wiring mirroring the env deps, since Task 10 finalizes panel anyway). Ensure tsc is green before committing.

- [ ] **Step 5: Commit**

```bash
git add src/extension/messaging.ts src/extension/panel.ts test/extension/messaging.test.ts
git commit -m "feat: workspace routes, workspace-stamped collections, openRequest"
```

---

## Task 5: Hub — dispatch + broadcast

**Files:**
- Create: `src/extension/hub.ts`
- Test: `test/extension/hub.test.ts`

**Interfaces:**
- Consumes: the router (`route: (msg) => Promise<HostMessage | undefined>`), and state accessors for broadcasting.
- Produces `Hub`:
  - `constructor(route, snapshot: () => Promise<HostMessage[]>)` where `snapshot()` returns the fresh broadcast messages (`tree` filtered, `environments`, `workspaces`, `history`).
  - `register(id: 'editor' | 'sidebar', post: (m: HostMessage) => void): () => void` — track a sink, returns an unregister fn.
  - `dispatch(fromId: 'editor' | 'sidebar', msg: WebviewMessage): Promise<void>` — runs the router; routes the reply: `response`/`pickedFile` → `fromId`; `openInEditor` → the `editor` sink; state-type replies (`tree`/`environments`/`workspaces`/`history`) ignored (covered by snapshot); then posts every `snapshot()` message to ALL sinks.

- [ ] **Step 1: Write the failing test**

`test/extension/hub.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { Hub } from '../../src/extension/hub'
import type { HostMessage, WebviewMessage } from '../../src/shared/types'

const snapshot = async (): Promise<HostMessage[]> => ([
  { type: 'tree', collections: [] },
  { type: 'environments', environments: [], activeId: null },
  { type: 'workspaces', workspaces: [], activeId: 'w1' },
  { type: 'history', entries: [] },
])

function setup(route: (m: WebviewMessage) => Promise<HostMessage | undefined>) {
  const hub = new Hub(route, snapshot)
  const editor: HostMessage[] = []
  const sidebar: HostMessage[] = []
  hub.register('editor', (m) => editor.push(m))
  hub.register('sidebar', (m) => sidebar.push(m))
  return { hub, editor, sidebar }
}

describe('Hub', () => {
  it('broadcasts the state snapshot to both surfaces after any dispatch', async () => {
    const { hub, editor, sidebar } = setup(async () => undefined)
    await hub.dispatch('sidebar', { type: 'loadWorkspaces' })
    expect(editor.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
    expect(sidebar.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
  })
  it('sends a response reply only to the sender', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const { editor, sidebar, hub } = setup(async () => resp)
    await hub.dispatch('editor', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(editor[0]).toEqual(resp)               // targeted to sender first
    expect(sidebar.find((m) => m.type === 'response')).toBeUndefined()
  })
  it('routes openInEditor to the editor even when the sidebar sent openRequest', async () => {
    const oie: HostMessage = { type: 'openInEditor', request: {} as any }
    const { editor, sidebar, hub } = setup(async () => oie)
    await hub.dispatch('sidebar', { type: 'openRequest', request: {} as any })
    expect(editor.find((m) => m.type === 'openInEditor')).toEqual(oie)
    expect(sidebar.find((m) => m.type === 'openInEditor')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/hub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/extension/hub.ts`:
```ts
import type { HostMessage, WebviewMessage } from '../shared/types'

type SurfaceId = 'editor' | 'sidebar'
type Sink = (m: HostMessage) => void

export class Hub {
  private readonly sinks = new Map<SurfaceId, Sink>()
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
  ) {}

  register(id: SurfaceId, post: Sink): () => void {
    this.sinks.set(id, post)
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id) }
  }

  private postTo(id: SurfaceId, m: HostMessage) { this.sinks.get(id)?.(m) }
  private broadcast(m: HostMessage) { for (const s of this.sinks.values()) s(m) }

  async dispatch(fromId: SurfaceId, msg: WebviewMessage): Promise<void> {
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor') this.postTo('editor', reply)
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/hub.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/extension/hub.ts test/extension/hub.test.ts
git commit -m "feat: Hub dispatch with targeted replies and state broadcast"
```

---

## Task 6: Webview store — workspaces slice

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append)

**Interfaces:**
- Produces: state `workspaces: Workspace[]` (init `[]`), `activeWorkspaceId: string | null` (init `null`); action `setWorkspaces(list, activeId)`; cleared in `__reset`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('store workspaces slice', () => {
  it('setWorkspaces sets list + active and __reset clears them', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }], 'w1')
    expect(useStore.getState().workspaces).toHaveLength(1)
    expect(useStore.getState().activeWorkspaceId).toBe('w1')
    useStore.getState().__reset()
    expect(useStore.getState().workspaces).toEqual([])
    expect(useStore.getState().activeWorkspaceId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/state/store.ts`: import `Workspace`; add to `State`:
```ts
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  setWorkspaces(list: Workspace[], activeId: string | null): void
```
Add to the store body:
```ts
  workspaces: [],
  activeWorkspaceId: null,
  setWorkspaces: (workspaces, activeWorkspaceId) => set({ workspaces, activeWorkspaceId }),
```
Add `workspaces: [], activeWorkspaceId: null` to `__reset` (keep all existing fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: webview store workspaces slice"
```

---

## Task 7: WorkspaceSwitcher + History components; Sidebar request click posts openRequest

**Files:**
- Create: `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx`
- Create: `src/webview/components/History/History.tsx`
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/WorkspaceSwitcher.test.tsx`, `test/webview/History.test.tsx`, `test/webview/Sidebar.test.tsx` (adjust)

**Interfaces:**
- `<WorkspaceSwitcher/>` — a `<select aria-label="active workspace">` of `workspaces` (value = `activeWorkspaceId`); change posts `setActiveWorkspace`; a "New Workspace" button posts `createWorkspace`.
- `<History/>` — renders `useStore(s => s.history)` as clickable entries that post `openRequest{request}`.
- `Sidebar` — a request click now posts `{type:'openRequest', request}` instead of opening a local tab.

- [ ] **Step 1: Write the failing tests**

`test/webview/WorkspaceSwitcher.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WorkspaceSwitcher } from '../../src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('WorkspaceSwitcher', () => {
  it('lists workspaces and reflects the active one', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    expect((screen.getByLabelText(/active workspace/i) as HTMLSelectElement).value).toBe('w2')
  })
  it('changing posts setActiveWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.change(screen.getByLabelText(/active workspace/i), { target: { value: 'w2' } })
    expect(posted).toContainEqual({ type: 'setActiveWorkspace', id: 'w2' })
  })
  it('New Workspace posts createWorkspace', () => {
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }))
    expect(posted).toContainEqual({ type: 'createWorkspace', name: 'New Workspace' })
  })
})
```

`test/webview/History.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { History } from '../../src/webview/components/History/History'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('History', () => {
  it('renders entries and clicking posts openRequest', () => {
    const request = { id: newId(), name: 'H', method: 'GET' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setHistory([{ id: 'h1', request, status: 200, at: 1 }])
    render(<History />)
    fireEvent.click(screen.getByText('GET https://api/h'))
    expect(posted).toContainEqual({ type: 'openRequest', request })
  })
})
```

For `test/webview/Sidebar.test.tsx`: update the existing "opens a request as a tab on click" test — it now asserts an `openRequest` post instead of a local tab. Replace its body:
```ts
  it('lists collections and posts openRequest when a request is clicked', () => {
    const request = { id: newId(), name: 'Get Users', method: 'GET' as const, url: 'https://api/users', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    expect(screen.getByText('My Coll')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Get Users'))
    expect(posted).toContainEqual({ type: 'openRequest', request })
  })
```
(Ensure the Sidebar test mocks `ipc` with a `posted` capture; it already does from Phase 3 Task 10.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/WorkspaceSwitcher.test.tsx test/webview/History.test.tsx test/webview/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  return (
    <div className="rm-row">
      <select className="rm-select" aria-label="active workspace" value={activeWorkspaceId ?? ''}
        onChange={(e) => postToHost({ type: 'setActiveWorkspace', id: e.target.value })}>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <button className="rm-btn" onClick={() => postToHost({ type: 'createWorkspace', name: 'New Workspace' })}>+ New Workspace</button>
    </div>
  )
}
```

`src/webview/components/History/History.tsx`:
```tsx
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function History() {
  const history = useStore((s) => s.history)
  return (
    <div className="rm-panel">
      <strong>History</strong>
      <ul>
        {history.map((e) => (
          <li key={e.id}>
            <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: e.request })}>
              {e.request.method} {e.request.url}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

In `src/webview/components/Sidebar/Sidebar.tsx`: replace the `openRequest`/`openNewTab`+`updateActive` local-open logic used on request click with a `postToHost({ type: 'openRequest', request: r })` call. Remove the now-unused `openNewTab`/`updateActive` from this component if they were only used for opening (leave the collection-tree rendering, create/import/export controls intact). If the Sidebar previously rendered an inline History section, remove it here (History is now its own component mounted by SidebarApp).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/WorkspaceSwitcher.test.tsx test/webview/History.test.tsx test/webview/Sidebar.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/WorkspaceSwitcher src/webview/components/History src/webview/components/Sidebar/Sidebar.tsx test/webview/WorkspaceSwitcher.test.tsx test/webview/History.test.tsx test/webview/Sidebar.test.tsx
git commit -m "feat: workspace switcher, history component, sidebar opens via openRequest"
```

---

## Task 8: SidebarApp

**Files:**
- Create: `src/webview/sidebar/SidebarApp.tsx`
- Create: `src/webview/sidebar/index.tsx`
- Test: `test/webview/SidebarApp.test.tsx`

**Interfaces:**
- Produces `<SidebarApp/>` composing `WorkspaceSwitcher`, `Sidebar` (collections + import/export), `Environments`, `History`; on mount posts `ready`, `loadHistory`, `loadEnvironments`, `loadWorkspaces`; subscribes to host messages and applies: `tree` → setTree; `environments` → setEnvironments+setActiveEnvId; `workspaces` → setWorkspaces; `history` → setHistory. Ignores editor-only messages. Imports `theme.css`.

- [ ] **Step 1: Write the failing test**

`test/webview/SidebarApp.test.tsx`:
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
import { SidebarApp } from '../../src/webview/sidebar/SidebarApp'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('SidebarApp', () => {
  it('requests state on mount and applies workspaces + tree', () => {
    render(<SidebarApp />)
    expect(posted.some((m) => m.type === 'loadWorkspaces')).toBe(true)
    act(() => {
      handler?.({ type: 'workspaces', workspaces: [{ id: 'w1', name: 'Default' }], activeId: 'w1' })
      handler?.({ type: 'tree', collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }] })
    })
    expect(useStore.getState().workspaces).toHaveLength(1)
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/SidebarApp.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/webview/sidebar/SidebarApp.tsx`:
```tsx
import { useEffect } from 'react'
import '../theme.css'
import { useStore } from '../state/store'
import { onHostMessage, postToHost } from '../ipc'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher/WorkspaceSwitcher'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { Environments } from '../components/Environments/Environments'
import { History } from '../components/History/History'

export function SidebarApp() {
  const setTree = useStore((s) => s.setTree)
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)
  const setWorkspaces = useStore((s) => s.setWorkspaces)
  const setHistory = useStore((s) => s.setHistory)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'environments') { setEnvironments(m.environments); setActiveEnvId(m.activeId) }
      else if (m.type === 'workspaces') setWorkspaces(m.workspaces, m.activeId)
      else if (m.type === 'history') setHistory(m.entries)
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadWorkspaces' })
    postToHost({ type: 'loadEnvironments' })
    postToHost({ type: 'loadHistory' })
    return off
  }, [setTree, setEnvironments, setActiveEnvId, setWorkspaces, setHistory])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <WorkspaceSwitcher />
      <Sidebar />
      <Environments />
      <History />
    </div>
  )
}
```

`src/webview/sidebar/index.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { SidebarApp } from './SidebarApp'
const el = document.getElementById('root')
if (el) createRoot(el).render(<SidebarApp />)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/SidebarApp.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar test/webview/SidebarApp.test.tsx
git commit -m "feat: SidebarApp surface composition"
```

---

## Task 9: EditorApp

**Files:**
- Create: `src/webview/editor/EditorApp.tsx`
- Create: `src/webview/editor/index.tsx`
- Test: `test/webview/EditorApp.test.tsx`
- Remove: `src/webview/App.tsx`, `test/webview/App.test.tsx`

**Interfaces:**
- Produces `<EditorApp/>` composing `EnvDropdown` (top bar), `Tabs`, `RequestPanel`, `ResponsePanel`; on mount posts `ready`, `loadEnvironments`; subscribes and applies: `response` → setResponse; `tree` → setTree (for Save-to-collection); `environments` → setEnvironments+setActiveEnvId; `openInEditor` → openNewTab + updateActive from the request; `pickedFile` → apply to the pending form-data row (moved from old App). Imports `theme.css`.

- [ ] **Step 1: Write the failing test**

`test/webview/EditorApp.test.tsx` (port the old App.test cases that concern the editor + add openInEditor):
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
let handler: ((m: any) => void) | undefined
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: (cb: (m: any) => void) => { handler = cb; return () => { handler = undefined } },
}))
import { EditorApp } from '../../src/webview/editor/EditorApp'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('EditorApp', () => {
  it('posts ready + loadEnvironments on mount', () => {
    render(<EditorApp />)
    expect(posted.some((m) => m.type === 'ready')).toBe(true)
    expect(posted.some((m) => m.type === 'loadEnvironments')).toBe(true)
  })
  it('openInEditor opens a tab populated from the request', () => {
    render(<EditorApp />)
    act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'POST', url: 'https://api/z', params: [], headers: [], body: { mode: 'none' } } }))
    const s = useStore.getState()
    const active = s.tabs.find((t) => t.id === s.activeTabId)!
    expect(active.url).toBe('https://api/z'); expect(active.method).toBe('POST')
  })
  it('routes a response into the active tab store', () => {
    useStore.getState().openNewTab()
    const id = useStore.getState().tabs[0].id
    render(<EditorApp />)
    act(() => handler?.({ type: 'response', requestId: id, payload: { status: 201, statusText: 'Created', headers: [], body: 'ok', bodyTruncated: false, timeMs: 3, sizeBytes: 2, cookies: [] } }))
    expect(useStore.getState().responses[id]?.status).toBe(201)
  })
  it('applies a pickedFile to the pending form-data row', () => {
    useStore.getState().openNewTab()
    const tabId = useStore.getState().tabs[0].id
    useStore.getState().updateActive({ body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: '', path: '', enabled: true }] } })
    useStore.getState().setPendingFilePick({ tabId, index: 0 })
    render(<EditorApp />)
    act(() => handler?.({ type: 'pickedFile', path: '/tmp/a.png', filename: 'a.png' }))
    const item = (useStore.getState().tabs[0].body as any).items[0]
    expect(item).toMatchObject({ path: '/tmp/a.png', filename: 'a.png' })
    expect(useStore.getState().pendingFilePick).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/EditorApp.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/webview/editor/EditorApp.tsx`:
```tsx
import { useEffect } from 'react'
import '../theme.css'
import { useStore } from '../state/store'
import { onHostMessage, postToHost } from '../ipc'
import { EnvDropdown } from '../components/EnvDropdown/EnvDropdown'
import { Tabs } from '../components/Tabs/Tabs'
import { RequestPanel } from '../components/RequestPanel/RequestPanel'
import { ResponsePanel } from '../components/ResponsePanel/ResponsePanel'

export function EditorApp() {
  const setTree = useStore((s) => s.setTree)
  const setResponse = useStore((s) => s.setResponse)
  const setEnvironments = useStore((s) => s.setEnvironments)
  const setActiveEnvId = useStore((s) => s.setActiveEnvId)
  const openNewTab = useStore((s) => s.openNewTab)
  const updateActive = useStore((s) => s.updateActive)

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === 'tree') setTree(m.collections)
      else if (m.type === 'environments') { setEnvironments(m.environments); setActiveEnvId(m.activeId) }
      else if (m.type === 'response') setResponse(m.requestId, m.payload)
      else if (m.type === 'openInEditor') {
        const r = m.request
        openNewTab()
        updateActive({ name: r.name, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body })
      } else if (m.type === 'pickedFile') {
        const st = useStore.getState()
        const pending = st.pendingFilePick
        if (pending) {
          const tab = st.tabs.find((t) => t.id === pending.tabId)
          if (tab && tab.body.mode === 'formdata') {
            const items = tab.body.items.map((it, i) =>
              i === pending.index && it.kind === 'file' ? { ...it, path: m.path, filename: m.filename } : it)
            st.setTabBody(pending.tabId, { mode: 'formdata', items })
          }
          st.setPendingFilePick(null)
        }
      }
    })
    postToHost({ type: 'ready' })
    postToHost({ type: 'loadEnvironments' })
    return off
  }, [setTree, setResponse, setEnvironments, setActiveEnvId, openNewTab, updateActive])

  return (
    <div className="rm-row" style={{ alignItems: 'stretch', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="rm-row" style={{ justifyContent: 'flex-end', padding: '4px 8px' }}>
          <EnvDropdown />
        </div>
        <Tabs />
        <RequestPanel />
        <ResponsePanel />
      </div>
    </div>
  )
}
```
Note: `setTabBody` was added in Phase-3 Task 12's plan — if it does not exist in the store yet, add it now:
```ts
  setTabBody: (tabId, body) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, body } : t)) })),
```
(with the matching `setTabBody(tabId: string, body: RestRequest['body']): void` in the `State` type).

`src/webview/editor/index.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'
const el = document.getElementById('root')
if (el) createRoot(el).render(<EditorApp />)
```

Delete `src/webview/App.tsx` and `test/webview/App.test.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/EditorApp.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean (App.tsx removed).

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor test/webview/EditorApp.test.tsx
git rm src/webview/App.tsx test/webview/App.test.tsx
git commit -m "feat: EditorApp surface; remove combined App"
```

---

## Task 10: Two Vite bundles + host providers + package.json

**Files:**
- Modify: `vite.config.ts`, `src/extension/panel.ts`, `src/extension/extension.ts`, `package.json`
- Create: `src/extension/sidebar-view.ts`
- Test: `test/extension/sidebar-view.test.ts`

**Interfaces:**
- `vite.config.ts` emits `media/editor.js` and `media/sidebar.js`.
- `panel.ts`: loads `editor.js`/`editor.css`, registers its webview with the shared `Hub` as `'editor'`, forwards messages via `hub.dispatch('editor', msg)`, and is revealed when an `openInEditor` is routed (the panel provider reveals on that). It also builds the router+Hub (shared) if not already built by a small host bootstrap.
- `sidebar-view.ts`: `SidebarViewProvider implements vscode.WebviewViewProvider` for `restman.sidebar`; loads `sidebar.js`/`sidebar.css`; registers with the Hub as `'sidebar'`; forwards via `hub.dispatch('sidebar', msg)`. Exposes a pure `buildSidebarHtml(scriptUri, styleUri, cspSource, nonce)` (unit-tested).
- Shared host bootstrap: build stores (Collection/Environment/History/Workspace), ensure a Default workspace exists and an active workspace id is set, construct the router with ALL deps (env + io + workspace), and a `snapshot()` that returns `[tree(filtered by active workspace), environments, workspaces, history]`. The Hub is a singleton shared by both providers.

- [ ] **Step 1: Write the failing test (pure HTML builder)**

`test/extension/sidebar-view.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildSidebarHtml } from '../../src/extension/sidebar-view'

describe('buildSidebarHtml', () => {
  it('embeds script + style with a strict CSP and a classic script', () => {
    const html = buildSidebarHtml('https://cdn/sidebar.js', 'https://cdn/sidebar.css', 'vscode-webview://x', 'ABC')
    expect(html).toContain('https://cdn/sidebar.js')
    expect(html).toContain('https://cdn/sidebar.css')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('nonce="ABC"')
    expect(html).not.toContain('type="module"')
    expect(html).toContain('<div id="root">')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sidebar-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — vite.config.ts (two entries)**

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
      input: {
        editor: 'src/webview/editor/index.tsx',
        sidebar: 'src/webview/sidebar/index.tsx',
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
})
```

- [ ] **Step 4: Implement — a shared host bootstrap + Hub, providers**

Create the bootstrap inside `panel.ts` (or a small `host.ts`; the plan keeps it in `panel.ts` for brevity) exposing a singleton getter used by both providers:
```ts
// in panel.ts (module scope)
import { Hub } from './hub'
import { WorkspaceStore } from './workspace-store'
import type { HostMessage } from '../shared/types'

let hubSingleton: Hub | undefined
async function ensureBootstrap(context: vscode.ExtensionContext): Promise<Hub> {
  if (hubSingleton) return hubSingleton
  const base = context.globalStorageUri.fsPath
  const collections = new CollectionStore(base)
  const environments = new EnvironmentStore(base)
  const history = new HistoryStore(base)
  const workspaces = new WorkspaceStore(base)

  // ensure a Default workspace + active id
  let list = await workspaces.list()
  if (list.length === 0) { const def = await workspaces.create('Default'); list = [def] }
  if (!context.globalState.get<string>('restman.activeWorkspaceId')) {
    await context.globalState.update('restman.activeWorkspaceId', list[0].id)
  }

  const route = createRouter({
    send: sendRequest, collections, history, environments,
    getActiveEnvId: () => context.globalState.get<string | null>('restman.activeEnvId', null),
    setActiveEnvId: (id) => { void context.globalState.update('restman.activeEnvId', id) },
    workspaces,
    getActiveWorkspaceId: () => context.globalState.get<string>('restman.activeWorkspaceId', '') as string,
    setActiveWorkspaceId: (id) => { void context.globalState.update('restman.activeWorkspaceId', id) },
    openImport: /* existing openImport impl */ undefined as any,
    runExport: /* existing runExport impl */ undefined as any,
    pickFile: /* existing pickFile impl */ undefined as any,
  })
  const snapshot = async (): Promise<HostMessage[]> => {
    const ws = context.globalState.get<string>('restman.activeWorkspaceId', '')
    const cols = (await collections.list()).filter((c) => (c.workspaceId || ws) === ws)
    return [
      { type: 'tree', collections: cols },
      { type: 'environments', environments: await environments.list(), activeId: context.globalState.get<string | null>('restman.activeEnvId', null) },
      { type: 'workspaces', workspaces: await workspaces.list(), activeId: ws },
      { type: 'history', entries: await history.list() },
    ]
  }
  hubSingleton = new Hub(route, snapshot)
  return hubSingleton
}
export { ensureBootstrap }
```
Move the existing `openImport`/`runExport`/`pickFile` dialog impls (from Phase-3 Task 8, currently inline in the panel constructor) into `ensureBootstrap` so both surfaces share them. The old per-panel `createRouter({...})` in the `RestmanPanel` constructor is replaced by registering with the shared Hub.

`RestmanPanel` (editor) constructor now: builds html from `editor.js`/`editor.css`, gets the Hub via `ensureBootstrap`, `const unregister = hub.register('editor', (m) => panel.webview.postMessage(m))`, and `panel.webview.onDidReceiveMessage((msg) => hub.dispatch('editor', msg))`; on dispose call `unregister()`. Also add a way for the Hub to reveal this panel on `openInEditor`: simplest — the panel provider stores a static `revealEditor()` and the Hub calls it before/when routing `openInEditor`. Concretely: pass a `revealEditor: () => void` into `ensureBootstrap`/Hub, OR have `RestmanPanel.createOrShow` be invoked by the Hub. Keep it simple: give the Hub an optional `onOpenInEditor?: () => void` hook set by the panel provider; the Hub calls it right before posting `openInEditor`. Add that hook to the Hub (a setter `setEditorReveal(fn)`) and call it in the `openInEditor` branch.

`src/extension/sidebar-view.ts`:
```ts
import * as vscode from 'vscode'
import { ensureBootstrap } from './panel'
import type { WebviewMessage } from '../shared/types'

function nonce(): string { return require('node:crypto').randomBytes(16).toString('hex') }

export function buildSidebarHtml(scriptUri: string, styleUri: string, cspSource: string, n: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
<link rel="stylesheet" href="${styleUri}" /></head>
<body><div id="root"></div><script nonce="${n}" src="${scriptUri}"></script></body></html>`
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}
  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] }
    const scriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js')).toString()
    const styleUri = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css')).toString()
    view.webview.html = buildSidebarHtml(scriptUri, styleUri, view.webview.cspSource, nonce())
    const hub = await ensureBootstrap(this.context)
    const unregister = hub.register('sidebar', (m) => view.webview.postMessage(m))
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => { void hub.dispatch('sidebar', msg) })
    view.onDidDispose(() => unregister())
  }
}
```

`src/extension/extension.ts`:
```ts
import * as vscode from 'vscode'
import { RestmanPanel } from './panel'
import { SidebarViewProvider } from './sidebar-view'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => { RestmanPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('restman.sidebar', new SidebarViewProvider(context)),
  )
}
export function deactivate() {}
```
(Remove the old `LaunchViewProvider` and its registration.)

`package.json` — replace the `views` block's tree view with a webview view and drop `viewsWelcome`:
```json
    "views": {
      "restman": [
        { "id": "restman.sidebar", "name": "restman", "type": "webview" }
      ]
    }
```
(Keep `viewsContainers.activitybar` with the icon; remove the `viewsWelcome` entry.)

- [ ] **Step 5: Run tests + full build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS; tsc clean; `npm run build` emits `media/editor.js`, `media/editor.css`, `media/sidebar.js`, `media/sidebar.css`, and `dist/extension.js`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: two webview bundles, sidebar view provider, shared Hub host"
```

---

## Task 11: Finish curl controls in RequestPanel (paused Phase-3 Task 11)

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx` (append)

**Interfaces:**
- Adds a "Copy as cURL" button (`toCurl(active)` → `navigator.clipboard.writeText`) and an "Import from cURL" control (a textarea `aria-label="curl command"` + button that runs `parseCurl` and applies it to a new tab).

- [ ] **Step 1: Write the failing test (append)**

```ts
it('Copy as cURL writes the request as a curl command to the clipboard', () => {
  const writeText = vi.fn()
  Object.assign(navigator, { clipboard: { writeText } })
  useStore.getState().updateActive({ method: 'GET', url: 'https://api.test/x' })
  render(<RequestPanel />)
  fireEvent.click(screen.getByRole('button', { name: /copy as curl/i }))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`curl -X GET 'https://api.test/x'`))
})
it('Import from cURL creates a new tab from the pasted command', () => {
  render(<RequestPanel />)
  fireEvent.change(screen.getByLabelText(/curl command/i), { target: { value: 'curl -X POST https://api.test/y' } })
  fireEvent.click(screen.getByRole('button', { name: /import from curl/i }))
  const s = useStore.getState(); const active = s.tabs.find((t) => t.id === s.activeTabId)!
  expect(active.url).toBe('https://api.test/y'); expect(active.method).toBe('POST')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `RequestPanel.tsx`, add imports `import { useState } from 'react'` (if absent) and `import { parseCurl, toCurl } from '../../curl'`; add `const [curlText, setCurlText] = useState('')` and `const openNewTab = useStore((s) => s.openNewTab)`; render a curl row:
```tsx
      <div className="rm-row">
        <button className="rm-btn" onClick={() => { void navigator.clipboard.writeText(toCurl(active)) }}>Copy as cURL</button>
        <input className="rm-input" aria-label="curl command" placeholder="Paste curl command" value={curlText}
          onChange={(e) => setCurlText(e.target.value)} />
        <button className="rm-btn" onClick={() => { const p = parseCurl(curlText); openNewTab(); update(p); setCurlText('') }}>Import from cURL</button>
      </div>
```
(`update` is the existing `updateActive` selector.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat: copy-as-curl and import-from-curl in the editor"
```

---

## Task 12: Manual smoke — new layout + workspaces end-to-end

**Files:**
- Create: `docs/superpowers/plans/layout-smoke-checklist.md`

**Interfaces:**
- Consumes: the full built extension. No automated test — F5 gate.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build (editor.js + sidebar.js).

- [ ] **Step 2: Write the smoke checklist**

`docs/superpowers/plans/layout-smoke-checklist.md`:
```markdown
# Layout Refactor + Workspaces Smoke Checklist

Press F5 → click the restman icon in the Activity Bar (left).

- [ ] The restman sidebar opens as a panel showing: Workspace switcher, Collections (Import/Export), Environments, History.
- [ ] A Default workspace exists and is selected.
- [ ] "New Workspace" creates one; switching the workspace changes which collections are listed.
- [ ] Create a collection in workspace A; switch to workspace B → it is not listed; switch back → it is.
- [ ] Click a request in the sidebar tree → the editor panel opens (or focuses) with that request in a tab.
- [ ] In the editor: set method/url, Send → response shows; the sidebar History updates with the sent request.
- [ ] Click a History entry → opens it in the editor.
- [ ] Save a request into a collection from the editor → it appears in the sidebar tree (same workspace).
- [ ] Environment dropdown in the editor top bar switches the active env; `{{var}}` resolves on Send.
- [ ] Import a Postman collection from the sidebar → it lands in the active workspace.
- [ ] Theme follows VS Code light/dark in both surfaces.
```

- [ ] **Step 3: Manually run the checklist**

Press F5, follow it, check every box. Fix failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/layout-smoke-checklist.md
git commit -m "chore: layout refactor + workspaces smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** Workspace model + workspaceId (Task 1); WorkspaceStore (2); workspace-stamped collection create (3); router workspace routes + openRequest + stamping + delete-active reassignment (4); Hub broadcast/targeted routing (5); store workspaces slice (6); WorkspaceSwitcher + History + sidebar-opens-via-openRequest (7); SidebarApp (8); EditorApp incl. openInEditor + pickedFile (9); two Vite bundles + sidebar-view provider + shared Hub bootstrap + Default-workspace bootstrap + package.json webview view (10); curl controls (11); manual e2e (12).
- **Two-surface topology:** sidebar WebviewView + editor WebviewPanel, each own bundle/store instance; Hub broadcasts `tree`(filtered)/`environments`/`workspaces`/`history` to both after any action; targeted `response`/`pickedFile`/`openInEditor`. Editor reveal on openInEditor via the Hub's editor-reveal hook.
- **Type consistency:** `Workspace`, `Collection.workspaceId`, and the new arms match between Task 1 and consumers (router 4, Hub 5, store 6, components 7-9). `createCollection(name, workspaceId)` (3) matches the router call (4). `snapshot()` message shapes (10) match the store setters (6, 8, 9).
- **Paused Phase-3 items:** curl finished in Task 11; picked-file handling folded into EditorApp (Task 9). The Phase-3 smoke checklist items are superseded by this layout checklist for the moved UI.
- **Deferred:** env/history workspace-scoping, drag-drop, folder hierarchy, moving collections between workspaces — all non-goals.
