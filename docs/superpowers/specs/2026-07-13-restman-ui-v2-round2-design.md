# restman — UI v2 Round 2 (Env tab button, Collection settings popup, DnD, single-tab) Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Scope:** Refinements on top of UI v2 (same branch `ui-v2`): a text "Environment" button that opens env settings in the editor; collection rows reduced to add-folder/add-request + a settings popup (rename/delete/export); sidebar request rows = rename-only; folder icons; fix the double-tab on first open; drag-and-drop requests between folders and collections; tooltips on all buttons; restore the last workspace on open.

## Feature areas

### A. Environment as a clear text button + editor tab

- Replace the two env icon buttons near the workspace switcher with ONE **text button labeled "Environments"** (with a hover tooltip). Clicking it posts `openEnvironments` → the editor shows the Environments manager (envMode). Keep an "add environment" affordance INSIDE the Environments editor (it already has "+ New Environment"). So the sidebar just has the single "Environments" text button; env CRUD lives in the editor view.

### B. Collection row = add-folder + add-request + settings popup

- A collection row's inline actions are reduced to: **add folder** (icon), **add request** (icon), and a **settings** (gear icon) that opens a small **popup menu** anchored to the row with: **Rename**, **Delete**, **Export (native)**, **Export (Postman)**. (Import stays a global action in the Collections section header.)
- A reusable **`PopupMenu`** component: a button that toggles a small absolutely-positioned menu of `{ label, onClick }` items; closes on item click or outside click. Menu items are text with optional leading codicon.

### C. Sidebar request row = rename only

- A request row in the sidebar keeps ONLY the **rename** action (inline). No delete/other icons on the row (delete moves to the collection settings later or the editor; out of scope here to add elsewhere — the row just loses the trash icon). All other request settings live in the editor when the request is opened.

### D. Folder icon

- Folder rows show a **folder codicon** (`codicon-folder` collapsed / `codicon-folder-opened` expanded) before the name, matching a real tree.

### E. Single tab on first open (fix double-tab)

- Currently EditorApp opens a blank tab on mount AND `openInEditor` opens another → two tabs. Fix: `openInEditor` REPLACES a pristine blank tab if one is the only/active tab (a tab with default name "New Request"/"Untitled", empty url, no params/headers, body none, empty scripts). Add a store action `openOrReplaceBlank(partial)` used by the `openInEditor` handler; the blank-on-mount stays (so the editor still shows something when revealed with no request), but the first real open reuses it instead of stacking.

### F. Drag-and-drop requests between folders and collections

- Request rows are `draggable`; folder rows and collection rows are drop targets. Dropping a request onto a folder/collection moves it there.
- New message `moveRequest`:
  ```ts
  | { type: 'moveRequest'; fromCollectionId: string; fromFolderId: string | null; toCollectionId: string; toFolderId: string | null; requestId: string }
  ```
- Host: the router removes the request from the source bucket and adds it to the destination bucket (across collections if needed), saving both collections, then rebroadcasts `tree`. `CollectionStore` gains no new method; the router loads both collections, mutates, and `saveCollection`s each.
- DnD uses native HTML5 (`draggable`, `onDragStart` setting the drag payload, `onDragOver` preventDefault to allow drop, `onDrop` posting `moveRequest`). Minimal visual feedback (a `.rm-drop-over` class on hover).

### G. Tooltips on all buttons

- Every icon button already has `title` (via IconButton). Ensure text action buttons (Environments, New Request, Import, New Collection, popup toggles) also carry a `title` matching their purpose.

### H. Restore the last workspace on open

- The host already persists `restman.activeWorkspaceId` in globalState and broadcasts it; verify the sidebar's workspace `<select>` reflects the persisted active workspace on open (its value binds to the store `activeWorkspaceId` set from the `workspaces` broadcast). Add a test that a `workspaces` message with `activeId` selects that option. If a gap exists, fix the binding.

## Message protocol (additions)

webview→host: `moveRequest`. (Env/settings reuse existing `openEnvironments`/`renameCollection`/`deleteCollection`/`exportCollection`/`createFolder`.)

## Non-goals

- Reordering within a bucket (only moving between buckets); dragging folders/collections themselves; multi-select drag; a full context-menu system (the popup is a simple anchored menu).

## Testing (TDD)

- `moveRequest` type + router route (removes from source, adds to dest, saves both, returns tree).
- `PopupMenu` opens/closes + fires item onClick.
- EditorApp: `openInEditor` reuses a pristine blank tab (tabs length stays 1, not 2).
- WorkspaceSwitcher: the Environments text button posts `openEnvironments`; the env icons are gone; workspace select reflects the active id.
- Sidebar: collection row shows add-folder/add-request/settings; the settings popup has Rename/Delete/Export items posting the right messages; request rows have rename only (no delete icon); folder rows show a folder codicon; a drop of a request onto a folder posts `moveRequest`.
- Every existing behavior test keeps passing (aria-labels preserved where a control remains).

## Files

New: `src/webview/components/common/PopupMenu.tsx`, tests.
Modified: `src/shared/types.ts` (moveRequest), `src/extension/messaging.ts` (moveRequest route), `src/webview/state/store.ts` (openOrReplaceBlank), `src/webview/editor/EditorApp.tsx` (reuse blank), `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx` (env text button, drop icons), `src/webview/components/Sidebar/Sidebar.tsx` (collection actions + popup + request rename-only + folder icon + DnD), `src/webview/theme.css` (popup, drop-over, folder icon).

## Open questions

None blocking. Iteration continues against the real extension (F5).
