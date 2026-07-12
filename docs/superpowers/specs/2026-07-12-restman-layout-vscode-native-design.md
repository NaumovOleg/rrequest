# restman — VS Code-native Layout Refactor Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Scope:** Restructure the UI into a VS Code-native two-surface layout (Postman/Thunder-Client style). Continues on branch `phase3-io`; finishes the paused Phase 3 UI (curl, picked-file) inside the new structure.

## Motivation

Phase 1 put the entire UI — collection tree, environments, history, request tabs, request editor, response — inside a single editor-area `WebviewPanel`. The desired layout (per the Postman reference in `design.png`, mapped onto native VS Code chrome) splits management from editing:

- The **left VS Code sidebar** (the restman activity-bar container, currently just an "Open restman" welcome button) hosts collection/environment/history **management**.
- The **main editor-area panel** hosts the **single-request editor** (method/url/send, params/headers/body, response), like Postman's main pane.
- Clicking a request in the sidebar opens it in the editor panel.

## Decisions

- **Sidebar surface:** a React **WebviewView** (not a native TreeView) registered for a `restman.sidebar` view in the activity-bar container — full styling and reuse of existing React components, and room for the environment variable editor.
- **Active-environment selector:** stays in the **editor panel** top bar (it governs sending, Postman-style). Environment **CRUD** lives in the sidebar.
- **Two webviews, host is the state hub:** each webview is a separate JS context with its own Zustand store; the extension host owns the source of truth (collection/environment/history stores + active-env in globalState) and keeps both webviews in sync by broadcasting state.
- **Broadcast vs targeted:** state messages (`tree`, `environments`, `history`) are broadcast to ALL live webviews; targeted messages (`response`, `pickedFile`, `openInEditor`) go to a specific webview.

## Architecture

```
┌───────────────────────── Extension Host (Node) ─────────────────────────┐
│  Stores: CollectionStore, EnvironmentStore, HistoryStore, globalState    │
│  HttpClient (send), import-export, postman, dialogs                      │
│  Router (createRouter) — unchanged core; returns one HostMessage         │
│  Hub — holds postMessage sinks for every live webview; routes each        │
│    produced HostMessage: broadcast (tree/environments/history) to all,    │
│    targeted (response/pickedFile) to the sender, openInEditor to the      │
│    editor panel (revealing it).                                           │
└───────▲───────────────────────────────────────▲──────────────────────────┘
        │ postMessage                            │ postMessage
┌───────┴───────────────────┐        ┌───────────┴──────────────────────────┐
│ Sidebar WebviewView (React)│        │ Editor WebviewPanel (React)           │
│  SidebarApp:               │        │  EditorApp:                           │
│   - collections tree        │        │   - EnvDropdown (top bar)             │
│   - Environments (CRUD+edit)│        │   - Tabs                              │
│   - History                 │        │   - RequestPanel (method/url/send,    │
│   - Import / Export          │        │       params/headers/body/formdata,   │
│  own Zustand store:          │        │       Save-to-collection, curl)       │
│   tree, environments,        │        │   - ResponsePanel                     │
│   activeEnvId, history        │        │  own Zustand store:                   │
│  On request click →          │        │   tabs, activeTabId, responses,       │
│   postToHost(openRequest)     │        │   tree, environments, activeEnvId,    │
│                              │        │   pendingFilePick                     │
└──────────────────────────────┘        └───────────────────────────────────────┘
```

### Host pieces

- **`hub.ts`** (new) — `Hub` tracks live webview sinks (`register(id, postMessage): dispose`) and exposes `dispatch(fromId, message)`: it runs the router and routes the reply — `tree`/`environments`/`history` → all sinks; `response`/`pickedFile` → the `fromId` sink; `openInEditor` → the editor sink (and the panel is revealed by the panel provider). A separate `broadcastState()` helper pushes fresh `tree`/`environments`/`history` snapshots to all sinks (used after any mutation).
- **`sidebar-view.ts`** (new) — `SidebarViewProvider implements vscode.WebviewViewProvider` for view id `restman.sidebar`; loads the sidebar bundle; registers its webview with the Hub; forwards messages to `Hub.dispatch`.
- **`panel.ts`** (modified) — the editor panel loads the editor bundle, registers with the Hub, and is the target for `openInEditor` (revealing itself). No longer renders the sidebar UI.
- **`messaging.ts`** (modified) — add `openRequest` (webview→host) and `openInEditor` (host→webview) handling. `openRequest` resolves to an `openInEditor` targeted at the editor. The existing routes are unchanged; the Hub decides broadcast vs targeted by message type.
- **`extension.ts`** (modified) — register the `SidebarViewProvider`; keep `restman.open` to reveal the editor panel; drop the welcome-only tree view.

### Webview pieces

- **Two Vite entries / bundles:** `src/webview/editor/index.tsx` → `media/editor.js`, `src/webview/sidebar/index.tsx` → `media/sidebar.js`. Shared components/state/ipc live under `src/webview/` and are imported by both.
- **`SidebarApp`** (new) composes the existing `Sidebar` (collections tree + import/export), `Environments` (list + editor + CRUD), and a history list; subscribes to `tree`/`environments`/`history`; posts `openRequest` when a request is clicked (instead of opening a local tab).
- **`EditorApp`** (renamed/derived from current `App`) composes `EnvDropdown`, `Tabs`, `RequestPanel`, `ResponsePanel`; subscribes to `tree` (for Save-to-collection), `environments`/`activeEnvId` (dropdown), `response`, `pickedFile`, and `openInEditor` (opens a tab from the given request).
- **Store split:** the single store becomes two slim stores (or one store module instantiated per bundle) — the sidebar store holds `tree`/`environments`/`activeEnvId`/`history`; the editor store holds `tabs`/`activeTabId`/`responses`/`tree`/`environments`/`activeEnvId`/`pendingFilePick`. Actions are partitioned to the surface that owns them.

### package.json contributions

- `viewsContainers.activitybar`: the existing `restman` container (icon unchanged).
- `views`: replace the welcome-only `restman.launch` tree view with a `restman.sidebar` **webview** view (`"type": "webview"`).
- `restman.open` command unchanged (reveals the editor panel).

## Workspaces (grouping collections)

A **Workspace** groups collections (Postman's "My Workspace" switcher, top-left of `design.png`). The sidebar shows only the active workspace's collections, with a workspace switcher at the top.

- **Model:** `Workspace = { id: string; name: string }`. `Collection` gains a `workspaceId: string` field. A collection belongs to exactly one workspace.
- **Scope:** workspaces group **collections only**. Environments and history stay global in this refactor (revisitable later — noted as a follow-up).
- **Storage:** `WorkspaceStore` → `${baseDir}/workspaces/<id>.json`, CRUD (mirrors CollectionStore). Active workspace id in `globalState` under `restman.activeWorkspaceId`.
- **Bootstrap:** on first run (no workspaces), the host creates a `Default` workspace and sets it active. Any existing collection without a `workspaceId` is treated as belonging to the active workspace (back-compat for Phase-1/2 collections).
- **Filtering:** the `tree` sent to the sidebar contains only collections whose `workspaceId === activeWorkspaceId`. `createCollection` and `importCollection` stamp the new collection with the active workspace id.
- **Sidebar UI:** a workspace switcher `<select>` (active workspace + a "New Workspace" action) at the top of the sidebar; rename/delete a workspace. Switching the active workspace re-broadcasts the filtered `tree`.

## Message protocol (delta)

```ts
// webview -> host
| { type: 'openRequest'; request: RestRequest }     // sidebar → open a request in the editor
| { type: 'loadWorkspaces' }
| { type: 'createWorkspace'; name: string }
| { type: 'renameWorkspace'; id: string; name: string }
| { type: 'deleteWorkspace'; id: string }
| { type: 'setActiveWorkspace'; id: string }
// host -> webview
| { type: 'openInEditor'; request: RestRequest }                              // editor only
| { type: 'workspaces'; workspaces: Workspace[]; activeId: string }           // broadcast
```

`Collection` gains `workspaceId: string`. All other existing arms are unchanged. Routing: `tree`/`environments`/`history`/`workspaces` are broadcast to both surfaces; `response`/`pickedFile`/`openInEditor` are targeted. Deleting the active workspace falls back to another workspace (creating `Default` if none remain); its collections are reassigned to the fallback (or deleted with it — decided in the plan: reassign to keep data).

## Data flow (new)

- **Open a request:** Sidebar click → `openRequest{request}` → Hub → editor reveal + `openInEditor{request}` → EditorApp opens a tab.
- **Send:** EditorApp Send → `sendRequest` → host (interpolates active env) → `response` targeted back to the editor; host appends history → broadcasts fresh `history` to the sidebar.
- **Create/save/delete/import collection or environment:** originates in the sidebar (or Save-to-collection in the editor) → host mutates store → broadcasts fresh `tree`/`environments` to BOTH surfaces.
- **Set active env:** EnvDropdown (editor) → `setActiveEnv` → host updates globalState → broadcasts `environments{activeId}` to both.
- **File pick:** editor form-data "Choose file" → `pickFile` → host dialog → `pickedFile` targeted back to the editor.

## Non-goals

- No change to http-client, interpolate, postman, or curl logic — this is a UI/topology refactor plus workspace grouping. Those tests stay green. (CollectionStore gains workspace-aware create/list; a new WorkspaceStore is added.)
- Environments and history are NOT workspace-scoped in this refactor (global) — a noted follow-up.
- No drag-and-drop reordering, no folder hierarchy in the tree (still flat), no moving collections between workspaces via the UI beyond delete/recreate.

## Testing

- Host: `hub` routing (broadcast for tree/environments/history; targeted for response/pickedFile; openRequest → openInEditor to editor) — unit-tested with fake sinks. `sidebar-view` `buildHtml`/registration is thin; the pure HTML builder is unit-tested like the panel's.
- Webview: `SidebarApp` (renders tree/env/history from store; request click posts `openRequest`), `EditorApp` (handles `openInEditor` → opens tab; existing send/response/env/pickedFile behavior). Existing component tests (`RequestPanel`, `ResponsePanel`, `Sidebar`, `Environments`, `EnvDropdown`, `FormDataEditor`, store, url-sync, curl) largely stand; imports/paths updated for the split.
- Build: `npm run build` produces `media/editor.js` + `media/sidebar.js` (+ css) and `dist/extension.js`.

## Finishing paused Phase 3

Within the new structure: the curl controls (Copy-as-cURL / Import-from-cURL) live in the editor's `RequestPanel`; the `pickedFile` handling lives in `EditorApp`. These two remaining Phase-3 items are completed here.

## Open questions

None blocking. History could later move to its own collapsible section or a separate view; for now it is a section in the sidebar.
