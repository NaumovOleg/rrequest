# 09-03 SUMMARY — manage tools + docs

Done: the agent can create, rename, move and delete collections, folders and
requests (and maintain request documentation), every write gated and routed
through the extension's own router.

Nine manage tools in `src/extension/mcp/tools.ts`:

| Tool                                     | Gated on                     | Dispatches                             |
| ---------------------------------------- | ---------------------------- | -------------------------------------- |
| `create_collection`                      | workspace (write)            | `createCollection`                     |
| `rename_collection`, `delete_collection` | collection (write)           | `renameCollection`, `deleteCollection` |
| `create_folder`                          | collection (write)           | `createFolder`                         |
| `rename_folder`, `delete_folder`         | collection (write)           | `renameFolder`, `deleteFolder`         |
| `create_request`                         | collection (write)           | `saveRequest`                          |
| `update_request`, `rename_request`       | collection (write)           | `saveRequest`, `renameRequest`         |
| `delete_request`                         | collection (write)           | `deleteRequest`                        |
| `move_request`                           | **both** collections (write) | `moveRequest`                          |

Mechanics:

- **Created-id resolution** — `create_collection` / `create_folder` snapshot ids
  before dispatching, re-list and diff the gap, and return the new id
  (`{id: "c-new-3", name: …}`) instead of a blind `{ok:true}`.
- **`update_request` merges, never clobbers** — `{...current, ...patch, id}`;
  zod omits absent optional keys, so a patch that doesn't mention
  `description`/`scripts` leaves them intact (asserted by a test).
- **Read-only/viewer workspaces** are refused by the router
  (`messaging.ts:189` → `toast level:'error'`), and `errorOf` surfaces that
  toast as `isError: true` with the same message a user sees.
- **Writes are serialized** by a module-level `serial()` queue in `tools.ts` —
  it survives across the per-request server instances, so before/after id diffs
  stay unambiguous even with concurrent POSTs.

Deliberate deviations from the plan:

- `create_request` dispatches **`saveRequest`**, not `createRequest`. Identical
  persistence path, but `createRequest` replies with `openItemMsg` →
  `openInEditor`, which would spam a panel tab (and switch the active
  environment) on every agent write. Documented in-code at the call site.
- **No `send_request` tool**, on purpose: the agent manages, the user sends.

Beyond the plan (requested during implementation): **request documentation**.
`description` (the markdown behind the book icon in the request pane) is now
writable through `create_request` (`description`) and `update_request`
(`patch.description`), and readable through `get_request`. Omitting the field
leaves the docs untouched.

Tests: `test/mcp/manage.test.ts` (10) against a fake dispatch — create returns
`c-new-*` / `f-new-*`, missing grant → `access_required` with **nothing
dispatched**, read-only toast → tool error, `create_request` posts `saveRequest`
with the generated id, `update_request` preserves the id and untouched fields,
`move_request` refuses with one grant and proceeds with both, `delete_request`
dispatches `deleteRequest`, and the two documentation cases (create with docs;
docs written, read back, then preserved across an unrelated patch).

The harness (`test/mcp/harness.ts`) builds its port with the **real
`buildMcpPort`**, so environment secret redaction is production-faithful, and it
now persists `saveRequest` into the sample store so read/write round trips are
genuine.

Docs: `docs/usage.md` gained a **"Connect an AI agent (MCP)"** section —
opt-in `rrequest.mcpEnabled`, the loopback-only endpoint
`http://127.0.0.1:3333/mcp`, the per-session bearer token from
`RREQUEST: MCP status`, the approval modal and `RREQUEST: MCP revoke access`,
what the agent can and cannot do (manage only — never send), plus paste-ready
VS Code `.vscode/mcp.json` and generic `mcpServers` JSON snippets (both verified
to parse).

Verified: `yarn test:all` green, `npx tsc --noEmit -p tsconfig.json` clean,
`yarn build` green (2 JSON snippets in `docs/usage.md` parse).

Not committed (awaiting user request).
