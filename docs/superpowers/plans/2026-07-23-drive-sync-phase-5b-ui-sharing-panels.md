# Drive Sync — DS-Phase 5b-ui: Sharing UX (Members panel, viewer read-only UX, toasts, switcher polish) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Visual tasks (3, 6, 7) additionally require superpowers/frontend-design:** the implementer of those tasks MUST invoke the `frontend-design` skill and follow the supplied mockups + this repo's `src/webview/theme.css` design system (all colors via `--vscode-*` / `--rm-*` custom props — no raw hex). Verify visually with the `run` skill (launch the extension, screenshot the panel) before marking the task done.

**Goal:** Surface DS-Phase-5b-core's role enforcement in the UI: a Members/invite panel (list · add-by-email + role · remove, owner-only), viewer read-only affordances (hidden/disabled edit controls + a role badge), rendered `toast` notifications (the read-only block + sync errors), and a polished workspace-switcher popup — all matching the supplied Postman-style mockups and this repo's theme.

**Architecture:** New shared message types (`openMembers`/`showMembers`/`loadMembers`/`members`/`addMember`/`removeMember`) follow the existing `openEnvironments`→`showEnvironments` panel-open pattern. The router gains a `MembersPort` (backed by `SyncClient`'s member methods, wired in `panel.ts`) to serve member reads/writes; the editor webview opens a `Members` view when it receives `showMembers` (a new store `membersMode`). `Workspace` gains a `role?` field (already broadcast by `panel.ts`'s snapshot from DS-Phase-5b-core) that drives a store `isViewer` selector — the sidebar/editor hide or disable edit controls and show a role badge for a viewer. A `Toaster` element renders the store's toast queue in both the sidebar and editor webviews, fed by the existing `toast` HostMessage.

**Tech Stack:** Webview (React + Zustand, Vite) + a thin host wiring layer (`panel.ts`, `messaging.ts`); TypeScript, vitest. No backend or sync-logic changes (DS-Phase 5a/5b-core already provide the server + client + enforcement).

## Global Constraints

- Webview design: use `src/webview/theme.css` custom properties + component classes (`rm-*`); NO raw hex — colors come from `--vscode-*`/`--rm-*`. Theme-adaptive (light/dark) like every existing surface. Match the two supplied mockups (workspace-switcher popup + Invite-to-Workspace panel) in layout, adapted to restman's roles (Owner/Editor/Viewer, not Postman's Admin).
- **Roles:** `owner` | `editor` | `viewer`. Owner-only actions: add/remove members. Viewer: read-only (edit controls hidden/disabled + a toast if a mutation is attempted; the router already blocks the mutation in DS-Phase-5b-core).
- The UI is a **reflection** of authoritative state — it never bypasses enforcement: hiding a button is UX, the router gate + server 403 remain the real boundary. A stale role showing an enabled button is harmless (the router/server still block).
- Member ops go through `SyncClient` (backend) — the webview never calls Google or the backend directly; it posts messages, the host calls `SyncClient`.
- Reuse: the `toast` HostMessage (added in DS-Phase-5b-core), `Workspace` message + `panel.ts` snapshot role attachment (DS-Phase-5b-core), the `openX`→`showX`→`RestmanPanel` panel pattern, `SyncClient.listMembers/addMember/removeMember` (DS-Phase-5b-core), the elements in `src/webview/elements` (`IconButton`, `RenameInput`, `ComboInput`, `PopupMenu`).
- Member shape (matches the DS-Phase-5a `GET .../members` response): `{ id?: string; email: string; role: 'owner'|'editor'|'viewer'; pending: boolean }` (owner entry has no `id`).

## Mockups (authoritative layout reference)

Two Postman layouts were supplied and saved (see the `workspace-panel-mockups` memory). Summary:

- **Invite / Members panel:** header "Invite to Workspace" + close ✕; an info banner (ⓘ) "Inviting people will change this into a team workspace."; a `Name, email, or group name` multiselect input; a `Role` dropdown; footer `Copy Invite Link` (tertiary) + `Send Invite` (primary, disabled until a valid email). Below/alongside: the current members list with each member's email + role + a remove control (owner only).
- **Workspace switcher popup:** a `Search Workspaces` input + `Create Workspace` button; a virtualized list with two section headers `Recently Visited` and `More Workspaces`; each row = leading check (active only) + a role/type icon (single-user = personal/owner, two-user = team/shared) + name; the active row flagged.

---

### Task 1: Shared types + store state (roles, members, toasts, members-mode)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (extend if present; else create a focused one)

**Interfaces:**
- Produces (shared/types):
  - `type WorkspaceRole = 'owner' | 'editor' | 'viewer'`
  - `type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }`
  - `Workspace` gains `role?: WorkspaceRole`.
  - New `WebviewMessage` variants: `{ type: 'openMembers'; workspaceId: string }`, `{ type: 'loadMembers'; workspaceId: string }`, `{ type: 'addMember'; workspaceId: string; email: string; role: 'editor' | 'viewer' }`, `{ type: 'removeMember'; workspaceId: string; memberId: string }`.
  - New `HostMessage` variants: `{ type: 'showMembers'; workspaceId: string }`, `{ type: 'members'; members: Member[] }`.
- Produces (store): state `members: Member[]`, `membersMode: boolean`, `membersWorkspaceId: string | null`, `toasts: { id: string; level: 'error'|'info'; message: string }[]`; actions `setMembers(list)`, `setMembersMode(v)`, `setMembersWorkspaceId(id)`, `pushToast(level, message)`, `dismissToast(id)`; selector helpers `activeWorkspace()` and `isViewer()` (derive from `workspaces`/`activeWorkspaceId` — active workspace `role === 'viewer'`). `setWorkspaces` already stores the workspaces array; because `Workspace` now includes `role`, no change is needed there beyond the type.

- [ ] **Step 1: Add the types to `src/shared/types.ts`**

Add near the existing `Workspace`:

```ts
export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }
```

Change `Workspace`:

```ts
export type Workspace = { id: string; name: string; role?: WorkspaceRole }
```

Add to the `WebviewMessage` union:

```ts
  | { type: 'openMembers'; workspaceId: string }
  | { type: 'loadMembers'; workspaceId: string }
  | { type: 'addMember'; workspaceId: string; email: string; role: 'editor' | 'viewer' }
  | { type: 'removeMember'; workspaceId: string; memberId: string }
```

Add to the `HostMessage` union:

```ts
  | { type: 'showMembers'; workspaceId: string }
  | { type: 'members'; members: Member[] }
```

- [ ] **Step 2: Write the failing store test** — `test/webview/store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => useStore.getState().__reset())

describe('store sharing state', () => {
  it('isViewer reflects the active workspace role', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'viewer' }, { id: 'w2', name: 'B', role: 'owner' }], 'w1')
    expect(useStore.getState().isViewer()).toBe(true)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'viewer' }, { id: 'w2', name: 'B', role: 'owner' }], 'w2')
    expect(useStore.getState().isViewer()).toBe(false)
  })
  it('pushToast adds a toast with an id; dismissToast removes it', () => {
    useStore.getState().pushToast('error', 'nope')
    const t = useStore.getState().toasts
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ level: 'error', message: 'nope' })
    useStore.getState().dismissToast(t[0].id)
    expect(useStore.getState().toasts).toHaveLength(0)
  })
  it('setMembers / membersMode round-trip', () => {
    useStore.getState().setMembers([{ email: 'o@x.com', role: 'owner', pending: false }])
    expect(useStore.getState().members).toHaveLength(1)
    useStore.getState().setMembersMode(true)
    expect(useStore.getState().membersMode).toBe(true)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL — `isViewer`/`pushToast`/`setMembers`/`membersMode` not defined.

- [ ] **Step 4: Extend `src/webview/state/store.ts`**

Add to the `State` type:

```ts
  members: Member[]
  membersMode: boolean
  membersWorkspaceId: string | null
  toasts: { id: string; level: 'error' | 'info'; message: string }[]
  setMembers(list: Member[]): void
  setMembersMode(v: boolean): void
  setMembersWorkspaceId(id: string | null): void
  pushToast(level: 'error' | 'info', message: string): void
  dismissToast(id: string): void
  isViewer(): boolean
  activeWorkspace(): Workspace | undefined
```

Import `Member` and `WorkspaceRole` from shared/types (add to the existing type import). In the store initial state add `members: [], membersMode: false, membersWorkspaceId: null, toasts: [],` and the actions:

```ts
  setMembers: (members) => set({ members }),
  setMembersMode: (membersMode) => set({ membersMode }),
  setMembersWorkspaceId: (membersWorkspaceId) => set({ membersWorkspaceId }),
  pushToast: (level, message) => set((s) => ({ toasts: [...s.toasts, { id: newId(), level, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  activeWorkspace: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId) },
  isViewer: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.role === 'viewer' },
```

(`create<State>((set, get) => ({...}))` — add `get` to the zustand callback signature if not already present.) Add `members: [], membersMode: false, membersWorkspaceId: null, toasts: [],` to the `__reset()` object too.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run test/webview/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/shared/types.ts src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat(ui): sharing types + store (roles, members, toasts, members-mode)"
```

---

### Task 2: `Toaster` element + wire `toast` into both webviews

**Files:**
- Create: `src/webview/elements/Toaster.tsx`
- Modify: `src/webview/elements/index.ts` (export it)
- Modify: `src/webview/sidebar/SidebarApp.tsx` + `src/webview/editor/EditorApp.tsx` (handle `toast` → `pushToast`; render `<Toaster/>`)
- Modify: `src/webview/theme.css` (toast styles)
- Test: `test/webview/Toaster.test.tsx`

**REQUIRES `frontend-design` skill** for the toast visual (stacked, top/bottom-right, error=danger accent / info=neutral, subtle enter + auto-dismiss). Keep it restrained — a toast is a utility, not the page's signature.

**Interfaces:**
- Consumes: store `toasts`/`dismissToast`.
- Produces: `<Toaster/>` renders the store's toast queue; each toast auto-dismisses after ~4s and on click; `error` vs `info` styling. Both `SidebarApp` and `EditorApp` add `if (m.type === 'toast') pushToast(m.level, m.message)` to their `onHostMessage` handler and render `<Toaster/>` at the app root.

- [ ] **Step 1: Write the failing test** — `test/webview/Toaster.test.tsx`

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toaster } from '../../src/webview/elements/Toaster'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => { useStore.getState().__reset(); vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())

describe('Toaster', () => {
  it('renders queued toasts and auto-dismisses them', () => {
    render(<Toaster />)
    act(() => { useStore.getState().pushToast('error', 'read only') })
    expect(screen.getByText('read only')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText('read only')).toBeNull()
  })
})
```

(Match the repo's existing webview test setup — check another `test/webview/*.test.tsx` for the render/jsdom config + whether `@testing-library/react` is the harness. If the repo uses a different render helper, use it. If `@testing-library/react` is not a dependency, follow whatever the existing webview component tests use; do NOT add a new test framework.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/Toaster.test.tsx`
Expected: FAIL — no `Toaster`.

- [ ] **Step 3: Implement `src/webview/elements/Toaster.tsx`**

```tsx
import { useEffect } from 'react'
import { useStore } from '../state/store'

function Toast({ id, level, message }: { id: string; level: 'error' | 'info'; message: string }) {
  const dismiss = useStore((s) => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 4000)
    return () => clearTimeout(t)
  }, [id, dismiss])
  return (
    <div className={`rm-toast rm-toast--${level}`} role="status" onClick={() => dismiss(id)}>
      {message}
    </div>
  )
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="rm-toaster" aria-live="polite">
      {toasts.map((t) => <Toast key={t.id} {...t} />)}
    </div>
  )
}
```

Export from `src/webview/elements/index.ts`: `export { Toaster } from './Toaster'`.

Add to `src/webview/theme.css` (adapt to the design system; example structure):

```css
.rm-toaster { position: fixed; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; max-width: 320px; }
.rm-toast { padding: 8px 12px; border-radius: var(--rm-radius, 4px); font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground); }
.rm-toast--error { border-left-color: var(--vscode-notificationsErrorIcon-foreground); }
```

- [ ] **Step 4: Wire both apps**

In `SidebarApp.tsx` and `EditorApp.tsx`: in the `onHostMessage((m) => {...})` handler add `else if (m.type === 'toast') useStore.getState().pushToast(m.level, m.message)` (or via a `pushToast` selector). Render `<Toaster />` just before the app's closing root element. Import `Toaster` from `../elements`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/webview/Toaster.test.tsx`
Expected: PASS.

- [ ] **Step 6: `frontend-design` visual check + typecheck + build**

Invoke `frontend-design` to refine the toast styling against the theme (both light/dark). Run: `npx tsc --noEmit && npm run build` → clean/succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/webview/elements/Toaster.tsx src/webview/elements/index.ts src/webview/sidebar/SidebarApp.tsx src/webview/editor/EditorApp.tsx src/webview/theme.css test/webview/Toaster.test.tsx
git commit -m "feat(ui): Toaster element + render toast messages in both webviews"
```

---

### Task 3: Viewer read-only UX — hide/disable edit controls + role badge

**Files:**
- Modify: sidebar views that expose edit controls — `src/webview/views/Sidebar/Sidebar.tsx`, `src/webview/views/SidebarHeader/SidebarHeader.tsx`, `src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx`, `src/webview/views/RequestPanel/RequestPanel.tsx` (Save)
- Test: `test/webview/viewer-readonly.test.tsx`

**REQUIRES `frontend-design` skill** for the role badge (a small, quiet chip near the workspace name: `Owner`/`Editor`/`Viewer`) and for the disabled-state treatment (dim, not jarring). Restraint: don't redesign the sidebar — just gate the affordances.

**Interfaces:**
- Consumes: store `isViewer()` + `activeWorkspace()`.
- Produces: when the active workspace role is `viewer`, edit affordances are hidden or disabled: "New Request", "New Collection", per-item rename/delete/+folder/+request, drag-and-drop add, environment create/rename/delete, and the RequestPanel "Save". A `Viewer`/`Editor`/`Owner` role badge shows next to the active workspace. Non-mutating actions (open, send, view history/env values) stay enabled. (The router already blocks a slipped-through mutation with a toast — this is the UX layer.)

- [ ] **Step 1: Write the failing test** — `test/webview/viewer-readonly.test.tsx`

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'

beforeEach(() => useStore.getState().__reset())

describe('viewer read-only UX', () => {
  it('hides the new-workspace/edit affordances is NOT the switcher concern, but shows a role badge for a viewer', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.getByText(/viewer/i)).toBeTruthy() // role badge visible
  })
  it('shows no viewer badge for an owner', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Mine', role: 'owner' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.queryByText(/viewer/i)).toBeNull()
  })
})
```

(Pick the component + assertions that actually match where you put the badge; the test above targets the switcher's role badge. Add a second focused test for a disabled control if a component exposes one cleanly — e.g. that `RequestPanel`'s Save button is `disabled` when `isViewer()` is true. Reuse the repo's existing webview test harness.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/viewer-readonly.test.tsx`
Expected: FAIL — no role badge yet.

- [ ] **Step 3: Implement the gating + badge**

- In `WorkspaceSwitcher.tsx`: read `const isViewer = useStore((s) => s.isViewer())` and `const active = useStore((s) => s.activeWorkspace())`; render a role badge `<span className="rm-role-badge">{active?.role}</span>` (only when `active?.role` is set and not owner, or always show — designer's call per the mockup); hide/disable the "new workspace"/rename/delete affordances when `isViewer` (a viewer can't manage the shared workspace's membership from here, but CAN still switch workspaces).
- In `Sidebar.tsx` / `SidebarHeader.tsx`: guard the "New Request"/"New Collection"/rename/delete/+folder controls with `if (!isViewer)` (hide) or `disabled={isViewer}`.
- In `RequestPanel.tsx`: `disabled={isViewer}` on the Save control (and skip the autosave `postToHost('saveRequest')` when `isViewer` — the router would reject it anyway, but avoid the toast spam by not sending). Read `const isViewer = useStore((s) => s.isViewer())`.
- Add `.rm-role-badge` to `theme.css` (small chip: `font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--rm-surface-2); color: var(--vscode-descriptionForeground);`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/viewer-readonly.test.tsx`
Expected: PASS.

- [ ] **Step 5: `frontend-design` refine + typecheck + build**

Invoke `frontend-design` for the badge + disabled treatment. Run: `npx tsc --noEmit && npm test && npm run build` → all green/clean/succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/webview/views/Sidebar/Sidebar.tsx src/webview/views/SidebarHeader/SidebarHeader.tsx src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx src/webview/views/RequestPanel/RequestPanel.tsx src/webview/theme.css test/webview/viewer-readonly.test.tsx
git commit -m "feat(ui): viewer read-only affordances + role badge"
```

---

### Task 4: Router `MembersPort` + member message handlers

**Files:**
- Modify: `src/extension/messaging.ts`
- Test: `test/extension/messaging.test.ts` (extend)

**Interfaces:**
- Consumes: the new `openMembers`/`loadMembers`/`addMember`/`removeMember` WebviewMessages; `showMembers`/`members` HostMessages.
- Produces: `RouterDeps` gains `members?: { list(workspaceId: string): Promise<Member[]>; add(workspaceId: string, email: string, role: 'editor'|'viewer'): Promise<void>; remove(workspaceId: string, memberId: string): Promise<void> }`. Router cases:
  - `openMembers` → `{ type: 'showMembers', workspaceId: msg.workspaceId }`
  - `loadMembers` → `{ type: 'members', members: await deps.members.list(msg.workspaceId) }` (empty list if `deps.members` absent)
  - `addMember` → `await deps.members.add(...)` then `{ type: 'members', members: await deps.members.list(...) }`
  - `removeMember` → `await deps.members.remove(...)` then refreshed `members`
  - Member ops are NOT in the `isMutating` set (they don't push a snapshot), so the viewer read-only gate does not block them — and add/remove is owner-only, enforced server-side anyway (a viewer's add → the backend 403s → the host surfaces a toast; see Task 5).

- [ ] **Step 1: Add failing tests** — extend `test/extension/messaging.test.ts`

```ts
  it('openMembers returns showMembers', async () => {
    const route = createRouter({ ...baseDeps(makeCollections()), getActiveWorkspaceId: () => 'w1' })
    expect(await route({ type: 'openMembers', workspaceId: 'w1' } as any)).toEqual({ type: 'showMembers', workspaceId: 'w1' })
  })
  it('loadMembers returns the members list from the port', async () => {
    const members = { list: async () => [{ email: 'o@x.com', role: 'owner', pending: false }], add: async () => {}, remove: async () => {} }
    const route = createRouter({ ...baseDeps(makeCollections()), getActiveWorkspaceId: () => 'w1', members })
    expect(await route({ type: 'loadMembers', workspaceId: 'w1' } as any)).toEqual({ type: 'members', members: [{ email: 'o@x.com', role: 'owner', pending: false }] })
  })
  it('addMember calls the port then returns the refreshed list', async () => {
    const added: any[] = []
    const members = { list: async () => added.slice(), add: async (_w: string, email: string, role: string) => { added.push({ id: 'm1', email, role, pending: false }) }, remove: async () => {} }
    const route = createRouter({ ...baseDeps(makeCollections()), getActiveWorkspaceId: () => 'w1', members })
    const reply = await route({ type: 'addMember', workspaceId: 'w1', email: 'e@x.com', role: 'editor' } as any)
    expect(reply).toEqual({ type: 'members', members: [{ id: 'm1', email: 'e@x.com', role: 'editor', pending: false }] })
  })
```

(Adapt `baseDeps`/`makeCollections` to the file's real helpers, as in DS-Phase-5b-core Task 4.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL — those cases hit the default/unknown branch.

- [ ] **Step 3: Add the port + cases in `src/extension/messaging.ts`**

Add `Member` to the shared-types import. Add to `RouterDeps`:

```ts
  members?: { list(workspaceId: string): Promise<import('../shared/types').Member[]>; add(workspaceId: string, email: string, role: 'editor' | 'viewer'): Promise<void>; remove(workspaceId: string, memberId: string): Promise<void> }
```

Add cases (near the `openEnvironments` case):

```ts
      case 'openMembers':
        return { type: 'showMembers', workspaceId: msg.workspaceId }
      case 'loadMembers':
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
      case 'addMember':
        await deps.members?.add(msg.workspaceId, msg.email, msg.role)
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
      case 'removeMember':
        await deps.members?.remove(msg.workspaceId, msg.memberId)
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/extension/messaging.ts test/extension/messaging.test.ts
git commit -m "feat(sync): router MembersPort + member message handlers"
```

---

### Task 5: Host wiring — `MembersPort` from `SyncClient`, panel open, sidebar entry

**Files:**
- Modify: `src/extension/panel.ts` (build the `MembersPort` from `SyncClient`; wire into `createRouter`; `Hub.setOpen` handles `showMembers` → open a `members` panel; surface a 403 on member ops as a toast)
- Modify: `src/webview/views/SidebarHeader/SidebarHeader.tsx` or `WorkspaceSwitcher.tsx` (a "Members"/"Share" action for the active workspace → `postToHost({ type: 'openMembers', workspaceId })`, shown for owner)
- Test: none new (host wiring — covered by typecheck/build; the port logic is thin over the tested `SyncClient`)

**Interfaces:**
- Consumes: the `SyncClient` instance already built in `panel.ts`'s sync runtime (DS-Phase 3/5b-core); `SyncClient.listMembers/addMember/removeMember`; `RouterDeps.members`; `RestmanPanel.openOrReveal`.
- Produces:
  - `panel.ts` builds `const membersPort = { list: (id) => syncClient.listMembers(id), add: (id, email, role) => syncClient.addMember(id, { email, role }).then(() => {}), remove: (id, mid) => syncClient.removeMember(id, mid) }` and passes `members: membersPort` into `createRouter({...})`. To surface a 403 (e.g. a viewer/non-owner attempting add, or a stale UI), wrap each port method so a `SyncForbiddenError` becomes a `hub`-broadcast `toast` (`hubRef?.refresh` is snapshot-only; add a small helper `hubRef?.emitTo` is per-sink — simplest: catch in the port and re-broadcast a toast via a new `broadcastToast(message)` that posts a `{type:'toast'}` to all sinks). Concretely, add a `broadcastToast` closure that calls `hub`'s broadcast (expose a `hub.toast(message)` or reuse the existing broadcast path) — see Step 2.
  - `Hub.setOpen` in `panel.ts` gains: `else if (m.type === 'showMembers') RestmanPanel.openOrReveal(context, 'members', 'Members', m)`.
  - A UI entry (owner-only) posts `openMembers`.

- [ ] **Step 1: Build the port + wire the router + panel open in `panel.ts`**

- Construct the port over the existing `syncClient` (the one created in the sync-runtime block):

```ts
  const broadcastToast = (level: 'error' | 'info', message: string) => hub.refresh && emitToastToAll(hub, level, message)
```

Simpler and concrete: add a tiny helper on the Hub. In `hub.ts` add `toast(level: 'error'|'info', message: string) { this.broadcast({ type: 'toast', level, message }) }` (a public method that broadcasts a toast HostMessage to every sink). Then in `panel.ts`:

```ts
  const membersPort = {
    list: (id: string) => syncClient.listMembers(id),
    add: async (id: string, email: string, role: 'editor' | 'viewer') => {
      try { await syncClient.addMember(id, { email, role }) }
      catch (e) { if (e instanceof SyncForbiddenError) { hub.toast('error', 'Only the owner can add members.'); return } throw e }
    },
    remove: async (id: string, memberId: string) => {
      try { await syncClient.removeMember(id, memberId) }
      catch (e) { if (e instanceof SyncForbiddenError) { hub.toast('error', 'Only the owner can remove members.'); return } throw e }
    },
  }
```

- Add `members: membersPort` to the `createRouter({ ... })` deps.
- In `hub.setOpen((m) => { ... })`, add: `else if (m.type === 'showMembers') { RestmanPanel.openOrReveal(context, 'members', 'Members', m) }`.
- Import `SyncForbiddenError` in `panel.ts`.

Add `toast` to `hub.ts`:

```ts
  toast(level: 'error' | 'info', message: string): void { this.broadcast({ type: 'toast', level, message }) }
```

- [ ] **Step 2: Add the owner-only "Members" entry in the webview**

In `WorkspaceSwitcher.tsx` (or `SidebarHeader.tsx`), add a "Members" / "Share" `IconButton` (icon e.g. `organization` or `person-add`) shown when the active workspace role is `owner` (`useStore((s) => s.activeWorkspace()?.role === 'owner')`), which posts `postToHost({ type: 'openMembers', workspaceId: active.id })`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/extension/panel.ts src/extension/hub.ts src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx
git commit -m "feat(sync): wire MembersPort + members panel open + owner Members entry"
```

---

### Task 6: Members panel view (the Invite/Members UI)

**Files:**
- Create: `src/webview/views/Members/Members.tsx`
- Modify: `src/webview/editor/EditorApp.tsx` (handle `showMembers` → `membersMode` + load; render `<Members/>` when `membersMode`)
- Modify: `src/webview/theme.css` (members/invite styles)
- Test: `test/webview/Members.test.tsx`

**REQUIRES `frontend-design` skill** — build to the supplied **Invite / Members mockup**: header "Invite to Workspace" + close ✕, info banner, `Name, email, or group name` input, `Role` dropdown (Editor/Viewer), `Copy Invite Link` + `Send Invite` (disabled until a valid email), and the members list (email · role · pending tag · remove ✕ for owner). Theme-adaptive, `rm-*` classes, no raw hex.

**Interfaces:**
- Consumes: store `members`/`setMembers`/`membersWorkspaceId`, `postToHost`.
- Produces: `<Members/>` — on mount / when `membersWorkspaceId` is set, posts `loadMembers`; renders the list + the add form (email input + role select + Send Invite → `addMember`); a member's remove ✕ (owner rows excluded / no remove) → `removeMember`. The `members` HostMessage updates the store (handled in `EditorApp`). Owner controls (add/remove) shown only when the current user's role for this workspace is `owner` — derive from the members list (the owner entry's email === the signed-in email) OR simplest: always show add/remove and let the backend 403 → toast (Task 5) gate it. Prefer showing add/remove only when the active workspace role (`activeWorkspace()?.role`) is `owner`.

- [ ] **Step 1: Write the failing test** — `test/webview/Members.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Members } from '../../src/webview/views/Members/Members'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

beforeEach(() => useStore.getState().__reset())

describe('Members view', () => {
  it('loads members on mount and renders the list', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner' }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    useStore.getState().setMembers([{ email: 'o@x.com', role: 'owner', pending: false }, { id: 'm1', email: 'e@x.com', role: 'editor', pending: false }])
    render(<Members />)
    expect(post).toHaveBeenCalledWith({ type: 'loadMembers', workspaceId: 'w1' })
    expect(screen.getByText('e@x.com')).toBeTruthy()
  })
  it('Send Invite posts addMember with the typed email + role', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner' }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    render(<Members />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'new@x.com' } })
    fireEvent.click(screen.getByText(/send invite/i))
    expect(post).toHaveBeenCalledWith({ type: 'addMember', workspaceId: 'w1', email: 'new@x.com', role: 'editor' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/Members.test.tsx`
Expected: FAIL — no `Members`.

- [ ] **Step 3: Implement `src/webview/views/Members/Members.tsx`**

Build the component to the mockup. Skeleton (the `frontend-design` pass refines layout/spacing/classes):

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { IconButton } from '../../elements'

export function Members() {
  const members = useStore((s) => s.members)
  const workspaceId = useStore((s) => s.membersWorkspaceId)
  const isOwner = useStore((s) => s.activeWorkspace()?.role === 'owner')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')

  useEffect(() => {
    if (workspaceId) postToHost({ type: 'loadMembers', workspaceId })
  }, [workspaceId])

  const valid = /\S+@\S+\.\S+/.test(email)
  const invite = () => {
    if (!workspaceId || !valid) return
    postToHost({ type: 'addMember', workspaceId, email, role })
    setEmail('')
  }
  const remove = (memberId: string) => { if (workspaceId) postToHost({ type: 'removeMember', workspaceId, memberId }) }

  return (
    <div className="rm-members">
      <div className="rm-members-head"><span className="rm-section-title">Invite to Workspace</span></div>
      {isOwner && (
        <div className="rm-invite-banner">Inviting people makes this a team workspace.</div>
      )}
      {isOwner && (
        <div className="rm-invite-form">
          <input className="rm-input" placeholder="Name, email, or group name" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="rm-select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="rm-btn rm-btn--primary" disabled={!valid} onClick={invite}>Send Invite</button>
        </div>
      )}
      <div className="rm-members-list">
        {members.map((m) => (
          <div key={m.id ?? m.email} className="rm-member-row">
            <span className="rm-member-email">{m.email}</span>
            <span className="rm-role-badge">{m.role}{m.pending ? ' · pending' : ''}</span>
            {isOwner && m.id && m.role !== 'owner' && (
              <IconButton icon="close" label={`remove ${m.email}`} onClick={() => remove(m.id!)} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire `EditorApp`**

In `EditorApp.tsx`: add store selectors `membersMode`/`setMembersMode`/`setMembersWorkspaceId`/`setMembers`. In the `onHostMessage` handler add:

```ts
      } else if (m.type === 'showMembers') {
        setMembersMode(true); setMembersWorkspaceId(m.workspaceId)
      } else if (m.type === 'members') {
        setMembers(m.members)
```

Render `<Members/>` when `membersMode` (alongside the other mode branches — e.g. `if (membersMode) return <Members/>` in the panel-selection block, or add it to the conditional render). Import `Members`. Also post a `setTitle('Members')` when `membersMode` (mirror how env/ws set the tab title).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/webview/Members.test.tsx`
Expected: PASS.

- [ ] **Step 6: `frontend-design` build-out + `run` verification**

Invoke `frontend-design` to bring the Members panel to the mockup (header/close, banner, form, list, pending tags, remove). Then invoke the `run` skill: launch the extension, open a workspace's Members panel, screenshot it, and verify against the mockup (light + dark). Iterate until it matches.

- [ ] **Step 7: Typecheck + build + commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green/clean/succeeds.

```bash
git add src/webview/views/Members/Members.tsx src/webview/editor/EditorApp.tsx src/webview/theme.css test/webview/Members.test.tsx
git commit -m "feat(ui): Members/invite panel (list + invite + remove)"
```

---

### Task 7: WorkspaceSwitcher popup polish

**Files:**
- Modify: `src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx` (+ a popup subcomponent if it grows)
- Modify: `src/webview/theme.css`
- Test: `test/webview/workspace-switcher.test.tsx` (light behavioral test)

**REQUIRES `frontend-design` skill + `run` verification** — build to the supplied **switcher popup mockup**: `Search Workspaces` input + `Create Workspace`; sections `Recently Visited` / `More Workspaces`; each row = active check + role/type icon (single-user = owned, two-user = shared) + name; active row flagged. Adapt to restman's theme; keep it a focused popup, not a redesign of the sidebar.

**Interfaces:**
- Consumes: store `workspaces` (with `role`), `activeWorkspaceId`, `useWorkspace()` (`select`/`create`).
- Produces: the switcher opens a popup listing workspaces with search-filtering, an active check, and a role/type icon (owned vs shared derived from `role === 'owner'`). "Recently Visited" can be the active + last-selected (a small local recents list) and "More Workspaces" the rest — or, if recents aren't tracked, a single list is acceptable for this pass; the section headers + icons + search are the mockup essentials.

- [ ] **Step 1: Write a light behavioral test** — `test/webview/workspace-switcher.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => useStore.getState().__reset())

describe('WorkspaceSwitcher popup', () => {
  it('filters workspaces by the search box', () => {
    useStore.getState().setWorkspaces([{ id: 'a', name: 'Alpha', role: 'owner' }, { id: 'b', name: 'Beta', role: 'editor' }], 'a')
    render(<WorkspaceSwitcher />)
    // open the popup (adapt to however the switcher toggles it) then type
    fireEvent.click(screen.getByLabelText(/workspaces|switch/i))
    fireEvent.change(screen.getByPlaceholderText(/search workspaces/i), { target: { value: 'bet' } })
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByText('Beta')).toBeTruthy()
  })
})
```

(Adapt the popup-open interaction to the actual toggle you build; if the current `ComboInput` already provides the dropdown, extend it or replace it with a dedicated popup — the mockup implies a richer popup than `ComboInput`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/webview/workspace-switcher.test.tsx`
Expected: FAIL — no search / popup.

- [ ] **Step 3: Build the popup**

Implement the popup per the mockup (search input, sections, rows with check + role icon + name). Reuse `useWorkspace()` for `select`/`create`. Add `rm-ws-popup`/`rm-ws-row`/`rm-ws-section` styles to `theme.css`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/webview/workspace-switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: `frontend-design` + `run` verification**

Invoke `frontend-design` for the popup visual, then `run` to launch + screenshot the switcher (light + dark) and match the mockup.

- [ ] **Step 6: Typecheck + build + commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green/clean/succeeds.

```bash
git add src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher.tsx src/webview/theme.css test/webview/workspace-switcher.test.tsx
git commit -m "feat(ui): workspace switcher popup polish (search + sections + role icons)"
```

---

### Task 8: Manual verification doc + full `run`

**Files:**
- Create: `docs/sync-phase-5b-ui-verification.md`

- [ ] **Step 1: Full `run` pass**

Invoke the `run` skill: launch the extension with two accounts (or a mocked backend), and walk the whole sharing UX: owner opens Members → invites an email → sees it appear (pending) → the member (other window) sees the workspace → viewer sees edit controls hidden + a role badge + a read-only toast on an attempted edit → owner removes the member. Screenshot the Members panel, the switcher popup, and a viewer's read-only sidebar. Fix any visual/interaction issues found.

- [ ] **Step 2: Create `docs/sync-phase-5b-ui-verification.md`**

```markdown
# Drive Sync DS-Phase 5b-ui — manual verification (sharing UX)

Prereq: DS-Phase 5a + 5b-core running; two Google accounts; both in restman.

## A. Members panel (owner)
1. As OWNER, open the active synced workspace's **Members** entry → the Members panel opens.
2. Enter a MEMBER email, pick a role (Editor/Viewer), **Send Invite** → the member appears in the list (pending if no account yet); Google emails them (DS-Phase 5a).
3. Remove a member with the ✕ → they disappear and lose access.

## B. Viewer read-only UX
1. Share as **Viewer**; the MEMBER's active workspace shows a **Viewer** role badge; New Request/Collection, rename, delete, +folder, and Save are hidden/disabled.
2. Any attempted mutation surfaces a read-only **toast**; the local tree doesn't change.
3. Open/send a request, view history/environment values — still work.

## C. Toasts
1. A viewer edit attempt and a sync/permission error both render a toast (auto-dismiss + click-to-dismiss), in both the sidebar and editor surfaces.

## D. Switcher popup
1. Open the workspace switcher → search filters the list; owned vs shared workspaces show distinct role/type icons; the active workspace is checked. Create Workspace works.
```

- [ ] **Step 3: Commit**

```bash
git add docs/sync-phase-5b-ui-verification.md
git commit -m "docs: Drive sync phase 5b-ui verification"
```

---

## Self-Review

**Spec coverage (DS-Phase 5 extension UI half):**
- Members list + add-by-email + role + remove, owner-only (spec line 79) → Tasks 4-6. ✓
- Viewer read-only, extension disables edits (spec line 160) → Task 3 (UX) on top of DS-Phase-5b-core's router gate (enforcement). ✓
- Owner/role badge + status (spec line 78) → Task 3 badge. ✓
- Error/conflict toasts (spec line 80) → Task 2 (`Toaster`) rendering the `toast` HostMessage + Task 5's 403→toast. ✓
- Workspace panel + switcher (spec line 74, mockups) → Task 7 switcher polish; the Members panel (Task 6) is the sharing surface. ✓

Explicitly deferred: "Sign in with Google / Sign out" panel chrome + per-workspace sync toggle already exist as commands (Phase 2); a fuller Workspace settings panel and "owner deletes workspace → keep a local copy" prompt are DS-Phase 6.

**Placeholder scan:** the logic/wiring tasks (1, 4, 5) and the toast/members/store mechanics carry full code. The three visual tasks (3, 6, 7) supply complete component skeletons + the exact message contracts + the mockup reference, and REQUIRE the `frontend-design` skill + `run` verification to finish the visual layer — this is the honest right level for pixel-level UI in an existing design system (the plan can't pre-specify every class; the skill + mockup + screenshot loop do). Tests pin the behavior (badge present for viewer, invite posts the right message, search filters, toast auto-dismisses); `frontend-design`/`run` pin the look.

**Type consistency:** `WorkspaceRole`/`Member` (Task 1, shared/types) used by the store, router `MembersPort` (Task 4), `panel.ts` port (Task 5), and the Members view (Task 6). `Workspace.role?` (Task 1) drives `isViewer`/`activeWorkspace` (store) → Task 3 gating + Task 5 owner entry + Task 6 owner controls. New messages (`openMembers`/`showMembers`/`loadMembers`/`members`/`addMember`/`removeMember`) are added to the unions in Task 1 and consumed in Tasks 4/5/6. `hub.toast(level,message)` (Task 5) broadcasts the `toast` HostMessage rendered by `Toaster` (Task 2). The member-ops port adapts `SyncClient.addMember(id,{email,role})` → `add(id,email,role)`.

**Enforcement-vs-UX check:** the UI never becomes the security boundary — a hidden/disabled control is UX; the router gate (DS-Phase-5b-core) blocks any slipped mutation and the server 403s a viewer/non-owner regardless (Task 5 turns that 403 into a toast). A stale role showing an enabled button is harmless. No task weakens the server/router enforcement.

**Integration risk called out:** `panel.ts`/`EditorApp` wiring (Tasks 5, 6) and all pixel-level visuals are not unit-tested — the store, router handlers, toast mechanics, members data flow, and switcher filtering ARE unit-tested; the end-to-end sharing UX + the mockup fidelity are verified by the `run` screenshot passes (Tasks 6, 7, 8). The `members` HostMessage reply from the router is followed by `panel.ts`'s snapshot broadcast (which carries `role`), so the workspace list stays role-tagged even after a member op.
