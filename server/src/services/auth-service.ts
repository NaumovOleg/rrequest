import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { signSession } from "../domain/jwt.js";
import type { GoogleOAuth } from "../domain/google-oauth.js";
import type { UserStore, MembershipStore } from "../stores/types.js";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function isLoopbackCb(cb: string): boolean {
  try {
    const u = new URL(cb);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "::1");
  } catch {
    return false;
  }
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signState(cb: string, secret: string): string {
  const payload = { cb, nonce: randomBytes(16).toString("hex"), exp: Date.now() + STATE_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = hmac(encoded, secret);
  return `${encoded}.${sig}`;
}

export function verifyState(token: string, secret: string): { cb: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = hmac(encoded, secret);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  let payload: { cb?: string; nonce?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.cb !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return { cb: payload.cb };
}

export type AuthServiceDeps = {
  users: UserStore;
  memberships: MembershipStore;
  google: GoogleOAuth;
  config: { jwtSecret: string; stateSecret: string };
};

export class AuthService {
  constructor(private deps: AuthServiceDeps) {}

  startUrl(cb: string): string {
    if (!isLoopbackCb(cb)) throw new Error("cb must be an http loopback url");
    const state = signState(cb, this.deps.config.stateSecret);
    return this.deps.google.authUrl(state);
  }

  async callback(code: string, state: string): Promise<{ redirectUrl: string }> {
    const verified = verifyState(state, this.deps.config.stateSecret);
    if (!verified) throw new Error("invalid or expired state");
    const profile = await this.deps.google.exchange(code);
    const user = await this.deps.users.upsertByGoogle(profile);
    await this.deps.memberships.resolvePending(user.email, user.id);
    const token = signSession(user.id, this.deps.config.jwtSecret);
    const url = new URL(verified.cb);
    url.searchParams.set("token", token);
    return { redirectUrl: url.toString() };
  }

  async me(userId: string): Promise<{ id: string; email: string } | undefined> {
    const user = await this.deps.users.getById(userId);
    if (!user) return undefined;
    return { id: user.id, email: user.email };
  }
}
