# restman — UI v2 (Codicons, Item Management, Folders, Env-in-Editor) Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Scope:** A proper Postman-extension-like UI: VS Code codicons, icon action bars that wrap, inline rename + delete for workspaces/collections/folders/requests, collection **folders** (nested tree), and the **Environments manager opening in the editor**. One branch `ui-v2` (stacked on `ui-design`).

## Motivation

The current UI works but reads as bare boxes with text buttons. The user wants it to look/behave like the Postman VS Code extension: real icons (codicons), action toolbars, buttons that wrap when they don't fit, icon-triggered inline rename, delete icons, collection folders, colored method glyph before request names, and the environments editor in the main area (not the sidebar).

## Feature areas

### A. Codicons + icon buttons + wrapping

- **Codicons:** add `@vscode/codicons`. A build step copies `codicon.css` + `codicon.ttf` into `media/`. `buildHtml`/`buildSidebarHtml` add `<link rel="stylesheet" href="<codicon.css webviewUri>">` and extend the CSP with `font-src ${cspSource}` (the `@font-face` in codicon.css resolves `./codicon.ttf` relative to the stylesheet's webview URI, under `localResourceRoots(media)`). Icons render as `<span class="codicon codicon-<name>"/>`.
- **`IconButton`** (new) — `<button className="rm-icon-btn" aria-label={label} title={label}><span className={`codicon codicon-${icon}`}/></button>`. Used for all actions (edit, trash, add, cloud-upload, cloud-download, new-file, new-folder, gear, plug, etc.).
- **Wrapping:** action rows use `.rm-actions { display:flex; flex-wrap:wrap; gap }` and `.rm-row` gains `flex-wrap:wrap` so buttons drop to the next line instead of overflowing.
- **Section header** matches the Postman sidebar structure: a title + a right-aligned `.rm-actions` toolbar of icon buttons.

### B. Item rename + delete (workspace / collection / folder / request)

- **Inline rename:** clicking an `edit` icon on a row turns the row's label into a text `<input>` (component-local "editing id" state); Enter/blur commits by posting the rename message; Escape cancels.
- **Delete:** a `trash` icon posts the delete message.
- New messages (webview→host):
  ```ts
  | { type: 'renameCollection'; id: string; name: string }
  | { type: 'deleteCollection'; id: string }
  | { type: 'renameRequest'; collectionId: string; folderId: string | null; requestId: string; name: string }
  | { type: 'deleteRequest'; collectionId: string; folderId: string | null; requestId: string }
  | { type: 'createFolder'; collectionId: string; name: string }
  | { type: 'renameFolder'; collectionId: string; folderId: string; name: string }
  | { type: 'deleteFolder'; collectionId: string; folderId: string }
  ```
  Workspace rename/delete already exist (`renameWorkspace`/`deleteWorkspace`) — their controls become icon buttons.
- Host: the router handles these by loading the collection, mutating it, and `saveCollection`. `CollectionStore` gains `delete(id)`; the rest is load-mutate-save in the router (or small store helpers). All mutations re-broadcast `tree`.

### C. Collection folders (nested tree)

- **Model** (`shared/types.ts`):
  ```ts
  type Folder = { id: string; name: string; requests: RestRequest[] }
  type Collection = { id; name; workspaceId; requests: RestRequest[]; folders: Folder[] }
  ```
  Single-level folders (a folder holds requests; no nested folders in this pass). `requests` are collection-root requests; `folders[]` each hold their own `requests`. Back-compat: a collection without `folders` is treated as `folders: []`; a request's target is `(collectionId, folderId|null)`.
- **Save target:** `saveRequest` gains `folderId?: string | null`:
  ```ts
  | { type: 'saveRequest'; collectionId: string; folderId?: string | null; request: RestRequest }
  ```
  The editor tracks `pendingSaveCollectionId` + `pendingSaveFolderId` (new); the Save UI shows the target collection/folder (or a collection+folder picker). `openRequest`/`openInEditor` gain `targetFolderId?`.
- **CollectionStore.saveRequest** upserts into the root or a folder by `folderId`.
- **Tree:** collection → expand → root requests + folders; folder → expand → its requests. Each level: rename/delete/add-request; collections also add-folder.
- **Import/export (Postman):** `postman.ts` `toNative` now PRESERVES one level of folders (Postman `item` entries that contain a nested `item[]` become folders; requests inside become that folder's requests; deeper nesting is flattened into the nearest folder). `fromNative` emits folders as nested `item[]`. (This replaces the previous flatten-everything behavior.)

### D. Environments in the editor

- The Environments manager MOVES from the sidebar into the editor area (like Postman). The sidebar keeps only an **add-environment** icon and an **open-environments** icon next to the workspace switcher.
- Flow: the sidebar's "open environments" icon posts `{ type: 'openEnvironments' }` → host reveals the editor + sends `{ type: 'showEnvironments' }` → the editor sets an `envMode` store flag and renders `<Environments/>` in place of the request editor (same pattern as `wsMode`). The add-environment icon posts `createEnvironment` (already exists).
- New messages:
  ```ts
  | { type: 'openEnvironments' }         // webview -> host (sidebar)
  | { type: 'showEnvironments' }         // host -> webview (editor)
  ```
- Store: `envMode: boolean` (editor). The editor top bar gets an "Environments" toggle too (like the WebSocket toggle). The active-environment dropdown stays in the editor top bar.

## Message protocol summary (additions)

webview→host: `renameCollection`, `deleteCollection`, `renameRequest`, `deleteRequest`, `createFolder`, `renameFolder`, `deleteFolder`, `openEnvironments`; `saveRequest` gains `folderId?`; `openRequest` gains `targetFolderId?`.
host→webview: `showEnvironments`; `openInEditor` gains `targetFolderId?`.
Types: `Folder`; `Collection.folders`.

## Non-goals

- Deeper than one level of folders; drag-and-drop reordering; multi-select.
- Collection/folder-level scripts or auth.
- A separate environments *tab* system (env editor is a single editor mode toggle).

## Testing (TDD)

- Codicons build step + CSP `font-src` (buildHtml test asserts `font-src` + the codicon link).
- `IconButton` renders the codicon + aria-label.
- Rename/delete routes (collection/folder/request) mutate + rebroadcast tree; CollectionStore.delete + folder/request upserts.
- Folder model types; `postman` folder round-trip; `saveRequest` with folderId targets the folder.
- Tree renders folders + nested requests; inline rename posts the rename message; delete posts delete; add-folder/add-request post the right messages with targets.
- Environments-in-editor: sidebar open-env posts `openEnvironments`; editor `showEnvironments` sets envMode + renders Environments; add-env icon posts createEnvironment.
- Every existing behavior test keeps passing (adapt selectors only where a control moved from text to an icon — keep the same `aria-label`).

## Files

New: `src/webview/components/common/IconButton.tsx`, folder/tree sub-structure in Sidebar, `src/webview/components/common/RenameInput.tsx` (inline rename helper), tests.
Modified: `package.json` (+`@vscode/codicons`), the build (copy codicons), `src/shared/types.ts`, `src/extension/collection-store.ts`, `src/extension/postman.ts`, `src/extension/messaging.ts`, `src/extension/panel.ts` + `src/extension/sidebar-view.ts` (CSP + codicon link), `src/webview/theme.css` (icon-btn, actions wrap, tree folder rows), `src/webview/state/store.ts` (pendingSaveFolderId, envMode), `src/webview/components/Sidebar/Sidebar.tsx` (folders + icon actions + inline rename), `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx` (icon rename/delete + add-env/open-env), `src/webview/components/RequestPanel/RequestPanel.tsx` (folder in save target), `src/webview/editor/EditorApp.tsx` (envMode + showEnvironments), `src/webview/sidebar/SidebarApp.tsx` (remove Environments section).

## Open questions

None blocking. Iteration happens against the real extension (F5).
