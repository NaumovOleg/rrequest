// Helios plugin: parses the `Authorization: Bearer` header on every request
// except the unauthenticated OAuth entry points (`/api/auth/start`,
// `/api/auth/callback`) and, when valid, stores the resolved user on the
// request state so controllers can read it.
//
// IMPORTANT (confirmed by reading @heliosjs/aws@10.0.0's compiled source,
// dist/utils/aws/plugin.js): `callPluginHook` wraps every hook invocation in
// its own try/catch and only `console.error`s on throw -- it never rethrows,
// and `runControllers` (dist/lambda.js) unconditionally proceeds to
// `controller[CONTROLLER_REQUEST]` right after `beforeRoute` regardless of
// what the hook did. So a plugin CANNOT reject/short-circuit a request by
// throwing (or by mutating `response.data`, since the controller's own
// `execute()` unconditionally overwrites `response.data` when it runs). This
// plugin therefore only sets state; the actual 401 is enforced per-route by
// `requireUser()` below, called from the protected controllers -- that DOES
// work, because a throw from inside a controller method is caught by
// `execute()`'s try/catch and correctly mapped to the thrown error's status.
import { UnauthorizedError, type Request } from "@heliosjs/core";
import type { Plugin } from "@heliosjs/aws";
import { verifySession } from "./domain/jwt.js";
import type { User, UserStore } from "./stores/types.js";

const AUTH_PREFIX = "/api/auth";

/** Pure core of the plugin: header -> verified session -> loaded user. Unit-testable without any Helios types. */
export async function authorize(
  authHeader: string | string[] | undefined,
  verify: (token: string) => { userId: string } | null,
  loadUser: (id: string) => Promise<User | undefined>,
): Promise<User | null> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const verified = verify(token);
  if (!verified) return null;
  const user = await loadUser(verified.userId);
  return user ?? null;
}

/** Throws 401 unless `authPlugin` (or a prior call) has set a user on the request state. */
export function requireUser(req: Request): User {
  const user = req.getState<User>("user");
  if (!user) throw new UnauthorizedError("unauthorized");
  return user;
}

export type AuthPluginDeps = {
  users: Pick<UserStore, "getById">;
  jwtSecret: string;
};

/**
 * Builds the `Plugin` from injected deps rather than importing `deps.ts`
 * singletons directly -- keeps this module free of `deps.ts`'s import-time
 * side effect (`loadConfig()` throws when required env vars are unset),
 * which would otherwise force every test importing this file (including the
 * pure `authorize()` unit tests) to first stub a full set of env vars.
 * `handlers/api-app.ts` wires the real `deps.ts` singletons in.
 */
export function makeAuthPlugin(deps: AuthPluginDeps): Plugin {
  return {
    name: "auth",
    hooks: {
      beforeRoute: async (req) => {
        if (req.path.startsWith(AUTH_PREFIX)) return;
        const user = await authorize(
          req.getHeader("authorization"),
          (token) => verifySession(token, deps.jwtSecret),
          (id) => deps.users.getById(id),
        );
        if (user) req.setState("user", user);
      },
    },
  };
}
