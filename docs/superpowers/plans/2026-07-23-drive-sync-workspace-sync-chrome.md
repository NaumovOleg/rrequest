# Drive Sync — Workspace Sync & Account Chrome (make sync/sharing visible in the UI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Visual tasks (4, 5) additionally require superpowers/frontend-design:** invoke the `frontend-design` skill and follow `src/webview/theme.css` (all colors via `--vscode-*`/`--rm-*`, no raw hex). Live screenshot verification via `run` is DEFERRED to a manual pass (headless env can't launch the VS Code extension host) — build to the spec + component tests + clean build.

**Goal:** Surface the (already-working) Drive-sync engine in the sidebar UI: a visible **Sign in with Google / account + Sign out** control, and a per-workspace **Sync toggle + status (synced · role)** with a **Sync Now** action — so the user can actually reach sign-in, enable sync, see status, and (as owner) open Members, all without the command palette. This closes the "Webview — Workspace panel" chrome the spec calls for (sign-in state, per-workspace sync toggle + status + role badge) that shipped only as hidden `restman.*` commands.

**Architecture:** The host (`panel.ts`) already builds the sync stack (`syncClient`, `manager`, `runtime`, `hub`, `cachedToken`). This plan (1) broadcasts **auth state** (signed-in email or null) and per-workspace **`synced`** in the snapshot, (2) adds a `SyncControlPort` (sign-in / sign-out / enable / sync-now) wired in `panel.ts` over the existing stack and routed from new webview messages, and (3) adds the visible sidebar controls (account row + sync toggle/status) that post those messages and render the broadcast state. The existing `restman.*` commands delegate to the same port (one implementation). The UI is a reflection of state — enforcement (viewer gate, server roles) is unchanged.

**Tech Stack:** Extension host (`panel.ts`, `messaging.ts`, `hub.ts`, `extension.ts`) + webview (React/Zustand) + shared types; TypeScript, vitest.

## Global Constraints

- Extension holds only the app JWT (SecretStorage); sign-in uses the existing loopback flow (`sync/login.ts` `signIn`); the Google refresh token never reaches the extension.
- Sign-out is local only: delete the stored token + cached email + clear synced roles from the UI. No backend call.
- The sync/account webview messages (`signIn`/`signOut`/`enableSync`/`syncNow`) are NOT in the `isMutating` set (they don't mutate collections/environments) — the viewer read-only gate must not block them. Enabling sync is an owner action on one's own workspace; the server enforces roles regardless.
- Webview design: `src/webview/theme.css` custom props (`--vscode-*`/`--rm-*`), `rm-*` classes, theme-adaptive, restrained. No raw hex.
- Reuse: `panel.ts`'s `syncClient`/`manager`/`runtime`/`hub`/`cachedToken`/`syncState`/`syncBaseUrl`; `sync/login.ts` `signIn`; `SyncClient.me()`; the snapshot broadcast; `createSyncRuntime`'s role cache; `getSyncRuntime()`.

---

### Task 1: Shared types + store (auth email, synced, sync/account messages)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/webview/state/store.ts`
- Modify: `src/webview/sidebar/SidebarApp.tsx` (handle `authState` → `setAuthEmail`)
- Test: `test/webview/store.test.ts` (extend)

**Interfaces:**
- Produces (shared/types):
  - `Workspace` gains `synced?: boolean` (already has `role?`).
  - `HostMessage` gains `{ type: 'authState'; email: string | null }`.
  - `WebviewMessage` gains `{ type: 'signIn' }`, `{ type: 'signOut' }`, `{ type: 'enableSync'; workspaceId: string }`, `{ type: 'syncNow'; workspaceId: string }`.
- Produces (store): `authEmail: string | null`, `setAuthEmail(email: string | null)`; selector `activeSynced(): boolean` (active workspace `synced === true`). `setWorkspaces` already stores the array (now carrying `synced`).

- [ ] **Step 1: Add the types to `src/shared/types.ts`**

Change `Workspace`:

```ts
export type Workspace = { id: string; name: string; role?: WorkspaceRole; synced?: boolean }
```

Add to `HostMessage`:

```ts
  | { type: 'authState'; email: string | null }
```

Add to `WebviewMessage`:

```ts
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'enableSync'; workspaceId: string }
  | { type: 'syncNow'; workspaceId: string }
```

- [ ] **Step 2: Add failing store tests** — extend `test/webview/store.test.ts`

```ts
  it('setAuthEmail stores the signed-in email (or null)', () => {
    useStore.getState().setAuthEmail('me@x.com')
    expect(useStore.getState().authEmail).toBe('me@x.com')
    useStore.getState().setAuthEmail(null)
    expect(useStore.getState().authEmail).toBeNull()
  })
  it('activeSynced reflects the active workspace synced flag', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'owner', synced: true }, { id: 'w2', name: 'B' }], 'w1')
    expect(useStore.getState().activeSynced()).toBe(true)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'owner', synced: true }, { id: 'w2', name: 'B' }], 'w2')
    expect(useStore.getState().activeSynced()).toBe(false)
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL — `setAuthEmail`/`activeSynced` not defined.

- [ ] **Step 4: Extend `src/webview/state/store.ts`**

Add to `State`: `authEmail: string | null`, `setAuthEmail(email: string | null): void`, `activeSynced(): boolean`. Add `authEmail: null` to the initial state and `__reset`. Add:

```ts
  setAuthEmail: (authEmail) => set({ authEmail }),
  activeSynced: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.synced === true },
```

- [ ] **Step 5: Handle `authState` in `SidebarApp.tsx`**

In the `onHostMessage` handler add `else if (m.type === 'authState') useStore.getState().setAuthEmail(m.email)`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/webview/state/store.ts src/webview/sidebar/SidebarApp.tsx test/webview/store.test.ts
git commit -m "feat(ui): sync/account message types + store (authEmail, synced)"
```

---

### Task 2: Runtime `syncedOf` cache + snapshot broadcasts synced + authState; `hub.authState`

**Files:**
- Modify: `src/extension/sync/sync-runtime.ts` (cache `synced` alongside `role`; `syncedOf(id)`)
- Modify: `src/extension/hub.ts` (`authState(email)` broadcaster)
- Modify: `src/extension/panel.ts` (snapshot: `synced` per workspace + an `authState` entry)
- Test: `test/extension/sync/sync-runtime.test.ts` (extend)

**Interfaces:**
- Produces:
  - `createSyncRuntime(...)` role cache also caches `synced`; new `syncedOf(id: string): boolean`. `refreshRoleCache()` populates both from `state.all()`.
  - `hub.authState(email: string | null): void { this.broadcast({ type: 'authState', email }) }`.
  - `panel.ts` snapshot: each workspace carries `synced: syncRuntimeRef?.syncedOf(w.id)`; the snapshot array includes a trailing `{ type: 'authState', email: currentAuthEmail() }` where `currentAuthEmail = () => cachedToken ? (context.globalState.get<string>('restman.syncEmail') ?? null) : null` (so every snapshot broadcast — including the sidebar's mount-time `loadWorkspaces` — carries the current auth email).

- [ ] **Step 1: Extend the sync-runtime test** — `test/extension/sync/sync-runtime.test.ts`

```ts
  it('syncedOf reflects the sync-state synced flag from the cache', async () => {
    const state = { all: async () => ({ w1: { role: 'owner', synced: true }, w2: { role: 'viewer', synced: false } }) } as any
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(), refreshRoles: vi.fn() } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const rt = createSyncRuntime({ manager, socket, onPulled: async () => {}, state })
    await rt.refreshRoleCache()
    expect(rt.syncedOf('w1')).toBe(true)
    expect(rt.syncedOf('w2')).toBe(false)
    expect(rt.syncedOf('unknown')).toBe(false)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts`
Expected: FAIL — no `syncedOf`.

- [ ] **Step 3: Add `synced` to the cache in `sync-runtime.ts`**

The `state.all()` shape must widen to `Record<string, { role?: string; synced?: boolean }>`. Add a `synced = new Map<string, boolean>()`; in `refreshRoleCache`, `synced.clear()` and `for (...) if (s.synced) synced.set(id, true)`; add `const syncedOf = (id: string) => synced.get(id) === true` and return it. Keep all existing returned fields.

- [ ] **Step 4: Add `authState` to `hub.ts`**

```ts
  authState(email: string | null): void { this.broadcast({ type: 'authState', email }) }
```

- [ ] **Step 5: Wire `panel.ts` snapshot**

- Define `const currentAuthEmail = (): string | null => cachedToken ? (context.globalState.get<string>('restman.syncEmail') ?? null) : null` (near `cachedToken`).
- In `snapshot()`, change the `workspaces` map to also attach `synced`: `.map((w) => ({ ...w, role: syncRuntimeRef?.roleOf(w.id), synced: syncRuntimeRef?.syncedOf(w.id) }))`, and append `{ type: 'authState', email: currentAuthEmail() }` to the returned array.

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS + clean + build ok.

- [ ] **Step 7: Commit**

```bash
git add src/extension/sync/sync-runtime.ts src/extension/hub.ts src/extension/panel.ts test/extension/sync/sync-runtime.test.ts
git commit -m "feat(sync): broadcast synced + authState (runtime syncedOf, snapshot, hub.authState)"
```

---

### Task 3: `SyncControlPort` in `panel.ts` + router routing + command delegation

**Files:**
- Modify: `src/extension/messaging.ts` (`RouterDeps.syncControl` + 4 cases)
- Modify: `src/extension/panel.ts` (build the port; wire into `createRouter`)
- Modify: `src/extension/extension.ts` (delegate the `restman.*` commands to the same port via a shared path)
- Test: `test/extension/messaging.test.ts` (extend)

**Interfaces:**
- Produces:
  - `RouterDeps` gains `syncControl?: { signIn(): Promise<void>; signOut(): Promise<void>; enable(workspaceId: string): Promise<void>; syncNow(workspaceId: string): Promise<void> }`.
  - Router cases (all return `undefined` — the post-dispatch snapshot broadcast refreshes workspaces/authState): `signIn`→`await deps.syncControl?.signIn()`; `signOut`→`signOut()`; `enableSync`→`enable(msg.workspaceId)`; `syncNow`→`syncNow(msg.workspaceId)`.
  - `panel.ts` builds `syncControlPort` over the existing stack: `signIn` runs `signIn({ baseUrl: syncBaseUrl(), openExternal })`, stores the token in `context.secrets`, sets `cachedToken`, calls `syncClient.me()`, saves `restman.syncEmail`, then `hub.authState(email)`; `signOut` deletes the secret + clears `cachedToken` + `syncEmail`, `hub.authState(null)`, `runtime.refreshRoleCache()`; `enable` = `manager.enable(id)` + `runtime.refreshRoleCache()`; `syncNow` = `manager.pull(id)` + `manager.push(id)` + `runtime.refreshRoleCache()`. Wrap `enable`/`syncNow` errors in a `hub.toast('error', ...)`.
  - `extension.ts` commands call the shared port (exposed via a new `getSyncControl()` from `panel.ts`, or by reusing `getSyncRuntime()` + a small signIn helper) so there's one implementation.

- [ ] **Step 1: Add failing tests** — extend `test/extension/messaging.test.ts`

```ts
  it('routes sync/account messages to the syncControl port', async () => {
    const calls: string[] = []
    const syncControl = {
      signIn: async () => { calls.push('signIn') },
      signOut: async () => { calls.push('signOut') },
      enable: async (id: string) => { calls.push('enable:' + id) },
      syncNow: async (id: string) => { calls.push('syncNow:' + id) },
    }
    const route = createRouter({ ...baseDeps(makeCollections()), getActiveWorkspaceId: () => 'w1', syncControl })
    expect(await route({ type: 'signIn' } as any)).toBeUndefined()
    expect(await route({ type: 'enableSync', workspaceId: 'w1' } as any)).toBeUndefined()
    await route({ type: 'signOut' } as any)
    await route({ type: 'syncNow', workspaceId: 'w2' } as any)
    expect(calls).toEqual(['signIn', 'enable:w1', 'signOut', 'syncNow:w2'])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — those cases hit the default branch.

- [ ] **Step 3: Add the port type + cases in `messaging.ts`**

Add to `RouterDeps`:

```ts
  syncControl?: { signIn(): Promise<void>; signOut(): Promise<void>; enable(workspaceId: string): Promise<void>; syncNow(workspaceId: string): Promise<void> }
```

Add cases (near the workspace cases):

```ts
      case 'signIn': await deps.syncControl?.signIn(); return undefined
      case 'signOut': await deps.syncControl?.signOut(); return undefined
      case 'enableSync': await deps.syncControl?.enable(msg.workspaceId); return undefined
      case 'syncNow': await deps.syncControl?.syncNow(msg.workspaceId); return undefined
```

- [ ] **Step 4: Build the port in `panel.ts` + wire it**

Import `signIn` from `./sync/login` and `vscode` (already imported). After the runtime is built, add:

```ts
  const syncControlPort = {
    signIn: async () => {
      const token = await signIn({ baseUrl: syncBaseUrl(), openExternal: (u) => void vscode.env.openExternal(vscode.Uri.parse(u)) })
      cachedToken = token
      await context.secrets.store('restman.syncToken', token)
      try { const me = await syncClient.me(); await context.globalState.update('restman.syncEmail', me.email); hub.authState(me.email) }
      catch { hub.authState(null) }
    },
    signOut: async () => {
      await context.secrets.delete('restman.syncToken'); cachedToken = undefined
      await context.globalState.update('restman.syncEmail', undefined)
      await runtime.refreshRoleCache()
      hub.authState(null)
    },
    enable: async (id: string) => {
      try { await manager.enable(id); await runtime.refreshRoleCache() }
      catch (e: any) { hub.toast('error', `Enable sync failed: ${e?.message ?? e}`) }
    },
    syncNow: async (id: string) => {
      try { await manager.pull(id); await manager.push(id); await runtime.refreshRoleCache() }
      catch (e: any) { hub.toast('error', `Sync failed: ${e?.message ?? e}`) }
    },
  }
  syncControlRef = syncControlPort
```

Add `members: membersPort` sibling `syncControl: syncControlPort` to the `createRouter({ ... })` deps. Add a module-level `let syncControlRef: typeof syncControlPort | undefined` + `export function getSyncControl() { return syncControlRef }`.

Note: `syncControlPort` is built after `createRouter` today only if the runtime block runs after it; if `createRouter` is called before the port exists, pass a thunk — but the deferred-closure pattern already used for `members`/`isReadOnly` (reading `syncControlRef`) works: pass `syncControl: { signIn: () => syncControlRef!.signIn(), signOut: () => syncControlRef!.signOut(), enable: (id) => syncControlRef!.enable(id), syncNow: (id) => syncControlRef!.syncNow(id) }` if ordering requires it. Prefer building the port before `createRouter` if the stack allows.

- [ ] **Step 5: Delegate the `restman.*` commands in `extension.ts`**

Replace the bodies of `restman.signInToSync` / `restman.enableWorkspaceSync` / `restman.syncNow` so they `await ensureBootstrap(context)` then call `getSyncControl()?.signIn()` / `.enable(activeWorkspaceId())` / `.syncNow(activeWorkspaceId())` respectively (with the existing "no active workspace"/"sync not ready" guards for enable/syncNow). This removes the duplicated sign-in/enable/sync logic from `extension.ts` (keep only the command registration + guards). Import `getSyncControl` from `./panel`.

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS + clean + build ok.

- [ ] **Step 7: Commit**

```bash
git add src/extension/messaging.ts src/extension/panel.ts src/extension/extension.ts test/extension/messaging.test.ts
git commit -m "feat(sync): SyncControlPort (sign-in/out, enable, syncNow) routed from webview + commands"
```

---

### Task 4: Account row UI (sign in / email + sign out)

**Files:**
- Modify: `src/webview/views/SidebarHeader/SidebarHeader.tsx` (add an account row at the top)
- Modify: `src/webview/theme.css`
- Test: `test/webview/account-row.test.tsx`

**REQUIRES `frontend-design` skill.** A quiet account strip at the very top of the sidebar header: signed-out → a `Sign in with Google` button; signed-in → the email (truncated) + a `Sign out` action. Restrained, theme-adaptive.

**Interfaces:**
- Consumes: store `authEmail`; `postToHost`.
- Produces: signed-out (`authEmail === null`) → a button posting `{ type: 'signIn' }`; signed-in → the email + a sign-out control posting `{ type: 'signOut' }`.

- [ ] **Step 1: Write the failing test** — `test/webview/account-row.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarHeader } from '../../src/webview/views/SidebarHeader/SidebarHeader'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

const props = { tab: 'collections' as const, onTab: () => {}, onNewHttp: () => {}, onNewWs: () => {}, onNewGrpc: () => {} }
beforeEach(() => useStore.getState().__reset())

describe('account row', () => {
  it('signed out → Sign in with Google posts signIn', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail(null)
    render(<SidebarHeader {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signIn' })
  })
  it('signed in → shows email + Sign out posts signOut', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    render(<SidebarHeader {...props} />)
    expect(screen.getByText(/me@x\.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signOut' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/account-row.test.tsx`
Expected: FAIL — no account row.

- [ ] **Step 3: Add the account row to `SidebarHeader.tsx`**

Read `authEmail = useStore((s) => s.authEmail)`, `postToHost`. Render at the top of the `<header>`:

```tsx
      <div className="rm-account">
        {authEmail ? (
          <>
            <span className="codicon codicon-account" />
            <span className="rm-account-email" title={authEmail}>{authEmail}</span>
            <button type="button" className="rm-linkbtn" onClick={() => postToHost({ type: 'signOut' })}>Sign out</button>
          </>
        ) : (
          <button type="button" className="rm-btn rm-btn--ghost" onClick={() => postToHost({ type: 'signIn' })}>
            <span className="codicon codicon-account" /> Sign in with Google
          </button>
        )}
      </div>
```

Add `.rm-account`/`.rm-account-email`/`.rm-linkbtn` styles to `theme.css`.

- [ ] **Step 4: Run tests + `frontend-design` refine + typecheck + build**

Run: `npx vitest run test/webview/account-row.test.tsx`. Then invoke `frontend-design` for the account strip. `npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/views/SidebarHeader/SidebarHeader.tsx src/webview/theme.css test/webview/account-row.test.tsx
git commit -m "feat(ui): sidebar account row (Sign in with Google / email + Sign out)"
```

---

### Task 5: Sync toggle + status for the active workspace

**Files:**
- Modify: `src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx` (add a sync control row/affordance near the active workspace) OR `SidebarHeader.tsx`
- Modify: `src/webview/theme.css`
- Test: `test/webview/sync-toggle.test.tsx`

**REQUIRES `frontend-design` skill.** A compact sync control for the ACTIVE workspace: when signed in — off → an "Enable Sync" toggle/button (posts `enableSync`); on → a "synced · <Role>" status + a Sync Now action (posts `syncNow`). Hidden/disabled when signed out. Sits next to the workspace name (the Members button is already there for owners). Restrained, theme-adaptive.

**Interfaces:**
- Consumes: store `authEmail`, `activeWorkspace()`, `activeSynced()`; `postToHost`.
- Produces: signed in + active workspace not synced → an "Enable Sync" control posting `{ type: 'enableSync', workspaceId }`; signed in + synced → `synced · <role>` + a Sync Now button posting `{ type: 'syncNow', workspaceId }`. Signed out → the sync control is hidden.

- [ ] **Step 1: Write the failing test** — `test/webview/sync-toggle.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

beforeEach(() => useStore.getState().__reset())

describe('sync toggle', () => {
  it('signed in + not synced → Enable Sync posts enableSync', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W' }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /enable sync/i }))
    expect(post).toHaveBeenCalledWith({ type: 'enableSync', workspaceId: 'w1' })
  })
  it('signed in + synced → Sync Now posts syncNow', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner', synced: true }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    expect(post).toHaveBeenCalledWith({ type: 'syncNow', workspaceId: 'w1' })
  })
  it('signed out → no sync control', () => {
    useStore.getState().setAuthEmail(null)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.queryByRole('button', { name: /enable sync|sync now/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/sync-toggle.test.tsx`
Expected: FAIL — no sync control.

- [ ] **Step 3: Add the sync control**

In `WorkspaceSwitcher.tsx`, read `authEmail`, `active = activeWorkspace()`, `synced = activeSynced()`. Render near the workspace name (beside the Members button):

```tsx
      {authEmail && active && (
        synced ? (
          <div className="rm-sync-status">
            <span className="codicon codicon-cloud" /> synced · {active.role ?? 'owner'}
            <button type="button" className="rm-linkbtn" onClick={() => postToHost({ type: 'syncNow', workspaceId: active.id })}>Sync Now</button>
          </div>
        ) : (
          <button type="button" className="rm-btn rm-btn--ghost" onClick={() => postToHost({ type: 'enableSync', workspaceId: active.id })}>
            <span className="codicon codicon-cloud-upload" /> Enable Sync
          </button>
        )
      )}
```

Add `.rm-sync-status` styles to `theme.css`. Keep the existing role badge / Members button / delete-confirm working.

- [ ] **Step 4: Run tests + `frontend-design` refine + typecheck + build**

Run: `npx vitest run test/webview/sync-toggle.test.tsx`. Then `frontend-design` for the sync control. `npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx src/webview/theme.css test/webview/sync-toggle.test.tsx
git commit -m "feat(ui): per-workspace sync toggle + status (Enable Sync / synced·role · Sync Now)"
```

---

### Task 6: Manual verification doc

**Files:**
- Create: `docs/sync-workspace-chrome-verification.md`

- [ ] **Step 1: Create `docs/sync-workspace-chrome-verification.md`**

```markdown
# Drive Sync — Workspace sync & account chrome — manual verification

Prereq: backend running; a Google account.

## A. Sign in / out (visible)
1. Open the restman sidebar. Signed out → the top account strip shows **Sign in with Google**.
2. Click it → the loopback OAuth flow opens the browser; after consent, the strip shows your **email + Sign out**.
3. Click **Sign out** → back to the Sign-in button; synced workspaces lose their sync status/role in the UI.

## B. Enable sync (visible)
1. Signed in, with a workspace active → an **Enable Sync** control shows next to the workspace name.
2. Click it → the workspace becomes **synced · Owner**; a **Sync Now** action + (owner) the **Members** button are now available.
3. Edits auto-push (DS-Phase 3); **Sync Now** forces a pull+push.

## C. Roles reflected
1. A workspace shared to you as Editor/Viewer shows **synced · Editor/Viewer**; a Viewer sees the read-only affordances (DS-Phase 5b-ui) and no Enable-Sync/Members controls beyond viewing.

## D. Command palette still works
1. `restman: Sign in to Sync` / `Enable Workspace Sync` / `Sync Now` still work and now drive the same state the UI shows.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sync-workspace-chrome-verification.md
git commit -m "docs: workspace sync & account chrome verification"
```

---

## Self-Review

**Coverage (the deferred "Webview — Workspace panel" chrome, spec lines 74-80):**
- Signed-out → Sign in with Google; signed-in → email + Sign out → Tasks 3 (port) + 4 (UI). ✓
- Per-workspace Sync toggle (on → create Drive folder+file via `manager.enable`) + status (synced) + owner/role badge → Tasks 2 (broadcast synced) + 5 (toggle/status); role badge already exists (5b-ui). ✓
- Members reachable → already wired (5b-ui) once synced+owner; this plan makes "synced+owner" attainable from the UI. ✓
- Command palette parity → Task 3 delegates the `restman.*` commands to the same port. ✓

**Placeholder scan:** logic/wiring tasks (1-3) carry full code; the two UI tasks (4, 5) give complete component snippets + exact message contracts + `frontend-design` for the visual, matching how DS-Phase-5b-ui handled visual work. Live screenshots deferred to a manual pass (documented, Task 6).

**Type consistency:** `Workspace.synced?` + `authState` HostMessage + `signIn/signOut/enableSync/syncNow` WebviewMessages (Task 1) consumed by the router `syncControl` (Task 3), the runtime `syncedOf`/snapshot (Task 2), and the UI (Tasks 4/5). `authEmail`/`activeSynced` store (Task 1) drive the account row + sync toggle. `hub.authState` (Task 2) broadcasts what the account row renders. The port method names (`signIn/signOut/enable/syncNow`) match between `RouterDeps.syncControl` (Task 3 router), the `panel.ts` port, and the `extension.ts` command delegation.

**Enforcement unchanged:** the new messages are NOT in `isMutating` (viewer gate untouched); enabling sync / signing in are account/sync actions, not collection mutations; the server still enforces roles. No security regression.

**Integration risk called out:** `panel.ts`/`extension.ts` wiring (Tasks 2, 3) + the pixel visuals (4, 5) aren't unit-tested against live VS Code — the store, router routing, runtime cache, and each UI component's message-posting ARE unit-tested; the end-to-end sign-in→enable→synced flow + the look are verified by the Task 6 manual runbook. The auth email rides every snapshot broadcast, so the sidebar reflects it on mount (via its `loadWorkspaces`) without a race; if the sidebar posts nothing dispatchable on mount, add an explicit `hub.authState(currentAuthEmail())` right after `runtime.start()`.
