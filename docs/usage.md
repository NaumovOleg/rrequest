# RREQUEST — User Guide

A Postman-style REST API client built into VS Code: HTTP, WebSocket and gRPC
requests, collections, environments with `{{variable}}` substitution, and
optional Google Drive sync.

---

## Quick start

1. Open the **RREQUEST** view from the Activity Bar (or run `RREQUEST: Open`
   from the Command Palette).
2. Enter a URL, pick a method, hit **Send** (or ⌘/Ctrl+Enter).
3. See the response below the request — status, time, size, headers, body.

Each request opens in its **own editor tab**. Edits are a local draft: the tab
shows an unsaved dot (●) and nothing reaches your collections until you hit
**Save** (⌘/Ctrl+S).

---

## The request editor

Top to bottom:

- **Name + Save**: an editable title. While a request is unsaved you pick the
  collection (and folder) it will be saved to; afterwards the target is shown
  and Save writes in place. The last save target is remembered per workspace.
- **URL bar**: method dropdown (colored per method) + URL. Query params, headers
  and body content are all `{{variable}}`-**highlighted**; hover any `{{var}}`
  to see what the active environment resolves it to.
- **Section tabs**: Params, Authorization, Headers, Body, Cookies, Pre-request
  Script, Tests. When the pane is narrow they collapse into a dropdown.
  - **Params** — key/value list, kept in sync with the URL's query string.
    Paste `a=1&b=2` (or one pair per line) into the table to bulk-add.
  - **Headers** — auto-generated headers (Host, Accept-Encoding, …) are shown
    greyed under "auto-generated headers" and are added for you on send.
  - **Body** — none / raw (JSON, Text, XML), `x-www-form-urlencoded`, form-data
    (with file uploads) and GraphQL. Raw JSON gets live validation ("Valid JSON"
    / "JSON error at line N"), a **Beautify** button and **Open in editor**.
  - **Cookies** — explicit cookies sent on the request.
- **Copy as cURL / Import from cURL** — pinned at the bottom of the request
  pane; paste any curl command to get a ready request.
- **Send → Cancel** — while a request is in flight the button becomes
  **Cancel**, so you can interrupt a slow call instead of waiting for the
  timeout.

### Keyboard shortcuts

| Shortcut        | Action                    |
| --------------- | ------------------------- |
| ⌘/Ctrl+S        | Save the request          |
| ⌘/Ctrl+Enter    | Send / cancel             |
| ⌘/Ctrl+E        | Focus the environment picker |

---

## The response pane

The response side shows: status pill (color-coded 2xx/3xx/4xx/5xx), total time,
TTFB, body download time, size, and a sub-tab strip — Body, Headers, Cookies,
Test Results, Console.

- **Body views** for JSON: Pretty (indented), Tree (collapsible, copy the
  dotted path of any node by clicking its path), Raw, plus a search box that
  highlights matches.
- HTML responses get a sandboxed (script-free) **Preview**.
- **Beautify**, **Copy**, **Open in editor** (full VS Code search/fold/highlight)
  and **Save** (writes the full body to a file — like when the preview was
  truncated).
- **Test Results** — PASS/FAIL rows from your test script, filterable.
- **Console** — `console.log` output from pre-request and test scripts.

---

## Scripts

Scripts are plain **JavaScript** run in a sandbox (no DOM, no network access,
5 s timeout). Everything goes through a Postman-like `pm` API.

### Pre-request script

Runs just before the request is sent. Scripts are **async**: you can `await
fetch(...)` to obtain a token or probe an endpoint first.

```js
// Fetch a token first, then attach it
const auth = await (await fetch('https://auth.example.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: 'rrequest' }),
})).json();
pm.environment.set('token', auth.access_token);

// Read/write the request itself
pm.request.method = 'POST';
pm.request.url = pm.request.url + '?ts=' + Date.now();
pm.request.headers.add({ key: 'Authorization', value: 'Bearer ' + pm.environment.get('token') });
pm.request.headers.get('X-Source'); // "rrequest"
pm.request.body = { mode: 'raw', type: 'json', text: '{"ping":1}' };
pm.request.params.push({ key: 'a', value: '1', enabled: true });

// Debug
console.log('about to send', pm.request.url);
```

### Test script

Runs against the response, right after it arrives. Tests can also `await
fetch(...)` (e.g. to compare the response against an external source).

```js
pm.test('status is 200', () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test('returns a token', () => {
  const body = pm.response.json();          // throws -> test fails
  pm.expect(body.token).to.be.a('string');
  pm.expect(body.token.length).to.be.above(10);
});

pm.test('fast enough', () => {
  pm.expect(pm.response.responseTime).to.be.below(500);
});

// capture a value into the environment for later requests
pm.environment.set('refreshToken', pm.response.json().refresh_token);
```

### `pm` API reference

| Member | Type | Description |
| --- | --- | --- |
| `pm.request.method` | get/set | HTTP method (`'GET'`, `'POST'`, …) |
| `pm.request.url` | get/set | Request URL (interpolated env values) |
| `pm.request.body` | get/set | Body object (`{ mode, text, items, ... }`) |
| `pm.request.headers.add({key, value})` | fn | Add a header |
| `pm.request.headers.get(key)` | fn | Value of a header (first match) |
| `pm.request.params` | array | Query params list (array of `{key, value, enabled}`) |
| `pm.response.code` | number | HTTP status code |
| `pm.response.status` | string | Status text (e.g. `"OK"`) |
| `pm.response.responseTime` | number | Total time in ms |
| `pm.response.headers` | array | Response headers (`{key, value}`) |
| `pm.response.text()` | fn | Body as a string |
| `pm.response.json()` | fn | Body parsed as JSON (throws if not JSON) |
| `pm.test(name, fn)` | fn | Record a test: PASS if `fn` doesn't throw |
| `pm.expect(actual)` | fn | Assertions (below) |
| `pm.environment.get(key)` / `set(key, value)` | fn | Read / write the active environment (persisted) |
| `pm.variables.get(key)` | fn | Read an environment variable (no write) |
| `fetch(url, init?)` | fn | Standard fetch (Node's implementation); scripts can `await` it, e.g. to fetch a token before the request |
| `console.log(...)` | fn | Appears in the Console tab next to the results |

> Scripts have a **5 second** total timeout (must `await` all `fetch`es in
> time). Unawaited fetches may finish after the script already returned.

### `pm.expect` matchers

Chained as `pm.expect(actual).to.*` or `.to.not.*`:

- `equal(value)` — strict (`===`)
- `eql(value)` — deep equality for objects/arrays
- `include(value)` — substring (string) or membership (array)
- `be.a('string')` / `be.an('array')` — `typeof`
- `be.above(n)` / `be.below(n)` — numeric comparison
- `be.true` / `be.false` / `be.ok` — boolean/truthiness

---

## Environments & variables

Environments hold `key = value` pairs. Any field in a request — URL, params,
headers, body, auth — can reference them as `{{key}}`; they are substituted at
send time. Mark a variable as **secret** and it is highlighted differently and
never uploaded during sync.

Key flows:

- Pick the active environment from the editor's top bar (⌘/Ctrl+E focuses it).
- A collection can **bind an environment** (gear menu in the sidebar): opening
  a request from it activates that environment automatically.
- Pre-request/test scripts can set values at run-time (`pm.environment.set`),
  which is the typical way to chain auth tokens between requests.

---

## Collections, folders, workspaces

- Sidebar organizes requests into **collections** and **folders**; drag items
  between them, or use the right-click menu (rename, duplicate, move up/down,
  move to another workspace, export).
- The sidebar has three more tabs: **Environments**, **History** (every send is
  remembered, searchable, grouped by day) and **Trash** (deleted items can be
  restored).
- **Workspaces** keep collections, environments, history and the sync state
  separate. Switch per workspace from the top; create new ones from the popup.

## WebSocket & gRPC

- **WebSocket** (New → New WebSocket): URL + headers, connect, send JSON frames
  and watch the in/out log with a Connect status.
- **gRPC** (New → New gRPC): host address, proto source, service + method, JSON
  message, and metadata. Works with plaintext and TLS addresses.

## Import / Export

- **Import**: Postman v2.1 collections and cURL commands (from the "Import from
  cURL" box on the request pane), and OpenAPI specs via the collection menu.
- **Export**: any collection as native JSON, Postman v2.1, or OpenAPI.

## Sync (optional)

Sign in with Google to sync a workspace and share it with teammates as
owner/editor/viewer. Each workspace is one JSON file in **your own** Google
Drive (`drive.file` scope — the app can't see the rest of your Drive).

What sync does and doesn't carry:

- Collections, requests, **pre-request and test scripts** — synced verbatim.
- Environment variables — synced, but **secret values are stripped** before
  upload (the value stays blank remotely and is filled back in locally).

So a token hardcoded inside a script (`pm.request.headers.add(... 'Bearer
abc123')`) **would be uploaded**. Keep secrets in environment variables
(marked secret, or even just unmarked) instead of script text, and read them
with `pm.environment.get(...)` — scripts inherit the stripped-variable behavior
of ordinary request fields.

Without a backend URL in settings, sync shows a warning with a shortcut to
configure it.

## Keyboard & IDE integration

- Request/response bodies open in a real editor tab via **Open in editor** —
  full syntax highlighting, search, and folding.
- `rrequest.syncServerUrl` (`RREQUEST: Settings`) points sync at your own
  backend; `rrequest.syncPollIntervalMs` tunes how often remote changes are
  pulled.