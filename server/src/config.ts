export type Config = {
  port: number;
  dbPath: string;
  jwtSecret: string;
  tokenEncKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const req = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? "restman.db",
    jwtSecret: req("JWT_SECRET"),
    tokenEncKey: req("TOKEN_ENC_KEY"),
    googleClientId: req("GOOGLE_CLIENT_ID"),
    googleClientSecret: req("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: req("GOOGLE_REDIRECT_URI"),
  };
}
