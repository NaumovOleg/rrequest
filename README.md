<div align="center">
  <img src="resources/rrequest.png" width="96" height="96" alt="RREQUEST icon">
  <h1>RREQUEST</h1>
  <p><strong>A Postman-style REST API client, built into Visual Studio Code — with optional Google Drive workspace sync.</strong></p>
</div>

RREQUEST turns your editor into a full API client. Build and send requests, inspect
responses, organize everything into collections — without ever leaving VS Code. When
you want your requests on more than one machine, sign in with Google and sync a
workspace to your **own** Google Drive (it's completely optional and off by default).

---

## Features

### Requests
- **HTTP, WebSocket and gRPC** in one place, each in its own tab.
- **URL bar** with method selector, live query-param ↔ URL syncing, and params/headers/body/auth tabs.
- **Body modes**: none, raw (with JSON beautify), form-data (including file uploads), URL-encoded.
- **Response viewer** with status, timing, size, headers, and body filtering.
- **Request history** — every send is remembered per workspace.

### Organize
- **Collections, folders and workspaces** with drag-and-drop.
- **Environments** with `{{variable}}` substitution across every field at send time.
- **Import / export**: Postman v2.1 collections and cURL commands, both directions.

### Scripting
- **Pre-request** and **test** scripts run in a sandbox with a focused `pm` API
  (`pm.environment`, `pm.variables`, `pm.request`, `pm.response`, `pm.test`, `pm.expect`, `console`).
- Test results (PASS/FAIL) and a console are shown alongside the response.

### Editor niceties
- Each request opens in its **own editor tab**.
- Edits are a **local draft** — the tab shows an unsaved-changes dot (●) and nothing
  touches your collections until you save.
- **Save with `Cmd/Ctrl+S`** (or the Save button), just like a file.

### Optional cloud sync (Google Drive)
- Sign in with Google to **sync a workspace across machines** and **share it** with
  teammates as **owner / editor / viewer**.
- Each workspace is stored as a **single JSON file the app creates in your own Drive**.
- Uses the Google **`drive.file`** scope — access is limited to files the app created;
  it can never see the rest of your Drive.
- **Secret environment values are never uploaded** (they're stripped before sync).
- Changes made in Drive or by teammates are picked up automatically.

## Getting started

1. Install **RREQUEST** from the VS Code Marketplace.
2. Open the **RREQUEST** view from the Activity Bar (or run **`RREQUEST: Open`** from the Command Palette).
3. Create a request, enter a URL, and hit **Send**.
4. *(Optional)* Click **Sign in with Google** in the sidebar to enable workspace sync.

## Commands

| Command | What it does |
|---|---|
| `RREQUEST: Open` | Open the RREQUEST editor |
| `RREQUEST: Sign in to Sync` | Sign in with Google for cloud sync |
| `RREQUEST: Enable Workspace Sync` | Start syncing the active workspace |
| `RREQUEST: Sync Now` | Pull + push the active workspace immediately |

## Settings

| Setting | Default | Description |
|---|---|---|
| `rrequest.syncServerUrl` | *(hosted backend)* | Base URL of the sync backend (`…/api`). |
| `rrequest.syncPollIntervalMs` | `45000` | How often (ms) to poll for remote changes. |

## Privacy & data

RREQUEST works fully offline and collects nothing until you choose to sign in. When you
do, it processes only what's needed to sync and share your workspaces, and it complies
with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

- **[Privacy Policy](https://naumovoleg.github.io/rrequest/privacy-policy.html)**
- **[Terms of Service](https://naumovoleg.github.io/rrequest/terms-of-service.html)**

Your workspace content lives in your own Google Drive; your Google refresh token is
encrypted at rest; secret environment values are never uploaded. You can revoke access
any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Links

- 🏠 [Homepage](https://naumovoleg.github.io/rrequest/)
- 🧩 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=olgert.rrequest)
- 💻 [Source on GitHub](https://github.com/NaumovOleg/rrequest)

## License

See the repository for license details.
