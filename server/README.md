# rrequest sync server (serverless)

Backend for Google Drive workspace sync: Google OAuth login + app-session JWT
+ per-workspace Drive-file sync + sharing (owner/editor/viewer). Runs entirely
on AWS Lambda via a Lambda Function URL — no long-running process, no WebSocket. The
extension discovers remote changes by polling.

## Architecture

```
Extension ──HTTPS + JWT──► Lambda Function URL ──► apiFn (Lambda: Helios RootController + authPlugin)
                                                              │
                                                              ▼
                                              DynamoDB: Users, Workspaces, Memberships
                                                              ▲
EventBridge (rate 1 min) ─────────────► pollFn (Lambda) ──────┘   (bumps workspace.revision on outside-Drive edits)
Secret VALUES (GOOGLE_CLIENT_SECRET / JWT_SECRET / TOKEN_ENC_KEY) ─► baked into the Lambda env at deploy (from GitHub environment secrets)
```

- **`apiFn`** (`server/src/handlers/api.ts` → `handlers/api-app.ts`) — a single
  Lambda running the Helios (`@heliosjs/core` + `@heliosjs/aws`) app. It is
  fronted by a **Lambda Function URL** (no API Gateway) — the URL delivers a
  payload-format-2.0 event (the same shape API Gateway HTTP API used), and
  Helios's own router dispatches by method/path inside the function.
  `RootController` (prefix
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
  (`infra/lib/rrequest-stack.ts`). For every workspace it reads the
  Drive file's current head revision (using the *owner's* stored refresh
  token) and, if it has moved since the last stored value, calls
  `setRevision` — this is how edits made directly in Google Drive (outside
  the extension) get picked up.
- **DynamoDB** — 3 on-demand tables (no separate `WatchChannels` table; Drive
  watch/webhook/renew was dropped from MVP in favor of polling):
  - `Users` (PK `userId`; GSIs `gsi_googleSub`, `gsi_email`)
  - `Workspaces` (PK `workspaceId`; GSI `gsi_owner`)
  - `Memberships` (PK `membershipId`; GSIs `gsi_ws`, `gsi_user`, `gsi_pendingEmail`)
- **Secrets — plaintext Lambda env vars.** The 3 backend secrets
  (`GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `TOKEN_ENC_KEY`) are supplied as
  VALUES at deploy time (from the deploy environment / GitHub environment
  secrets, via `bin/app.ts`) and baked directly into both Lambdas'
  environment. `deps.ts` calls `domain/config.ts`'s `loadConfig()` at module
  top level, which reads them straight from `process.env` on cold start — no
  Parameter Store fetch, no cold-start indirection.
  ⚠️ **Security trade-off:** env-var values land in plaintext in the
  CloudFormation template (stored in the CDK asset S3 bucket) and are readable
  by anyone with `lambda:GetFunctionConfiguration` or console access. This is
  weaker at rest than the previous SSM `SecureString` + KMS setup. Restrict
  who can read the function config / CFN stack accordingly.
- **No WebSocket / realtime.** The extension polls
  `GET /api/workspaces` (`rrequest.syncPollIntervalMs`, default 45s) and
  compares each workspace's `revision`; `pollFn`'s 1-minute sweep is what
  makes an out-of-band Drive edit show up as a revision bump for the client
  to notice.

## One-time operator setup

### 1. Google OAuth app (one, shared by all users of this deployment)

1. In Google Cloud Console: create **one** OAuth 2.0 **Web application**
   client and enable the **Google Drive API** for the project.
2. You will need to add the exact redirect URI, but **the URL is only known
   after the first deploy** (the Function URL is assigned then). So:
   a. Do a first `cdk deploy` (see below) with a placeholder
      `GOOGLE_REDIRECT_URI` (e.g. `https://placeholder.example.com/api/auth/callback`).
   b. Read the `ApiUrl` CfnOutput from `RrequestStack` (e.g.
      `https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/`).
   c. The real redirect URI is that URL **+ `/api/auth/callback`** (the
      `/api` prefix comes from `RootController`'s `prefix: "/api"`; the
      `AuthController`'s `@Get("/auth/callback")` is mounted under it — see
      `RootController`'s doc comment and `AUTH_PREFIX = "/api/auth"` in
      `auth-plugin.ts`). Example:
      `https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/api/auth/callback`
   d. Add that exact URL as an authorized redirect URI on the Google OAuth
      client.
   e. Re-deploy with `GOOGLE_REDIRECT_URI` set to the real value (step 3
      below) so the Lambda's env matches what Google will actually redirect
      to.
3. Note the client's **Client ID** (`GOOGLE_CLIENT_ID`) and **Client Secret**
   (`GOOGLE_CLIENT_SECRET`). Both are passed as deploy-time env vars and baked
   into the Lambda env (the client secret via a GitHub environment secret in
   CI, or `GOOGLE_CLIENT_SECRET=...` for a local `cdk deploy`).

### 2. AWS credentials

Have AWS credentials (profile or env vars) with permission to create Lambda,
DynamoDB, EventBridge, and IAM resources, and know the target account/region.

## Deploy

```sh
npm install   # one node_modules at the repo ROOT carries everything (extension,
              # server, and infra — aws-cdk / aws-cdk-lib / constructs are root
              # devDependencies).

cd infra      # CDK app lives at the repo root now (was server/infra)
export CDK_DEFAULT_ACCOUNT=<your-account-id>
export CDK_DEFAULT_REGION=<your-region>          # e.g. us-east-1
export GOOGLE_CLIENT_ID=<oauth-client-id>
export GOOGLE_REDIRECT_URI=<see step 1 above — placeholder on the first deploy>
# The 3 secret VALUES (baked into the Lambda env; bin/app.ts requires them):
export GOOGLE_CLIENT_SECRET=<the OAuth client secret from Google Cloud Console>
export JWT_SECRET=$(openssl rand -hex 32)        # HMAC key: session JWTs + OAuth state
export TOKEN_ENC_KEY=$(openssl rand -hex 32)     # AES-256-GCM key: refresh tokens at rest

npx cdk deploy --all
```

This deploys one stack (`bin/app.ts`): `RrequestStack` — the 3 DynamoDB
tables, the Lambda Function URL + `apiFn`, and the EventBridge rule + `pollFn`. It
prints an `ApiUrl` CfnOutput — that's the base URL from step 1b above.
(`--all` is harmless with a single stack; `npx cdk deploy` works too.)

`bin/app.ts` reads the 3 secret VALUES from the deploy environment and bakes
them into the Lambda env — `cdk deploy` fails fast with `Missing required
deploy env var: <NAME>` if any is unset. In CI these come from GitHub
environment secrets (see the CI/CD section); values are `keyOf`-hashed
(sha256 → 32-byte key) so any long random string works for `JWT_SECRET` /
`TOKEN_ENC_KEY`.

⚠️ Rotating `TOKEN_ENC_KEY` makes every stored refresh token undecryptable
(all users must re-log in); rotating `JWT_SECRET` invalidates live sessions.
A rotation = re-deploy with the new value; it takes effect on the next
Lambda cold start.

After confirming/updating the Google redirect URI (step 1), re-run
`npx cdk deploy --all` with the real `GOOGLE_REDIRECT_URI` so the deployed
Lambda env matches.

## Point the extension at the deployed backend

Set the VS Code setting **`rrequest.syncServerUrl`** to the deployed API's
`/api` base — i.e. the `ApiUrl` CfnOutput **with `/api` appended**:

```
https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/api
```

The extension's `SyncClient` (`src/extension/sync/sync-client.ts`) and the
loopback sign-in helper (`src/extension/sync/login.ts`) both concatenate
this base directly with unprefixed paths (`/me`, `/workspaces`,
`/auth/start`, ...) — so the configured URL **must already include `/api`**;
the client does not add it. With the base above, the effective routes are
`/api/auth/start`, `/api/auth/callback`, `/api/me`, `/api/workspaces`, etc.

(The `rrequest.syncServerUrl` setting's packaged default,
`http://localhost:8787`, is a holdover from the old local Fastify server and
does **not** work against this backend — there is no local long-running dev
server anymore. Always point it at the deployed Function URL + `api`.)

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
  (`src/handlers/api.smoke.test.ts`) sets the env vars directly
  (`JWT_SECRET`, `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`) before importing the handler, so `loadConfig()` finds
  them in `process.env`.
- **CDK synth check** (no deploy, no AWS account):
  ```sh
  cd infra
  npx vitest run   # test/synth.test.ts
  ```
- **Running a handler locally by hand**: import `server/src/handlers/api-app.ts`
  (or `poll-app.ts`) with env vars set (`JWT_SECRET`, `TOKEN_ENC_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and
  optionally `DYNAMO_ENDPOINT` pointed at a local dynalite/DynamoDB Local
  instance) — `deps.ts`'s `loadConfig()` reads them straight from
  `process.env` at import. There is no bundled local API
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
  under `<hash>-rrequest/`, stores a row, returns `{ driveFileId, revision }`.
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
  row (pending if the email has no rrequest account yet), returns
  `{ member }`.
- `DELETE /workspaces/:id/members/:memberId` (Bearer JWT, owner only) →
  removes the Drive permission + membership row, returns `{ ok: true }`.

## Tests

```sh
cd server && npm test
cd infra && npx vitest run
```

## CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main` or `development`
(and via manual `workflow_dispatch`). It has **2 jobs, sequential — AWS first,
then the extension**:

1. **`deploy-api`** — `cdk deploy RrequestStack` (the backend). Uses
   `aws-actions/configure-aws-credentials` with the IAM access keys from the
   environment's secrets, and bakes `GOOGLE_CLIENT_ID` / `GOOGLE_REDIRECT_URI`
   into the Lambda env from the environment's variables.
2. **`publish-extension`** (`needs: deploy-api`) — bumps the extension version
   from Conventional Commits (`conventional-recommended-bump -p angular`,
   defaults to patch), publishes to the VS Code Marketplace, then pushes a git
   tag. The bump is `--no-git-tag-version` (only the tag is pushed), so it never
   re-triggers the workflow.

### Two environments (branch → environment → stack → release)

Secrets and variables live in **GitHub Environments**, not at repo level. The
workflow picks the environment from the branch, so `main` and `development`
deploy to their own AWS targets with their own credentials. `STAGE` selects the
stack: production keeps the original unprefixed `RrequestStack` (tables `Users`,
`Workspaces`, `Memberships`); development deploys `DevelopmentRrequestStack` with
a `development-` prefix on every table name, so both stacks can coexist in one
AWS account. **Only `main` publishes the extension** — a `development` push
deploys the AWS stack and stops.

| Branch        | Environment   | STAGE / stack                       | Extension          |
|---------------|---------------|-------------------------------------|--------------------|
| `main`        | `production`  | `production` / `RrequestStack`      | **stable** (`vsce publish`), tag `vX.Y.Z` |
| `development` | `development` | `development` / `DevelopmentRrequestStack` | none (deploy only) |

### One-time setup

1. **IAM user(s)** for CI: create one with programmatic access + a policy that
   can `cdk deploy` this stack (create/update Lambda, DynamoDB, EventBridge, IAM
   roles, Lambda Function URLs, CloudFormation, and read/write the CDK asset S3
   bucket). Use separate users/accounts per environment if prod and dev deploy
   to different AWS accounts.
2. **Bootstrap** each target account/region once (asset bucket + roles CDK needs):
   ```sh
   npx cdk bootstrap aws://389151907894/eu-west-1
   ```
3. **Marketplace publisher**: `package.json`'s `publisher` (`rrequest`) must be
   a real registered VS Code Marketplace publisher. Create one at
   <https://marketplace.visualstudio.com/manage> and generate a **PAT**
   (Azure DevOps, scope: *Marketplace → Manage*). (The publisher must have a
   pre-release-capable extension — a single publisher handles both channels.)
4. **Create the two environments** (repo → *Settings → Environments* → *New
   environment*): `production` and `development`. On `production`, set
   *Deployment branches* → *Selected branches* → `main` only; on `development`,
   restrict to `development`. Then add these **in each environment** (repo →
   *Settings → Environments → <env> → Secrets / Variables*):

   | Kind     | Name                    | Value                                             |
   |----------|-------------------------|---------------------------------------------------|
   | Secret   | `AWS_ACCESS_KEY_ID`     | CI IAM user access key id                          |
   | Secret   | `AWS_SECRET_ACCESS_KEY` | CI IAM user secret access key                      |
   | Secret   | `VSCE_PAT`              | Marketplace publisher PAT                          |
   | Secret   | `GOOGLE_CLIENT_SECRET`  | OAuth client secret                               |
   | Secret   | `JWT_SECRET`            | long random string (`openssl rand -hex 32`)       |
   | Secret   | `TOKEN_ENC_KEY`         | long random string (`openssl rand -hex 32`)       |
   | Variable | `AWS_REGION`            | `eu-west-1`                                        |
   | Variable | `AWS_ACCOUNT_ID`        | `389151907894` (dev may differ)                   |
   | Variable | `GOOGLE_CLIENT_ID`      | OAuth client id (per environment)                 |
   | Variable | `GOOGLE_REDIRECT_URI`   | `https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/api/auth/callback` |

5. **The 3 app secrets (`GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `TOKEN_ENC_KEY`)
   are now GitHub environment secrets** — `deploy-api` passes them as env to
   `cdk deploy`, which bakes them into the Lambda env. Use distinct
   `JWT_SECRET` / `TOKEN_ENC_KEY` values per environment so a leaked dev key
   can't decrypt prod data. (No more SSM Parameter Store — see the security
   trade-off in the Architecture section.)

### Notes

- No GitHub PAT for the tag push — the workflow's built-in `GITHUB_TOKEN`
  (`permissions: contents: write`) pushes the tag.
- The backend deploy and the extension release run in sequence; a failed
  publish does not roll back a successful backend deploy.
