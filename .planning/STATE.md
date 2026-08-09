# State

Position: Phase 08 (Power user & polish) — DONE (7 of 8 plans executed and
committed 2026-08-09; 05-graphql formally deferred to Future).

## Phase 08 — executed
- 08-01 OAuth2 (PKCE + client-credentials, token cache in Secret Storage) — commit 0a4bdba
- 08-02 Variables in WS/gRPC, env secrets in Secret Storage, timeout setting — commit 941b857
- 08-03 SSE streaming panel + WS polish — commit 8391e53
- 08-04 Save response examples, reopen + diff — commit da27d18
- 08-06 Markdown docs on requests/collections/folders + export — commit ef90186
- 08-07 Method combobox, read-only banner, onboarding sample — commit 83c770a
- 08-08 Bulk multi-select in sidebar (delete/duplicate/move) — commit 49cd94e
- 05-graphql: **deferred, not executed** — plan kept, moved to Future in ROADMAP.
Summaries: `.planning/phases/08-power/08-0{1..4,6,7,8}-SUMMARY.md`.

## Post-phase additions (2026-08-09, beyond roadmap)
- Dynamic values: `{{$uuid}}`, `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`,
  `{{$randomInt}}`, `{{$randomHex}}` in `interpolate` — work with zero env vars,
  everywhere interpolation runs (HTTP/WS/gRPC/SSE).
- Save history entry to a collection: save icon on history rows -> pick
  collection/folder; reuses `saveRequest` flow.
- Auth callback pages (Google sign-in, OAuth2) restyled: logo, card, "Done"
  pill — `src/extension/callback-page.ts`.

## Test status
- `yarn test`: 80 files / 561 tests green.
- `tsc --noEmit -p tsconfig.json` clean; `yarn build` (vite + esbuild) green.

## Key facts from codebase revision (2026-08-08)
- Sidebar + history already have search/filter; request/folder duplicate; OpenAPI
  import/export; Cmd/Ctrl+Enter send; Copy-as-cURL — all pre-existing, not re-planned.
- Confirmed gaps that Phase 07 closed: keyboard shortcuts, run-last, codegen,
  no-code assertions, collection/folder scripts.
- Future (unplanned): mock servers, git-native collections, GraphQL schema
  explorer (deferred 08-05), collection runner, resend-from-history.
