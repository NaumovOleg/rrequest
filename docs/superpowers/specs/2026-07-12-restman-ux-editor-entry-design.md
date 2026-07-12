# restman — Editor Entry Points + Collection Tree UX Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Scope:** Fix the functional gaps left by the two-webview split — the editor is currently unreachable from a fresh state and collections offer no way to create/expand requests. Branch `ux-editor-entry` (stacked on `phase4-scripts`).

## Problem

After the layout refactor (sidebar WebviewView + editor WebviewPanel), the only ways to open the editor are (a) clicking an existing request in the sidebar tree or (b) running the `restman: Open` command. On a fresh install the Default workspace has no collections/requests, so there is nothing to click and the editor never appears. Collections created in the sidebar are empty with no "add request" affordance, and the tree renders requests flat with no expand/collapse — clicking a collection does nothing.

## Goals

- The editor is always reachable: a "New Request" action opens it with a blank request, and the editor always shows a request tab when open.
- Each collection has a "+ Request" action that opens a new request in the editor pre-targeted to save into that collection.
- Collections expand/collapse on click; their requests show only when expanded.

## Decisions

- **Editor always has a tab:** `EditorApp` opens a blank tab on mount if there are no tabs, so the editor never shows an empty "No request open" state when revealed.
- **New Request entry point:** the sidebar gets a global "New Request" button that posts `openRequest` with a fresh blank request → the host reveals the editor and sends `openInEditor` → a tab opens.
- **Per-collection "+ Request":** each collection row gets a "+ Request" button that posts `openRequest` with a blank request AND a `targetCollectionId`. The editor pre-selects that collection in the request's Save dropdown so Save writes into it.
- **Cross-webview target:** because sidebar and editor are separate webview instances, the target collection travels via the message: `openRequest`/`openInEditor` gain an optional `targetCollectionId`. `EditorApp` stores it in `pendingSaveCollectionId`; `RequestPanel`'s Save dropdown initializes from it.
- **Expand/collapse:** local component state in `Sidebar` (a set of expanded collection ids); clicking a collection name toggles it; requests + the "+ Request" button render only when expanded.

## Data model / protocol

```ts
// message arms gain an optional field (both directions)
| { type: 'openRequest'; request: RestRequest; targetCollectionId?: string }
| { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string }
```

Store (editor instance) gains:
```ts
pendingSaveCollectionId: string | null   // pre-selected collection for the next Save
setPendingSaveCollectionId(id: string | null): void
```

## Behavior

- **New Request (global):** sidebar posts `openRequest{ request: blank }` (no target). Host reveals editor + `openInEditor{ request: blank }`. EditorApp opens the tab; `pendingSaveCollectionId` = null.
- **+ Request (per collection):** sidebar posts `openRequest{ request: blank, targetCollectionId: c.id }`. EditorApp opens the tab and sets `pendingSaveCollectionId = c.id`. RequestPanel's Save collection dropdown defaults to that id.
- **EditorApp mount:** if `tabs.length === 0`, `openNewTab()`. (A subsequent `openInEditor` from a click may add another tab — acceptable; the user can close the blank one.)
- **Collection expand/collapse:** clicking the collection name toggles its expanded state; when collapsed, its requests and "+ Request" are hidden.
- **RequestPanel Save default:** when `pendingSaveCollectionId` is non-null, the Save collection `<select>` initializes to it (via an effect keyed on `pendingSaveCollectionId`).

A "blank request" is the same shape as `blankRequest()` (id via newId, name "New Request", GET, empty everything) — the sidebar builds it with `newId()` and name "New Request".

## Non-goals

- Rename/delete request in the tree, drag-drop, folders — later.
- Visual/styling polish — a separate UI-design pass after Phase 5.
- Duplicating the request or saving WS (Phase 5).

## Testing (TDD)

- **types:** `openRequest`/`openInEditor` accept `targetCollectionId`.
- **store:** `pendingSaveCollectionId` set + reset.
- **EditorApp:** mount opens a blank tab when none; `openInEditor` with `targetCollectionId` sets `pendingSaveCollectionId`.
- **Sidebar:** "New Request" posts `openRequest` (blank, no target); "+ Request" posts `openRequest` with the collection's id as `targetCollectionId`; collapse/expand hides/shows a collection's requests.
- **RequestPanel:** the Save dropdown initializes to `pendingSaveCollectionId` when set.

## Files

Modified: `src/shared/types.ts`, `src/webview/state/store.ts`,
`src/webview/editor/EditorApp.tsx`, `src/webview/components/Sidebar/Sidebar.tsx`,
`src/webview/components/RequestPanel/RequestPanel.tsx`.

## Open questions

None blocking.
