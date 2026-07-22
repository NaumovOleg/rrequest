# Drive Sync DS-Phase 4 — manual verification

Prereq: backend running with a real Google OAuth client + Drive API; sign in and enable sync on a workspace (DS-Phase 1-2 steps); a second VS Code window signed in as the same account, connected (DS-Phase 3 realtime working).

## A. Poll fallback (no public URL needed)
1. Leave `PUBLIC_WEBHOOK_URL` unset. Restart the backend (default `POLL_INTERVAL_MS=60000`; set `POLL_INTERVAL_MS=5000` to speed up the test).
2. Open the workspace's JSON file directly in Google Drive (drive.google.com) and edit it (e.g. add a request object by hand), or edit from a device outside restman.
3. Within one poll interval, both restman windows should show the outside change (poll detects the head-revision bump → broadcast → clients pull). Confirm no change is lost and secrets stay intact.

## B. Webhook (real-time outside-edit sync)
1. Expose the backend over HTTPS (e.g. `ngrok http 8787`) and set `PUBLIC_WEBHOOK_URL=https://<id>.ngrok.io`. Restart the backend.
2. Re-enable sync on the workspace (or wait for renewal) so a `files.watch` channel registers against the ngrok `/webhook`.
3. Edit the file directly in Google Drive again. Within a second or two (no waiting for the poll interval), both windows should update — Drive fired the webhook.

## C. Echo suppression
1. From restman, make a normal edit (auto-push). Confirm the backend does NOT emit a second redundant `workspace-changed` for that same write (the webhook/poll sees an unchanged head revision vs the stored one → no broadcast). The pusher shouldn't get a spurious extra pull.

## D. Renewal
1. With a public URL set, confirm the `watch_channels` row's `expiration` refreshes over time (renewal runs hourly by default, re-registering channels within ~1 day of expiry) so sync survives past the original channel lifetime.
