// Multi-account registry for Drive sync: several Google accounts can be
// connected at once, and each synced workspace is bound to ONE of them (see
// SyncState.accountId). Tokens live in VS Code Secret Storage keyed by account
// id; the account list (id + email) lives in globalState. Tokens are cached in
// memory so `getToken` can stay synchronous for the SyncClient.
//
// Two tokens per account: a short-ish access token (sent on every request) and
// a long-lived refresh token (only sent to /auth/refresh to mint a new access
// token). The access token is what the SyncClient sends; when the server 401s
// it, the client refreshes with the refresh token and retries.
export type Account = { id: string; email: string };

// Minimal slices of the VS Code APIs we need — keeps this unit testable without
// importing `vscode`.
export type SecretsLike = {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
};
export type GlobalStateLike = {
  get<T>(key: string, def: T): T;
  update(key: string, value: unknown): Thenable<void>;
};

const LIST_KEY = "rrequest.syncAccounts";
const LEGACY_TOKEN_KEY = "rrequest.syncToken";
const LEGACY_EMAIL_KEY = "rrequest.syncEmail";
const tokenKey = (id: string): string => `rrequest.syncToken.${id}`;
const refreshKey = (id: string): string => `rrequest.syncToken.${id}.refresh`;

/** Decode a JWT payload (no signature check). Shared by subOf/expOf. */
function payloadOf(token: string): Record<string, unknown> | undefined {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

/** Decode a JWT payload's `sub` (the userId) without verifying — used as the stable account id. */
export function subOf(token: string): string | undefined {
  const sub = payloadOf(token)?.sub;
  return typeof sub === "string" ? sub : undefined;
}

/**
 * Whether a JWT is past its `exp`. A token with no readable exp (opaque, or a
 * legacy token) is treated as NOT expired — we can't tell, so we let the server
 * decide (a 401 triggers the refresh/re-login path).
 */
export function isExpired(token: string, now: number = Date.now()): boolean {
  const exp = payloadOf(token)?.exp;
  return typeof exp === "number" && exp * 1000 <= now;
}

export class AccountStore {
  private tokens = new Map<string, string>();
  private refreshTokens = new Map<string, string>();
  constructor(
    private ctx: { secrets: SecretsLike; globalState: GlobalStateLike }
  ) {}

  /** Load cached tokens + migrate a legacy single-account session into the registry. */
  async load(): Promise<void> {
    // Migrate an old single-token/email session (pre-multi-account). It has no
    // refresh token; the account will prompt for a re-login when it expires.
    const legacyToken = await this.ctx.secrets.get(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      const id = subOf(legacyToken);
      const email =
        this.ctx.globalState.get<string>(LEGACY_EMAIL_KEY, "") || "";
      if (id) await this.add({ id, email }, legacyToken);
      await this.ctx.secrets.delete(LEGACY_TOKEN_KEY);
    }
    for (const a of this.list()) {
      const t = await this.ctx.secrets.get(tokenKey(a.id));
      if (t) this.tokens.set(a.id, t);
      const r = await this.ctx.secrets.get(refreshKey(a.id));
      if (r) this.refreshTokens.set(a.id, r);
    }
  }

  list(): Account[] {
    return this.ctx.globalState.get<Account[]>(LIST_KEY, []) ?? [];
  }
  ids(): string[] {
    return this.list().map((a) => a.id);
  }
  emailOf(id: string | undefined): string | undefined {
    return id ? this.list().find((a) => a.id === id)?.email : undefined;
  }
  isEmpty(): boolean {
    return this.list().length === 0;
  }

  /**
   * Access token for an account. With no id, falls back to the sole account (so
   * a legacy workspace whose SyncState predates account-binding still resolves).
   */
  getToken(id?: string): string | undefined {
    return this.resolved(this.tokens, id);
  }

  /** Refresh token for an account (same sole-account fallback as getToken). */
  getRefreshToken(id?: string): string | undefined {
    return this.resolved(this.refreshTokens, id);
  }

  private resolved(map: Map<string, string>, id?: string): string | undefined {
    if (id) return map.get(id);
    const all = this.list();
    return all.length === 1 ? map.get(all[0].id) : undefined;
  }

  /** True when the account has an access token that isn't past its exp. */
  hasFreshToken(id?: string, now: number = Date.now()): boolean {
    const t = this.getToken(id);
    return !!t && !isExpired(t, now);
  }

  /** Update just the access token (after an auto-refresh), keeping the refresh token. */
  async setToken(id: string, token: string): Promise<void> {
    this.tokens.set(id, token);
    await this.ctx.secrets.store(tokenKey(id), token);
  }

  async add(a: Account, token: string, refreshToken?: string): Promise<void> {
    this.tokens.set(a.id, token);
    await this.ctx.secrets.store(tokenKey(a.id), token);
    // Only overwrite a stored refresh token when a new one is provided — a
    // plain re-add (same account) keeps the existing refresh token.
    if (refreshToken) {
      this.refreshTokens.set(a.id, refreshToken);
      await this.ctx.secrets.store(refreshKey(a.id), refreshToken);
    }
    const rest = this.list().filter((x) => x.id !== a.id);
    await this.ctx.globalState.update(LIST_KEY, [...rest, a]);
  }

  async remove(id: string): Promise<void> {
    this.tokens.delete(id);
    this.refreshTokens.delete(id);
    await this.ctx.secrets.delete(tokenKey(id));
    await this.ctx.secrets.delete(refreshKey(id));
    await this.ctx.globalState.update(
      LIST_KEY,
      this.list().filter((x) => x.id !== id)
    );
  }
}
