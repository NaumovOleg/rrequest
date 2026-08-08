# Roadmap

## Phase 08 — Power user & polish (in progress)

Goal: close the biggest feature-name gaps vs the 2026 market (OAuth2, SSE,
GraphQL schema, saved examples, docs) plus security/consistency fixes
(variables in WS/gRPC, secrets in Secret Storage) and UX polish (custom
methods, viewer lock, bulk ops, onboarding).

| Plan | Wave | Contents | Status |
|---|---|---|---|
| 01-auth | 1 | OAuth2: authorization-code PKCE + client-credentials, token cache in Secret Storage | planned |
| 02-vars | 1 | {{var}} in WS/gRPC, env secrets -> Secret Storage, timeout setting | planned |
| 03-sse | 1 | SSE streaming tab; WS polish (interpolation from 02) | planned |
| 04-examples | 1 | Save response as example, reopen + diff | planned |
| 06-docs | 2 | request/collection descriptions, Docs pane, export includes desc | planned |
| 08-bulk | 2 | multi-select tree ops (delete/duplicate/move) | planned |
| 05-graphql | 3 | GraphQL introspection + schema explorer/autocomplete (needs 01) | planned |
| 07-ux | 3 | method combobox, viewer lock, empty states, onboarding sample | planned |

## Future (not planned yet)

- Mock servers (big: needs backend infra)
- Git-native collections (like Bruno)
- GraphQL schema explorer — partially covered by 05
- Collection runner (Postman-style batch execute) — explicitly deferred
- "Resend from history" — explicitly skipped by decision