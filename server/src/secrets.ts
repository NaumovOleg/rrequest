// Cold-start Secrets Manager loading for Lambda handlers.
//
// The CDK infra (see `infra/lib/functions.ts`) only wires Secrets Manager
// ARNs into the Lambda environment (`JWT_SECRET_ARN`, `TOKEN_ENC_KEY_ARN`,
// `GOOGLE_CLIENT_SECRET_ARN`) -- never plaintext secret values. But
// `deps.ts` calls `loadConfig()` at MODULE TOP LEVEL, and `loadConfig`
// requires the plaintext env vars (`JWT_SECRET`, `TOKEN_ENC_KEY`,
// `GOOGLE_CLIENT_SECRET`) to be present, throwing otherwise. So on a cold
// start, importing `deps.ts` before these plaintext vars are populated
// throws before the handler ever runs.
//
// `ensureSecretsLoaded` fetches each secret's value from Secrets Manager
// and writes it into `process.env` under the plaintext key `loadConfig`
// expects, so it must be awaited BEFORE `deps.ts` (and therefore
// `loadConfig`) is imported. Handlers achieve this via a dynamic
// `import()` of the real handler module, deferred until after this
// resolves (see `handlers/api.ts` / `handlers/poll.ts`).
//
// In local dev / tests, the plaintext env vars are already set directly
// (no `*_ARN` vars, no AWS credentials available) -- those are left alone
// and Secrets Manager is never touched.
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export type FetchSecret = (arn: string) => Promise<string>;

export type EnsureSecretsLoadedOptions = {
  env?: NodeJS.ProcessEnv;
  fetchSecret?: FetchSecret;
};

const SECRET_ENV_PAIRS: Array<{ plain: string; arn: string }> = [
  { plain: "JWT_SECRET", arn: "JWT_SECRET_ARN" },
  { plain: "TOKEN_ENC_KEY", arn: "TOKEN_ENC_KEY_ARN" },
  { plain: "GOOGLE_CLIENT_SECRET", arn: "GOOGLE_CLIENT_SECRET_ARN" },
];

let loaded = false;

let smClient: SecretsManagerClient | undefined;

async function fetchSecretFromSecretsManager(arn: string): Promise<string> {
  if (!smClient) smClient = new SecretsManagerClient({});
  const result = await smClient.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!result.SecretString) throw new Error(`Secret ${arn} has no SecretString`);
  return result.SecretString;
}

/**
 * Idempotent per warm container: only the FIRST call per Lambda container
 * hits Secrets Manager. Subsequent invocations on the same warm container
 * are no-ops.
 */
export async function ensureSecretsLoaded(opts: EnsureSecretsLoadedOptions = {}): Promise<void> {
  if (loaded) return;
  const env = opts.env ?? process.env;
  const fetchSecret = opts.fetchSecret ?? fetchSecretFromSecretsManager;

  for (const { plain, arn } of SECRET_ENV_PAIRS) {
    if (env[plain]) continue; // local dev / test: plaintext already provided
    const arnValue = env[arn];
    if (!arnValue) continue; // neither plaintext nor ARN set -- loadConfig will throw with a clear message
    env[plain] = await fetchSecret(arnValue);
  }

  loaded = true;
}

/** Test-only: clears the idempotency flag so a test can exercise a fresh load. */
export function __resetForTest(): void {
  loaded = false;
}
