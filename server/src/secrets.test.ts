import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureSecretsLoaded, __resetForTest } from "./secrets.js";

describe("ensureSecretsLoaded", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("skips fetching a secret whose plaintext env var is already set (local dev / test)", async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET: "local-jwt-secret" };
    const fetchSecret = vi.fn(async () => "should-not-be-called");

    await ensureSecretsLoaded({ env, fetchSecret });

    expect(fetchSecret).not.toHaveBeenCalled();
    expect(env.JWT_SECRET).toBe("local-jwt-secret");
  });

  it("fetches and populates the plaintext env var when only the ARN is set", async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123:secret:jwt" };
    const fetchSecret = vi.fn(async (arn: string) => `fetched-value-for:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });

    expect(fetchSecret).toHaveBeenCalledWith("arn:aws:secretsmanager:us-east-1:123:secret:jwt");
    expect(env.JWT_SECRET).toBe("fetched-value-for:arn:aws:secretsmanager:us-east-1:123:secret:jwt");
  });

  it("is idempotent: a second call in the same container does not re-fetch", async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123:secret:jwt" };
    const fetchSecret = vi.fn(async (arn: string) => `fetched-value-for:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });
    await ensureSecretsLoaded({ env, fetchSecret });

    expect(fetchSecret).toHaveBeenCalledTimes(1);
  });

  it("fetches all three secrets by ARN when none of the plaintext vars are set", async () => {
    const env: NodeJS.ProcessEnv = {
      JWT_SECRET_ARN: "arn:jwt",
      TOKEN_ENC_KEY_ARN: "arn:enc",
      GOOGLE_CLIENT_SECRET_ARN: "arn:google",
    };
    const fetchSecret = vi.fn(async (arn: string) => `value:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });

    expect(env.JWT_SECRET).toBe("value:arn:jwt");
    expect(env.TOKEN_ENC_KEY).toBe("value:arn:enc");
    expect(env.GOOGLE_CLIENT_SECRET).toBe("value:arn:google");
    expect(fetchSecret).toHaveBeenCalledTimes(3);
  });
});
