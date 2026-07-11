# restman — Phase 3 (Import/Export + File Upload + curl) Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 3 — collection import/export (Postman v2.1 + native), multipart file upload, and curl import/export. Builds on Phases 1-2.

## Overview

Phase 3 adds three independent capabilities:
1. **Import/export collections** — import Postman Collection v2.1 or restman-native JSON; export a collection to Postman v2.1 or native JSON.
2. **File upload** — a `form-data` body mode with text and file fields; files are read by the host and sent as multipart at request time.
3. **curl** — parse a pasted `curl` command into a request, and copy the current request as a `curl` command.

Phases 1 (core) and 2 (environments) are complete. Later phases remain: 4
(scripts/hooks), 5 (WebSockets), 6 (backend + auth/sync).

## Goals

- Import a Postman v2.1 collection (or native JSON) into restman's collection tree.
- Export a collection to Postman v2.1 or native JSON via a save dialog.
- A `form-data` request body with mixed text and file fields; files chosen via a
  VS Code open dialog and sent as real multipart at send time.
- Paste a `curl` command → a new request tab populated from it.
- Copy the current request as a `curl` command.

## Non-goals (Phase 3)

- Postman folder hierarchy preservation — nested folders are flattened into the
  flat `requests[]` model (folder path folded into the request name).
- Postman auth blocks, scripts, tests, variables on import/export (auth is Phase 6;
  scripts are Phase 4). Only method/url/headers/params/body are converted.
- Environments import/export (kept simple; can be a later addition).
- Streaming very large file uploads (files are read into memory via fs.readFile —
  fine for typical API testing).
- curl flags beyond the common set (see below).

## Decisions

- **Formats:** import accepts Postman v2.1 AND native; export offers native or
  Postman v2.1. Native = restman's own on-disk `Collection` JSON.
- **Format detection on import:** a parsed object with `info.schema` containing
  `v2.1.0` (or an `item` array) is treated as Postman v2.1; otherwise if it
  matches the native `Collection` shape (`id`, `requests[]`) it is native.
- **File dialogs are host-only:** all file read/write and open/save dialogs run
  in the extension host. The webview triggers them via messages.
- **Form-data files store a path:** the webview holds `{ path, filename }`; the
  host reads the file at send time. The webview never touches the filesystem.
- **curl is pure and lives in the webview** (`src/webview/curl.ts`): both
  `parseCurl` and `toCurl` are pure string functions, unit-tested, used directly
  by the UI.
- **Multipart Content-Type is automatic:** for `form-data`, the host builds a
  `FormData` and lets fetch set the `multipart/form-data; boundary=...` header;
  it is never set manually.

## Data model

```ts
// shared/types.ts — RequestBody union gains a formdata mode
type FormDataItem =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | { kind: 'file'; key: string; filename: string; path: string; enabled: boolean }

type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json' | 'text' | 'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }
  | { mode: 'formdata'; items: FormDataItem[] }   // NEW
```

## Architecture

Same two-process split. New/changed pieces:

### Extension host

- **`postman.ts`** (new, pure) — `toNative(pm: unknown): Collection` and
  `fromNative(c: Collection): unknown` (Postman v2.1 shape). Flattens folders on
  import; emits a flat `item[]` on export. Maps method/url/query/headers/body
  (raw/urlencoded/formdata). Unknown/unsupported request fields are dropped.
- **`import-export.ts`** (new) — host-side orchestration using VS Code dialogs:
  - `importCollection(store)`: `showOpenDialog` → read file → JSON.parse →
    detect format → convert to native (or accept native) → `store` writes it.
  - `exportCollection(store, id, format)`: load the collection → serialize
    (native or via `fromNative`) → `showSaveDialog` → write file.
  Errors surface via `vscode.window.showErrorMessage`; nothing is written on
  parse failure.
- **`http-client.ts`** (modified) — `sendRequest` handles `body.mode==='formdata'`:
  build a `FormData`; text items → string fields; file items → `fs.readFile(path)`
  wrapped as a `Blob`/`File` with `filename`. Do NOT set Content-Type manually.
  Interpolate `{{var}}` in text item keys/values and file item keys/filenames
  (never in file contents).
- **`messaging.ts`** (modified) — new routes: `importCollection` (→ dialog →
  returns `tree`), `exportCollection` (→ dialog, returns nothing user-visible or
  a fresh `tree`), `pickFile` (→ `showOpenDialog` → returns `pickedFile`).
- **`panel.ts`** (modified) — pass the collection store / dialogs into the router
  (the router already holds `collections`).

### Webview

- **`curl.ts`** (new, pure) — `parseCurl(cmd: string): Partial<RestRequest>`
  (handles `-X/--request`, `-H/--header`, `-d/--data/--data-raw/--data-binary`,
  `-F/--form`, and the URL; query string parsed from the URL) and
  `toCurl(req: RestRequest): string` (method, headers, body per mode).
- **`store.ts`** (modified) — a small helper to apply a `Partial<RestRequest>`
  onto a new tab (reused by curl import). No new persistent state.
- **Body editor** (modified `RequestPanel`) — the Body sub-tab gains a `form-data`
  mode with a per-row type selector (text/file); file rows show a "Choose file"
  button that posts `{type:'pickFile'}` and, on `pickedFile`, stores path+filename.
- **Import/Export UI** (modified `Sidebar`) — an "Import" button (posts
  `importCollection`) and a per-collection "Export" control (native/postman).
- **curl UI** (modified `RequestPanel`) — a "Copy as cURL" button (`toCurl` →
  clipboard) and an "Import from cURL" affordance (paste box → `parseCurl` → new
  tab).

### Message protocol (additions)

```ts
// webview -> host
| { type: 'importCollection' }
| { type: 'exportCollection'; id: string; format: 'native' | 'postman' }
| { type: 'pickFile' }
// host -> webview
| { type: 'pickedFile'; path: string; filename: string }
```

`importCollection`/`exportCollection` respond with a fresh `tree` (import) or
nothing user-visible (export writes a file). `pickFile` responds with
`pickedFile`.

## Data flow

**Import:** Sidebar Import → `importCollection` → host open dialog → read/parse →
detect (Postman v2.1 vs native) → `toNative` if needed → CollectionStore writes →
router returns `tree` → Sidebar refreshes.

**Export:** Sidebar Export(collection, format) → `exportCollection` → host loads
collection → native or `fromNative` → save dialog → write file.

**File upload:** Body form-data row (file) → "Choose file" → `pickFile` → host
open dialog → `pickedFile{path,filename}` → webview stores it on the row. On
Send, host builds multipart, reads files, fetches.

**curl import:** paste `curl ...` → `parseCurl` → new tab via updateActive.
**curl export:** "Copy as cURL" → `toCurl(active)` → clipboard.

## Error handling & edge cases

- Import of a file that is neither valid Postman v2.1 nor native → `showErrorMessage`,
  nothing written.
- Postman request with an unsupported body/auth → body converted best-effort
  (auth dropped); never throws — unknown fields ignored.
- Form-data file whose path no longer exists at send → the send returns an
  `HttpResponse` error (kind `'unknown'`) via the existing never-throws contract;
  the file read is wrapped so it does not crash the host.
- `parseCurl` on malformed input → returns whatever it could parse (at least the
  URL if present); never throws.
- A `form-data` body with only text items still sends as multipart.

## Testing (TDD)

- **`curl`** — parse: method, multiple `-H`, `-d` body, `-F` fields, URL with
  query; `toCurl`: round-trips a representative request; malformed input tolerated.
- **`postman`** — `toNative`: v2.1 collection with nested folders flattened,
  header/param/body mapping; `fromNative`: native → v2.1 shape; round-trip of a
  simple collection preserves method/url/headers.
- **`http-client` form-data** — text + file fields produce a multipart body (mock
  fetch captures the `FormData`/body); file read from a temp file; `{{var}}` in a
  text field resolved; missing file path → error result, no throw.
- **`import-export`** — format detection (Postman vs native vs garbage); native
  round-trip through a temp dir; garbage → no write.
- **`messaging`** — import/export/pickFile routes; import returns tree.
- **components** — form-data editor row add + type switch + Choose file posts
  pickFile; Sidebar Import/Export post the right messages; RequestPanel Copy-as-cURL
  and Import-from-cURL.

## Files

New: `src/extension/postman.ts`, `src/extension/import-export.ts`,
`src/webview/curl.ts`, plus a form-data editor (likely
`src/webview/components/RequestPanel/FormDataEditor.tsx`), and their tests.
Modified: `src/shared/types.ts`, `src/extension/http-client.ts`,
`src/extension/messaging.ts`, `src/extension/panel.ts`,
`src/webview/state/store.ts`, `src/webview/components/RequestPanel/RequestPanel.tsx`,
`src/webview/components/Sidebar/Sidebar.tsx`, `src/webview/App.tsx` (handle
`pickedFile`).

## Open questions

None blocking. Postman folder hierarchy and auth/scripts on import are explicit
non-goals for Phase 3.
