# restman sync server (Phase 1)

Backend for Google Drive workspace sync: OAuth login + app-session JWT + users.

## Setup

1. In Google Cloud Console: create an OAuth 2.0 **Web application** client, enable
   the **Google Drive API**, and add `http://localhost:8787/auth/callback` as an
   authorized redirect URI.
2. `cp .env.example .env` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `JWT_SECRET`, `TOKEN_ENC_KEY` (use long random strings for the last two).
3. `npm install`

## Run

- Dev: `npm run dev`
- Prod: `npm run build && npm start`

## Endpoints

- `GET /health` → `{ ok: true }`
- `GET /auth/start?cb=<loopback-url>` → 302 to Google consent.
- `GET /auth/callback?code=&state=` → 302 to `<cb>?token=<jwt>`.
- `GET /me` (Bearer JWT) → `{ id, email }`.
- `GET /workspaces` (Bearer JWT) → the caller's synced workspaces.
- `POST /workspaces` (Bearer JWT) `{ workspaceId, name, snapshot }` → creates the Drive file under `<hash>-restman/`, stores a row, returns `{ driveFileId, revision }`.
- `PUT /workspaces/:id` (Bearer JWT, owner) `{ snapshot }` → pushes, returns `{ revision }`.
- `GET /workspaces/:id` (Bearer JWT, owner) → pulls, returns `{ snapshot, revision }`.

## Manual smoke test

```
npm run dev
# in another shell:
curl -s http://localhost:8787/health          # {"ok":true}
open "http://localhost:8787/auth/start?cb=http://localhost:5000"
# complete Google consent; the browser lands on http://localhost:5000?token=<jwt>
curl -s http://localhost:8787/me -H "Authorization: Bearer <jwt>"   # {"id":...,"email":...}
```

## Tests

`npm test`
