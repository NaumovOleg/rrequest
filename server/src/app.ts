import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { GoogleOAuth } from "./google-oauth.js";
import type { PendingStates } from "./pending-states.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { DriveFactory } from "./drive-factory.js";
import { randomUUID } from "node:crypto";
import { signSession, verifySession } from "./jwt.js";
import { requireUser } from "./auth.js";

export type AppDeps = {
  config: Config;
  users: UserStore;
  google: GoogleOAuth;
  states: PendingStates;
  workspaces: WorkspaceStore;
  driveFor: DriveFactory;
};

function isLoopbackCb(cb: string): boolean {
  try {
    const u = new URL(cb);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "::1");
  } catch {
    return false;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get("/auth/start", async (req, reply) => {
    const cb = (req.query as { cb?: string }).cb;
    if (!cb || !isLoopbackCb(cb)) return reply.code(400).send({ error: "cb must be an http loopback url" });
    const state = randomUUID();
    deps.states.put(state, cb);
    return reply.redirect(deps.google.authUrl(state));
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const cb = state ? deps.states.take(state) : undefined;
    if (!code || !cb) return reply.code(400).send({ error: "invalid or expired state" });
    try {
      const profile = await deps.google.exchange(code);
      const user = deps.users.upsertByGoogle(profile);
      const token = signSession(user.id, deps.config.jwtSecret);
      const url = new URL(cb);
      url.searchParams.set("token", token);
      return reply.redirect(url.toString());
    } catch {
      return reply.code(400).send({ error: "authentication failed" });
    }
  });

  app.get("/me", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { id: user.id, email: user.email };
  });

  return app;
}
