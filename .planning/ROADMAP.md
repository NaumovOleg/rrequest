# Roadmap

## Phase 08 — Power user & polish (done)

Goal: close the biggest feature-name gaps vs the 2026 market (OAuth2, SSE,
GraphQL schema, saved examples, docs) plus security/consistency fixes
(variables in WS/gRPC, secrets in Secret Storage) and UX polish (custom
methods, viewer lock, bulk ops, onboarding).

| Plan | Wave | Contents | Status |
|---|---|---|---|
| 01-auth | 1 | OAuth2: authorization-code PKCE + client-credentials, token cache in Secret Storage | done |
| 02-vars | 1 | {{var}} in WS/gRPC, env secrets -> Secret Storage, timeout setting | done |
| 03-sse | 1 | SSE streaming tab; WS polish (interpolation from 02) | done |
| 04-examples | 1 | Save response as example, reopen + diff | done |
| 06-docs | 2 | request/collection descriptions, Docs pane, export includes desc | done |
| 08-bulk | 2 | multi-select tree ops (delete/duplicate/move) | done |
| 07-ux | 3 | method combobox, viewer lock, empty states, onboarding sample | done |
| 05-graphql | 3 | GraphQL introspection + schema explorer/autocomplete (needs 01) | deferred |

## Future (not planned yet)

- Mock servers (big: needs backend infra)
- Git-native collections (like Bruno)
- GraphQL schema explorer (08-05) — deferred, not executed
- Collection runner (Postman-style batch execute) — explicitly deferred
- "Resend from history" — explicitly skipped by decision
- Dynamic values — done as {{$uuid}} / {{$timestamp}} / {{$isoTimestamp}} /
  {{$randomInt}} / {{$randomHex}} in interpolate (beyond roadmap)
- Save history entry to collection — done via sidebar save popup