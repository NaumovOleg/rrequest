// Multi-account registry for Drive sync: several Google accounts can be
// connected at once, and each synced workspace is bound to ONE of them (see
// SyncState.accountId). Tokens live in VS Code Secret Storage keyed by account
// id; the account list (id + email) lives in globalState. Tokens are cached in
// memory so `getToken` can stay synchronous for the SyncClient.
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

/** Decode a JWT payload's `sub` (the userId) without verifying — used as the stable account id. */
export function subOf(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : undefined;
  } catch {
    return undefined;
  }
}

export class AccountStore {
  private tokens = new Map<string, string>();
  constructor(private ctx: { secrets: SecretsLike; globalState: GlobalStateLike }) {}

  /** Load cached tokens + migrate a legacy single-account session into the registry. */
  async load(): Promise<void> {
    // Migrate an old single-token/email session (pre-multi-account).
    const legacyToken = await this.ctx.secrets.get(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      const id = subOf(legacyToken);
      const email = this.ctx.globalState.get<string>(LEGACY_EMAIL_KEY, "") || "";
      if (id) await this.add({ id, email }, legacyToken);
      await this.ctx.secrets.delete(LEGACY_TOKEN_KEY);
    }
    for (const a of this.list()) {
      const t = await this.ctx.secrets.get(tokenKey(a.id));
      if (t) this.tokens.set(a.id, t);
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
   * Token for an account. With no id, falls back to the sole account (so a
   * legacy workspace whose SyncState predates account-binding still resolves).
   */
  getToken(id?: string): string | undefined {
    if (id) return this.tokens.get(id);
    const all = this.list();
    return all.length === 1 ? this.tokens.get(all[0].id) : undefined;
  }

  async add(a: Account, token: string): Promise<void> {
    this.tokens.set(a.id, token);
    await this.ctx.secrets.store(tokenKey(a.id), token);
    const rest = this.list().filter((x) => x.id !== a.id);
    await this.ctx.globalState.update(LIST_KEY, [...rest, a]);
  }

  async remove(id: string): Promise<void> {
    this.tokens.delete(id);
    await this.ctx.secrets.delete(tokenKey(id));
    await this.ctx.globalState.update(
      LIST_KEY,
      this.list().filter((x) => x.id !== id),
    );
  }
}
