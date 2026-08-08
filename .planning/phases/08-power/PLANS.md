# Phase 08 — Power user & polish

Goal: close the biggest feature gaps found in the 2026 best-practices survey vs
RREQUEST today, plus cheap UX wins that remove daily friction.

| Plan | File | Wave | Depends on | Tasks |
|---|---|---|---|---|
| 01-auth | [08-01-PLAN.md](08-01-PLAN.md) | 1 | — | OAuth2 (auth code + PKCE + client credentials), token cache |
| 02-vars | [08-02-PLAN.md](08-02-PLAN.md) | 1 | — | {{var}} in WS/gRPC, env secrets in SecretStorage, timeout setting |
| 03-sse | [08-03-PLAN.md](08-03-PLAN.md) | 2 | 02 | SSE streaming tab + WS polish |
| 04-examples | [08-04-PLAN.md](08-04-PLAN.md) | 2 | — | Save response as example, per-request examples + diff |
| 05-graphql | [08-05-PLAN.md](08-05-PLAN.md) | 3 | 01 | GraphQL introspection + schema explorer |
| 06-docs | [08-06-PLAN.md](08-06-PLAN.md) | 2 | — | request/collection descriptions, docs export |
| 07-ux | [08-07-PLAN.md](08-07-PLAN.md) | 3 | 06,04 | custom method, viewer input locking, empty states, keyboard, onboarding |
| 08-bulk | [08-08-PLAN.md](08-08-PLAN.md) | 2 | — | multi-select tree ops (batch delete/move/duplicate) |

Notes:
- Scoped out deliberately: collection runner (postman-style), "resend from
  history", mock server (roadmap), git-native collections (conflicts with Drive
  story), AI features (needs API keys, privacy load).
- Waves keep editor-file contention low: 01/03/05 touch RequestPanel/AuthEditor
  in later waves; 02/stores and 08/sidebar and 06/deps are independent.
- No new runtime dependencies beyond what's already shipped (@grpc/*, ws).
  OAuth2 uses node:http + node:crypto + vscode.env.openExternal.

TODO (early execution check): confirm exact deps naming, keybinding conflicts,
and whether SSE fits the existing WS panel or needs its own panel mode.