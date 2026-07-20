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
    expect(c.dbPath).toBe("restman.db");
    expect(c.jwtSecret).toBe("j");
    expect(c.googleClientId).toBe("cid");
  });
  it("throws when a required var is missing", () => {
    expect(() => loadConfig({} as any)).toThrow(/JWT_SECRET/);
  });
});
