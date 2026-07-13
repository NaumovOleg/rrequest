# restman UI v2 Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the sidebar/editor per feedback — a text "Environments" button opening the env editor, collection rows = add-folder/add-request + a settings popup (rename/delete/export), request rows = rename-only, folder icons, single-tab first open, drag-and-drop requests between folders/collections, tooltips, restored last workspace.

**Architecture:** A `PopupMenu` for collection settings; a `moveRequest` message the router applies across collections (load-mutate-save both, rebroadcast tree); `openOrReplaceBlank` in the store so `openInEditor` reuses a pristine blank tab; native HTML5 DnD in the tree.

**Tech Stack:** existing TS + React + Zustand + Vitest + codicons.

## Global Constraints

- No storage writes in the webview; `moveRequest` mutates via the router (load both collections, move, `saveCollection` each, return fresh `tree`).
- `openInEditor` must REUSE a pristine blank tab (name "New Request"/"Untitled", empty url, no params/headers, body `none`, empty scripts) when it's the active tab — so the first open shows ONE tab, not two.
- Env CRUD lives in the editor's Environments view; the sidebar only has a text "Environments" button (posts `openEnvironments`) — remove the workspace env icon buttons.
- Collection row inline actions = add-folder + add-request + a settings gear (popup: Rename/Delete/Export native/Export postman). Request rows = rename only (drop the delete icon). Folder rows show a folder codicon.
- Every button (icon and text) has a `title` tooltip. Keep all existing aria-labels/selectors that tests rely on. No hard-coded hex on themed surfaces.
- TDD; `npx tsc --noEmit` clean each task; `npm run build` before the final commit; small commits. Keep the suite green.

---

## Task 1: Shared types — moveRequest

**Files:** Modify `src/shared/types.ts`; Test `test/shared/move-types.test.ts`

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import type { WebviewMessage } from '../../src/shared/types'
describe('moveRequest type', () => {
  it('type-checks', () => {
    const m: WebviewMessage = { type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, toCollectionId: 'c2', toFolderId: 'f1', requestId: 'r1' }
    expect(m.type).toBe('moveRequest')
  })
})
```
- [ ] **Step 2: run → FAIL** `npx vitest run test/shared/move-types.test.ts`
- [ ] **Step 3: implement** — append to `WebviewMessage`:
```ts
  | { type: 'moveRequest'; fromCollectionId: string; fromFolderId: string | null; toCollectionId: string; toFolderId: string | null; requestId: string }
```
- [ ] **Step 4: run → PASS + tsc** `npx vitest run test/shared/move-types.test.ts && npx tsc --noEmit`
- [ ] **Step 5: commit** `git commit -m "feat: moveRequest message type"`

---

## Task 2: Router — moveRequest route

**Files:** Modify `src/extension/messaging.ts`; Test `test/extension/messaging.test.ts` (append)

**Interface:** `moveRequest` → load the source + dest collections (may be the same), remove the request from `(fromFolderId ? folder.requests : root requests)`, add it to the dest bucket, `saveCollection` each changed collection, return fresh `tree`.

- [ ] **Step 1: failing test (append)**
```ts
it('moveRequest moves a request between collections and saves both', async () => {
  const d = deps()
  const req = { id: 'r1', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
  d.collections.list = vi.fn(async () => [
    { id: 'c1', name: 'A', workspaceId: 'w1', requests: [req], folders: [] },
    { id: 'c2', name: 'B', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] },
  ])
  const out = await routerAll(d)({ type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, toCollectionId: 'c2', toFolderId: 'f1', requestId: 'r1' }) as any
  const saved = (d.collections.saveCollection as any).mock.calls.map((c: any) => c[0])
  const src = saved.find((c: any) => c.id === 'c1'); const dst = saved.find((c: any) => c.id === 'c2')
  expect(src.requests).toHaveLength(0)
  expect(dst.folders[0].requests).toHaveLength(1)
  expect(out.type).toBe('tree')
})
```
(`routerAll(d)` = the existing full-deps router builder used by other tests; reuse it.)
- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: implement** — add a case (before `default`) + a helper:
```ts
      case 'moveRequest': {
        const all = await deps.collections.list()
        const from = all.find((c) => c.id === msg.fromCollectionId)
        const to = all.find((c) => c.id === msg.toCollectionId)
        if (!from || !to) return { type: 'tree', collections: all }
        const fromBucket = bucketOf(from, msg.fromFolderId)
        const req = fromBucket?.find((r) => r.id === msg.requestId)
        if (!req || !fromBucket) return { type: 'tree', collections: all }
        // remove from source
        const idx = fromBucket.findIndex((r) => r.id === msg.requestId)
        fromBucket.splice(idx, 1)
        // add to dest
        const toBucket = bucketOf(to, msg.toFolderId)
        if (toBucket) toBucket.push(req)
        await deps.collections.saveCollection(from)
        if (to.id !== from.id) await deps.collections.saveCollection(to)
        return { type: 'tree', collections: await deps.collections.list() }
      }
```
Add a module-level helper (reuse the existing `reqBucket` if present, else):
```ts
function bucketOf(c: import('../shared/types').Collection, folderId: string | null) {
  if (folderId) return (c.folders ?? []).find((f) => f.id === folderId)?.requests
  return c.requests
}
```
(If `reqBucket` already exists from earlier, reuse it and skip this.)
- [ ] **Step 4: run → PASS + tsc + esbuild** `npx vitest run test/extension/messaging.test.ts && npx tsc --noEmit && node esbuild.js`
- [ ] **Step 5: commit** `git commit -m "feat: router moveRequest between folders/collections"`

---

## Task 3: Store — openOrReplaceBlank

**Files:** Modify `src/webview/state/store.ts`; Test `test/webview/store.test.ts` (append)

**Interface:** `openOrReplaceBlank(patch: Partial<RestRequest>)` — if the active tab is a pristine blank (name 'New Request' or 'Untitled', url '', params [], headers [], body.mode 'none', no scripts), replace it in place with `{ ...blank, ...patch, id: <keep active id> }` and keep it active; else `openNewTab()` then `updateActive(patch)`.

- [ ] **Step 1: failing test (append)**
```ts
describe('store openOrReplaceBlank', () => {
  it('reuses a pristine blank tab instead of opening a second', () => {
    useStore.getState().openNewTab()                 // one pristine blank
    useStore.getState().openOrReplaceBlank({ name: 'Opened', method: 'POST', url: 'https://z' })
    expect(useStore.getState().tabs).toHaveLength(1)
    expect(useStore.getState().tabs[0].url).toBe('https://z')
  })
  it('opens a new tab when the active tab is not blank', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ url: 'https://used' })  // active now non-blank
    useStore.getState().openOrReplaceBlank({ url: 'https://z' })
    expect(useStore.getState().tabs).toHaveLength(2)
  })
})
```
- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: implement** — add to `State` `openOrReplaceBlank(patch: Partial<RestRequest>): void` and to the store body:
```ts
  openOrReplaceBlank: (patch) => set((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId)
    const isBlank = active && (active.name === 'New Request' || active.name === 'Untitled')
      && !active.url && active.params.length === 0 && active.headers.length === 0
      && active.body.mode === 'none' && !active.preRequestScript && !active.testScript
    if (active && isBlank) {
      return { tabs: s.tabs.map((t) => (t.id === active.id ? { ...t, ...patch } : t)) }
    }
    const r = blankRequest()
    return { tabs: [...s.tabs, { ...r, ...patch }], activeTabId: r.id }
  }),
```
(Uses the existing `blankRequest()`.)
- [ ] **Step 4: run → PASS + tsc**
- [ ] **Step 5: commit** `git commit -m "feat: store openOrReplaceBlank reuses a pristine blank tab"`

---

## Task 4: EditorApp — single tab on first open

**Files:** Modify `src/webview/editor/EditorApp.tsx`; Test `test/webview/EditorApp.test.tsx` (append)

**Change:** in the `openInEditor` handler, use `openOrReplaceBlank({ name, method, url, params, headers, body, preRequestScript, testScript })` INSTEAD of `openNewTab()` + `updateActive(...)`, and still set the pending save targets. So a fresh editor (one blank tab from mount) + first `openInEditor` = one tab.

- [ ] **Step 1: failing test (append)**
```ts
it('opening a request into a fresh editor yields exactly one tab', () => {
  render(<EditorApp />)          // mount opens a pristine blank
  act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'GET', url: 'https://z', params: [], headers: [], body: { mode: 'none' } } }))
  expect(useStore.getState().tabs).toHaveLength(1)
  const active = useStore.getState().tabs[0]
  expect(active.url).toBe('https://z')
})
```
- [ ] **Step 2: run → FAIL (currently 2 tabs)**
- [ ] **Step 3: implement** — replace the `openInEditor` body's `openNewTab()`+`updateActive(...)` with `openOrReplaceBlank({...the request fields...})`; keep `setPendingSaveCollectionId`/`setPendingSaveFolderId`. Swap the `openNewTab`/`updateActive` selectors for `openOrReplaceBlank` (add the selector; keep `openNewTab` if the mount-blank still uses it).
- [ ] **Step 4: run → PASS + tsc**
- [ ] **Step 5: commit** `git commit -m "fix(ui): first request opens a single tab (reuse blank)"`

---

## Task 5: PopupMenu component

**Files:** Create `src/webview/components/common/PopupMenu.tsx`; Test `test/webview/PopupMenu.test.tsx`; theme.css

**Interface:** `<PopupMenu icon label items />` where `items: { label: string; icon?: string; onClick: () => void }[]`. Renders an `IconButton`(icon,label) that toggles an absolutely-positioned menu of the items; clicking an item runs its onClick + closes; clicking outside closes.

- [ ] **Step 1: failing test**
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PopupMenu } from '../../src/webview/components/common/PopupMenu'
describe('PopupMenu', () => {
  it('opens on click and fires an item', () => {
    const onClick = vi.fn()
    render(<PopupMenu icon="gear" label="settings" items={[{ label: 'Delete', onClick }]} />)
    expect(screen.queryByText('Delete')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    fireEvent.click(screen.getByText('Delete'))
    expect(onClick).toHaveBeenCalled()
    expect(screen.queryByText('Delete')).toBeNull()   // closed after click
  })
})
```
- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: implement**
```tsx
import { useState, useEffect, useRef } from 'react'
import { IconButton } from './IconButton'
export function PopupMenu({ icon, label, items }: { icon: string; label: string; items: { label: string; icon?: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <span className="rm-popup" ref={ref} style={{ position: 'relative' }}>
      <IconButton icon={icon} label={label} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="rm-popup-menu" role="menu">
          {items.map((it, i) => (
            <button key={i} className="rm-popup-item" role="menuitem"
              onClick={(e) => { e.stopPropagation(); it.onClick(); setOpen(false) }}>
              {it.icon && <span className={`codicon codicon-${it.icon}`} />} {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
```
theme.css append:
```css
.rm-popup-menu { position: absolute; right: 0; top: 100%; z-index: 10; min-width: 160px; background: var(--rm-panel-bg); border: 1px solid var(--rm-border); border-radius: var(--rm-radius); box-shadow: 0 2px 8px rgba(0,0,0,.3); padding: 2px; }
.rm-popup-item { display: flex; align-items: center; gap: var(--rm-sp-1); width: 100%; text-align: left; background: transparent; border: none; color: var(--rm-fg); padding: 4px 8px; cursor: pointer; border-radius: var(--rm-radius); }
.rm-popup-item:hover { background: var(--rm-hover); }
.rm-drop-over { outline: 1px dashed var(--rm-accent); outline-offset: -1px; }
```
- [ ] **Step 4: run → PASS + tsc**
- [ ] **Step 5: commit** `git commit -m "feat(ui): PopupMenu component"`

---

## Task 6: WorkspaceSwitcher — Environments text button (drop env icons)

**Files:** Modify `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx`; Test `test/webview/WorkspaceSwitcher.test.tsx` (adjust)

**Change:** remove the two env IconButtons (`new environment`, `environments`); add ONE text button `<button className="rm-btn" title="Environments" onClick={() => postToHost({ type:'openEnvironments' })}>Environments</button>`. Keep workspace select + create + rename(edit icon)/delete(trash icon). Every button gets a `title`.

- [ ] **Step 1: adjust the test** — replace the "add-env + open-env icons" test with: clicking the `Environments` text button (`getByRole('button', { name: /environments/i })`) posts `openEnvironments`; assert there is NO `new environment` icon anymore (`queryByRole('button', { name: /new environment/i })` is null). Keep rename/delete/create/select tests.
- [ ] **Step 2: run → FAIL / Step 3: implement** per above; add `title` to all buttons.
- [ ] **Step 4: run → PASS + tsc**
- [ ] **Step 5: commit** `git commit -m "feat(ui): sidebar Environments text button; drop env icons"`

---

## Task 7: Sidebar — collection popup, request rename-only, folder icon, DnD

**Files:** Modify `src/webview/components/Sidebar/Sidebar.tsx`; Test `test/webview/Sidebar.test.tsx` (adjust + append); theme.css (drop-over already added Task 5)

**Changes (keep existing selectors/aria-labels that tests use; keep collapse/expand + inline rename from UI v2):**
- **Collection row actions** reduce to: `IconButton add`/`new folder in <name>` (createFolder), `IconButton add`/`add request to <name>` (openRequest blank + targetCollectionId), and a `PopupMenu` (gear, label `collection settings <name>`) with items: **Rename** (→ enter inline rename mode), **Delete** (`deleteCollection`), **Export native** (`exportCollection` native), **Export postman** (`exportCollection` postman). Remove the standalone rename/delete/export icon buttons from the row (they move into the popup). Keep the `export native for <name>`/`export postman for <name>` semantics — but note: the existing tests reference those aria-labels on buttons; since export moves into the popup, UPDATE those tests to open the popup then click the "Export native"/"Export postman" menu items (not a weakening — same posted message). Do the same for delete (`delete collection <name>` → the popup's Delete item).
- **Folder rows**: add a folder codicon before the name — `<span className={`codicon codicon-folder${expanded ? '-opened' : ''}`} />`. Keep the folder actions (rename via edit icon, delete via trash, add request). Folder rows are DROP TARGETS.
- **Request rows**: keep ONLY the rename (edit) icon — REMOVE the delete (trash) icon. Keep the row click → openRequest and keyboard operability. Request rows are DRAGGABLE.
- **DnD**: request row `draggable onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ fromCollectionId, fromFolderId, requestId }))}`. Folder rows + collection rows: `onDragOver={(e) => { e.preventDefault(); setDropTarget(id) }}` (+ a `.rm-drop-over` class when hovered) and `onDrop={(e) => { e.preventDefault(); const p = JSON.parse(e.dataTransfer.getData('application/json')); postToHost({ type:'moveRequest', ...p, toCollectionId, toFolderId }) }}`.

- [ ] **Step 1: adjust + append tests**
- Update the existing delete-collection test to open the settings popup then click Delete; update export tests to open the popup then click Export native/postman.
- Append:
```ts
it('collection settings popup has Rename/Delete/Export and posts', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
  fireEvent.click(screen.getByText(/export postman/i))
  expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'postman' })
})
it('request row has no delete icon (rename only)', () => {
  const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('C'))
  expect(screen.getByRole('button', { name: /rename request Req/i })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /delete request Req/i })).toBeNull()
})
it('dropping a request on a folder posts moveRequest', () => {
  const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('C'))
  const folderRow = screen.getByText('F').closest('.rm-tree-row')!
  const data: any = { types: ['application/json'], getData: () => JSON.stringify({ fromCollectionId: 'c1', fromFolderId: null, requestId: 'r1' }), setData: () => {} }
  fireEvent.drop(folderRow, { dataTransfer: data })
  expect(posted).toContainEqual({ type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, requestId: 'r1', toCollectionId: 'c1', toFolderId: 'f1' })
})
```
- [ ] **Step 2: run → FAIL**
- [ ] **Step 3: implement** per the changes above (PopupMenu for collection settings; folder codicon; request rename-only; draggable requests + droppable folders/collections posting moveRequest). Keep the `add request to <name>` / `rename request <name>` / `new folder in <name>` aria-labels.
- [ ] **Step 4: run → PASS + tsc**
- [ ] **Step 5: commit** `git commit -m "feat(ui): collection settings popup, request rename-only, folder icon, drag-and-drop"`

---

## Task 8: Full gate + smoke

**Files:** Create `docs/superpowers/plans/ui-v2-round2-smoke-checklist.md`

- [ ] **Step 1: gate** `npx vitest run && npx tsc --noEmit && npm run build` (verify codicon files present)
- [ ] **Step 2: write the checklist**
```markdown
# UI v2 Round 2 Smoke Checklist

Press F5 → open restman.

- [ ] Reopen the extension → the last-selected workspace is active in the switcher.
- [ ] A text "Environments" button sits by the workspace; clicking it opens the Environments manager in the editor.
- [ ] Every button shows a tooltip on hover.
- [ ] Expand a collection → folder-tree look; folders show a folder icon; each folder expands to its requests.
- [ ] Collection row shows only add-folder + add-request + a settings (gear) button; the gear opens a popup with Rename / Delete / Export native / Export postman.
- [ ] A request row in the sidebar has only a rename action.
- [ ] Drag a request onto a folder (or another collection) → it moves there (tree updates).
- [ ] Open a request in a fresh editor → exactly ONE tab opens (no stray blank).
- [ ] Theme light↔dark re-themes everything incl. icons.
```
- [ ] **Step 3: manual run** — F5, follow it; fix issues.
- [ ] **Step 4: commit** `git add -A && git commit -m "chore: ui v2 round 2 smoke checklist"`

---

## Self-Review Notes

- **Spec coverage:** moveRequest type (1) + router route (2); openOrReplaceBlank store (3) + EditorApp single-tab (4); PopupMenu (5); Environments text button (6); collection settings popup + request rename-only + folder icon + DnD (7); gate + smoke (8).
- **Type consistency:** `moveRequest` fields (1) match the router route (2) and the Sidebar drop payload (7). `openOrReplaceBlank(Partial<RestRequest>)` (3) matches the EditorApp call (4). `PopupMenu` items API (5) matches the Sidebar collection settings usage (7).
- **No-behavior-loss:** the delete/export controls move into the popup (same posted messages, tests updated to drive the popup — not weakened); request rows keep click-open + keyboard; env-in-editor path unchanged (just the trigger becomes a text button).
