// Cold-start SSM Parameter Store loading for Lambda handlers.
//
// The CDK infra (see `infra/lib/functions.ts`) only wires SSM parameter
// NAMES into the Lambda environment (`JWT_SECRET_PARAM`,
// `TOKEN_ENC_KEY_PARAM`, `GOOGLE_CLIENT_SECRET_PARAM`) -- never plaintext
// secret values. But `deps.ts` calls `loadConfig()` at MODULE TOP LEVEL,
// and `loadConfig` requires the plaintext env vars (`JWT_SECRET`,
// `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_SECRET`) to be present, throwing
// otherwise. So on a cold start, importing `deps.ts` before these plaintext
// vars are populated throws before the handler ever runs.
//
// `ensureSecretsLoaded` fetches each secret's value from Parameter Store
// (SecureString, decrypted) and writes it into `process.env` under the
// plaintext key `loadConfig` expects, so it must be awaited BEFORE `deps.ts`
// (and therefore `loadConfig`) is imported. Handlers achieve this via a
// dynamic `import()` of the real handler module, deferred until after this
// resolves (see `handlers/api.ts` / `handlers/poll.ts`).
//
// In local dev / tests, the plaintext env vars are already set directly
// (no `*_PARAM` vars, no AWS credentials available) -- those are left alone
// and Parameter Store is never touched.
//
// Why SSM Parameter Store over Secrets Manager: standard-tier SecureString
// parameters are free (Secrets Manager charges per secret per month + per
// API call). These secrets are static long-lived config, not rotated
// credentials, so Parameter Store's cheaper tier is the right fit.
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

export type FetchSecret = (parameterName: string) => Promise<string>;

export type EnsureSecretsLoadedOptions = {
  env?: NodeJS.ProcessEnv;
  fetchSecret?: FetchSecret;
};

const SECRET_ENV_PAIRS: Array<{ plain: string; param: string }> = [
  { plain: "JWT_SECRET", param: "JWT_SECRET_PARAM" },
  { plain: "TOKEN_ENC_KEY", param: "TOKEN_ENC_KEY_PARAM" },
  { plain: "GOOGLE_CLIENT_SECRET", param: "GOOGLE_CLIENT_SECRET_PARAM" },
];

let loaded = false;

let ssmClient: SSMClient | undefined;

async function fetchSecretFromParameterStore(parameterName: string): Promise<string> {
  if (!ssmClient) ssmClient = new SSMClient({});
  const result = await ssmClient.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${parameterName} has no value`);
  return value;
}

/**
 * Idempotent per warm container: only the FIRST call per Lambda container
 * hits Parameter Store. Subsequent invocations on the same warm container
 * are no-ops.
 */
export async function ensureSecretsLoaded(opts: EnsureSecretsLoadedOptions = {}): Promise<void> {
  if (loaded) return;
  const env = opts.env ?? process.env;
  const fetchSecret = opts.fetchSecret ?? fetchSecretFromParameterStore;

  for (const { plain, param } of SECRET_ENV_PAIRS) {
    if (env[plain]) continue; // local dev / test: plaintext already provided
    const paramName = env[param];
    if (!paramName) continue; // neither plaintext nor param name set -- loadConfig will throw with a clear message
    env[plain] = await fetchSecret(paramName);
  }

  loaded = true;
}

/** Test-only: clears the idempotency flag so a test can exercise a fresh load. */
export function __resetForTest(): void {
  loaded = false;
}
