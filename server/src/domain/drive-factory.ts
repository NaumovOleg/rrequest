import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { GoogleDriveClient, type DriveClient } from "./drive-client.js";
import type { User } from "../stores/types.js";
import type { Config } from "./config.js";

// Folder names are a hash of the GOOGLE sub (the account's stable identity),
// NOT the internal user id: a duplicate user row (a re-created Users table, an
// eventually-consistent GSI miss on login, ...) used to mint a brand-new
// randomUUID -> a brand-new folder for the same email and the old data looked
// "lost". Keyed off the sub, every login of the same Google account resolves
// to exactly one folder, no matter how many user rows exist.
export function folderNameForUser(googleSub: string): string {
  const hash = createHash("sha256").update(googleSub).digest("hex").slice(0, 8);
  return `${hash}-rrequest`;
}

// Pre-static-naming folders were hashed off the internal user id. They are
// kept for migration only (see resolveSyncFolder) so a deploy never strands
// the Drive files that already live under a legacy folder.
export function legacyFolderNameForUser(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `${hash}-rrequest`;
}

/**
 * The ONE sync folder per account: the static sub-based folder when it
 * exists, else the legacy user-id folder (account already has files there —
 * keep using it so nothing goes missing), else a freshly created static one.
 */
export async function resolveSyncFolder(drive: DriveClient, user: User): Promise<string> {
  const primary = await drive.findFolder(folderNameForUser(user.googleSub));
  if (primary) return primary;
  const legacy = await drive.findFolder(legacyFolderNameForUser(user.id));
  if (legacy) return legacy;
  return drive.ensureFolder(folderNameForUser(user.googleSub));
}

export type DriveFactory = (user: User) => DriveClient;

// Thrown when Google refuses to mint a fresh access token for a user's
// stored refresh token -- almost always because the user revoked rrequest's
// Drive access or the refresh token otherwise expired. Callers (services)
// catch this and surface a 401 so the client knows to prompt re-auth,
// instead of a generic 500.
export class DriveAuthError extends Error {
  constructor(message = "drive auth failed") {
    super(message);
    this.name = "DriveAuthError";
  }
}

// True only when Google DEFINITIVELY rejected the refresh token (revoked or
// expired). Transport errors, rate limits and 5xx are transient — they must
// NOT be surfaced as "auth expired", or a flaky token endpoint makes the
// client drop sync over a hiccup.
export function isRevokedTokenError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const res = (e as { response?: { status?: number; data?: { error?: string } } }).response;
  if (!res) return false; // network-level failure -> transient
  if (res.status === 429 || (res.status ?? 0) >= 500) return false; // rate limit / Google-side -> transient
  return (res.data?.error ?? "") === "invalid_grant";
}

export type TokenRefreshResult = { token?: string | null };

/**
 * Mint an access token, retrying transient token-endpoint failures (network
 * blips, 429, 5xx) with exponential backoff. Only a definitive `invalid_grant`
 * (or exhausting the retries) throws DriveAuthError.
 */
export async function getAccessTokenWithRetry(
  refresh: () => Promise<TokenRefreshResult>,
  opts: { maxAttempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const delay = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await delay(baseDelayMs * 2 ** (attempt - 1));
    try {
      const { token } = await refresh();
      if (token) return token;
    } catch (e) {
      lastErr = e;
      if (isRevokedTokenError(e)) break;
    }
  }
  throw new DriveAuthError(lastErr instanceof Error ? lastErr.message : "could not obtain a Google access token");
}

const oauthClients = new Map<string, OAuth2Client>();
const OAUTH_CLIENT_CACHE_MAX = 512;

export function makeDriveFactory(config: Config): DriveFactory {
  return (user: User): DriveClient => {
    // One shared client per user per warm container: google-auth-library
    // caches the minted access token on the client (expiry_date), so reuse
    // drops ~3 token-endpoint refreshes per sync action to ~0 per token
    // lifetime. A fresh client per call refreshed on EVERY Drive API call,
    // which Google rate-limits (429s) and surfaced as false "auth expired"
    // errors on save.
    let oauth = oauthClients.get(user.id);
    if (!oauth) {
      if (oauthClients.size >= OAUTH_CLIENT_CACHE_MAX) oauthClients.clear(); // ponytail: naive cap, LRU if this ever grows
      oauth = new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
      oauthClients.set(user.id, oauth);
    }
    const client = oauth;
    client.setCredentials({ refresh_token: user.refreshToken });
    const getAccessToken = (): Promise<string> =>
      getAccessTokenWithRetry(async () => {
        const res = await client.getAccessToken();
        return { token: res.token };
      });
    return new GoogleDriveClient(getAccessToken);
  };
}