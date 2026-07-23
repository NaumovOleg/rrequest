# Drive Sync — DS-Phase 5b-core: Extension Role Enforcement + Member Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the restman extension honor the DS-Phase-5a sharing backend: fetch/add/remove members via `SyncClient`, record each workspace's role from the server, block a **viewer** from mutating a synced workspace locally (before any round-trip), and gracefully drop sync (keep the local copy) when a push/pull comes back **403** (member removed or downgraded). This is the logic/enforcement half; the visual Members panel + switcher polish + role badges/toasts rendering are DS-Phase 5b-ui (a separate plan).

**Architecture:** `SyncClient` gains member CRUD + a typed `SyncForbiddenError` thrown on any 403; `RemoteWorkspace`/`pull` carry the caller's `role`. `SyncManager` records the role into the existing `sync-state` (`role` field already exists), adds `refreshRoles()`, and — catching `SyncForbiddenError` in push/pull/refresh — marks the workspace `synced: false` (local copy retained). The host router (`messaging.ts`) gains an injectable `isReadOnly(workspaceId)` predicate and, reusing the existing `isMutating` set, short-circuits a mutating message on a read-only (viewer) active workspace with a `toast` reply instead of applying it. `panel.ts` supplies the real `isReadOnly` from a role cache kept in the sync runtime and attaches each synced workspace's `role` to the `workspaces` snapshot so DS-Phase-5b-ui can badge/disable.

**Tech Stack:** Extension side — TypeScript, VS Code API, vitest. No backend changes (DS-Phase 5a is the server half).

## Global Constraints

- Extension holds only the app-session JWT (SecretStorage); all sharing calls go through the backend via `SyncClient` (never Google directly).
- **Roles:** `owner` | `editor` | `viewer`. Viewer = read-only: the extension blocks local mutations to a viewer workspace AND the backend already rejects a viewer `PUT` (DS-Phase 5a). This task adds the extension half.
- **403 = access lost/reduced:** a 403 from push/pull/list means the user was removed or downgraded; the extension drops sync for that workspace (`synced: false`) but **keeps the local data** (never deletes local collections/environments).
- **Local-first:** blocking a viewer mutation or dropping sync must never lose or corrupt local data; a read-only block is a no-op + a toast, not a destructive revert of stored data.
- Reuse existing modules: `SyncClient`, `SyncManager`, `SyncStateStore` (`SyncState.role` already exists), `messaging.ts` router (`RouterDeps`), `isMutating` from `sync-runtime.ts`, the Hub snapshot, `src/shared/types.ts` message unions.
- Member shape mirrors the DS-Phase-5a `GET /workspaces/:id/members` response: `{ id?: string; email: string; role: 'owner'|'editor'|'viewer'; pending: boolean }` (owner entry has no `id`).

---

### Task 1: `SyncClient` — member CRUD, role fields, `SyncForbiddenError`

**Files:**
- Modify: `src/extension/sync/sync-client.ts`
- Test: `test/extension/sync/sync-client.test.ts` (extend)

**Interfaces:**
- Produces:
  - `class SyncForbiddenError extends Error` (constructor sets `name = 'SyncForbiddenError'`).
  - `type WorkspaceRole = 'owner' | 'editor' | 'viewer'`
  - `type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }`
  - `RemoteWorkspace` gains `role?: WorkspaceRole`.
  - `pull(id)` return type becomes `{ snapshot: string; revision: string; role?: WorkspaceRole }`.
  - `listMembers(id: string): Promise<Member[]>` (GET `/workspaces/:id/members` → `{members}` → the array).
  - `addMember(id: string, input: { email: string; role: 'editor' | 'viewer' }): Promise<Member>` (POST `/workspaces/:id/members`).
  - `removeMember(id: string, memberId: string): Promise<void>` (DELETE `/workspaces/:id/members/:memberId`).
  - `call()` throws `SyncForbiddenError` on HTTP 403 (before the generic failure throw); `push()` likewise returns/throws — specifically `push` throws `SyncForbiddenError` on 403 (it keeps its 409 → conflict `PushResult` special-case).

- [ ] **Step 1: Add failing tests** — append to `test/extension/sync/sync-client.test.ts`

```ts
import { SyncForbiddenError } from '../../../src/extension/sync/sync-client'

describe('SyncClient members + 403', () => {
  it('listMembers GETs the members array', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members')
      expect(init.method ?? 'GET').toBe('GET')
      return { status: 200, body: { members: [{ email: 'o@x.com', role: 'owner', pending: false }, { id: 'm1', email: 'e@x.com', role: 'editor', pending: false }] } }
    })
    const list = await client(f).listMembers('w1')
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ id: 'm1', role: 'editor' })
  })
  it('addMember POSTs email+role and returns the member', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ email: 'n@x.com', role: 'viewer' })
      return { status: 201, body: { id: 'm2', email: 'n@x.com', role: 'viewer', pending: true } }
    })
    expect(await client(f).addMember('w1', { email: 'n@x.com', role: 'viewer' })).toMatchObject({ id: 'm2', pending: true })
  })
  it('removeMember DELETEs the member', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members/m1')
      expect(init.method).toBe('DELETE')
      return { status: 200, body: { ok: true } }
    })
    await client(f).removeMember('w1', 'm1')
  })
  it('a 403 on a GET throws SyncForbiddenError', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).pull('w1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
  it('a 403 on push throws SyncForbiddenError', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).push('w1', '{}', '1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
})
```

(Use the file's existing `fetchMock`/`client` helpers. If `fetchMock`'s response builder needs a `json()` — follow how the existing tests construct responses. The exact helper shape is already in the file; match it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: FAIL — `SyncForbiddenError`/`listMembers`/`addMember`/`removeMember` not defined; 403 currently throws a generic Error.

- [ ] **Step 3: Implement in `src/extension/sync/sync-client.ts`**

Add near the top (after the imports / before `RemoteWorkspace`):

```ts
export class SyncForbiddenError extends Error {
  constructor(message = 'forbidden') { super(message); this.name = 'SyncForbiddenError' }
}

export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }
```

Add `role?: WorkspaceRole` to `RemoteWorkspace`.

In `call()`, before the generic `if (!res.ok)` throw, add the 403 branch:

```ts
    if (res.status === 403) throw new SyncForbiddenError()
    if (!res.ok) throw new Error(`sync request failed: ${res.status}`)
```

In `push()`, before the generic `if (!res.ok)` throw (and after the 409 branch), add:

```ts
    if (res.status === 403) throw new SyncForbiddenError()
```

Change `pull`'s return type + add the member methods:

```ts
  pull(id: string): Promise<{ snapshot: string; revision: string; role?: WorkspaceRole }> {
    return this.call(`/workspaces/${id}`)
  }
  async listMembers(id: string): Promise<Member[]> {
    const body = await this.call<{ members: Member[] }>(`/workspaces/${id}/members`)
    return body.members
  }
  addMember(id: string, input: { email: string; role: 'editor' | 'viewer' }): Promise<Member> {
    return this.call(`/workspaces/${id}/members`, { method: 'POST', body: input })
  }
  async removeMember(id: string, memberId: string): Promise<void> {
    await this.call(`/workspaces/${id}/members/${memberId}`, { method: 'DELETE' })
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: PASS (all, including the existing push/conflict tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-client.ts test/extension/sync/sync-client.test.ts
git commit -m "feat(sync): SyncClient member CRUD + role + SyncForbiddenError"
```

---

### Task 2: `SyncManager` — record role on pull + `refreshRoles()`

**Files:**
- Modify: `src/extension/sync/sync-manager.ts`
- Test: `test/extension/sync/sync-manager.test.ts` (extend)

**Interfaces:**
- Consumes: `SyncClient.pull` (now returns `role?`), `SyncClient.listWorkspaces` (each item now carries `role?`), `SyncStateStore` (`SyncState.role`).
- Produces:
  - `pull(workspaceId)` writes the pulled `role` into `sync-state` when present (`role: pulled.role ?? state.role`).
  - `refreshRoles(): Promise<void>` — `client.listWorkspaces()`; for each returned workspace that is locally synced, update its `sync-state.role` to the server's role.

- [ ] **Step 1: Add failing tests** — extend `test/extension/sync/sync-manager.test.ts`

```ts
  it('pull records the role returned by the server', async () => {
    const client = { pull: vi.fn(async () => ({ snapshot: JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [], environments: [], updatedAt: 1, updatedBy: 'x' }), revision: '5', role: 'viewer' })), push: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).pull('w1')
    expect((await state.get('w1'))?.role).toBe('viewer')
  })
  it('refreshRoles updates synced workspaces roles from listWorkspaces', async () => {
    const client = { listWorkspaces: vi.fn(async () => [{ id: 'w1', role: 'viewer' }, { id: 'w2', role: 'owner' }]) } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    // w2 not synced locally -> should be ignored
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).refreshRoles()
    expect((await state.get('w1'))?.role).toBe('viewer')
    expect(await state.get('w2')).toBeUndefined()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: FAIL — pull doesn't persist role; `refreshRoles` missing.

- [ ] **Step 3: Update `src/extension/sync/sync-manager.ts`**

In `pull`, change the final `state.set` to persist the role:

```ts
    const { snapshot, revision, role } = await this.deps.client.pull(workspaceId)
```

and the closing set:

```ts
    await this.deps.state.set(workspaceId, { ...state, lastRevision: revision, role: role ?? state.role })
```

Add `refreshRoles`:

```ts
  async refreshRoles(): Promise<void> {
    const remote = await this.deps.client.listWorkspaces()
    for (const w of remote) {
      if (!w.role) continue
      const state = await this.deps.state.get(w.id)
      if (state?.synced) await this.deps.state.set(w.id, { ...state, role: w.role })
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-manager.ts test/extension/sync/sync-manager.test.ts
git commit -m "feat(sync): SyncManager records role on pull + refreshRoles"
```

---

### Task 3: `SyncManager` — drop sync (keep local) on 403

**Files:**
- Modify: `src/extension/sync/sync-manager.ts`
- Test: `test/extension/sync/sync-manager.test.ts` (extend)

**Interfaces:**
- Consumes: `SyncForbiddenError` from `./sync-client`.
- Produces: `push`, `pull`, and `refreshRoles` catch `SyncForbiddenError` for a workspace and mark it `synced: false` (keeping the local `driveFileId`/`role`/`lastRevision` so a re-share can resume) — they do NOT rethrow (the auto-scheduler must not crash), and they NEVER touch the local stores on a 403.

- [ ] **Step 1: Add failing tests** — extend `test/extension/sync/sync-manager.test.ts`

```ts
  it('push drops sync (synced=false) but keeps local data on a 403', async () => {
    const applyPulled = vi.fn()
    const client = { push: vi.fn(async () => { throw new SyncForbiddenError() }), enableSync: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).push('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect((await state.get('w1'))?.driveFileId).toBe('f') // kept for re-share
    expect(applyPulled).not.toHaveBeenCalled() // local data untouched
  })
  it('pull drops sync on a 403 without touching local stores', async () => {
    const applyPulled = vi.fn()
    const client = { pull: vi.fn(async () => { throw new SyncForbiddenError() }), push: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'viewer', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).pull('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect(applyPulled).not.toHaveBeenCalled()
  })
```

Add the import at the top of the test file: `import { SyncForbiddenError } from '../../../src/extension/sync/sync-client'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: FAIL — the 403 currently propagates out of push/pull (rejects), state stays `synced: true`.

- [ ] **Step 3: Update `src/extension/sync/sync-manager.ts`**

Add the import:

```ts
import { SyncForbiddenError } from './sync-client'
```

Add a private helper:

```ts
  private async dropSync(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (state) await this.deps.state.set(workspaceId, { ...state, synced: false })
  }
```

Wrap the bodies of `push`, `pull`, and `refreshRoles` so a `SyncForbiddenError` drops sync instead of propagating. For `push` and `pull`, wrap the existing body in `try { ... } catch (e) { if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return } throw e }`. For `refreshRoles`, wrap the `client.listWorkspaces()` call the same way but a 403 there is a whole-account issue — on `SyncForbiddenError` simply `return` (do not drop a specific workspace). Concretely, `push` becomes:

```ts
  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    try {
      const local = await this.buildLocalSnapshot(workspaceId)
      const first = await this.deps.client.push(workspaceId, JSON.stringify(local), state.lastRevision)
      if (first.ok) { await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision }); return }
      const remote = JSON.parse(first.snapshot) as WorkspaceSnapshot
      const merged = mergeSnapshots(remote, local)
      const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
      await this.deps.stores.applyPulled(workspaceId, merged.collections, mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs))
      const retry = await this.deps.client.push(workspaceId, JSON.stringify(merged), first.revision)
      if (retry.ok) await this.deps.state.set(workspaceId, { ...state, lastRevision: retry.revision })
    } catch (e) {
      if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
      throw e
    }
  }
```

and `pull` becomes:

```ts
  async pull(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    try {
      const { snapshot, revision, role } = await this.deps.client.pull(workspaceId)
      const remote = JSON.parse(snapshot) as WorkspaceSnapshot
      const local = await this.buildLocalSnapshot(workspaceId)
      const merged = mergeSnapshots(remote, local)
      const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
      const environments = mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs)
      await this.deps.stores.applyPulled(workspaceId, merged.collections, environments)
      await this.deps.state.set(workspaceId, { ...state, lastRevision: revision, role: role ?? state.role })
    } catch (e) {
      if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
      throw e
    }
  }
```

and `refreshRoles`:

```ts
  async refreshRoles(): Promise<void> {
    let remote
    try { remote = await this.deps.client.listWorkspaces() }
    catch (e) { if (e instanceof SyncForbiddenError) return; throw e }
    for (const w of remote) {
      if (!w.role) continue
      const state = await this.deps.state.get(w.id)
      if (state?.synced) await this.deps.state.set(w.id, { ...state, role: w.role })
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: PASS (all, incl. Task 2's role tests and the existing conflict/merge tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-manager.ts test/extension/sync/sync-manager.test.ts
git commit -m "feat(sync): drop sync + keep local on 403 (member removed/viewer)"
```

---

### Task 4: Router viewer read-only gate + `toast` host message

**Files:**
- Modify: `src/shared/types.ts` (add a `toast` HostMessage variant)
- Modify: `src/extension/messaging.ts` (`RouterDeps.isReadOnly` + gate)
- Test: `test/extension/messaging.test.ts` (extend)

**Interfaces:**
- Consumes: `isMutating` from `./sync/sync-runtime`.
- Produces:
  - `HostMessage` union gains `{ type: 'toast'; level: 'error' | 'info'; message: string }`.
  - `RouterDeps` gains optional `isReadOnly?: (workspaceId: string) => boolean`.
  - The router's entry function returns a `{ type: 'toast', level: 'error', message: 'This workspace is read-only (viewer access).' }` reply — and makes NO store mutation — when the incoming message's type `isMutating` and `isReadOnly(getActiveWorkspaceId())` is true.

- [ ] **Step 1: Add the `toast` type to `src/shared/types.ts`**

In the `HostMessage` union add:

```ts
  | { type: 'toast'; level: 'error' | 'info'; message: string }
```

- [ ] **Step 2: Add failing tests** — extend `test/extension/messaging.test.ts`

```ts
  it('blocks a mutating message on a read-only (viewer) workspace with a toast', async () => {
    const collections = /* the test file's collection store double */ makeCollections()
    const route = createRouter({ ...baseDeps(collections), getActiveWorkspaceId: () => 'w1', isReadOnly: (id) => id === 'w1' })
    const before = await collections.list()
    const reply = await route({ type: 'createCollection', name: 'Nope' } as any)
    expect(reply).toEqual({ type: 'toast', level: 'error', message: 'This workspace is read-only (viewer access).' })
    expect(await collections.list()).toEqual(before) // no mutation happened
  })
  it('allows mutations when not read-only', async () => {
    const collections = makeCollections()
    const route = createRouter({ ...baseDeps(collections), getActiveWorkspaceId: () => 'w1', isReadOnly: () => false })
    await route({ type: 'createCollection', name: 'Yes' } as any)
    expect((await collections.list()).some((c) => c.name === 'Yes')).toBe(true)
  })
  it('allows a non-mutating message even when read-only', async () => {
    const collections = makeCollections()
    const route = createRouter({ ...baseDeps(collections), getActiveWorkspaceId: () => 'w1', isReadOnly: () => true })
    const reply = await route({ type: 'loadTree' } as any)
    expect(reply).not.toEqual(expect.objectContaining({ type: 'toast' }))
  })
```

(Adapt `makeCollections()` / `baseDeps(...)` to however `test/extension/messaging.test.ts` currently builds a router + store doubles — reuse the existing helpers/fixtures in that file; do not invent a new scaffold. If the file builds deps inline, follow that shape and just add `isReadOnly`.)

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — `isReadOnly` isn't consulted; `createCollection` mutates regardless.

- [ ] **Step 4: Wire the gate in `src/extension/messaging.ts`**

Add the import:

```ts
import { isMutating } from './sync/sync-runtime'
```

Add `isReadOnly?: (workspaceId: string) => boolean` to `RouterDeps`.

Find the router's returned entry function (the `async function route(msg: WebviewMessage): Promise<HostMessage | undefined>` that the big `switch (msg.type)` lives in — `createRouter` returns it). At the very TOP of that function, before the switch, add:

```ts
    if (isMutating(msg.type) && deps.isReadOnly?.(deps.getActiveWorkspaceId())) {
      return { type: 'toast', level: 'error', message: 'This workspace is read-only (viewer access).' }
    }
```

(If `createRouter` returns the function under a different name or as an arrow, add the guard as the first statement of that returned function. `isMutating` takes the message type string — `msg.type` — and returns true for data-mutating types; read-only + non-mutating messages like `loadTree`/`sendRequest` pass through.)

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: PASS (all, incl. the existing router tests — they pass no `isReadOnly`, so the guard is inert for them).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/shared/types.ts src/extension/messaging.ts test/extension/messaging.test.ts
git commit -m "feat(sync): router blocks viewer mutations with a toast"
```

---

### Task 5: Host wiring — role cache + `isReadOnly` + role in the workspaces snapshot

**Files:**
- Modify: `src/extension/sync/sync-runtime.ts` (role cache + `isReadOnly` accessor)
- Modify: `src/extension/panel.ts` (wire `isReadOnly` into the router; attach role to the `workspaces` snapshot; refresh the cache)
- Test: `test/extension/sync/sync-runtime.test.ts` (extend for the role cache)

**Interfaces:**
- Consumes: `SyncStateStore`, `SyncManager.refreshRoles`, the router `RouterDeps.isReadOnly`.
- Produces:
  - `createSyncRuntime(...)` gains a role cache: a `roleOf(workspaceId): 'owner'|'editor'|'viewer'|undefined` reader and an async `refreshRoleCache()` that loads all sync-state roles into the cache; the runtime exposes `isReadOnly(workspaceId): boolean` = `roleOf(id) === 'viewer'`.
  - `panel.ts`: passes `isReadOnly: (id) => runtime.isReadOnly(id)` into `createRouter`'s deps; refreshes the role cache after each pull/enable and once at bootstrap (and calls `manager.refreshRoles()` opportunistically e.g. right after the socket connects / on the first snapshot); the `workspaces` snapshot attaches `role: runtime.roleOf(w.id)` to each workspace entry.
- Note on `RouterDeps`: `createRouter` is invoked in `panel.ts`. Because the runtime is created AFTER the router in the current bootstrap order, pass `isReadOnly` as a thunk that reads a `let runtime` bound later (same deferred-closure pattern already used for `hubRef`/`syncRuntimeRef`), OR move the runtime construction before `createRouter`. Prefer the deferred closure: `isReadOnly: (id) => syncRuntimeRef?.isReadOnly(id) ?? false`.

- [ ] **Step 1: Extend the sync-runtime test** — `test/extension/sync/sync-runtime.test.ts`

```ts
  it('exposes isReadOnly from the role cache (viewer = read-only)', async () => {
    const state = { all: async () => ({ w1: { role: 'viewer' }, w2: { role: 'editor' } }) } as any
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(), refreshRoles: vi.fn() } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const rt = createSyncRuntime({ manager, socket, onPulled: async () => {}, state })
    await rt.refreshRoleCache()
    expect(rt.isReadOnly('w1')).toBe(true)
    expect(rt.isReadOnly('w2')).toBe(false)
    expect(rt.isReadOnly('unknown')).toBe(false)
    expect(rt.roleOf('w2')).toBe('editor')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts`
Expected: FAIL — `createSyncRuntime` takes no `state`; no `refreshRoleCache`/`isReadOnly`/`roleOf`.

- [ ] **Step 3: Extend `createSyncRuntime` in `src/extension/sync/sync-runtime.ts`**

Add a `state: { all(): Promise<Record<string, { role?: string }>> }` to the deps object, and a role cache:

```ts
export function createSyncRuntime(deps: {
  manager: SyncManager
  socket: SyncSocket
  onPulled: () => Promise<void>
  debounceMs?: number
  state?: { all(): Promise<Record<string, { role?: string }>> }
}) {
  // ... existing debounce/timers ...
  const roles = new Map<string, string>()
  const refreshRoleCache = async (): Promise<void> => {
    roles.clear()
    const all = (await deps.state?.all()) ?? {}
    for (const [id, s] of Object.entries(all)) if (s.role) roles.set(id, s.role)
  }
  const roleOf = (id: string) => roles.get(id) as 'owner' | 'editor' | 'viewer' | undefined
  const isReadOnly = (id: string) => roleOf(id) === 'viewer'

  return {
    // ... existing manager/schedulePush/start/stop/onSocketChange ...
    refreshRoleCache,
    roleOf,
    isReadOnly,
  }
}
```

Keep every existing return field; ADD `refreshRoleCache`, `roleOf`, `isReadOnly`. Also, in `onSocketChange` (after a successful pull) and wherever `onPulled` fires, call `await refreshRoleCache()` so a role change pulled from the server updates the cache. (Add `await refreshRoleCache()` inside `onSocketChange` right after `manager.pullIfNewer` resolves true, before `onPulled()`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Wire `panel.ts`**

In `panel.ts`'s `ensureBootstrap`:
- Pass `state: new SyncStateStore(base)` into `createSyncRuntime(...)` (reuse the same `SyncStateStore(base)` instance the `SyncManager` uses — construct it once as `const syncState = new SyncStateStore(base)` and pass it to both `SyncManager` and the runtime).
- Add `isReadOnly: (id) => syncRuntimeRef?.isReadOnly(id) ?? false` to the `createRouter({ ... })` deps object.
- After `runtime.start()`, call `void runtime.refreshRoleCache()` and `void manager.refreshRoles().then(() => runtime.refreshRoleCache())` (opportunistic role sync on boot).
- In the `snapshot()` builder, change the `workspaces` message to attach a role per workspace: `workspaces: (await workspaces.list()).map((w) => ({ ...w, role: syncRuntimeRef?.roleOf(w.id) }))`. (The `role` field is additive; the webview ignores it until DS-Phase 5b-ui.)
- After `onPulled`/`hub.refresh()` the role cache is already refreshed by Step 3's `onSocketChange` change; also call `void runtime.refreshRoleCache()` inside the manual `syncNow`-triggered `onPulled` path if applicable.

- [ ] **Step 6: Typecheck + full suite + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean; all tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/extension/sync/sync-runtime.ts src/extension/panel.ts test/extension/sync/sync-runtime.test.ts
git commit -m "feat(sync): role cache + isReadOnly wired into router + workspaces snapshot"
```

---

### Task 6: Manual verification doc

**Files:**
- Create: `docs/sync-phase-5b-core-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a runbook proving the extension honors roles.

- [ ] **Step 1: Create `docs/sync-phase-5b-core-verification.md`**

```markdown
# Drive Sync DS-Phase 5b-core — manual verification (extension role enforcement)

Prereq: backend running (DS-Phase 5a) with two Google accounts (OWNER, MEMBER); OWNER has enabled sync on `w1` and shared it with MEMBER; both signed into restman.

## A. Role recorded
1. As MEMBER, open/sync `w1`. Confirm the local `sync-state.json` for `w1` shows `role: "editor"` (or `"viewer"`) matching the share, and it updates if OWNER changes the role (after a pull / refreshRoles).

## B. Viewer is read-only in the extension (no round-trip)
1. OWNER shares `w1` with MEMBER as **viewer**; MEMBER pulls so `sync-state.role` = `viewer`.
2. In MEMBER's restman, with `w1` active, attempt any edit (new collection/request/folder, rename, delete, save request, edit environment). The change is blocked and a read-only toast/error is surfaced; the local tree is unchanged (no mutation applied).
3. Non-mutating actions still work: opening a request, sending a request, viewing history/environments.

## C. Removed member drops sync, keeps local
1. With MEMBER (editor) actively synced on `w1`, OWNER removes MEMBER (`DELETE .../members/:id`).
2. MEMBER's next push or pull returns 403 → sync silently drops (`sync-state.synced` becomes `false`) but the local collections/environments for `w1` REMAIN intact and editable locally.
3. Re-sharing MEMBER lets them re-enable sync and resume.

## D. Downgrade editor→viewer
1. OWNER downgrades MEMBER from editor to viewer; MEMBER pulls (or refreshRoles runs).
2. MEMBER's `sync-state.role` becomes `viewer`; further edits are blocked as in B.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sync-phase-5b-core-verification.md
git commit -m "docs: Drive sync phase 5b-core verification"
```

---

## Self-Review

**Spec coverage (DS-Phase 5 extension half — the enforcement/plumbing part):**
- `SyncClient` member management (spec line 65 "member management") → Task 1 (`listMembers`/`addMember`/`removeMember`). ✓
- Role recorded in sync-state (spec line 69 sync-state `role`) → Task 2 (pull + refreshRoles). ✓
- Viewer read-only, extension disables edits (spec line 160 "extension disables edits") → Task 4 router gate (the visual disable is 5b-ui; the router gate is the hard enforcement). ✓
- Member-removed-mid-edit: next push 403 → drop sync, keep local (spec line 176) → Task 3. ✓
- Role surfaced for the UI (owner/role badge, spec line 78) → Task 5 attaches role to the workspaces snapshot (rendering is 5b-ui). ✓

Explicitly deferred to DS-Phase 5b-ui: the Members webview panel (list/add/remove UI), the role badge + edit-affordance disabling in the sidebar/editor, the WorkspaceSwitcher popup polish, and the toast RENDERING (this plan emits the `toast` message + adds the type; 5b-ui renders it). "Owner deletes workspace → members notified → keep a local copy" UX is DS-Phase 6.

**Placeholder scan:** none for the logic tasks (full code). Tasks 4 Step 2 and 5 Step 5 describe adapting to existing test fixtures / bootstrap wiring in prose (reuse this repo's current `messaging.test.ts` helpers and `panel.ts` bootstrap order) because they must match current file contents; each names the exact statement/field to add and where.

**Type consistency:** `WorkspaceRole` + `Member` + `SyncForbiddenError` (Task 1) consumed by Tasks 2/3. `SyncState.role` already exists. `pull` return `{snapshot, revision, role?}` (Task 1) read in Task 2/3. `isMutating` (imported from `sync-runtime`) drives the router gate (Task 4) — the same set that drives auto-push, so "mutating" is defined once. `RouterDeps.isReadOnly` (Task 4) supplied by `panel.ts` from `runtime.isReadOnly` (Task 5). `toast` HostMessage (Task 4) added to the union; `panel.ts`/webview render it in 5b-ui. `createSyncRuntime` gains `state` + `refreshRoleCache`/`roleOf`/`isReadOnly` (Task 5) without removing existing fields.

**Local-first / safety check:** the 403 path (Task 3) only flips `synced:false` and never calls `applyPulled` or deletes stores (asserted by `applyPulled` not-called in both tests); the viewer gate (Task 4) returns before the switch so no store method runs. No path loses local data.

**Integration risk called out:** `panel.ts` bootstrap wiring (Task 5) is not unit-tested against live VS Code — the role cache, `isReadOnly`, router gate, `SyncForbiddenError` handling, and member client are all unit-tested; the end-to-end (viewer edit blocked in the running extension, removed-member drop) is covered by the Task 6 manual runbook. The deferred-closure for `isReadOnly` (reads `syncRuntimeRef` bound later) mirrors the existing `hubRef`/`syncRuntimeRef` pattern already in `panel.ts`.
