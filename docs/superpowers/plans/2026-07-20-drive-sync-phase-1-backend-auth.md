# Drive Sync — Phase 1: Backend Skeleton + Google OAuth + JWT + Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the sync backend service with Google OAuth login that stores users (refresh token encrypted at rest), issues an app-session JWT to the extension via a loopback redirect, and exposes an authenticated `/me`.

**Architecture:** A standalone Node/TypeScript Fastify service in `server/`. `/auth/start` redirects the browser to Google; `/auth/callback` exchanges the code (server holds the client secret), upserts the user, mints a JWT, and redirects to the extension's `http://localhost:<port>?token=…` loopback. Dependencies are injected into `buildApp(deps)` so routes are unit-testable with `app.inject` and fakes. SQLite (better-sqlite3) stores users now; the store interface is DB-agnostic for a later Postgres swap.

**Tech Stack:** Node 18+, TypeScript, Fastify 4, better-sqlite3, google-auth-library, jsonwebtoken, vitest.

## Global Constraints

- Node **>= 18** (crypto `aes-256-gcm`, google-auth-library, better-sqlite3).
- **All Google-facing calls live on the backend.** The extension never receives Google tokens — only the app-session JWT.
- **Refresh tokens are encrypted at rest** (AES-256-GCM) before touching the DB.
- OAuth scope is exactly: `https://www.googleapis.com/auth/drive.file`, `openid`, `email`, `profile`.
- App-session JWT lifetime: **30 days**.
- Everything lives under `server/` and does not touch the existing extension code.

---

### Task 1: Project scaffold + config loader

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/config.ts`
- Create: `server/.env.example`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Config = { port: number; dbPath: string; jwtSecret: string; tokenEncKey: string; googleClientId: string; googleClientSecret: string; googleRedirectUri: string }` and `loadConfig(env?: NodeJS.ProcessEnv): Config`.

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "restman-sync-server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "fastify": "^4.28.0",
    "google-auth-library": "^9.14.0",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create `server/.env.example`**

```
PORT=8787
DB_PATH=restman.db
JWT_SECRET=change-me-long-random
TOKEN_ENC_KEY=change-me-another-long-random
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8787/auth/callback
```

- [ ] **Step 5: Install dependencies**

Run: `cd server && npm install`
Expected: dependencies install; `node_modules` created.

- [ ] **Step 6: Write the failing test** — `server/src/config.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = {
  JWT_SECRET: "j", TOKEN_ENC_KEY: "k",
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec",
  GOOGLE_REDIRECT_URI: "http://localhost:8787/auth/callback",
};

describe("loadConfig", () => {
  it("parses required values and applies defaults", () => {
    const c = loadConfig(base as any);
    expect(c.port).toBe(8787);
    expect(c.dbPath).toBe("restman.db");
    expect(c.jwtSecret).toBe("j");
    expect(c.googleClientId).toBe("cid");
  });
  it("throws when a required var is missing", () => {
    expect(() => loadConfig({} as any)).toThrow(/JWT_SECRET/);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 8: Implement `server/src/config.ts`**

```ts
export type Config = {
  port: number;
  dbPath: string;
  jwtSecret: string;
  tokenEncKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const req = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? "restman.db",
    jwtSecret: req("JWT_SECRET"),
    tokenEncKey: req("TOKEN_ENC_KEY"),
    googleClientId: req("GOOGLE_CLIENT_ID"),
    googleClientSecret: req("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: req("GOOGLE_REDIRECT_URI"),
  };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json server/vitest.config.ts server/.env.example server/src/config.ts server/src/config.test.ts
git commit -m "feat(server): scaffold sync backend + config loader"
```

---

### Task 2: Encryption helper (AES-256-GCM)

**Files:**
- Create: `server/src/crypto.ts`
- Test: `server/src/crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encrypt(plain: string, secret: string): string` and `decrypt(blob: string, secret: string): string`. Output format is `"<ivB64>.<tagB64>.<cipherB64>"`.

- [ ] **Step 1: Write the failing test** — `server/src/crypto.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  it("round-trips a value", () => {
    const blob = encrypt("refresh-token-123", "secret");
    expect(blob).not.toContain("refresh-token-123");
    expect(decrypt(blob, "secret")).toBe("refresh-token-123");
  });
  it("fails to decrypt with the wrong key", () => {
    const blob = encrypt("x", "secret");
    expect(() => decrypt(blob, "wrong")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/crypto.test.ts`
Expected: FAIL — cannot find module `./crypto`.

- [ ] **Step 3: Implement `server/src/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function keyOf(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(blob: string, secret: string): string {
  const [ivB64, tagB64, encB64] = blob.split(".");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/crypto.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/crypto.ts server/src/crypto.test.ts
git commit -m "feat(server): AES-256-GCM encrypt/decrypt helper"
```

---

### Task 3: UserStore (SQLite, encrypted refresh token)

**Files:**
- Create: `server/src/user-store.ts`
- Test: `server/src/user-store.test.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt` from `./crypto`.
- Produces:
  - `type User = { id: string; email: string; googleSub: string; refreshToken: string }`
  - `class UserStore { constructor(dbPath: string, encKey: string); upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): User; getById(id: string): User | undefined }`
  - Use `":memory:"` as `dbPath` in tests.

- [ ] **Step 1: Write the failing test** — `server/src/user-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { UserStore } from "./user-store";

describe("UserStore", () => {
  it("inserts a new user and returns it with a generated id", () => {
    const store = new UserStore(":memory:", "enc");
    const u = store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect(u.id).toBeTruthy();
    expect(u.email).toBe("a@x.com");
    expect(store.getById(u.id)?.refreshToken).toBe("rt1");
  });
  it("upserts by googleSub (same id, updated email + token)", () => {
    const store = new UserStore(":memory:", "enc");
    const first = store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    const second = store.upsertByGoogle({ googleSub: "g1", email: "b@x.com", refreshToken: "rt2" });
    expect(second.id).toBe(first.id);
    expect(store.getById(first.id)?.email).toBe("b@x.com");
    expect(store.getById(first.id)?.refreshToken).toBe("rt2");
  });
  it("returns undefined for an unknown id", () => {
    expect(new UserStore(":memory:", "enc").getById("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/user-store.test.ts`
Expected: FAIL — cannot find module `./user-store`.

- [ ] **Step 3: Implement `server/src/user-store.ts`**

```ts
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./crypto.js";

export type User = { id: string; email: string; googleSub: string; refreshToken: string };

type Row = { id: string; email: string; google_sub: string; refresh_token: string };

export class UserStore {
  private db: Database.Database;
  constructor(dbPath: string, private encKey: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      google_sub TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL
    )`);
  }

  upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): User {
    const enc = encrypt(input.refreshToken, this.encKey);
    const existing = this.db.prepare("SELECT * FROM users WHERE google_sub = ?").get(input.googleSub) as Row | undefined;
    if (existing) {
      this.db.prepare("UPDATE users SET email = ?, refresh_token = ? WHERE google_sub = ?").run(input.email, enc, input.googleSub);
      return { id: existing.id, email: input.email, googleSub: input.googleSub, refreshToken: input.refreshToken };
    }
    const id = randomUUID();
    this.db.prepare("INSERT INTO users (id, email, google_sub, refresh_token) VALUES (?, ?, ?, ?)").run(id, input.email, input.googleSub, enc);
    return { id, email: input.email, googleSub: input.googleSub, refreshToken: input.refreshToken };
  }

  getById(id: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    if (!r) return undefined;
    return { id: r.id, email: r.email, googleSub: r.google_sub, refreshToken: decrypt(r.refresh_token, this.encKey) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/user-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/user-store.ts server/src/user-store.test.ts
git commit -m "feat(server): UserStore with encrypted refresh tokens (sqlite)"
```

---

### Task 4: JWT session helpers

**Files:**
- Create: `server/src/jwt.ts`
- Test: `server/src/jwt.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `signSession(userId: string, secret: string): string` and `verifySession(token: string, secret: string): { userId: string } | null`.

- [ ] **Step 1: Write the failing test** — `server/src/jwt.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "./jwt";

describe("jwt session", () => {
  it("signs and verifies a session", () => {
    const token = signSession("user-1", "secret");
    expect(verifySession(token, "secret")).toEqual({ userId: "user-1" });
  });
  it("rejects a token signed with a different secret", () => {
    const token = signSession("user-1", "secret");
    expect(verifySession(token, "other")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifySession("not-a-jwt", "secret")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/jwt.test.ts`
Expected: FAIL — cannot find module `./jwt`.

- [ ] **Step 3: Implement `server/src/jwt.ts`**

```ts
import jwt from "jsonwebtoken";

export function signSession(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

export function verifySession(token: string, secret: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, secret) as { sub?: string };
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/jwt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/jwt.ts server/src/jwt.test.ts
git commit -m "feat(server): app-session JWT sign/verify"
```

---

### Task 5: Google OAuth wrapper

**Files:**
- Create: `server/src/google-oauth.ts`
- Test: `server/src/google-oauth.test.ts`

**Interfaces:**
- Consumes: `OAuth2Client` from `google-auth-library`.
- Produces:
  - `type GoogleProfile = { googleSub: string; email: string; refreshToken: string }`
  - `interface OAuthClientLike { generateAuthUrl(opts: object): string; getToken(code: string): Promise<{ tokens: { id_token?: string | null; refresh_token?: string | null } }>; verifyIdToken(opts: { idToken: string; audience: string }): Promise<{ getPayload(): { sub?: string; email?: string } | undefined }> }`
  - `class GoogleOAuth { constructor(client: OAuthClientLike, clientId: string); static create(cfg: { clientId: string; clientSecret: string; redirectUri: string }): GoogleOAuth; authUrl(state: string): string; exchange(code: string): Promise<GoogleProfile> }`

- [ ] **Step 1: Write the failing test** — `server/src/google-oauth.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { GoogleOAuth } from "./google-oauth";

function fakeClient() {
  return {
    generateAuthUrl: vi.fn((o: any) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}`),
    getToken: vi.fn(async () => ({ tokens: { id_token: "idtok", refresh_token: "rt-abc" } })),
    verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ sub: "g-sub", email: "a@x.com" }) })),
  };
}

describe("GoogleOAuth", () => {
  it("builds an auth url carrying the state and requesting offline access", () => {
    const c = fakeClient();
    const url = new GoogleOAuth(c as any, "cid").authUrl("state-123");
    expect(url).toContain("state-123");
    expect(c.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: "offline", prompt: "consent", state: "state-123" }),
    );
    const scopes = (c.generateAuthUrl.mock.calls[0][0] as any).scope as string[];
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
  });
  it("exchanges a code into a profile with the refresh token", async () => {
    const profile = await new GoogleOAuth(fakeClient() as any, "cid").exchange("code-1");
    expect(profile).toEqual({ googleSub: "g-sub", email: "a@x.com", refreshToken: "rt-abc" });
  });
  it("throws when Google returns no refresh token", async () => {
    const c = fakeClient();
    c.getToken = vi.fn(async () => ({ tokens: { id_token: "idtok", refresh_token: null } }));
    await expect(new GoogleOAuth(c as any, "cid").exchange("code-1")).rejects.toThrow(/refresh token/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/google-oauth.test.ts`
Expected: FAIL — cannot find module `./google-oauth`.

- [ ] **Step 3: Implement `server/src/google-oauth.ts`**

```ts
import { OAuth2Client } from "google-auth-library";

export type GoogleProfile = { googleSub: string; email: string; refreshToken: string };

export interface OAuthClientLike {
  generateAuthUrl(opts: object): string;
  getToken(code: string): Promise<{ tokens: { id_token?: string | null; refresh_token?: string | null } }>;
  verifyIdToken(opts: { idToken: string; audience: string }): Promise<{ getPayload(): { sub?: string; email?: string } | undefined }>;
}

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
  "profile",
];

export class GoogleOAuth {
  constructor(private client: OAuthClientLike, private clientId: string) {}

  static create(cfg: { clientId: string; clientSecret: string; redirectUri: string }): GoogleOAuth {
    const client = new OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
    return new GoogleOAuth(client, cfg.clientId);
  }

  authUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      scope: SCOPES,
    });
  }

  async exchange(code: string): Promise<GoogleProfile> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");
    if (!tokens.id_token) throw new Error("Google did not return an id token");
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error("Google id token missing sub/email");
    return { googleSub: payload.sub, email: payload.email, refreshToken: tokens.refresh_token };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/google-oauth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/google-oauth.ts server/src/google-oauth.test.ts
git commit -m "feat(server): Google OAuth wrapper (auth url + code exchange)"
```

---

### Task 6: Pending OAuth state store

**Files:**
- Create: `server/src/pending-states.ts`
- Test: `server/src/pending-states.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class PendingStates { put(state: string, cb: string): void; take(state: string): string | undefined }`. `take` is single-use (deletes on read).

- [ ] **Step 1: Write the failing test** — `server/src/pending-states.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { PendingStates } from "./pending-states";

describe("PendingStates", () => {
  it("stores and takes a callback exactly once", () => {
    const s = new PendingStates();
    s.put("state-1", "http://localhost:5000");
    expect(s.take("state-1")).toBe("http://localhost:5000");
    expect(s.take("state-1")).toBeUndefined();
  });
  it("returns undefined for an unknown state", () => {
    expect(new PendingStates().take("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/pending-states.test.ts`
Expected: FAIL — cannot find module `./pending-states`.

- [ ] **Step 3: Implement `server/src/pending-states.ts`**

```ts
export class PendingStates {
  private map = new Map<string, { cb: string; at: number }>();

  put(state: string, cb: string): void {
    this.map.set(state, { cb, at: Date.now() });
  }

  take(state: string): string | undefined {
    const entry = this.map.get(state);
    if (!entry) return undefined;
    this.map.delete(state);
    return entry.cb;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/pending-states.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/pending-states.ts server/src/pending-states.test.ts
git commit -m "feat(server): single-use pending OAuth state store"
```

---

### Task 7: App factory + health route

**Files:**
- Create: `server/src/app.ts`
- Test: `server/src/app.health.test.ts`

**Interfaces:**
- Consumes: `Config`, `UserStore`, `GoogleOAuth`, `PendingStates`.
- Produces:
  - `type AppDeps = { config: Config; users: UserStore; google: GoogleOAuth; states: PendingStates }`
  - `function buildApp(deps: AppDeps): FastifyInstance` — exposes `GET /health` now; auth routes are added in Tasks 8–9 (same file).

- [ ] **Step 1: Write the failing test** — `server/src/app.health.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const fakeGoogle = new GoogleOAuth({
  generateAuthUrl: (o: any) => `https://g/?state=${o.state}`,
  getToken: async () => ({ tokens: { id_token: "i", refresh_token: "rt" } }),
  verifyIdToken: async () => ({ getPayload: () => ({ sub: "g", email: "a@x.com" }) }),
} as any, "cid");

function app() {
  return buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google: fakeGoogle, states: new PendingStates() });
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.health.test.ts`
Expected: FAIL — cannot find module `./app`.

- [ ] **Step 3: Implement `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { GoogleOAuth } from "./google-oauth.js";
import type { PendingStates } from "./pending-states.js";

export type AppDeps = {
  config: Config;
  users: UserStore;
  google: GoogleOAuth;
  states: PendingStates;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/app.health.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.health.test.ts
git commit -m "feat(server): app factory with /health"
```

---

### Task 8: OAuth routes (`/auth/start`, `/auth/callback`)

**Files:**
- Modify: `server/src/app.ts` (add two routes inside `buildApp`, after `/health`)
- Test: `server/src/app.auth.test.ts`

**Interfaces:**
- Consumes: `deps.google.authUrl`, `deps.google.exchange`, `deps.states.put/take`, `deps.users.upsertByGoogle`, `signSession` from `./jwt`.
- Produces: `GET /auth/start?cb=<url>` (302 → Google, stores state→cb) and `GET /auth/callback?code=&state=` (302 → `<cb>?token=<jwt>`).

- [ ] **Step 1: Write the failing test** — `server/src/app.auth.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { verifySession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
function makeGoogle() {
  return new GoogleOAuth({
    generateAuthUrl: (o: any) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}`,
    getToken: async () => ({ tokens: { id_token: "i", refresh_token: "rt" } }),
    verifyIdToken: async () => ({ getPayload: () => ({ sub: "g-sub", email: "a@x.com" }) }),
  } as any, "cid");
}
function make() {
  const states = new PendingStates();
  const users = new UserStore(":memory:", "k");
  const app = buildApp({ config: cfg, users, google: makeGoogle(), states });
  return { app, states, users };
}

describe("auth routes", () => {
  it("/auth/start redirects to Google and stores the callback", async () => {
    const { app, states } = make();
    const res = await app.inject({ method: "GET", url: "/auth/start?cb=http%3A%2F%2Flocalhost%3A5000" });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain("accounts.google.com");
    const state = new URL(loc).searchParams.get("state")!;
    expect(states.take(state)).toBe("http://localhost:5000");
  });

  it("/auth/start returns 400 without cb", async () => {
    const { app } = make();
    const res = await app.inject({ method: "GET", url: "/auth/start" });
    expect(res.statusCode).toBe(400);
  });

  it("/auth/callback exchanges the code, upserts a user, and redirects with a JWT", async () => {
    const { app, states, users } = make();
    states.put("state-1", "http://localhost:5000");
    const res = await app.inject({ method: "GET", url: "/auth/callback?code=abc&state=state-1" });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe("http://localhost:5000/");
    const token = loc.searchParams.get("token")!;
    const session = verifySession(token, "j")!;
    expect(users.getById(session.userId)?.email).toBe("a@x.com");
  });

  it("/auth/callback returns 400 for an unknown state", async () => {
    const { app } = make();
    const res = await app.inject({ method: "GET", url: "/auth/callback?code=abc&state=nope" });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.auth.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Add the routes in `server/src/app.ts`**

Add this import at the top of the file:

```ts
import { randomUUID } from "node:crypto";
import { signSession } from "./jwt.js";
```

Insert these two routes inside `buildApp`, immediately after the `/health` route and before `return app;`:

```ts
  app.get("/auth/start", async (req, reply) => {
    const cb = (req.query as { cb?: string }).cb;
    if (!cb) return reply.code(400).send({ error: "cb query param required" });
    const state = randomUUID();
    deps.states.put(state, cb);
    return reply.redirect(deps.google.authUrl(state));
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const cb = state ? deps.states.take(state) : undefined;
    if (!code || !cb) return reply.code(400).send({ error: "invalid or expired state" });
    const profile = await deps.google.exchange(code);
    const user = deps.users.upsertByGoogle(profile);
    const token = signSession(user.id, deps.config.jwtSecret);
    const url = new URL(cb);
    url.searchParams.set("token", token);
    return reply.redirect(url.toString());
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/app.auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.auth.test.ts
git commit -m "feat(server): /auth/start + /auth/callback OAuth routes"
```

---

### Task 9: Authenticated `/me` route

**Files:**
- Modify: `server/src/app.ts` (add `/me` route inside `buildApp`)
- Test: `server/src/app.me.test.ts`

**Interfaces:**
- Consumes: `verifySession` from `./jwt`, `deps.users.getById`.
- Produces: `GET /me` with `Authorization: Bearer <jwt>` → `200 { id, email }`; missing/invalid → `401 { error }`.

- [ ] **Step 1: Write the failing test** — `server/src/app.me.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { signSession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const google = new GoogleOAuth({
  generateAuthUrl: () => "https://g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }),
} as any, "cid");

describe("GET /me", () => {
  it("returns the user for a valid token", async () => {
    const users = new UserStore(":memory:", "k");
    const u = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
    const app = buildApp({ config: cfg, users, google, states: new PendingStates() });
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${signSession(u.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: u.id, email: "a@x.com" });
  });
  it("401 without a token", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates() });
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });
  it("401 for a valid token whose user no longer exists", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates() });
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${signSession("ghost", "j")}` } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.me.test.ts`
Expected: FAIL — `/me` returns 404.

- [ ] **Step 3: Add the route in `server/src/app.ts`**

Add to the imports at the top:

```ts
import { verifySession } from "./jwt.js";
```

(Note: `signSession` is already imported from Task 8; keep a single combined import line `import { signSession, verifySession } from "./jwt.js";`.)

Insert this route inside `buildApp`, before `return app;`:

```ts
  app.get("/me", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const session = verifySession(token, deps.config.jwtSecret);
    const user = session ? deps.users.getById(session.userId) : undefined;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { id: user.id, email: user.email };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/app.me.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.me.test.ts
git commit -m "feat(server): authenticated /me route"
```

---

### Task 10: Server entry point + README

**Files:**
- Create: `server/src/server.ts`
- Create: `server/README.md`

**Interfaces:**
- Consumes: `loadConfig`, `buildApp`, `UserStore`, `GoogleOAuth`, `PendingStates`.
- Produces: a runnable process (`npm start` / `npm run dev`) listening on `config.port`.

- [ ] **Step 1: Implement `server/src/server.ts`**

```ts
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { UserStore } from "./user-store.js";
import { GoogleOAuth } from "./google-oauth.js";
import { PendingStates } from "./pending-states.js";

const config = loadConfig();
const app = buildApp({
  config,
  users: new UserStore(config.dbPath, config.tokenEncKey),
  google: GoogleOAuth.create({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  }),
  states: new PendingStates(),
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then((addr) => console.log(`restman sync server on ${addr}`))
  .catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Create `server/README.md`**

````markdown
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
````

- [ ] **Step 3: Typecheck + full test run**

Run: `cd server && npm run typecheck && npm test`
Expected: typecheck clean; all suites pass (config, crypto, user-store, jwt, google-oauth, pending-states, app health/auth/me).

- [ ] **Step 4: Manual smoke of the server boot (optional but recommended)**

Run: `cd server && JWT_SECRET=x TOKEN_ENC_KEY=y GOOGLE_CLIENT_ID=a GOOGLE_CLIENT_SECRET=b GOOGLE_REDIRECT_URI=http://localhost:8787/auth/callback npm run dev`
Then: `curl -s http://localhost:8787/health`
Expected: `{"ok":true}`. Stop the server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts server/README.md
git commit -m "feat(server): entry point + README (phase 1 complete)"
```

---

## Self-Review

**Spec coverage (Phase 1 scope = "Backend skeleton + Google OAuth + JWT + users"):**
- Backend skeleton → Tasks 1, 7, 10. ✓
- Google OAuth (start/callback, code exchange, `drive.file`+profile scopes) → Tasks 5, 8. ✓
- JWT app session + auth’d `/me` → Tasks 4, 9. ✓
- `users` table with **refresh token encrypted at rest** → Tasks 2, 3. ✓
- Extension-never-sees-Google-tokens boundary → JWT returned via loopback (`/auth/callback` → `cb?token=`), tokens stay server-side. ✓
- Loopback handoff (`cb` param) → Tasks 8. ✓

Out of Phase 1 (correctly deferred to later phases): Drive proxy, workspaces/memberships tables, watch channels, WebSocket, sharing, sync engine.

**Placeholder scan:** none — every code step contains full code; commands have expected output.

**Type consistency:** `GoogleProfile`, `User`, `AppDeps`, `signSession`/`verifySession`, `PendingStates.put/take`, `UserStore.upsertByGoogle/getById`, `GoogleOAuth.authUrl/exchange/create` are used with identical signatures across tasks. The combined `import { signSession, verifySession } from "./jwt.js"` note in Task 9 prevents a duplicate-import error after Task 8.

**Note on the DB swap:** `UserStore` is the only SQLite-aware unit; a future Postgres migration replaces just that file behind the same interface.
