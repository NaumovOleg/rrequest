import "reflect-metadata";
import { Helios } from "@heliosjs/aws";
import { RootController } from "../controllers/root.controller.js";
import { makeAuthPlugin } from "../auth-plugin.js";
import { users, config } from "../deps.js";

const adapter = new Helios(RootController);
adapter.usePlugin(makeAuthPlugin({ users, jwtSecret: config.jwtSecret }));

type AnyHandler = (...args: any[]) => Promise<any>;
const inner = adapter.handler as AnyHandler;

/**
 * WORKAROUND for a `@heliosjs/aws` bug on **Lambda Function URLs**.
 *
 * Helios normalizes incoming events per source. Its API-Gateway-v2 normalizer
 * sets the request `url` to the PATH (`/api/auth/start`) — which the router
 * matches on. But its Function-URL normalizer sets `url` to the FULL url
 * (`https://<host>/api/auth/start?cb=...`), so no route ever matches and every
 * request 404s. The two code paths are told apart purely by event shape: a
 * Function-URL event has `requestContext.apiId === undefined` and a
 * `domainName` containing `"lambda-url"`.
 *
 * Until the framework is fixed, coerce Function-URL events to look like an
 * API-Gateway-v2 event (give them an `apiId`, drop `lambda-url` from the
 * `domainName`) so Helios takes the correct v2 normalizer. Nothing downstream
 * reads either field — the v2 normalizer derives host from the `host` header
 * and OAuth redirects come from `config.googleRedirectUri` — so the rewrite is
 * inert beyond the routing fix. EventBridge (poll) events lack `version`/`http`
 * and are untouched.
 */
export const handler: AnyHandler = (event, context) => {
  const rc = (
    event as { version?: string; requestContext?: { http?: unknown; apiId?: unknown; domainName?: string } }
  )?.requestContext;
  if (
    (event as { version?: string })?.version === "2.0" &&
    rc?.http !== undefined &&
    rc.apiId === undefined &&
    typeof rc.domainName === "string" &&
    rc.domainName.includes("lambda-url")
  ) {
    (rc as { apiId: string }).apiId = "function-url";
    rc.domainName = rc.domainName.replace("lambda-url", "fnurl");
  }
  return inner(event, context);
};
