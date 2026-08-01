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

  it("fetches and populates the plaintext env var when only the param name is set", async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_PARAM: "/rrequest/JWT_SECRET" };
    const fetchSecret = vi.fn(async (arn: string) => `fetched-value-for:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });

    expect(fetchSecret).toHaveBeenCalledWith("/rrequest/JWT_SECRET");
    expect(env.JWT_SECRET).toBe("fetched-value-for:/rrequest/JWT_SECRET");
  });

  it("is idempotent: a second call in the same container does not re-fetch", async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_PARAM: "/rrequest/JWT_SECRET" };
    const fetchSecret = vi.fn(async (arn: string) => `fetched-value-for:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });
    await ensureSecretsLoaded({ env, fetchSecret });

    expect(fetchSecret).toHaveBeenCalledTimes(1);
  });

  it("fetches all three secrets by param name when none of the plaintext vars are set", async () => {
    const env: NodeJS.ProcessEnv = {
      JWT_SECRET_PARAM: "/rrequest/JWT_SECRET",
      TOKEN_ENC_KEY_PARAM: "/rrequest/TOKEN_ENC_KEY",
      GOOGLE_CLIENT_SECRET_PARAM: "/rrequest/GOOGLE_CLIENT_SECRET",
    };
    const fetchSecret = vi.fn(async (arn: string) => `value:${arn}`);

    await ensureSecretsLoaded({ env, fetchSecret });

    expect(env.JWT_SECRET).toBe("value:/rrequest/JWT_SECRET");
    expect(env.TOKEN_ENC_KEY).toBe("value:/rrequest/TOKEN_ENC_KEY");
    expect(env.GOOGLE_CLIENT_SECRET).toBe("value:/rrequest/GOOGLE_CLIENT_SECRET");
    expect(fetchSecret).toHaveBeenCalledTimes(3);
  });
});
