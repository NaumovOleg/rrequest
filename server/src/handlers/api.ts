// Thin cold-start wrapper around `handlers/api-app.ts`.
//
// `api-app.ts` (transitively, via `deps.ts`) calls `loadConfig()` at module
// TOP LEVEL, which requires plaintext secret env vars (`JWT_SECRET`,
// `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_SECRET`). The CDK infra only wires the SSM
// parameter names (`*_PARAM`) into the Lambda environment -- so
// `ensureSecretsLoaded()` must populate the plaintext vars from Parameter
// Store BEFORE `api-app.ts` is ever imported. A dynamic `import()` defers
// that top-level `loadConfig()` call until after the env is populated (a
// static `import` would be hoisted above it). The imported handler is
// cached on `inner` so subsequent warm invocations skip the (already
// no-op) `ensureSecretsLoaded` fetch and the re-import.
import { ensureSecretsLoaded } from "../secrets.js";

// `api-app.ts`'s exported `handler` is typed as `aws-lambda`'s `Handler`
// (event, context, callback) => void | Promise<TResult> -- a rest-args
// signature here keeps this wrapper structurally assignable to that type
// (and to whatever shape CDK's `NodejsFunction` expects) without re-
// importing `aws-lambda`'s types just for a pass-through wrapper.
type AnyHandler = (...args: any[]) => Promise<any>;

let inner: AnyHandler | undefined;

export const handler: AnyHandler = async (...args) => {
  await ensureSecretsLoaded();
  if (!inner) inner = (await import("./api-app.js")).handler as AnyHandler;
  return inner(...args);
};
