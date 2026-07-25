# restman Sync Backend — AWS Lambda + Helios + DynamoDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> Spec: `docs/superpowers/specs/2026-07-23-aws-lambda-backend-rewrite-design.md`.

**Goal:** Re-platform `server/` from Fastify + `ws` + better-sqlite3 to serverless: HTTP on AWS Lambda via `@heliosjs/*`, data in DynamoDB, scheduled poll on EventBridge, infra as AWS CDK, WebSocket removed (client polls). Same domain semantics (roles, revision guard, owner-credential Drive I/O, secret strip, pending invites).

**Architecture:** Thin Helios **controllers** → deps-injected **services** (all logic, fully tested) → **stores** (TS interface + DynamoDB impl + in-memory fake). Auth is a Helios `Plugin` (JWT → `req` state). `apiFn` Lambda serves auth/workspaces/members; `pollFn` (EventBridge) bumps revisions on outside Drive edits. Pure **domain** (crypto/jwt/oauth/drive-client/authz/merge) is reused ~verbatim. CDK provisions 3 DynamoDB tables + API Gateway HTTP API + EventBridge + Secrets Manager.

**Tech Stack:** Node 18+, TypeScript (decorators: `experimentalDecorators`+`emitDecoratorMetadata`+`reflect-metadata`), `@heliosjs/core`+`@heliosjs/aws`, `@aws-sdk/client-dynamodb`+`@aws-sdk/lib-dynamodb`, `dynalite` (pure-JS DynamoDB for tests), `aws-cdk-lib`, vitest.

## Global Constraints

- Backend under `server/`; extension under `src/`. All Google-facing calls on the backend. Extension holds only the app JWT.
- **Layering:** `controllers/` (thin, Helios) → `services/` (pure logic, deps injected — THE tested layer) → `stores/` (interface + dynamo + fake) + `domain/` (reused pure). Controllers contain NO business logic (just req→service→response).
- **Same semantics as the current server** (do not change behavior, only transport+storage): role gates (`resolveRole`), owner-credential Drive access (`ownerDriveFor`), revision-guard 409, `stripSnapshotSecrets` on write, pending-invite resolution on sign-in, owner-only member add/remove, viewer PUT → 403.
- **No realtime:** no `ws`, no `Realtime`, no broadcast, no `/webhook`, no watch channels (dropped per spec). `pollFn` bumps `workspace.revision` on outside Drive edits; clients poll.
- **DynamoDB store tests run against `dynalite`** (in-process pure-JS DynamoDB — no docker), asserting the SAME behaviors as the current sqlite store suites.
- **OAuth `state` is stateless**: a signed token (HMAC of `cb`+nonce+exp) — no server-side state table (spec decision).
- Reuse existing tests for `domain/` unchanged. Every task ends green + `npm run typecheck`.

---

### Task 1: Project skeleton — deps, decorator tsconfig, `domain/` reorg

**Files:** `server/package.json`, `server/tsconfig.json`, move `server/src/{crypto,jwt,google-oauth,drive-client,drive-factory,authz,config}.ts` (+ their tests) into `server/src/domain/`, plus `snapshot`/`merge`/`stripSnapshotSecrets` extraction.

**Interfaces:** produces the `domain/` layer (unchanged logic, new paths). No behavior change.

- [ ] **Step 1: Add deps** to `server/package.json`:
  - deps: `reflect-metadata`, `@heliosjs/core`, `@heliosjs/aws`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `google-auth-library`, `jsonwebtoken`.
  - devDeps: `dynalite`, `aws-cdk-lib`, `constructs`, `@types/aws-lambda`, existing vitest/typescript.
  - Remove (later, Task 13): `fastify`, `ws`, `better-sqlite3`.
  Run `cd server && npm install`.

- [ ] **Step 2: tsconfig decorators** — ensure `server/tsconfig.json` `compilerOptions` has `"experimentalDecorators": true`, `"emitDecoratorMetadata": true`, `"target": "ES2021"`, `"module": "ES2022"`/`"NodeNext"`, `"strict": true`. Run `npx tsc --noEmit` (clean).

- [ ] **Step 3: Move domain files** — `git mv server/src/crypto.ts server/src/domain/crypto.ts` (and `.test.ts`), same for `jwt`, `google-oauth`, `drive-client`, `drive-factory`, `authz`, `config`. Extract `stripSnapshotSecrets` from the old `app.ts` into `server/src/domain/snapshot.ts` (+ a `merge` helper if the server needs it; the extension owns `mergeSnapshots`, the server only strips + reads snapshots). Fix all relative imports.

- [ ] **Step 4: Verify** — `cd server && npx vitest run && npx tsc --noEmit` — all existing domain tests green (crypto/jwt/oauth/drive-client/authz/drive-factory), typecheck clean. (app/store/realtime tests will fail to compile only if they still import moved files — leave the old `app.ts`/stores/realtime in place for now; do NOT delete until Task 13. If moving breaks their imports, update the import paths but keep the files.)

- [ ] **Step 5: Commit** `git add -A server/ && git commit -m "chore(server): deps + decorator tsconfig + domain/ reorg for the serverless rewrite"`

---

### Task 2: Store interfaces + in-memory fakes

**Files:** create `server/src/stores/types.ts` (interfaces), `server/src/stores/memory/{user,workspace,membership}-store.ts` (in-memory impls), tests `server/src/stores/memory/*.test.ts`.

**Interfaces:**
- `UserStore` = `{ getById(id): Promise<User|undefined>; getByEmail(email): Promise<User|undefined>; upsertByGoogle(input): Promise<User> }`
- `WorkspaceStore` = `{ get(id); listByOwner(ownerUserId); upsert(w); setRevision(id, revision, updatedAt); allIds() }` (all `Promise`-returning now — DynamoDB is async).
- `MembershipStore` = `{ add(m); getById(id); listByWorkspace(id); listByUser(userId); roleForUser(id, userId); findByWorkspaceEmail(id, email); findByWorkspaceUser(id, userId); update(id, patch); resolvePending(email, userId); remove(id) }` (Promise-returning).
- Types `User`/`SyncedWorkspace`/`Membership`/`Role` re-exported from `stores/types.ts`.
- The in-memory impls back the SAME behavior as today's sqlite stores (used by service tests). **Note:** all methods become `async` (return Promises) since the DynamoDB impls are async — the current sqlite stores are sync; the interface is now async.

- [ ] **Step 1: Write the failing tests** — port the current `user-store.test.ts`/`workspace-store.test.ts`/`membership-store.test.ts` assertions to run against the in-memory impls, `await`-ing every call. (Same scenarios: getById/getByEmail/upsert; listByOwner/setRevision/allIds; add/pending/resolve/roleForUser/remove/update/findBy*.)

- [ ] **Step 2: Run → fail** (`cd server && npx vitest run src/stores/memory`) — modules missing.

- [ ] **Step 3: Implement** the interfaces (`types.ts`) + in-memory impls (Maps; async wrappers). `resolvePending` updates all pending rows for the email. `roleForUser` returns undefined for non-members. `update` patches role/permissionId.

- [ ] **Step 4: Run → pass.** Typecheck clean.

- [ ] **Step 5: Commit** `git commit -m "feat(server): store interfaces + in-memory fakes (async)"`

---

### Task 3: DynamoDB client + `DynamoUserStore` (dynalite-tested)

**Files:** `server/src/stores/dynamo/ddb-client.ts`, `server/src/stores/dynamo/user-store.ts`, test `server/src/stores/dynamo/user-store.test.ts` (dynalite), a shared test helper `server/test/dynalite.ts`.

**Interfaces:** `DynamoUserStore implements UserStore`, constructed with `{ doc: DynamoDBDocumentClient, table: string }`. Table `Users`: PK `userId`; GSI `gsi_googleSub` (PK `googleSub`); GSI `gsi_email` (PK `email`); attrs `email, googleSub, refreshTokenEnc`. (Encryption stays in the domain crypto — the store gets the already-encrypted token, same as sqlite's UserStore encrypts inside; **decision:** keep encrypt/decrypt INSIDE the store to preserve the current contract — pass `encKey` to the store.)

- [ ] **Step 1: Test helper `server/test/dynalite.ts`** — starts a `dynalite` server on an ephemeral port, returns a `DynamoDBDocumentClient` pointed at it + a `createTable(def)` helper + teardown. (Confirm `dynalite` usage: `const dynalite = require('dynalite'); const srv = dynalite({createTableMs:0}); srv.listen(0, cb)` then a `DynamoDBClient({ endpoint, region:'local', credentials:{...} })`.)

- [ ] **Step 2: Write the failing test** — create the `Users` table (PK + 2 GSIs) via the helper; then assert `upsertByGoogle` inserts + returns the user (decrypted token), a second `upsertByGoogle` same googleSub updates email/token, `getById` returns it (decrypted), `getByEmail` finds by email GSI, misses return undefined. (Mirror `domain`/current user-store.test scenarios.)

- [ ] **Step 3: Run → fail.**

- [ ] **Step 4: Implement `ddb-client.ts`** (`makeDocClient(cfg)` → `DynamoDBDocumentClient.from(new DynamoDBClient(...))`) + `DynamoUserStore` using `GetCommand`/`QueryCommand`(gsi_googleSub, gsi_email)/`PutCommand`. Encrypt on write, decrypt on read (reuse `domain/crypto`).

- [ ] **Step 5: Run → pass.** Typecheck clean.

- [ ] **Step 6: Commit** `git commit -m "feat(server): DynamoUserStore (dynalite-tested) + ddb client"`

---

### Task 4: `DynamoWorkspaceStore` (dynalite-tested)

**Files:** `server/src/stores/dynamo/workspace-store.ts`, test.

**Interfaces:** `DynamoWorkspaceStore implements WorkspaceStore`. Table `Workspaces`: PK `workspaceId`; GSI `gsi_owner` (PK `ownerUserId`); attrs `name, ownerUserId, driveFileId, hashFolderId, revision, updatedAt`.

- [ ] **Step 1: Test** — create table + GSI; assert `upsert`→`get`; `listByOwner` returns only that owner's; `setRevision` updates revision+updatedAt; `allIds` returns all ids (Scan). Mirror current workspace-store scenarios.
- [ ] **Step 2: Fail → 3: Implement** (`PutCommand`, `GetCommand`, `QueryCommand` gsi_owner, `UpdateCommand` for setRevision, `ScanCommand` projection `workspaceId` for allIds) → **Step 4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): DynamoWorkspaceStore (dynalite-tested)"`

---

### Task 5: `DynamoMembershipStore` (dynalite-tested)

**Files:** `server/src/stores/dynamo/membership-store.ts`, test.

**Interfaces:** `DynamoMembershipStore implements MembershipStore`. Table `Memberships`: PK `membershipId`; GSI `gsi_ws` (PK `workspaceId`); GSI `gsi_user` (PK `userId`); GSI `gsi_pendingEmail` (PK `pendingEmail`); attrs `workspaceId, userId?, pendingEmail?, role, permissionId`.

- [ ] **Step 1: Test** — mirror current membership scenarios: `add` resolved + pending; `getById`; `listByWorkspace`(gsi_ws); `listByUser`(gsi_user); `roleForUser`(query gsi_user filter workspaceId, or gsi_ws filter userId); `findByWorkspaceEmail`(gsi_pendingEmail filter workspaceId); `findByWorkspaceUser`; `resolvePending`(query gsi_pendingEmail → update each: set userId, remove pendingEmail); `update`(role/permissionId); `remove`. Prove pending invisible to roleForUser until resolved; re-invite `update` (no dup).
- [ ] **Step 2: Fail → 3: Implement** (Put/Get/Query/Update/Delete; `resolvePending` queries gsi_pendingEmail then UpdateCommand per item removing `pendingEmail` + setting `userId`) → **4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): DynamoMembershipStore (dynalite-tested)"`

---

### Task 6: `AuthService` (start/callback/me, stateless OAuth state)

**Files:** `server/src/services/auth-service.ts`, test (against in-memory stores + a fake GoogleOAuth + FakeDriveClient).

**Interfaces:**
- `signState(cb, secret): string` / `verifyState(token, secret): { cb } | null` — HMAC(cb+nonce+exp); single-use not enforced (stateless).
- `AuthService(deps: { users: UserStore; memberships: MembershipStore; google: GoogleOAuth; config; })`:
  - `startUrl(cb): string` — validate loopback `cb` (`isLoopbackCb`), return `google.authUrl(signState(cb))`.
  - `callback(code, state): Promise<{ redirectUrl }>` — `verifyState` → `google.exchange(code)` → `users.upsertByGoogle` → `memberships.resolvePending(email, userId)` → `signSession(userId)` → `redirectUrl = cb?token=<jwt>`.
  - `me(userId): Promise<{ id, email }>`.

- [ ] **Step 1: Tests** — `startUrl` rejects non-loopback cb; `signState`/`verifyState` round-trip + reject tampered/expired; `callback` upserts user, resolves a pending membership for that email, returns `cb?token=<jwt>`; `me` returns id+email. (Reuse the current app.auth + pending-resolve scenarios, now at the service layer.)
- [ ] **Step 2: fail → 3: implement** (reuse `domain/jwt`, `domain/google-oauth`, `isLoopbackCb` from the old app.ts, `crypto.createHmac` for state) → **4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): AuthService (oauth start/callback/me, stateless state)"`

---

### Task 7: `WorkspaceService` (list/enable/pull/push — roles, revision, owner-drive, strip)

**Files:** `server/src/services/workspace-service.ts`, test (in-memory stores + FakeDriveClient + a `driveFor` that returns it).

**Interfaces:** `WorkspaceService(deps: { workspaces; memberships; users; driveFor })`:
- `list(user): Promise<Array<SyncedWorkspace & { role }>>` — owned (`role:'owner'`) + shared (memberships.listByUser → get + role), deduped.
- `enable(user, { workspaceId, name, snapshot }): Promise<{ driveFileId, revision }>` — ownership guard; `stripSnapshotSecrets`; existing → `updateFile`, else `ensureFolder`+`createFile`; `workspaces.upsert`.
- `pull(user, id): Promise<{ snapshot, revision, role } | { status: 403|404 }>` — `resolveRole`; owner-drive `readFile`.
- `push(user, id, { snapshot, baseRevision }): Promise<{ revision } | { status: 403|404|409; body? }>` — role owner/editor else 403; revision guard → 409 `{snapshot,revision}`; owner-drive `updateFile`; `setRevision`. (No broadcast.)

- [ ] **Step 1: Tests** — reuse the current app.workspaces-* + share-read/share-write + list-shared + conflict scenarios at the service layer: owner/editor push ok, viewer push 403, non-member 403, 409 on stale base returns current snapshot, list returns owned+shared roles, enable creates+strips secrets. Use `resolveRole`/`ownerDriveFor` from `domain/authz`.
- [ ] **Step 2: fail → 3: implement** → **4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): WorkspaceService (list/enable/pull/push, roles+revision+owner-drive)"`

---

### Task 8: `MemberService` (list/add/remove — Drive perms, dedupe)

**Files:** `server/src/services/member-service.ts`, test.

**Interfaces:** `MemberService(deps: { workspaces; memberships; users; driveFor })`:
- `list(user, id): Promise<{ members } | {status:403|404}>` — any member; owner first + membership rows (email/role/pending).
- `add(user, id, { email, role }): Promise<{ member } | {status:400|403|404}>` — owner-only; role∈{editor,viewer}; dedupe/update-in-place on re-invite (revoke old perm + create new + `update`); else Drive `createPermission`(writer/reader, notify) + `memberships.add` (resolved/pending).
- `remove(user, id, memberId): Promise<{ ok } | {status:403|404}>` — owner-only; cross-workspace guard; best-effort `deletePermission` + `remove`.

- [ ] **Step 1: Tests** — reuse app.members-add + list-remove + the re-invite dedupe scenarios (single row, role updated, single perm; owner-only 403; cross-ws 404).
- [ ] **Step 2: fail → 3: implement** → **4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): MemberService (share/list/remove + re-invite dedupe)"`

---

### Task 9: Auth `Plugin` + Helios controllers + `apiFn` handler

**Files:** `server/src/auth-plugin.ts`, `server/src/deps.ts` (module singletons wiring dynamo stores + driveFactory + config), `server/src/controllers/{auth,workspaces,members}.controller.ts`, `server/src/controllers/root.controller.ts`, `server/src/handlers/api.ts`, a light smoke test `server/src/handlers/api.smoke.test.ts`.

**CONFIRM against the Helios docs/examples during this task** (the owner's framework): exact `Plugin` hook signature, `@Controller({prefix,controllers})` composition, param decorators (`@Body/@Param/@Req`), how the plugin sets/reads `req` state, how `@heliosjs/aws` maps API Gateway HTTP API v2 events, and how a handler returns a redirect (302). Use the owner's `lambda-integration` example as the template.

**Interfaces:**
- `authPlugin: Plugin` — `beforeRoute`: skip `/api/auth/*`; read `Authorization: Bearer`, `verifySession`, load user, `req.setState('user', user)`; else 401.
- Controllers are THIN: each method reads `req` (state user, params, body) → calls the matching **service** method (from `deps`) → maps `{status,body}` to a Helios response.
- `RootController` `@Controller({ prefix: '/api', controllers: [AuthController, WorkspacesController, MembersController] })`.
- `handlers/api.ts`: `import 'reflect-metadata'` → `const adapter = new Helios(RootController); adapter.usePlugin(authPlugin); export const handler = adapter.handler`.

- [ ] **Step 1: Wire `deps.ts`** — construct `DynamoUserStore`/`DynamoWorkspaceStore`/`DynamoMembershipStore` (table names + encKey from env), `makeDriveFactory(config)`, and instantiate the 3 services. Export singletons.
- [ ] **Step 2: authPlugin** — implement per the confirmed `Plugin` hook; unit-test the pure part (a `authorize(headers, verify, loadUser)` function → user|null) with a fake verify + store.
- [ ] **Step 3: Controllers** — thin wrappers calling services; each returns/throws per Helios's response convention (confirm: return value serialized; for 302 redirect + status codes use the framework's response API).
- [ ] **Step 4: `handlers/api.ts`** — root + plugin + export handler.
- [ ] **Step 5: Smoke** — if the Helios adapter can be invoked in-process with a synthetic API Gateway v2 event, write one smoke test (GET `/api/auth/start?cb=http://localhost:5000` → 302 to Google). If invoking the adapter in a unit test is impractical, SKIP the smoke and rely on the service tests + the manual runbook (note it). Typecheck + `npx tsc --noEmit` clean regardless.
- [ ] **Step 6: Commit** `git commit -m "feat(server): auth plugin + Helios controllers + apiFn handler"`

---

### Task 10: `PollService` + `pollFn` (EventBridge)

**Files:** `server/src/services/poll-service.ts`, `server/src/handlers/poll.ts`, test.

**Interfaces:** `PollService(deps: { workspaces; users; driveFor })`:
- `pollAll(): Promise<number>` — for each `workspaces.allIds()`: resolve owner drive (`driveFor(users.getById(ownerUserId))`), read `getHeadRevision(driveFileId)`; if it differs from stored `revision` → `setRevision(id, head, now)` (bumps for the client's next poll); count bumped. Per-item try/catch (one bad workspace doesn't abort). NO broadcast.
- `handlers/poll.ts`: `export const handler = async () => { await pollService.pollAll() }` (EventBridge invokes; ignores event).

Note: `DriveClient.getHeadRevision` already exists (from DS-Phase 4). Keep it in `domain/drive-client`.

- [ ] **Step 1: Test** — two workspaces, mutate one Drive file's head revision via FakeDriveClient; `pollAll` returns 1 and bumps only that workspace's stored revision; unknown owner skipped.
- [ ] **Step 2: fail → 3: implement** → **4: pass** → typecheck.
- [ ] **Step 5: Commit** `git commit -m "feat(server): PollService + pollFn (outside-edit revision bump)"`

---

### Task 11: AWS CDK infra

**Files:** `server/infra/bin/app.ts`, `server/infra/lib/{data-stack,api-stack,scheduler-stack,functions}.ts`, `server/infra/cdk.json`, test `server/infra/test/synth.test.ts`.

**CONFIRM CDK construct APIs** (`aws-cdk-lib` v2: `aws-dynamodb`, `aws-lambda-nodejs.NodejsFunction`, `aws-apigatewayv2` + `aws-apigatewayv2-integrations.HttpLambdaIntegration`, `aws-events`+`aws-events-targets`, `aws-secretsmanager`) during the task.

**Interfaces:**
- `DataStack`: 3 `Table`s (Users/Workspaces/Memberships) with the GSIs from Tasks 3-5, `BillingMode.PAY_PER_REQUEST`; 3 `Secret`s (or one JSON secret) for GOOGLE_CLIENT_SECRET/JWT_SECRET/TOKEN_ENC_KEY. Exposes table names + secret ARNs.
- `functions.ts`: `apiFunction(scope, {tables, secrets, config})` + `pollFunction(...)` — `NodejsFunction` (esbuild bundling of `handlers/api.ts` / `handlers/poll.ts`), env (table names + `GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI` + secret values via `secretsmanager` grants), least-privilege IAM (`table.grantReadWriteData(fn)` per needed table, `secret.grantRead(fn)`).
- `ApiStack`: `HttpApi` + `HttpLambdaIntegration(apiFn)` on `ANY /{proxy+}`; output the API URL.
- `SchedulerStack`: `Rule(schedule: Schedule.rate(Duration.minutes(1)))` → `LambdaFunction(pollFn)` target.

- [ ] **Step 1: `cdk.json` + bin/app.ts** — app instantiating DataStack → ApiStack → SchedulerStack (env account/region from context).
- [ ] **Step 2: Implement the stacks + functions factory** per the confirmed CDK v2 API.
- [ ] **Step 3: Synth test** — `Template.fromStack(stack)` assertions: 3 tables with expected GSIs + PAY_PER_REQUEST; HttpApi + a Lambda integration on `ANY /{proxy+}`; an EventBridge rule at rate 1 min targeting pollFn; IAM policies scoped to the tables/secrets. Run `cd server/infra && npx vitest run` (or `cdk synth` in CI).
- [ ] **Step 4: `npx cdk synth`** succeeds (no deploy). Typecheck clean.
- [ ] **Step 5: Commit** `git commit -m "feat(infra): CDK data + api + scheduler stacks"`

---

### Task 12: Extension — remove `SyncSocket`, add client poll loop

**Files:** modify `src/extension/panel.ts` (drop SyncSocket wiring, add a poll timer), possibly a new `src/extension/sync/poll-loop.ts`; remove/retire `src/extension/sync/sync-socket.ts` (+ test); test `test/extension/sync/poll-loop.test.ts`.

**Interfaces:**
- `createPollLoop(deps: { listWorkspaces(): Promise<RemoteWorkspace[]>; state: SyncStateStore; pullIfNewer(id, revision): Promise<boolean>; onPulled(): Promise<void>; intervalMs?: number })` — `start()`/`stop()`; each tick: `listWorkspaces()`; for each returned workspace, if locally `synced` and its server `revision !== sync-state.lastRevision`, `await pullIfNewer(id, revision)`; if any pulled, `await onPulled()`.
- `panel.ts`: replace `new SyncSocket(...)` + `runtime.onSocketChange` with `createPollLoop({ listWorkspaces: () => syncClient.listWorkspaces(), state: syncState, pullIfNewer: (id, r) => manager.pullIfNewer(id, r), onPulled: () => hub.refresh(), intervalMs })`. Config `restman.syncPollIntervalMs` (default 45000).
- `SyncClient.listWorkspaces` already returns each workspace with `revision` (+ `role`). `pullIfNewer` already exists.

- [ ] **Step 1: Test `poll-loop.test.ts`** — fake `listWorkspaces` returns `[{id:'w1',revision:'5'}]`; sync-state has `w1 lastRevision '3' synced`; one tick → `pullIfNewer('w1','5')` called + `onPulled` called; if revision equals lastRevision → not called. Use fake timers.
- [ ] **Step 2: fail → 3: implement** `poll-loop.ts` + wire `panel.ts` (remove SyncSocket import/usage; keep auto-push + role cache). Delete `sync-socket.ts` + its test (the WS client is gone).
- [ ] **Step 4:** `npx vitest run test/extension && npx tsc --noEmit && npm run build` — green/clean/build ok.
- [ ] **Step 5: Commit** `git commit -m "feat(sync): replace WebSocket with a client poll loop"`

---

### Task 13: Remove the legacy Fastify/ws/sqlite server; wire config

**Files:** delete `server/src/{app,server,realtime,ws-server,watch-service,watch-scheduler,watch-channel-store,pending-states}.ts` + their tests + the sqlite `{user,workspace,membership}-store.ts` (now replaced by dynamo + memory); delete the old `drive-client` FakeDriveClient? (keep the FakeDriveClient — tests use it; it lives in `domain/drive-client`). Update `server/package.json` (remove fastify/ws/better-sqlite3; scripts: `test`, `typecheck`, `cdk` passthrough).

- [ ] **Step 1: Delete** the legacy files (confirm nothing in `services/`/`controllers/`/`handlers/`/`stores/dynamo`/`domain` imports them). `git rm` them + tests.
- [ ] **Step 2:** `cd server && npx tsc --noEmit && npx vitest run` — everything green with only the new layers. Remove now-unused deps.
- [ ] **Step 3: Commit** `git commit -m "chore(server): remove legacy Fastify/ws/sqlite backend"`

---

### Task 14: Deploy + OAuth manual verification doc

**Files:** `server/README.md` (rewrite for the serverless stack), `docs/sync-aws-backend-verification.md`.

- [ ] **Step 1: Rewrite `server/README.md`** — Google OAuth app setup (one, by operator) + redirect `https://<api>/auth/callback`; AWS creds + `cd server/infra && npx cdk deploy`; set Secrets Manager values; set the extension `restman.syncServerUrl` to the deployed URL. Local dev: `dynalite` for tests; optional local Lambda emulation note.
- [ ] **Step 2: `docs/sync-aws-backend-verification.md`** — runbook: deploy stacks; sign in from the extension (loopback → Google → JWT); enable sync on a workspace (Drive file created); edit in another window → within a poll interval the other window pulls; outside Drive edit → `pollFn` bumps revision → client pulls; share by email → member sees it; viewer read-only; remove member.
- [ ] **Step 3: Commit** `git commit -m "docs: serverless backend README + verification runbook"`

---

## Self-Review

**Spec coverage:** Helios controllers+plugin (Task 9) ✓; DynamoDB per-entity stores (Tasks 3-5, dynalite-tested) ✓; services with the SAME role/revision/owner-drive/strip/pending semantics (Tasks 6-8) ✓; poll instead of WS (Task 10 server pollFn + Task 12 client poll loop) ✓; CDK 3 stacks (Task 11) ✓; domain reuse + readable layering (Tasks 1-2) ✓; legacy removal (Task 13) ✓; deploy runbook (Task 14) ✓. Dropped per spec: `ws`/`Realtime`/`/webhook`/watch channels/renew.

**Placeholder scan:** pure-logic tasks (stores/services/poll/extension) carry full TDD code paths + exact interfaces. Framework-coupled tasks (9 Helios, 11 CDK) give the confirmed API + exact structure + explicit "CONFIRM against the owner's Helios docs / CDK v2 API during this task" — the honest level for the owner's own thin-doc framework + IaC (like the frontend-design tasks). The service layer holds all business logic and is fully unit-tested, so controllers/handlers/CDK being integration-verified (smoke + `cdk synth` + manual runbook) is sound.

**Type consistency:** async store interfaces (Task 2) implemented by both memory (Task 2) and dynamo (3-5) impls; services (6-8) depend on the interfaces + `domain/authz`/`drive-factory`; controllers (9) call services; `pollFn` (10) uses WorkspaceService's stores + `getHeadRevision`; CDK (11) provisions the tables the stores expect; the extension poll loop (12) uses existing `SyncClient.listWorkspaces` (revision+role) + `SyncManager.pullIfNewer`.

**Security parity:** every gate from the current server is preserved in the service layer (role checks via `resolveRole`, owner-credential Drive via `ownerDriveFor`, viewer PUT→403, owner-only member ops, revision-guard 409, `stripSnapshotSecrets` on write, pending-invite tied to the OAuth email). The JWT auth moves to the Helios plugin. No Google secret ships to the client (backend-only, Secrets Manager). Stateless OAuth `state` is HMAC-signed with a TTL.

**Integration risk called out:** the Helios adapter wiring (Task 9) and CDK (Task 11) aren't fully unit-tested against a live AWS/Helios runtime — the services, stores (dynalite), poll, and extension loop ARE; the end-to-end deploy + OAuth + cross-account share is the Task 14 manual runbook (needs an AWS account + the one Google OAuth app). If the Helios adapter can't be invoked in-process, the controller smoke is skipped in favor of the service tests + runbook (noted in Task 9).
