# restman Editor Entry Points + Collection Tree UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor reachable and collections usable — a "New Request" action and per-collection "+ Request" open the editor with a blank request (the latter pre-targeting that collection for Save), the editor always shows a tab when open, and collections expand/collapse.

**Architecture:** The sidebar posts `openRequest{ request, targetCollectionId? }`; the host reveals the editor and forwards `openInEditor{ request, targetCollectionId? }`. The editor opens the tab and stores `pendingSaveCollectionId`, which RequestPanel's Save dropdown initializes from. EditorApp opens a blank tab on mount if none. Expand/collapse is local Sidebar state.

**Tech Stack:** existing TypeScript + React + Zustand + Vitest. No new deps.

## Global Constraints

- `openRequest`/`openInEditor` carry an OPTIONAL `targetCollectionId?: string` — absent for the global New Request, set to the collection id for per-collection "+ Request".
- A "blank request" = `{ id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }`.
- The editor and sidebar are separate webview instances (separate stores); the target collection travels only via the message, never via a shared store.
- Keep ALL existing tests passing. `rm-*` styling only. TDD; run `npx tsc --noEmit` each task and confirm clean; small commits.

---

## Task 1: Shared types — targetCollectionId on openRequest/openInEditor

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/target-collection-types.test.ts`

- [ ] **Step 1: Write the failing test**

`test/shared/target-collection-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { WebviewMessage, HostMessage, RestRequest } from '../../src/shared/types'

const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }

describe('targetCollectionId', () => {
  it('openRequest and openInEditor accept an optional targetCollectionId', () => {
    const a: WebviewMessage = { type: 'openRequest', request: req, targetCollectionId: 'c1' }
    const b: WebviewMessage = { type: 'openRequest', request: req }
    const c: HostMessage = { type: 'openInEditor', request: req, targetCollectionId: 'c1' }
    expect(a.type).toBe('openRequest'); expect(b.type).toBe('openRequest'); expect(c.type).toBe('openInEditor')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/target-collection-types.test.ts`
Expected: FAIL — `targetCollectionId` not on the arms.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, change the two arms to add the optional field:
```ts
  | { type: 'openRequest'; request: RestRequest; targetCollectionId?: string }
```
```ts
  | { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shared/target-collection-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/target-collection-types.test.ts
git commit -m "feat: optional targetCollectionId on openRequest/openInEditor"
```

---

## Task 2: Store — pendingSaveCollectionId slice

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('store pendingSaveCollectionId', () => {
  it('sets and resets pendingSaveCollectionId', () => {
    useStore.getState().setPendingSaveCollectionId('c1')
    expect(useStore.getState().pendingSaveCollectionId).toBe('c1')
    useStore.getState().__reset()
    expect(useStore.getState().pendingSaveCollectionId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/state/store.ts` add to the `State` type:
```ts
  pendingSaveCollectionId: string | null
  setPendingSaveCollectionId(id: string | null): void
```
Add to the store body:
```ts
  pendingSaveCollectionId: null,
  setPendingSaveCollectionId: (pendingSaveCollectionId) => set({ pendingSaveCollectionId }),
```
Add `pendingSaveCollectionId: null` to the object in `__reset` (keep all existing fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: store pendingSaveCollectionId slice"
```

---

## Task 3: EditorApp — blank tab on mount + targetCollectionId handling

**Files:**
- Modify: `src/webview/editor/EditorApp.tsx`
- Test: `test/webview/EditorApp.test.tsx` (append)

- [ ] **Step 1: Write the failing tests (append)**

```ts
it('opens a blank tab on mount when there are no tabs', () => {
  expect(useStore.getState().tabs).toHaveLength(0)
  render(<EditorApp />)
  expect(useStore.getState().tabs).toHaveLength(1)
})

it('openInEditor with targetCollectionId sets pendingSaveCollectionId', () => {
  render(<EditorApp />)
  act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }, targetCollectionId: 'c9' }))
  expect(useStore.getState().pendingSaveCollectionId).toBe('c9')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/EditorApp.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/webview/editor/EditorApp.tsx`:
- Add the store selectors near the others:
```tsx
  const setPendingSaveCollectionId = useStore((s) => s.setPendingSaveCollectionId)
```
- In the `openInEditor` branch, after the existing `openNewTab()` + `updateActive(...)`, set the pending target:
```tsx
      else if (m.type === 'openInEditor') {
        const r = m.request
        openNewTab()
        updateActive({ name: r.name, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body, preRequestScript: r.preRequestScript ?? '', testScript: r.testScript ?? '' })
        setPendingSaveCollectionId(m.targetCollectionId ?? null)
      }
```
- At the END of the mount effect (before `return off`), open a blank tab if none exist:
```tsx
    if (useStore.getState().tabs.length === 0) openNewTab()
    return off
```
- Add `setPendingSaveCollectionId` to the effect dependency array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/EditorApp.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor/EditorApp.tsx test/webview/EditorApp.test.tsx
git commit -m "feat: editor opens a blank tab on mount and honors targetCollectionId"
```

---

## Task 4: Sidebar — New Request, per-collection + Request, expand/collapse

**Files:**
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/Sidebar.test.tsx` (append)

- [ ] **Step 1: Write the failing tests (append)**

```ts
it('New Request posts openRequest with a blank request and no target', () => {
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: /new request/i }))
  const msg = posted.find((m) => m.type === 'openRequest')
  expect(msg).toBeTruthy()
  expect(msg.request.name).toBe('New Request')
  expect(msg.targetCollectionId).toBeUndefined()
})

it('collections collapse/expand: requests hidden until the collection is clicked', () => {
  const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
  render(<Sidebar />)
  expect(screen.queryByText('Get Users')).toBeNull()          // collapsed by default
  fireEvent.click(screen.getByText('My Coll'))
  expect(screen.getByText('Get Users')).toBeInTheDocument()   // expanded
})

it('+ Request on a collection posts openRequest with that collection as target', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('My Coll'))                 // expand to reveal + Request
  fireEvent.click(screen.getByRole('button', { name: /add request to My Coll/i }))
  const msg = posted.filter((m) => m.type === 'openRequest').pop()
  expect(msg.targetCollectionId).toBe('c1')
  expect(msg.request.name).toBe('New Request')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite `src/webview/components/Sidebar/Sidebar.tsx`:
```tsx
import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type RestRequest } from '../../../shared/types'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Collections</strong>
        <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: blankRequest() })}>New Request</button>
        <button className="rm-btn" onClick={() => postToHost({ type: 'importCollection' })}>Import</button>
        <button className="rm-btn" onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })}>+ New</button>
      </div>
      {tree.map((c) => (
        <div key={c.id}>
          <div className="rm-row">
            <button className="rm-btn" onClick={() => toggle(c.id)}>{expanded.has(c.id) ? '▾' : '▸'} {c.name}</button>
            <button className="rm-btn" aria-label={`export native for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'native' })}>Export native</button>
            <button className="rm-btn" aria-label={`export postman for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' })}>Export postman</button>
          </div>
          {expanded.has(c.id) && (
            <div>
              <ul>
                {c.requests.map((r) => (
                  <li key={r.id}>
                    <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: r })}>{r.name}</button>
                  </li>
                ))}
              </ul>
              <button className="rm-btn" aria-label={`add request to ${c.name}`}
                onClick={() => postToHost({ type: 'openRequest', request: blankRequest(), targetCollectionId: c.id })}>+ Request</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```
Note: the collection name toggle uses a `<button>` whose accessible name contains `c.name` (`▸ My Coll`), so the test's `getByText('My Coll')` still matches the visible text node inside the button; `fireEvent.click(screen.getByText('My Coll'))` clicks it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/Sidebar.test.tsx && npx tsc --noEmit`
Expected: PASS. (The existing Sidebar tests that click a request name must first expand the collection — if an existing test renders a request without expanding, update it to click the collection name first. Do NOT weaken assertions; add the expand click.)

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Sidebar/Sidebar.tsx test/webview/Sidebar.test.tsx
git commit -m "feat: sidebar New Request, per-collection + Request, expand/collapse"
```

---

## Task 5: RequestPanel — Save dropdown defaults to pendingSaveCollectionId

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx` (append)

- [ ] **Step 1: Write the failing test (append)**

```ts
it('the Save collection dropdown initializes from pendingSaveCollectionId', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [] }, { id: 'c2', name: 'C2', workspaceId: 'w1', requests: [] }])
  useStore.getState().setPendingSaveCollectionId('c2')
  render(<RequestPanel />)
  expect((screen.getByLabelText(/save to collection/i) as HTMLSelectElement).value).toBe('c2')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: FAIL — the dropdown defaults to `''`.

- [ ] **Step 3: Implement**

In `src/webview/components/RequestPanel/RequestPanel.tsx`:
- Import `useEffect`:
```tsx
import { useEffect, useState } from 'react'
```
- Add a selector for the pending id near the other `useStore` calls:
```tsx
  const pendingSaveCollectionId = useStore((s) => s.pendingSaveCollectionId)
```
- After the `const [saveCollectionId, setSaveCollectionId] = useState('')` line, add an effect that adopts the pending id when it changes:
```tsx
  useEffect(() => {
    if (pendingSaveCollectionId) setSaveCollectionId(pendingSaveCollectionId)
  }, [pendingSaveCollectionId])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Full suite + build + commit**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; both bundles build.
```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat: Save dropdown defaults to the pending target collection"
```

---

## Task 6: Manual smoke — editor entry points

**Files:**
- Create: `docs/superpowers/plans/ux-editor-entry-smoke-checklist.md`

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Write the checklist**

`docs/superpowers/plans/ux-editor-entry-smoke-checklist.md`:
```markdown
# Editor Entry Points Smoke Checklist

Press F5 → click the restman activity-bar icon.

- [ ] Sidebar shows a "New Request" button; clicking it opens the editor panel with a blank request tab.
- [ ] The editor, once open, always shows a request (no empty "No request open").
- [ ] Create a collection → it appears collapsed (▸); clicking its name expands (▾) and shows its (empty) request list + a "+ Request" button.
- [ ] "+ Request" on a collection opens a blank request in the editor with that collection pre-selected in the Save dropdown; Send + Save writes the request into that collection; it appears under the collection when expanded.
- [ ] Clicking an existing request under an expanded collection opens it in the editor.
- [ ] Collapse a collection → its requests hide.
```

- [ ] **Step 3: Manually run it**

Press F5, follow the checklist. Fix failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/ux-editor-entry-smoke-checklist.md
git commit -m "chore: editor entry points smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** targetCollectionId on messages (1); pendingSaveCollectionId store (2); editor blank-tab-on-mount + targetCollectionId → pending (3); sidebar New Request + per-collection + Request + expand/collapse (4); Save dropdown default (5); manual smoke (6).
- **Type consistency:** `targetCollectionId?` optional on both `openRequest`/`openInEditor` (1) matches sidebar posting (4) and editor reading (3); `pendingSaveCollectionId`/`setPendingSaveCollectionId` consistent between store (2), editor (3), and RequestPanel (5). Blank request shape matches `blankRequest()` including the Phase-4 script fields.
- **Cross-webview:** the target collection flows only via the message (sidebar → host → editor), never a shared store, since the two webviews have separate store instances.
