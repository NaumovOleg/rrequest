# restman sync server (serverless)

Backend for Google Drive workspace sync: Google OAuth login + app-session JWT
+ per-workspace Drive-file sync + sharing (owner/editor/viewer). Runs entirely
on AWS Lambda behind API Gateway — no long-running process, no WebSocket. The
extension discovers remote changes by polling.

## Architecture

```
Extension ──HTTPS + JWT──► API Gateway HTTP API (v2) ──► apiFn (Lambda: Helios RootController + authPlugin)
                                                              │
                                                              ▼
                                              DynamoDB: Users, Workspaces, Memberships
                                                              ▲
EventBridge (rate 1 min) ─────────────► pollFn (Lambda) ──────┘   (bumps workspace.revision on outside-Drive edits)
SSM Parameter Store (SecureString): GOOGLE_CLIENT_SECRET / JWT_SECRET / TOKEN_ENC_KEY ─► fetched at Lambda cold start
```

- **`apiFn`** (`server/src/handlers/api.ts` → `handlers/api-app.ts`) — a single
  Lambda running the Helios (`@heliosjs/core` + `@heliosjs/aws`) app. API
  Gateway forwards every request (`ANY /{proxy+}`) to it; Helios's own router
  dispatches by method/path inside the function. `RootController` (prefix
  `/api`) composes `AuthController` (mounted at `/`, so `/auth/start`,
  `/auth/callback`, `/me` land at `/api/auth/*` and `/api/me`),
  `WorkspacesController` (prefix `/workspaces` → `/api/workspaces*`), and
  `MembersController` (same prefix → `/api/workspaces/:id/members*`). An
  `authPlugin` (`src/auth-plugin.ts`) resolves the caller from the
  `Authorization: Bearer <jwt>` header on every path except `/api/auth/*`;
  each protected controller method calls `requireUser(req)` to enforce it
  (see the comment in `auth-plugin.ts` for why the plugin hook itself can't
  short-circuit the request under Helios).
- **`pollFn`** (`server/src/handlers/poll.ts` → `handlers/poll-app.ts`) — a
  plain (non-Helios) Lambda invoked by an EventBridge rule every 1 minute
  (`server/infra/lib/scheduler-stack.ts`). For every workspace it reads the
  Drive file's current head revision (using the *owner's* stored refresh
  token) and, if it has moved since the last stored value, calls
  `setRevision` — this is how edits made directly in Google Drive (outside
  the extension) get picked up.
- **DynamoDB** — 3 on-demand tables (no separate `WatchChannels` table; Drive
  watch/webhook/renew was dropped from MVP in favor of polling):
  - `Users` (PK `userId`; GSIs `gsi_googleSub`, `gsi_email`)
  - `Workspaces` (PK `workspaceId`; GSI `gsi_owner`)
  - `Memberships` (PK `membershipId`; GSIs `gsi_ws`, `gsi_user`, `gsi_pendingEmail`)
- **SSM Parameter Store** — 3 `SecureString` parameters
  (`/restman/GOOGLE_CLIENT_SECRET`, `/restman/JWT_SECRET`,
  `/restman/TOKEN_ENC_KEY`). CloudFormation can't create `SecureString`
  params, so `DataStack` does NOT provision them — the operator creates them
  post-deploy (see below). Both Lambdas get the param NAMES baked into their
  environment (`GOOGLE_CLIENT_SECRET_PARAM`, `JWT_SECRET_PARAM`,
  `TOKEN_ENC_KEY_PARAM`) plus IAM `ssm:GetParameter` (scoped to those param
  ARNs) + `kms:Decrypt` (scoped via `kms:ViaService` to SSM). On cold start,
  `src/secrets.ts`'s `ensureSecretsLoaded()` fetches each value (decrypted)
  and writes it into `process.env` under the plaintext name (`JWT_SECRET`,
  `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_SECRET`) that `domain/config.ts`'s
  `loadConfig()` requires — this must happen (and does, via a deferred
  dynamic `import()` in `handlers/api.ts` / `handlers/poll.ts`) *before*
  `deps.ts` is imported, since `deps.ts` calls `loadConfig()` at module top
  level and throws if a required var is missing. Warm invocations skip the
  fetch (idempotent per container).
- **No WebSocket / realtime.** The extension polls
  `GET /api/workspaces` (`restman.syncPollIntervalMs`, default 45s) and
  compares each workspace's `revision`; `pollFn`'s 1-minute sweep is what
  makes an out-of-band Drive edit show up as a revision bump for the client
  to notice.

## One-time operator setup

### 1. Google OAuth app (one, shared by all users of this deployment)

1. In Google Cloud Console: create **one** OAuth 2.0 **Web application**
   client and enable the **Google Drive API** for the project.
2. You will need to add the exact redirect URI, but **the URL is only known
   after the first deploy** (API Gateway assigns it). So:
   a. Do a first `cdk deploy` (see below) with a placeholder
      `GOOGLE_REDIRECT_URI` (e.g. `https://placeholder.example.com/api/auth/callback`).
   b. Read the `ApiUrl` CfnOutput from `RestmanApiStack` (e.g.
      `https://abc123xyz.execute-api.us-east-1.amazonaws.com`).
   c. The real redirect URI is that URL **+ `/api/auth/callback`** (the
      `/api` prefix comes from `RootController`'s `prefix: "/api"`; the
      `AuthController`'s `@Get("/auth/callback")` is mounted under it — see
      `RootController`'s doc comment and `AUTH_PREFIX = "/api/auth"` in
      `auth-plugin.ts`). Example:
      `https://abc123xyz.execute-api.us-east-1.amazonaws.com/api/auth/callback`
   d. Add that exact URL as an authorized redirect URI on the Google OAuth
      client.
   e. Re-deploy with `GOOGLE_REDIRECT_URI` set to the real value (step 3
      below) so the Lambda's env matches what Google will actually redirect
      to.
3. Note the client's **Client ID** (`GOOGLE_CLIENT_ID`, not secret — baked
   into the Lambda env directly) and **Client Secret** (secret — goes into
   SSM Parameter Store after deploy, see below; never passed as a deploy-time
   env var).

### 2. AWS credentials

Have AWS credentials (profile or env vars) with permission to create Lambda,
API Gateway, DynamoDB, EventBridge, and IAM resources, and
know the target account/region.

## Deploy

```sh
cd server
npm install   # aws-cdk / aws-cdk-lib / constructs live here; server/infra has
              # no package-lock.json of its own and resolves them via Node's
              # normal parent-directory node_modules lookup.

cd infra
export CDK_DEFAULT_ACCOUNT=<your-account-id>
export CDK_DEFAULT_REGION=<your-region>          # e.g. us-east-1
export GOOGLE_CLIENT_ID=<oauth-client-id>
export GOOGLE_REDIRECT_URI=<see step 1 above — placeholder on the first deploy>

npx cdk deploy --all
```

This deploys 3 stacks (`bin/app.ts`): `RestmanDataStack` (tables; the
secrets are out-of-band SSM params), `RestmanApiStack` (the HTTP API + `apiFn`), `RestmanSchedulerStack`
(the EventBridge rule + `pollFn`). `RestmanApiStack` prints a `ApiUrl`
CfnOutput — that's the base URL from step 1b above.

After confirming/updating the Google redirect URI (step 1), re-run
`npx cdk deploy --all` with the real `GOOGLE_REDIRECT_URI` so the deployed
Lambda env matches.

### Create the 3 secret parameters

CDK does NOT create these (CloudFormation can't make `SecureString` SSM
parameters). Create them as `SecureString` after deploy, using the exact
names the Lambdas read. `--type SecureString` with no `--key-id` uses the
free AWS-managed `alias/aws/ssm` key (which the Lambdas' `kms:Decrypt` grant
covers):

```sh
aws ssm put-parameter --name /restman/GOOGLE_CLIENT_SECRET --type SecureString --overwrite \
  --value '<the OAuth client secret from Google Cloud Console>'

aws ssm put-parameter --name /restman/JWT_SECRET --type SecureString --overwrite \
  --value '<a long random string — HMAC key for session JWTs and the stateless OAuth state param>'

aws ssm put-parameter --name /restman/TOKEN_ENC_KEY --type SecureString --overwrite \
  --value '<a long random string — AES-256-GCM key encrypting stored Google refresh tokens at rest>'
```

(Rotating a value later: re-run `put-parameter --overwrite`, then the next
Lambda cold start picks it up — a warm container caches the value.)

Find the secret ARNs/names in the `RestmanDataStack` outputs or the Secrets
Manager console (`GoogleClientSecret`, `JwtSecret`, `TokenEncKey` — CDK
appends a suffix to each logical ID). Both Lambdas read these lazily at cold
start (`ensureSecretsLoaded` in `src/secrets.ts`); a warm container never
re-fetches, so updating a secret's value takes effect on the *next* cold
start, not instantly.

## Point the extension at the deployed backend

Set the VS Code setting **`restman.syncServerUrl`** to the deployed API's
`/api` base — i.e. the `ApiUrl` CfnOutput **with `/api` appended**:

```
https://abc123xyz.execute-api.us-east-1.amazonaws.com/api
```

The extension's `SyncClient` (`src/extension/sync/sync-client.ts`) and the
loopback sign-in helper (`src/extension/sync/login.ts`) both concatenate
this base directly with unprefixed paths (`/me`, `/workspaces`,
`/auth/start`, ...) — so the configured URL **must already include `/api`**;
the client does not add it. With the base above, the effective routes are
`/api/auth/start`, `/api/auth/callback`, `/api/me`, `/api/workspaces`, etc.

(The `restman.syncServerUrl` setting's packaged default,
`http://localhost:8787`, is a holdover from the old local Fastify server and
does **not** work against this backend — there is no local long-running dev
server anymore. Always point it at a deployed API Gateway URL + `/api`.)

## Local dev / testing

There is no local server process to run (`npm run dev` no longer exists —
the old Fastify entrypoint is gone). Everything runs as Lambda handlers.

- **Unit + integration tests** (no AWS account needed):
  ```sh
  cd server
  npm test
  ```
  Dynamo-backed store tests spin up an in-process `dynalite` instance
  (`server/src/test-support/dynalite.ts`) for a real (embedded) DynamoDB
  wire protocol; the API-handler smoke test
  (`src/handlers/api.smoke.test.ts`) sets plaintext env vars directly
  (`JWT_SECRET`, `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`) before importing the handler, so
  `ensureSecretsLoaded()` sees them already set and never touches Secrets
  Manager.
- **CDK synth check** (no deploy, no AWS account):
  ```sh
  cd server/infra
  npx vitest run   # test/synth.test.ts
  ```
- **Running a handler locally by hand**: import `server/src/handlers/api.ts`
  (or `poll.ts`) with plaintext env vars set (`JWT_SECRET`, `TOKEN_ENC_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and
  optionally `DYNAMO_ENDPOINT` pointed at a local dynalite/DynamoDB Local
  instance) and no `*_PARAM` vars — `ensureSecretsLoaded` treats any
  already-set plaintext var as "already loaded" and skips Parameter Store
  entirely (see `server/src/secrets.ts`). There is no bundled local API
  Gateway emulator; for a full HTTP round-trip locally you'd invoke the
  handler with a hand-built `APIGatewayProxyEventV2` (see
  `api.smoke.test.ts` for the event shape) or use a third-party tool like
  `sam local` / `aws-lambda-runtime-interface-emulator` (not currently wired
  into this repo).

## Endpoints

All paths below are relative to the deployed API's `/api` base.

- `GET /auth/start?cb=<loopback-url>` → 302 to Google consent.
- `GET /auth/callback?code=&state=` → 302 to `<cb>?token=<jwt>`.
- `GET /me` (Bearer JWT) → `{ id, email }`.
- `GET /workspaces` (Bearer JWT) → the caller's synced workspaces (owned +
  shared), each with a `role` (`owner`/`editor`/`viewer`) and `revision`.
- `POST /workspaces` (Bearer JWT) `{ workspaceId, name, snapshot }` → creates
  (or, if the caller already owns that workspace, updates) the Drive file
  under `<hash>-restman/`, stores a row, returns `{ driveFileId, revision }`.
  403 if the workspace ID already exists and is owned by someone else.
- `GET /workspaces/:id` (Bearer JWT, any role) → pulls, returns
  `{ snapshot, revision, role }`. 403 if the caller has no role on the
  workspace, 404 if it doesn't exist.
- `PUT /workspaces/:id` (Bearer JWT, owner or editor) `{ snapshot, baseRevision }`
  → pushes if `baseRevision` matches the stored revision, returns
  `{ revision }`; 409 with `{ snapshot, revision }` (the current server
  state) on a stale `baseRevision`; 403 for a viewer or non-member.
- `GET /workspaces/:id/members` (Bearer JWT, any role) → `{ members: [...] }`
  (owner first, then editors/viewers; a member invited by email before they
  ever signed in has `pending: true`).
- `POST /workspaces/:id/members` (Bearer JWT, owner only) `{ email, role }`
  (`role` is `editor` or `viewer`) → creates a Drive permission + membership
  row (pending if the email has no restman account yet), returns
  `{ member }`.
- `DELETE /workspaces/:id/members/:memberId` (Bearer JWT, owner only) →
  removes the Drive permission + membership row, returns `{ ok: true }`.

## Tests

```sh
cd server && npm test
cd server/infra && npx vitest run
```
