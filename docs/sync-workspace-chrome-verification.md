# Drive Sync — Workspace sync & account chrome — manual verification

Prereq: backend running; a Google account.

## A. Sign in / out (visible)
1. Open the restman sidebar. Signed out → the top account strip shows **Sign in with Google**.
2. Click it → the loopback OAuth flow opens the browser; after consent, the strip shows your **email + Sign out**.
3. Click **Sign out** → back to the Sign-in button; synced workspaces lose their sync status/role in the UI.

## B. Enable sync (visible)
1. Signed in, with a workspace active → an **Enable Sync** control shows next to the workspace name.
2. Click it → the workspace becomes **synced · Owner**; a **Sync Now** action + (owner) the **Members** button are now available.
3. Edits auto-push (DS-Phase 3); **Sync Now** forces a pull+push.

## C. Roles reflected
1. A workspace shared to you as Editor/Viewer shows **synced · Editor/Viewer**; a Viewer sees the read-only affordances (DS-Phase 5b-ui) and no Enable-Sync/Members controls beyond viewing.

## D. Command palette still works
1. `restman: Sign in to Sync` / `Enable Workspace Sync` / `Sync Now` still work and now drive the same state the UI shows.
