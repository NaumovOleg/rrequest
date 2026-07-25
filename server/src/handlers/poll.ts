// Thin cold-start wrapper around `handlers/poll-app.ts`. See `handlers/api.ts`
// for why this dynamic-import-after-secrets-loaded split exists.
import { ensureSecretsLoaded } from "../secrets.js";

type AnyHandler = (...args: any[]) => Promise<any>;

let inner: AnyHandler | undefined;

export const handler: AnyHandler = async (...args) => {
  await ensureSecretsLoaded();
  if (!inner) inner = (await import("./poll-app.js")).handler as AnyHandler;
  return inner(...args);
};
