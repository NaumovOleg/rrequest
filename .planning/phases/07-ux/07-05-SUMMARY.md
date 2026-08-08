# 07-05 Summary: Collection/folder scripts (cascade)

## Done
- Schema: `preRequestScript?` / `testScript?` on `Collection` and `Folder` (types.ts); `sendRequest` message now carries `collectionId`/`folderId`; new `saveCollectionScript` / `saveFolderScript` messages.
- Cascade in messaging.ts `resolveCascade`:
  - pre: collection → folder → request (each mutates the request for the next; any error returns the same "Pre-request script failed" response as today, logs kept);
  - tests: request → folder → collection (sandwich order), all testResults/logs/envSets merged into the response payload.
- Sidebar: "Scripts" entry added to collection and folder gear menus (folder menu previously had no settings), modal with two CodeTextareas, Save posts the mutation; `run-all` icon badge on rows that have scripts.
- Tests: cascade order for pre & test, abort on folder-pre error, skip-empty-levels.

## Notes
- RequestPanel.send now passes the tab's collection/folder link; Repeat in ResponsePanel carries it too.
- Read-only workspaces: scripts execute on send (they don't mutate the tree) — no role check needed, matching plan.

## Verification
- 4 cascade tests, full suite (75 files / 517 tests) green, typecheck + esbuild build clean.