import * as crypto from "node:crypto";

/** Minimal async key/value store — shaped like `vscode.SecretStorage`. */
export type TokenStore = {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
};

/** A fresh 48-hex-char bearer token. */
export function mintToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * The stored token, minted and persisted on first use. Stable across restarts
 * — that is what lets an MCP client keep one pasted config. To invalidate it
 * (leaked token, new machine), delete it first and call this again.
 */
export async function ensureToken(store: TokenStore): Promise<string> {
  const existing = await store.get();
  if (existing) return existing;
  const token = mintToken();
  await store.set(token);
  return token;
}
