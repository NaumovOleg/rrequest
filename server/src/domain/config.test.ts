import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = {
  JWT_SECRET: "j", TOKEN_ENC_KEY: "k",
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec",
  GOOGLE_REDIRECT_URI: "http://localhost:8787/auth/callback",
};

describe("loadConfig", () => {
  it("parses required values and applies defaults", () => {
    const c = loadConfig(base as any);
    expect(c.port).toBe(8787);
    expect(c.dbPath).toBe("rrequest.db");
    expect(c.jwtSecret).toBe("j");
    expect(c.googleClientId).toBe("cid");
  });
  it("throws when a required var is missing", () => {
    expect(() => loadConfig({} as any)).toThrow(/JWT_SECRET/);
  });
});

describe("loadConfig watch settings", () => {
  it("defaults poll interval + channel ttl and leaves publicWebhookUrl undefined", () => {
    const c = loadConfig({ ...base } as any);
    expect(c.publicWebhookUrl).toBeUndefined();
    expect(c.pollIntervalMs).toBe(60000);
    expect(c.channelTtlSeconds).toBe(604800);
  });
  it("reads overrides from env", () => {
    const c = loadConfig({ ...base, PUBLIC_WEBHOOK_URL: "https://pub", POLL_INTERVAL_MS: "5000", CHANNEL_TTL_SECONDS: "3600" } as any);
    expect(c.publicWebhookUrl).toBe("https://pub");
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.channelTtlSeconds).toBe(3600);
  });
});
