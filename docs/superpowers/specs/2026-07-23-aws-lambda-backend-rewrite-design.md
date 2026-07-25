# restman Sync Backend — AWS Lambda + Helios + DynamoDB Rewrite — Design Spec

**Status:** design (approved decisions below) → next: implementation plan → subagent execution.

## Goal

Re-platform the restman sync backend (`server/`) from a single long-running Fastify + `ws` + better-sqlite3 process to a **serverless AWS stack**: HTTP on **AWS Lambda via `@heliosjs/*`** (the project owner's own decorator framework), data in **DynamoDB**, scheduled work on **EventBridge**, infra as **AWS CDK**. Realtime WebSockets are **removed** in favor of client polling. The result deploys to the operator's AWS account; the extension keeps talking only to one HTTPS URL + an app JWT (no Google secret ever ships to users).

## Locked decisions (from consultation)

1. **HTTP layer:** `@heliosjs/core` (decorators + DI) + `@heliosjs/aws` (Lambda adapter). Decorator/controller style (NestJS-like).
2. **DB:** DynamoDB, **per-entity tables** (1:1 with the current store interfaces).
3. **Realtime:** **removed.** No WebSocket. Clients learn of changes by **periodic pull**; the backend detects outside-Drive edits via an EventBridge-scheduled `pollFn` that bumps the workspace revision.
4. **Infra:** AWS CDK (TypeScript).
5. **Drive watch/webhook/renewal:** **dropped from MVP** (reversible). With WS gone and the client polling anyway, the push webhook's only benefit is a slightly fresher server revision; the client still only sees it on its next poll. So MVP relies on `pollFn` + client poll. → **3 tables** (no `WatchChannels`), no `/webhook`, no renew.

## Helios API (confirmed from the owner's docs + example)

```ts
import 'reflect-metadata'
import { Helios, Plugin } from '@heliosjs/aws'
import { Controller, Get, Post, Put, Delete, Any, Body, Param, Req } from '@heliosjs/core'

@Controller({ prefix: '/workspaces' })
class WorkspacesController {
  @Get('/') list(@Req() req) { const user = req.getState('user'); /* ... */ }
  @Put('/:id') push(@Param('id') id, @Body() body, @Req() req) { /* ... */ }
}

// Root controller composes children via `controllers: []`
@Controller({ prefix: '/api', controllers: [AuthController, WorkspacesController, MembersController] })
class RootController {}

const adapter = new Helios(RootController)
adapter.usePlugin(authPlugin)          // Plugin: { name, onInit(server), hooks: { beforeRoute(req,res) } }
export const handler = adapter.handler // AWS Lambda handler
```

- **Auth** is a `Plugin` (`beforeRoute`): read `Authorization: Bearer <jwt>`, `verifySession`, `req.setState('user', {...})`; controllers read `req.getState('user')`. Unauthed → reject in the hook.
- **DI:** available in `@heliosjs/core`, but stores are wired as **module singletons** (imported into controllers) to avoid coupling the design to an unconfirmed DI syntax. Revisit if the owner prefers Helios DI.

## Architecture

```
Extension ──HTTPS + JWT──► API Gateway HTTP API (v2) ──► apiFn (Lambda: Helios RootController + authPlugin)
                                                              │
                                                              ▼
                                              DynamoDB: Users, Workspaces, Memberships
                                                              ▲
EventBridge (rate 1 min) ─────────────► pollFn (Lambda) ──────┘   (bumps workspace.revision on outside Drive edits)
Secrets Manager: GOOGLE_CLIENT_SECRET / JWT_SECRET / TOKEN_ENC_KEY ─► injected as Lambda env
```
- **`apiFn`** — one Helios Lambda behind API Gateway HTTP API (`ANY /{proxy+}` → apiFn); RootController routes to auth/workspaces/members; authPlugin gates everything except `/auth/*`.
- **`pollFn`** — scheduled plain Lambda (NOT a Helios controller): for each workspace, read the Drive file's current `headRevisionId` (owner creds) and, if it differs from the stored revision, `setRevision`. This is the outside-edit detector; clients pick it up on their next poll.
- No `ws`, no `Realtime`, no `WatchScheduler`, no `/webhook`, no watch channels.

## What is reused vs rewritten

**Reused ~verbatim (pure domain — no Node-server/sqlite coupling):**
- `crypto.ts` (AES-256-GCM), `jwt.ts` (sign/verify session), `google-oauth.ts` (authUrl/exchange), `drive-client.ts` (fetch-based Drive REST — Lambda-friendly), `drive-factory.ts` (`folderNameForUser`, per-user OAuth2Client), `authz.ts` (`resolveRole`, `ownerDriveFor`), `snapshot`/`merge` logic, `stripSnapshotSecrets`, the `WatchService.detect…` revision-compare logic (repurposed into `pollFn`, minus broadcast), `pending-states` (OAuth state; may move to a short-TTL DynamoDB item or stay in-memory per-invocation — see below).

**Rewritten:**
- **Stores** → DynamoDB implementations behind the **existing interfaces** (`UserStore`, `WorkspaceStore`, `MembershipStore`). Method signatures unchanged; bodies use `@aws-sdk/lib-dynamodb` `DynamoDBDocumentClient`.
- **HTTP transport** → Fastify routes become Helios controllers; `requireUser` becomes the auth `Plugin`.
- **Realtime** → deleted (`realtime.ts`, `ws-server.ts`).
- **Scheduler** → `watch-scheduler.ts` (setInterval) → EventBridge rule → `pollFn`. `watch-channel-store.ts` + the webhook route → dropped (MVP).
- **Entry** → `server.ts` (app.listen) → per-Lambda `handler` exports.
- **`pending-states`** (OAuth `state`): the loopback OAuth flow spans `/auth/start` → Google → `/auth/callback` (two separate Lambda invocations), so in-memory state does NOT survive. → move to a DynamoDB **`OAuthStates`** item with a TTL (single-use). (This is a 4th small table, or reuse a table with a TTL attribute.) Alternatively encode `cb` into a signed `state` JWT (stateless, no table). **Decision: signed stateless `state`** (HMAC the `cb`+nonce, TTL in the token) — avoids a table and matches the loopback flow. → stays **3 tables**.

## DynamoDB tables + access patterns

All keys map from the current store queries. On-demand billing; `@aws-sdk/lib-dynamodb` DocumentClient.

**Users** — PK `userId`.
- GSI `gsi_googleSub` (PK `googleSub`) — `upsertByGoogle` lookup.
- GSI `gsi_email` (PK `email`) — `getByEmail`.
- Attrs: `email`, `googleSub`, `refreshTokenEnc` (AES-GCM ciphertext).
- Ops: `getById`(PK), `getByEmail`(GSI), `upsertByGoogle`(query gsi_googleSub → put).

**Workspaces** — PK `workspaceId`.
- GSI `gsi_owner` (PK `ownerUserId`) — `listByOwner`.
- Attrs: `name`, `ownerUserId`, `driveFileId`, `hashFolderId`, `revision`, `updatedAt`.
- Ops: `get`(PK), `listByOwner`(GSI), `upsert`(put), `setRevision`(update), `allIds` (Scan — only used by `pollFn`; acceptable, or a GSI-less Scan on a small table; revisit if it grows).

**Memberships** — PK `membershipId`.
- GSI `gsi_ws` (PK `workspaceId`) — `listByWorkspace` + role lookups.
- GSI `gsi_user` (PK `userId`) — `listByUser`.
- (pending-email lookups: query `gsi_ws` filtered by `pendingEmail`, or a GSI `gsi_pendingEmail`.)
- Attrs: `workspaceId`, `userId?`, `pendingEmail?`, `role`, `permissionId`.
- Ops: `add`(put), `getById`(PK), `listByWorkspace`(gsi_ws), `listByUser`(gsi_user), `roleForUser`(query gsi_ws + filter userId, or gsi_user + filter workspaceId), `findByWorkspaceEmail`(gsi_ws + filter), `findByWorkspaceUser`, `resolvePending`(query by pendingEmail → update user_id), `update`, `remove`(delete).

(`resolvePending` across workspaces stays as-is — one sign-in resolves all pending invites for that email, which is desired.)

## HTTP routes → controllers

- **AuthController** `/auth` (public — authPlugin skips `/auth/*`): `GET /start?cb=…` (validate loopback cb, redirect to Google), `GET /callback?code=&state=` (exchange, upsertByGoogle, resolvePending, mint JWT, redirect to `cb?token=`), plus `GET /me` (authed).
- **WorkspacesController** `/workspaces` (authed, role-gated via `resolveRole`): `GET /` (owned+shared with roles), `POST /` (enable — owner), `GET /:id` (pull — any role, owner Drive creds), `PUT /:id` (push — owner/editor, viewer 403, revision guard 409). No `broadcast` (WS gone).
- **MembersController** `/workspaces/:id/members` (authed): `GET` (any member), `POST` (owner — Drive permission + membership/pending), `DELETE /:memberId` (owner — revoke + remove).

All role checks, owner-credential Drive access, secret-strip, revision/409 guard, pending resolution — **identical semantics to the current server** (reuse `authz` + domain). Only the transport + store backing change.

## Extension change (WS → poll)

Removing the server WebSocket ripples to the client:
- **Remove** `SyncSocket` (WS client) + its wiring in `panel.ts`.
- **Add** a client **poll loop**: a timer (e.g. 30–60s, configurable) that calls `GET /workspaces` (already returns each workspace with its `revision`), and for each locally-synced workspace whose server revision differs from `sync-state.lastRevision`, calls the existing `SyncManager.pullIfNewer(id, revision)`. `pullIfNewer` already exists — only the trigger changes from socket-event to timer.
- Auto-push (debounced) stays. The `authState`/role/synced UI chrome is unaffected.
- Net: near-real-time becomes poll-latency real-time (acceptable per the decision).

## AWS CDK structure

```
server/infra/                    # CDK app (TypeScript)
  bin/app.ts                     # App, env(account/region), Stack wiring
  lib/data-stack.ts              # 3 DynamoDB tables + GSIs (on-demand) + Secrets Manager secrets
  lib/api-stack.ts               # HttpApi (API GW v2) + apiFn (NodejsFunction) + ANY /{proxy+} route
  lib/scheduler-stack.ts         # EventBridge rate(1 minute) rule → pollFn
  lib/functions.ts               # shared NodejsFunction factory: esbuild bundling, env from secrets,
                                 #   least-privilege IAM (each fn only its tables + secretsmanager:GetSecretValue)
```
- **IAM least-privilege:** `apiFn` → RW on all 3 tables + read secrets; `pollFn` → RW Workspaces + read Users (owner creds) + read secrets.
- **Secrets:** `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `TOKEN_ENC_KEY` in Secrets Manager; CDK grants read + injects ARNs/values as env (or fetched at cold start).
- **Config:** `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI` (`https://<api>/auth/callback`), `PUBLIC_BASE_URL` as plain Lambda env.
- **Deploy:** `cd server/infra && npx cdk deploy`. Extension's default `restman.syncServerUrl` → the deployed HTTPS API URL.

## Testing

- **Domain** (crypto/jwt/oauth/authz/merge/drive-client-fake): reused tests pass unchanged.
- **Stores:** DynamoDB implementations tested against **DynamoDB Local** (docker) or `aws-sdk-client-mock` — mirror the current store test suites (same interface → same assertions).
- **Controllers:** unit-test the handler logic by invoking controller methods with a fake `req` (state/params/body) + the store fakes; assert status/shape + store effects (same behaviors as the current app.*.test.ts).
- **pollFn:** unit-test the revision-bump logic with the `FakeDriveClient` + store fakes.
- **CDK:** `cdk synth` snapshot / fine-grained assertions on the stacks.
- The **real** Google OAuth + DynamoDB + deploy path = a manual verification runbook (needs an AWS account + the one Google OAuth app).

## Migration / rollout

- The current `server/` (Fastify+sqlite) and the new serverless backend can coexist during development; the extension points at whichever `syncServerUrl` is configured. Cut over by changing the default URL.
- No user data migration needed for a fresh launch (no production users yet). If there were, a one-off script would copy sqlite rows → DynamoDB.

## Open items (confirm during planning)

1. **Helios multi-controller registration** — confirmed `@Controller({ controllers: [...] })` root pattern from the owner's example; verify child-controller prefixes compose as expected (`/api` + `/workspaces` + `/:id`) during the first task.
2. **Helios DI** — using module singletons for stores; switch to Helios DI only if the owner wants.
3. **`allIds` Scan in `pollFn`** — fine at small scale; if workspaces grow large, add a GSI or paginate.
4. **Stateless OAuth `state`** (signed cb+nonce) vs a TTL DynamoDB item — spec chooses signed stateless; revisit if replay-protection needs server-side single-use tracking.
5. **Cold starts** — acceptable for a sync backend; provisioned concurrency only if latency matters later.
