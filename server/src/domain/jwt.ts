import jwt from "jsonwebtoken";

// Access token: short-ish-lived, sent on every request. Refresh token: long-
// lived, stored by the client and only sent to /auth/refresh to mint a new
// access token. Keeping them separate means a leaked access token has a bounded
// life, and the user re-logs-in once a year instead of every 30 days.
const ACCESS_TTL = "30d";
const REFRESH_TTL = "365d";

type Payload = { sub?: string; typ?: string };

export function signSession(userId: string, secret: string): string {
  return jwt.sign({ sub: userId, typ: "access" }, secret, {
    expiresIn: ACCESS_TTL,
  });
}

export function signRefresh(userId: string, secret: string): string {
  return jwt.sign({ sub: userId, typ: "refresh" }, secret, {
    expiresIn: REFRESH_TTL,
  });
}

/** Access-token verify. Tokens predating `typ` (no typ claim) are accepted as access. */
export function verifySession(
  token: string,
  secret: string
): { userId: string } | null {
  return verify(
    token,
    secret,
    (p) => p.typ === undefined || p.typ === "access"
  );
}

/** Refresh-token verify. Rejects an access token (it lacks typ: "refresh"). */
export function verifyRefresh(
  token: string,
  secret: string
): { userId: string } | null {
  return verify(token, secret, (p) => p.typ === "refresh");
}

function verify(
  token: string,
  secret: string,
  ok: (p: Payload) => boolean
): { userId: string } | null {
  try {
    const payload = jwt.verify(token, secret) as Payload;
    if (!payload.sub || !ok(payload)) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
