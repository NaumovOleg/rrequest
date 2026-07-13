# restman UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postman-extension-like UI — VS Code codicons + icon action bars that wrap, inline rename + delete for workspaces/collections/folders/requests, collection folders (one-level nested tree), and the Environments manager opening in the editor.

**Architecture:** Codicons bundled into `media/` and linked in both webview HTMLs (CSP `font-src`). Icon actions via a shared `IconButton`; inline rename via a `RenameInput`. Folders add `Collection.folders: Folder[]`; the router mutates collections (load-mutate-`saveCollection`) for rename/delete/folder ops and rebroadcasts `tree`. Environments moves to an editor `envMode` toggle (mirrors `wsMode`), driven by a sidebar icon.

**Tech Stack:** TypeScript, `@vscode/codicons` (new dep), existing VS Code + React + Zustand + Vitest.

## Global Constraints

- Codicons live ONLY in the host-copied `media/codicon.{css,ttf}`; the webview HTML links `codicon.css` (webview URI) and the CSP gains `font-src ${cspSource}`. The `@font-face` `./codicon.ttf` resolves under `localResourceRoots(media)`.
- New `Collection.folders` and message fields are OPTIONAL/additive where possible (`folders?`, `folderId?`, `targetFolderId?`) so existing literals/tsc stay green; absent `folders` = `[]`.
- Rename/delete/folder mutations happen in the extension host (router load-mutate-`saveCollection`); every mutation returns/rebroadcasts a fresh `tree`. No webview ever writes storage.
- Inline rename is icon-triggered (edit icon → input → Enter commits/Escape cancels); delete is a trash icon.
- Environments renders in the editor (`envMode`), not the sidebar. The active-env dropdown stays in the editor top bar.
- Keep ALL existing behavior tests passing; where a text button became an icon, keep the SAME `aria-label` so selectors still match. No hard-coded hex on themed surfaces.
- TDD; `npx tsc --noEmit` clean each task; `npm run build` before the final commit; small commits.

---

## Task 1: Codicons — dep, build copy, CSP + link, IconButton, theme

**Files:**
- Modify: `package.json`, `esbuild.js`, `src/extension/panel.ts` (buildHtml + wiring), `src/extension/sidebar-view.ts` (buildSidebarHtml + wiring), `src/webview/theme.css`
- Create: `src/webview/components/common/IconButton.tsx`
- Test: `test/extension/panel.test.ts` (extend), `test/webview/IconButton.test.tsx`

**Interfaces:**
- Produces: codicons available in both webviews; `<IconButton icon label onClick/>` rendering `<button className="rm-icon-btn" aria-label={label} title={label}><span className={`codicon codicon-${icon}`}/></button>`.

- [ ] **Step 1: Write the failing tests**

`test/webview/IconButton.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconButton } from '../../src/webview/components/common/IconButton'
describe('IconButton', () => {
  it('renders a codicon with an aria-label and fires onClick', () => {
    const onClick = vi.fn()
    render(<IconButton icon="edit" label="rename" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'rename' })
    expect(btn.querySelector('.codicon.codicon-edit')).toBeTruthy()
    fireEvent.click(btn); expect(onClick).toHaveBeenCalled()
  })
})
```

Extend `test/extension/panel.test.ts` (the buildHtml test) — buildHtml now takes a codicon uri; assert the link + font-src. Update the existing call and add:
```ts
it('links codicons and allows font-src', () => {
  const html = buildHtml('https://cdn/editor.js', 'https://cdn/editor.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC')
  expect(html).toContain('https://cdn/codicon.css')
  expect(html).toContain('font-src vscode-webview://x')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/IconButton.test.tsx test/extension/panel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the dependency + build copy**

`package.json` dependencies: add `"@vscode/codicons": "^0.0.45"`. Run `npm install`.
`esbuild.js` — after the esbuild build, copy the codicon assets into `media/`. Add at the top `const fs = require('node:fs')` and, in `main()` after the build/`ctx.watch()`, a copy step:
```js
function copyCodicons() {
  fs.mkdirSync('media', { recursive: true })
  const src = 'node_modules/@vscode/codicons/dist'
  fs.copyFileSync(`${src}/codicon.css`, 'media/codicon.css')
  fs.copyFileSync(`${src}/codicon.ttf`, 'media/codicon.ttf')
}
```
Call `copyCodicons()` in both the watch and non-watch branches after building. NOTE: `vite build` runs with `emptyOutDir: true` which wipes `media/` — so the codicon copy must run AFTER vite. Change the build script order in `package.json` so esbuild+codicon-copy runs LAST, or copy in a tiny standalone step. Simplest: change the `build` script to `RM_ENTRY=editor vite build && RM_ENTRY=sidebar vite build && node esbuild.js` (esbuild + codicon copy last, after vite has emptied+written media). Keep `watch` as `node esbuild.js --watch`.

- [ ] **Step 4: buildHtml/buildSidebarHtml — codicon link + font-src**

In `src/extension/panel.ts` `buildHtml`, change the signature to `buildHtml(scriptUri, styleUri, codiconUri, cspSource, nonce)`; in the CSP add `font-src ${cspSource};`; add `<link rel="stylesheet" href="${codiconUri}" />` in `<head>`. Where `buildHtml` is called (the panel constructor), compute `codiconUri = panel.webview.asWebviewUri(Uri.joinPath(extensionUri,'media','codicon.css')).toString()` and pass it.
In `src/extension/sidebar-view.ts` `buildSidebarHtml`, same: add a codicon uri param, `font-src ${cspSource}`, the `<link>`, and compute+pass the codicon uri in `resolveWebviewView`.

- [ ] **Step 5: IconButton + theme**

`src/webview/components/common/IconButton.tsx`:
```tsx
export function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="rm-icon-btn" aria-label={label} title={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}>
      <span className={`codicon codicon-${icon}`} />
    </button>
  )
}
```
Append to `src/webview/theme.css`:
```css
.rm-icon-btn { background: transparent; border: none; color: var(--rm-fg); cursor: pointer; padding: 2px 4px; border-radius: var(--rm-radius); display: inline-flex; align-items: center; }
.rm-icon-btn:hover { background: var(--rm-hover); }
.rm-icon-btn:disabled { opacity: .4; cursor: default; }
.rm-actions { display: flex; flex-wrap: wrap; gap: var(--rm-sp-1); align-items: center; }
.rm-row { flex-wrap: wrap; }
.codicon { font-size: 15px; line-height: 1; }
```

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS; tsc clean; build emits `media/editor.js`+`media/sidebar.js`+their css AND `media/codicon.css`+`media/codicon.ttf` (verify both codicon files exist after `npm run build`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): codicons in webviews + IconButton + action wrapping"
```

---

## Task 2: Shared types — Folder, folders, targets, item/env message arms

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/shared/uiv2-types.test.ts`

- [ ] **Step 1: Write the failing test**

`test/shared/uiv2-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { Folder, Collection, WebviewMessage, HostMessage, RestRequest } from '../../src/shared/types'
const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }
describe('ui v2 types', () => {
  it('Folder + Collection.folders type-check', () => {
    const f: Folder = { id: 'f1', name: 'Auth', requests: [req] }
    const c: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [f] }
    expect(c.folders?.[0].name).toBe('Auth')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'renameCollection', id: 'c1', name: 'N' }
    const b: WebviewMessage = { type: 'deleteRequest', collectionId: 'c1', folderId: null, requestId: 'r1' }
    const c: WebviewMessage = { type: 'createFolder', collectionId: 'c1', name: 'F' }
    const d: WebviewMessage = { type: 'saveRequest', collectionId: 'c1', folderId: 'f1', request: req }
    const e: WebviewMessage = { type: 'openRequest', request: req, targetCollectionId: 'c1', targetFolderId: 'f1' }
    const f: WebviewMessage = { type: 'openEnvironments' }
    const g: HostMessage = { type: 'showEnvironments' }
    const h: HostMessage = { type: 'openInEditor', request: req, targetCollectionId: 'c1', targetFolderId: 'f1' }
    expect([a.type, b.type, c.type, d.type, e.type, f.type, g.type, h.type]).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shared/uiv2-types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`:
- Add `Folder` and extend `Collection` (folders optional for back-compat):
```ts
export type Folder = { id: string; name: string; requests: RestRequest[] }
export type Collection = { id: string; name: string; workspaceId: string; requests: RestRequest[]; folders?: Folder[] }
```
- Change the `saveRequest` arm to add `folderId?`:
```ts
  | { type: 'saveRequest'; collectionId: string; folderId?: string | null; request: RestRequest }
```
- Change `openRequest`/`openInEditor` to add `targetFolderId?`:
```ts
  | { type: 'openRequest'; request: RestRequest; targetCollectionId?: string; targetFolderId?: string | null }
```
```ts
  | { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string; targetFolderId?: string | null }
```
- Append the new WebviewMessage arms:
```ts
  | { type: 'renameCollection'; id: string; name: string }
  | { type: 'deleteCollection'; id: string }
  | { type: 'renameRequest'; collectionId: string; folderId: string | null; requestId: string; name: string }
  | { type: 'deleteRequest'; collectionId: string; folderId: string | null; requestId: string }
  | { type: 'createFolder'; collectionId: string; name: string }
  | { type: 'renameFolder'; collectionId: string; folderId: string; name: string }
  | { type: 'deleteFolder'; collectionId: string; folderId: string }
  | { type: 'openEnvironments' }
```
- Append the new HostMessage arm:
```ts
  | { type: 'showEnvironments' }
```

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/shared/uiv2-types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (folders optional → no existing Collection literal breaks).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts test/shared/uiv2-types.test.ts
git commit -m "feat: Folder type, collection folders, item/env message arms"
```

---

## Task 3: CollectionStore — delete + folder-aware saveRequest

**Files:**
- Modify: `src/extension/collection-store.ts`
- Test: `test/extension/collection-store.test.ts` (append)

**Interfaces:**
- Produces: `CollectionStore.delete(id): Promise<void>`; `saveRequest(collectionId, request, folderId?): Promise<Collection>` — upserts into the folder's `requests` when `folderId` is given (creating the folders array as needed), else into the collection root `requests`.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('deletes a collection', async () => {
  const c = await store.createCollection('X', 'w1')
  await store.delete(c.id)
  expect(await store.list()).toEqual([])
})
it('saveRequest into a folder upserts into that folder', async () => {
  const c = await store.createCollection('X', 'w1')
  await store.saveCollection({ ...c, folders: [{ id: 'f1', name: 'F', requests: [] }] })
  const r = { id: 'r1', name: 'req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  await store.saveRequest(c.id, r, 'f1')
  const all = await store.list()
  expect(all[0].folders?.[0].requests).toHaveLength(1)
  expect(all[0].requests).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/collection-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/extension/collection-store.ts`, add a `delete` method and make `saveRequest` folder-aware:
```ts
  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
```
Change `saveRequest`:
```ts
  async saveRequest(collectionId: string, request: RestRequest, folderId?: string | null): Promise<Collection> {
    const c = (await readJsonSafe<Collection>(this.file(collectionId)))
      ?? { id: collectionId, name: 'Collection', workspaceId: '', requests: [], folders: [] }
    if (!c.folders) c.folders = []
    if (folderId) {
      const folder = c.folders.find((f) => f.id === folderId)
      if (folder) {
        const i = folder.requests.findIndex((r) => r.id === request.id)
        if (i >= 0) folder.requests[i] = request; else folder.requests.push(request)
      }
    } else {
      const i = c.requests.findIndex((r) => r.id === request.id)
      if (i >= 0) c.requests[i] = request; else c.requests.push(request)
    }
    await writeJsonAtomic(this.file(collectionId), c)
    return c
  }
```
(Ensure `fs` and `readJsonSafe`/`writeJsonAtomic` are already imported — they are.)

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/extension/collection-store.test.ts && npx tsc --noEmit`
Expected: PASS; tsc will flag the router's `saveRequest(collectionId, request)` call — that is fixed in Task 5. Confirm collection-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/extension/collection-store.ts test/extension/collection-store.test.ts
git commit -m "feat: CollectionStore delete + folder-aware saveRequest"
```

---

## Task 4: Postman converter — preserve one level of folders

**Files:**
- Modify: `src/extension/postman.ts`
- Test: `test/extension/postman.test.ts` (adjust/extend)

**Interfaces:**
- `toNative`: Postman `item` entries with a nested `item[]` become `Folder`s (their request children become the folder's `requests`); top-level requests go to the collection root `requests`. `fromNative`: emits `folders` as nested-`item[]` groups plus root requests.

- [ ] **Step 1: Update the failing test**

In `test/extension/postman.test.ts`, the existing `toNative` "flattens folders" test must change to assert folders are PRESERVED. Replace that test's expectations:
```ts
it('preserves one level of folders and root requests', () => {
  const c = toNative(pm)
  expect(c.requests).toHaveLength(1)             // "Get Users" at root
  expect(c.requests[0].name).toBe('Get Users')
  expect(c.folders).toHaveLength(1)
  expect(c.folders?.[0].name).toBe('Folder')
  expect(c.folders?.[0].requests[0].name).toBe('Create')
})
```
Add a fromNative folder test:
```ts
it('fromNative emits folders as nested items', () => {
  const c = { id: '1', name: 'API', workspaceId: 'w1', requests: [], folders: [{ id: 'f', name: 'Auth', requests: [
    { id: 'a', name: 'Login', method: 'POST' as const, url: 'https://x', params: [], headers: [], body: { mode: 'none' as const } },
  ] }] }
  const pmOut = fromNative(c as any)
  const folderItem = pmOut.item.find((i: any) => i.name === 'Auth')
  expect(folderItem.item).toHaveLength(1)
  expect(folderItem.item[0].name).toBe('Login')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/postman.test.ts`
Expected: FAIL — current code flattens.

- [ ] **Step 3: Implement**

Rewrite `toNative` so the top-level walk separates folders from requests (one level; deeper nesting flattens into the nearest folder). Replace the flatten call:
```ts
export function toNative(pm: any): Collection {
  const rootReqs: RestRequest[] = []
  const folders: Folder[] = []
  for (const it of pm?.item ?? []) {
    if (Array.isArray(it.item)) {
      const fReqs: RestRequest[] = []
      collectRequests(it.item, fReqs)
      folders.push({ id: newId(), name: String(it.name ?? 'Folder'), requests: fReqs })
    } else if (it.request) {
      rootReqs.push(pmRequestToNative(it))
    }
  }
  return { id: newId(), name: String(pm?.info?.name ?? 'Imported'), workspaceId: '', requests: rootReqs, folders }
}
```
where `collectRequests(items, out)` recursively pushes any `it.request` (via `pmRequestToNative`) found at any depth, and `pmRequestToNative(it)` is the existing per-request mapping (extract the current `flatten` body that builds one `RestRequest` from `it.request` into a helper `pmRequestToNative(it): RestRequest`, dropping the folder-prefix name logic — the name is just `it.name`). Import `Folder` from shared/types.
Update `fromNative` to also emit folders:
```ts
export function fromNative(c: Collection): any {
  const item: any[] = c.requests.map(nativeRequestItem)
  for (const f of c.folders ?? []) {
    item.push({ name: f.name, item: f.requests.map(nativeRequestItem) })
  }
  return { info: { name: c.name, schema: V21 }, item }
}
```
where `nativeRequestItem(r)` is the existing per-request `{ name, request:{...} }` builder (extract it from the current `fromNative`).

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/extension/postman.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension/postman.ts test/extension/postman.test.ts
git commit -m "feat: postman converter preserves one level of folders"
```

---

## Task 5: Router — item management + folder save + openEnvironments

**Files:**
- Modify: `src/extension/messaging.ts`
- Test: `test/extension/messaging.test.ts` (append)

**Interfaces:**
- New routes (all mutate via `deps.collections` load-`saveCollection`/`delete`, then return a fresh `tree`): `renameCollection`, `deleteCollection`, `renameRequest`, `deleteRequest`, `createFolder`, `renameFolder`, `deleteFolder`. `saveRequest` passes `msg.folderId` to `deps.collections.saveRequest`. `openRequest` forwards `targetFolderId`. `openEnvironments` → `{ type:'showEnvironments' }` (targeted to editor via the Hub's openInEditor path — treat `showEnvironments` like `openInEditor` in the Hub).

- [ ] **Step 1: Write the failing tests (append)**

Extend the `collections` mock in `deps()` with `delete: vi.fn(async () => {})` and make `list` return a collection with a folder for the folder tests. Add:
```ts
describe('createRouter item + folder routes', () => {
  function r(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
  }
  it('deleteCollection deletes and returns tree', async () => {
    const d = deps()
    const out = await r(d)({ type: 'deleteCollection', id: 'c1' }) as any
    expect(d.collections.delete).toHaveBeenCalledWith('c1')
    expect(out.type).toBe('tree')
  })
  it('renameCollection loads, renames, saves', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'Old', workspaceId: 'w1', requests: [], folders: [] }])
    await r(d)({ type: 'renameCollection', id: 'c1', name: 'New' })
    expect(d.collections.saveCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'New' }))
  })
  it('createFolder adds a folder and saves', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    await r(d)({ type: 'createFolder', collectionId: 'c1', name: 'Auth' })
    const saved = (d.collections.saveCollection as any).mock.calls[0][0]
    expect(saved.folders).toHaveLength(1)
    expect(saved.folders[0].name).toBe('Auth')
  })
  it('saveRequest forwards folderId', async () => {
    const d = deps()
    await r(d)({ type: 'saveRequest', collectionId: 'c1', folderId: 'f1', request: req() })
    expect(d.collections.saveRequest).toHaveBeenCalledWith('c1', expect.anything(), 'f1')
  })
  it('openEnvironments returns showEnvironments', async () => {
    const out = await r(deps())({ type: 'openEnvironments' })
    expect(out).toEqual({ type: 'showEnvironments' })
  })
})
```
Also update the `collections.saveRequest` mock to accept the third arg (it already accepts extra args via vi.fn).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/messaging.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — messaging.ts**

Add a helper to load one collection by id:
```ts
  async function withCollection(id: string, fn: (c: import('../shared/types').Collection) => void) {
    const c = (await deps.collections.list()).find((x) => x.id === id)
    if (c) { fn(c); await deps.collections.saveCollection(c) }
  }
```
Change `saveRequest` route to forward folderId:
```ts
      case 'saveRequest':
        await deps.collections.saveRequest(msg.collectionId, msg.request, msg.folderId ?? null)
        return { type: 'tree', collections: await deps.collections.list() }
```
Change `openRequest` to forward the folder target:
```ts
      case 'openRequest':
        return { type: 'openInEditor', request: msg.request, targetCollectionId: msg.targetCollectionId, targetFolderId: msg.targetFolderId }
```
Add the new cases (before `default`):
```ts
      case 'deleteCollection':
        await deps.collections.delete(msg.id)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameCollection':
        await withCollection(msg.id, (c) => { c.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createFolder':
        await withCollection(msg.collectionId, (c) => { (c.folders ??= []).push({ id: newId(), name: msg.name, requests: [] }) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameFolder':
        await withCollection(msg.collectionId, (c) => { const f = (c.folders ?? []).find((x) => x.id === msg.folderId); if (f) f.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteFolder':
        await withCollection(msg.collectionId, (c) => { c.folders = (c.folders ?? []).filter((x) => x.id !== msg.folderId) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameRequest':
        await withCollection(msg.collectionId, (c) => { renameReqIn(c, msg.folderId, msg.requestId, msg.name) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteRequest':
        await withCollection(msg.collectionId, (c) => { deleteReqIn(c, msg.folderId, msg.requestId) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'openEnvironments':
        return { type: 'showEnvironments' }
```
Add module-level helpers (import `newId`, `Collection`):
```ts
function reqBucket(c: import('../shared/types').Collection, folderId: string | null) {
  if (folderId) return ((c.folders ?? []).find((f) => f.id === folderId)?.requests) ?? null
  return c.requests
}
function renameReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string, name: string) {
  const b = reqBucket(c, folderId); if (!b) return
  const r = b.find((x) => x.id === reqId); if (r) r.name = name
}
function deleteReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string) {
  if (folderId) { const f = (c.folders ?? []).find((x) => x.id === folderId); if (f) f.requests = f.requests.filter((x) => x.id !== reqId) }
  else c.requests = c.requests.filter((x) => x.id !== reqId)
}
```
Finally, the Hub must route `showEnvironments` to the editor (revealing it) like `openInEditor`. In `src/extension/hub.ts` `dispatch`, extend the targeted branch:
```ts
      else if (reply.type === 'openInEditor' || reply.type === 'showEnvironments') { this.onOpenInEditor?.(); if (this.sinks.has('editor')) this.postTo('editor', reply); else this.pendingEditor.push(reply) }
```
(Adapt to the existing structure: `showEnvironments` uses the same reveal + queue-until-registered path as `openInEditor`.)

- [ ] **Step 4: Run tests + tsc + build**

Run: `npx vitest run test/extension/messaging.test.ts test/extension/hub.test.ts && npx tsc --noEmit && node esbuild.js`
Expected: PASS; tsc clean; host bundle builds.

- [ ] **Step 5: Commit**

```bash
git add src/extension/messaging.ts src/extension/hub.ts test/extension/messaging.test.ts
git commit -m "feat: router item/folder management + openEnvironments routing"
```

---

## Task 6: Store — pendingSaveFolderId + envMode

**Files:**
- Modify: `src/webview/state/store.ts`
- Test: `test/webview/store.test.ts` (append)

**Interfaces:**
- Adds `pendingSaveFolderId: string | null` (null), `envMode: boolean` (false); actions `setPendingSaveFolderId`, `setEnvMode`; both cleared in `__reset`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('store pendingSaveFolderId + envMode', () => {
  it('set + reset', () => {
    useStore.getState().setPendingSaveFolderId('f1'); useStore.getState().setEnvMode(true)
    expect(useStore.getState().pendingSaveFolderId).toBe('f1'); expect(useStore.getState().envMode).toBe(true)
    useStore.getState().__reset()
    expect(useStore.getState().pendingSaveFolderId).toBeNull(); expect(useStore.getState().envMode).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails / Step 3: Implement**

Add to `State`: `pendingSaveFolderId: string | null`, `setPendingSaveFolderId(id: string|null): void`, `envMode: boolean`, `setEnvMode(v: boolean): void`. Store body: `pendingSaveFolderId: null,`, `setPendingSaveFolderId: (pendingSaveFolderId) => set({ pendingSaveFolderId }),`, `envMode: false,`, `setEnvMode: (envMode) => set({ envMode }),`. Add both to `__reset` (keep all existing fields).

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/webview/store.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/state/store.ts test/webview/store.test.ts
git commit -m "feat: store pendingSaveFolderId + envMode"
```

---

## Task 7: RenameInput helper component

**Files:**
- Create: `src/webview/components/common/RenameInput.tsx`
- Test: `test/webview/RenameInput.test.tsx`

**Interfaces:**
- `<RenameInput initial onCommit(name) onCancel/>` — a text input pre-filled with `initial`, auto-focused; Enter (or blur) calls `onCommit(value)` when non-empty; Escape calls `onCancel`.

- [ ] **Step 1: Write the failing test**

`test/webview/RenameInput.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RenameInput } from '../../src/webview/components/common/RenameInput'
describe('RenameInput', () => {
  it('commits on Enter and cancels on Escape', () => {
    const onCommit = vi.fn(); const onCancel = vi.fn()
    render(<RenameInput initial="Old" onCommit={onCommit} onCancel={onCancel} />)
    const input = screen.getByDisplayValue('Old')
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('New')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails / Step 3: Implement**

`src/webview/components/common/RenameInput.tsx`:
```tsx
import { useState } from 'react'
export function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const commit = () => { const v = value.trim(); if (v) onCommit(v); else onCancel() }
  return (
    <input className="rm-input rm-rename-input" autoFocus aria-label="rename input" value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      onBlur={commit} />
  )
}
```
Append to `theme.css`: `.rm-rename-input { padding: 1px 4px; }`

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/webview/RenameInput.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/common/RenameInput.tsx src/webview/theme.css test/webview/RenameInput.test.tsx
git commit -m "feat: inline RenameInput helper"
```

---

## Task 8: WorkspaceSwitcher — icon rename/delete + add-env + open-env

**Files:**
- Modify: `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx`
- Test: `test/webview/WorkspaceSwitcher.test.tsx` (adjust to icons)

**Restyle + behavior:** replace the text Rename/Delete buttons with `IconButton` (`edit`→rename, `trash`→delete) — Rename toggles a `RenameInput` (posts `renameWorkspace`), Delete posts `deleteWorkspace`. Add an `IconButton` `add` labeled "new environment" (posts `createEnvironment` with name 'New Environment') and `IconButton` `list-tree`/`gear` labeled "environments" (posts `openEnvironments`) next to the workspace select. Keep the `active workspace` select + `createWorkspace` (`+` icon) + the `setActiveWorkspace` behavior. Keep the `rename workspace`/`delete <name>` aria-labels so existing tests still match — but they're now on icon buttons.

- [ ] **Step 1: Adjust the failing tests**

Update `test/webview/WorkspaceSwitcher.test.tsx`: the rename test now clicks the `edit` icon (aria-label `rename workspace`) to reveal the input, types, Enter → posts `renameWorkspace`; the delete test clicks the `trash` icon (aria-label matches `delete`); add: clicking the `new environment` icon posts `createEnvironment`; clicking the `environments` icon posts `openEnvironments`. Keep the create/select tests.
```ts
it('rename via the edit icon posts renameWorkspace', () => {
  useStore.getState().setWorkspaces([{ id: 'w1', name: 'Dev' }], 'w1')
  render(<WorkspaceSwitcher />)
  fireEvent.click(screen.getByRole('button', { name: /rename workspace/i }))
  fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Prod' } })
  fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
  expect(posted).toContainEqual({ type: 'renameWorkspace', id: 'w1', name: 'Prod' })
})
it('add-env + open-env icons post the right messages', () => {
  useStore.getState().setWorkspaces([{ id: 'w1', name: 'Dev' }], 'w1')
  render(<WorkspaceSwitcher />)
  fireEvent.click(screen.getByRole('button', { name: /new environment/i }))
  expect(posted).toContainEqual({ type: 'createEnvironment', name: 'New Environment' })
  fireEvent.click(screen.getByRole('button', { name: /^environments$/i }))
  expect(posted).toContainEqual({ type: 'openEnvironments' })
})
```

- [ ] **Step 2: Run test / Step 3: Implement**

Import `IconButton`, `RenameInput`. Use local `const [renaming, setRenaming] = useState(false)`. Keep the workspace `<select>` and `+` create. Render rename (`edit`), delete (`trash`), `add` (new environment), `gear`/`list-tree` (environments) icon buttons; when `renaming`, show `<RenameInput initial={activeName} onCommit={(name) => { postToHost({type:'renameWorkspace', id: activeWorkspaceId, name}); setRenaming(false) }} onCancel={() => setRenaming(false)} />`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run test/webview/WorkspaceSwitcher.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx test/webview/WorkspaceSwitcher.test.tsx
git commit -m "feat(ui): workspace icon rename/delete + add/open environment icons"
```

---

## Task 9: Sidebar — folders, icon actions, inline rename, method glyph

**Files:**
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/Sidebar.test.tsx` (adjust + append)

This is the largest task. The Sidebar now renders a real Postman-like tree:
- **Collections header** (`.rm-section` + title + a `.rm-actions` toolbar of icon buttons: `add`→New Request (openRequest blank), `new-folder` N/A here, `cloud-upload`→Import, `add`→New Collection (createCollection)).
- **Each collection** (`.rm-tree-row`): caret ▸/▾, name (or `RenameInput` when renaming), and a hover `.rm-actions` toolbar: `edit`→rename (posts `renameCollection`), `trash`→delete (posts `deleteCollection`), `new-folder`→createFolder, `add`→add root request (openRequest blank with `targetCollectionId`), `cloud-download`→export (keep both native/postman as two icons or a small pick — MVP: `cloud-download` native + a `json` postman, keep existing aria-labels `export native for <name>`/`export postman for <name>`).
  - When expanded: the collection's `folders` (each a `.rm-tree-row` with caret, name/RenameInput, actions: `edit`→renameFolder, `trash`→deleteFolder, `add`→add request to folder (openRequest blank with `targetCollectionId`+`targetFolderId`)) and then the root `requests`.
  - **Request rows** (`.rm-req-row`, keyboard-operable `role=button tabIndex onKeyDown`): `<MethodBadge method={r.method}/>` then the name (or RenameInput), and hover actions: `edit`→renameRequest (with folderId null/folderId), `trash`→deleteRequest. Clicking the row (not the actions) posts `openRequest{request:r, targetCollectionId, targetFolderId?}`.

Keep the existing collapse/expand state and every existing `aria-label` reachable (`export native for <name>`, `export postman for <name>`, `add request to <name>`, and the request/collection name text nodes for `getByText`). New action icon buttons get clear aria-labels: `rename collection <name>`, `delete collection <name>`, `new folder in <name>`, `rename folder <name>`, `delete folder <name>`, `rename request <name>`, `delete request <name>`.

- [ ] **Step 1: Adjust + write the failing tests**

Keep the existing Sidebar tests working (they click collection/request name text and the `add request to <name>` / export aria-labels — preserve those). Append:
```ts
it('renders folders and their requests when expanded', () => {
  const folderReq = { id: 'fr', name: 'In Folder', method: 'POST' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [folderReq] }] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('C'))            // expand collection
  fireEvent.click(screen.getByText('Auth'))          // expand folder
  expect(screen.getByText('In Folder')).toBeInTheDocument()
})
it('new folder icon posts createFolder', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('C'))
  fireEvent.click(screen.getByRole('button', { name: /new folder in C/i }))
  expect(posted).toContainEqual({ type: 'createFolder', collectionId: 'c1', name: 'New Folder' })
})
it('delete collection icon posts deleteCollection', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: /delete collection C/i }))
  expect(posted).toContainEqual({ type: 'deleteCollection', id: 'c1' })
})
it('rename request via edit icon posts renameRequest', () => {
  const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('C'))
  fireEvent.click(screen.getByRole('button', { name: /rename request Req/i }))
  fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Renamed' } })
  fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
  expect(posted).toContainEqual({ type: 'renameRequest', collectionId: 'c1', folderId: null, requestId: 'r1', name: 'Renamed' })
})
```
(Adjust the existing `+ Request`/export tests if the button became an icon — keep the SAME aria-labels: `add request to <name>` stays, so those tests keep passing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite `Sidebar.tsx` per the structure above using `IconButton`, `RenameInput`, `MethodBadge`. Manage per-item "renaming id" local state (a `renamingId: string | null`). Keep `postToHost` for every action with the exact message shapes and aria-labels named above; keep collapse/expand `Set`s (one for collections, one for folders). The `folders` may be undefined on a collection → default `[]`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run test/webview/Sidebar.test.tsx && npx tsc --noEmit`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Sidebar/Sidebar.tsx test/webview/Sidebar.test.tsx
git commit -m "feat(ui): sidebar folders, icon actions, inline rename, method glyphs"
```

---

## Task 10: RequestPanel — folder in Save target

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx` (append)

**Change:** the Save posts `{ type:'saveRequest', collectionId, folderId: pendingSaveFolderId, request }`. Add a folder `<select aria-label="save to folder">` populated from the chosen collection's `folders` (from the store `tree`), defaulting to `pendingSaveFolderId`. When no folder chosen, folderId is null (root). Keep the existing `save to collection` select + Save disabled logic.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('Save posts the pending folder id', () => {
  useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
  useStore.getState().setPendingSaveCollectionId('c1')
  useStore.getState().setPendingSaveFolderId('f1')
  render(<RequestPanel />)
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
  const msg = posted.find((m) => m.type === 'saveRequest')
  expect(msg.collectionId).toBe('c1'); expect(msg.folderId).toBe('f1')
})
```

- [ ] **Step 2: Run test / Step 3: Implement**

Add a `pendingSaveFolderId` selector + a local `saveFolderId` state initialized from it (mirror the collection effect). Add the folder select (options from the selected collection's folders + a "root" default value `''`). On Save, post `folderId: saveFolderId || null`.

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat(ui): save request into a folder"
```

---

## Task 11: EditorApp — env mode + showEnvironments + folder target

**Files:**
- Modify: `src/webview/editor/EditorApp.tsx`
- Test: `test/webview/EditorApp.test.tsx` (append)

**Change:** handle `showEnvironments` → `setEnvMode(true)`; add an "Environments" toggle button in the top bar (like the WebSocket toggle) flipping `envMode`; when `envMode`, render `<Environments/>` (imported) instead of Tabs/RequestPanel/ResponsePanel (and it takes precedence with/над wsMode — pick one: `envMode ? <Environments/> : wsMode ? <WebSocketPanel/> : <the HTTP trio>`). Also, `openInEditor` now sets `setPendingSaveFolderId(m.targetFolderId ?? null)` alongside the collection target.

- [ ] **Step 1: Write the failing tests (append)**

```ts
it('showEnvironments opens the environments editor', () => {
  render(<EditorApp />)
  act(() => handler?.({ type: 'showEnvironments' }))
  expect(useStore.getState().envMode).toBe(true)
  expect(screen.getByText('Environments')).toBeInTheDocument()
})
it('openInEditor sets the pending folder target', () => {
  render(<EditorApp />)
  act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }, targetCollectionId: 'c1', targetFolderId: 'f1' }))
  expect(useStore.getState().pendingSaveFolderId).toBe('f1')
})
```

- [ ] **Step 2: Run test / Step 3: Implement**

Import `Environments`. Add selectors `envMode`, `setEnvMode`, `setPendingSaveFolderId`. Handle `showEnvironments` in the message handler; set folder target in `openInEditor`. Add the Environments toggle to the top bar and the conditional body precedence. Add the new setters to the effect deps.

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/webview/EditorApp.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor/EditorApp.tsx test/webview/EditorApp.test.tsx
git commit -m "feat(ui): environments editor mode + folder save target in editor"
```

---

## Task 12: SidebarApp — remove Environments section

**Files:**
- Modify: `src/webview/sidebar/SidebarApp.tsx`
- Test: `test/webview/SidebarApp.test.tsx` (adjust)

**Change:** remove `<Environments/>` from the SidebarApp composition (it now lives in the editor). Keep the `environments` host-message handler (SidebarApp still needs the env list? No — the env list is only used by the editor dropdown + editor Environments now). Keep `setEnvironments`/`setActiveEnvId` handling so the workspace switcher's add-env still reflects; but the Environments editor is in the editor bundle. SidebarApp keeps WorkspaceSwitcher + Sidebar + History.

- [ ] **Step 1: Adjust the test**

Update `test/webview/SidebarApp.test.tsx` if it asserted an Environments section in the sidebar — remove/replace that assertion (the sidebar no longer renders Environments). Keep the tree/workspaces/history assertions.

- [ ] **Step 2: Run test / Step 3: Implement**

Remove the `<Environments/>` import + render from `SidebarApp.tsx`. Keep everything else (WorkspaceSwitcher, Sidebar, History, the message handlers).

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run test/webview/SidebarApp.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/SidebarApp.tsx test/webview/SidebarApp.test.tsx
git commit -m "feat(ui): move environments out of the sidebar into the editor"
```

---

## Task 13: Full suite + build gate

- [ ] **Step 1: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS; tsc clean; build emits `media/editor.js`+`media/sidebar.js`+css AND `media/codicon.css`+`media/codicon.ttf`.

- [ ] **Step 2: Commit (if any incidental fixes were needed)**

```bash
git add -A && git commit -m "chore(ui): ui v2 full-suite green" --allow-empty
```

---

## Task 14: Manual smoke — UI v2

**Files:**
- Create: `docs/superpowers/plans/ui-v2-smoke-checklist.md`

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean; codicon files present.

- [ ] **Step 2: Write the checklist**

`docs/superpowers/plans/ui-v2-smoke-checklist.md`:
```markdown
# UI v2 Smoke Checklist

Press F5 → open restman.

- [ ] Icons render (edit/trash/add/cloud/folder) — not tofu boxes (codicon font loaded).
- [ ] Action buttons wrap to the next line when the sidebar is narrow.
- [ ] Workspace: rename via the edit icon (inline input, Enter commits); delete via the trash icon; add-environment + environments icons sit next to the workspace select.
- [ ] Clicking the environments icon opens the Environments manager IN THE EDITOR (not the sidebar); the editor top bar has an Environments toggle.
- [ ] Collection: text color matches the rest; rename (edit icon → inline), delete (trash), new folder, add request, export are icon buttons.
- [ ] Folders: "new folder" adds a folder; expand it; "add request" in a folder opens a request pre-targeted to that folder; Save writes it into the folder; it appears under the folder.
- [ ] Requests show a colored method glyph (GET/POST/…) before the name; rename/delete via icons.
- [ ] Import a Postman collection with folders → folders + their requests appear nested; Export postman → folders round-trip.
- [ ] Switch VS Code theme light↔dark → everything (icons included) re-themes.
```

- [ ] **Step 3: Manually run it**

Press F5, follow the checklist. Fix issues before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/ui-v2-smoke-checklist.md
git commit -m "chore: ui v2 smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** codicons + IconButton + wrapping + CSP (Task 1); Folder/message types (2); store delete + folder saveRequest (3); postman folder round-trip (4); router item/folder routes + openEnvironments + Hub showEnvironments (5); store pendingSaveFolderId + envMode (6); RenameInput (7); workspace icon rename/delete + add/open env (8); sidebar folders + icon actions + inline rename + method glyph (9); request save-into-folder (10); editor env mode + folder target (11); sidebar drops Environments (12); full gate (13); manual smoke (14).
- **Type consistency:** `Folder`/`Collection.folders?` (2) used by store (3), postman (4), router helpers (5), sidebar tree (9). `saveRequest.folderId?`/`openRequest.targetFolderId?` (2) match store saveRequest (3), router (5), RequestPanel (10), EditorApp (11). `showEnvironments`/`openEnvironments`/`envMode` consistent across router+hub (5), store (6), workspace (8), editor (11).
- **No-behavior-loss:** icon buttons keep the same aria-labels used by existing tests; request rows keep keyboard operability (role=button); every mutation rebroadcasts `tree`.
- **Back-compat:** `folders?` optional (absent = []); a collection saved before folders still lists and renders (root requests only).
