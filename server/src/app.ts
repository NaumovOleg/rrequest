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
