# 07-01 Summary: Palette commands + keybindings

## Done
- `rrequest.newRequest` (Ctrl/Cmd+Alt+N) — opens a blank request tab (same path as sidebar Add).
- `rrequest.changeEnvironment` (Ctrl/Cmd+Alt+E) — opens the Environments editor panel.
- `rrequest.importCurl` (Ctrl/Cmd+Alt+U) — reads clipboard on the host, sends `importCurl` host message; webview parses via existing `parseCurl` and opens a fresh tab.

## Architecture notes
- No curl-parser relocation was needed: the host only reads the clipboard and passes text; parsing stays in the webview (`parseCurl` already had all the logic).
- All three commands reuse existing `RrequestPanel` open paths; `importCurl` reuses the pending-message mechanism so the panel opens and receives the message in one shot.

## Deviations from plan
- Task 2 (move curl parser to shared) skipped — the host never parses, so there is nothing to share. Comment in code documents the choice.

## Verification
- `yarn run typecheck` clean; unit tests unchanged (no new logic in shared paths).