import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { GoogleOAuth } from "./google-oauth.js";
import type { PendingStates } from "./pending-states.js";
import { randomUUID } from "node:crypto";
import { signSession } from "./jwt.js";

export type AppDeps = {
  config: Config;
  users: UserStore;
  google: GoogleOAuth;
  states: PendingStates;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

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

  return app;
}
