# Drive Sync Phase 3 — manual verification

Prereq: backend running (`cd server && npm run dev`) with a real Google OAuth client + Drive API; sign in and enable sync on a workspace (Phase 2 steps).

## Realtime (same owner, two windows)
1. Open two VS Code windows on the extension (both signed in as the same Google account, same synced workspace).
2. In window A, add a request to a collection and wait ~2s (debounced auto-push).
3. Window B should update within a second or two (WebSocket `workspace-changed` → auto-pull → tree refresh) — no manual action.

## Conflict (revision guard)
1. Stop window B's network (or the backend) briefly so it goes stale.
2. In window A, make a change (pushes → revision bumps).
3. Reconnect window B and make a *different* change. Its push 409s; the client merges (both changes present) and retries. Confirm both changes survive in the Drive file and in both windows.

## Secrets
1. Confirm the Drive file still stores secret env values as `""` after auto-push, and local secret values remain intact in each window after pull.
