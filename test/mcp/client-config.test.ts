import { describe, expect, it } from "vitest";
import {
  MCP_TOKEN_ENV,
  shellProfilePath,
  upsertMcpJson,
  upsertShellExport,
} from "../../src/extension/mcp/client-config";

describe("upsertMcpJson", () => {
  it("creates a portable mcpServers config with the env-var token", () => {
    const doc = JSON.parse(
      upsertMcpJson(undefined, "http://127.0.0.1:3333/mcp")
    );
    expect(doc.mcpServers.rrequest).toEqual({
      type: "http",
      url: "http://127.0.0.1:3333/mcp",
      headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` },
    });
  });

  it("merges into an existing file, keeping other servers and updating url", () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { type: "http", url: "http://x" },
        rrequest: { type: "http", url: "http://old" },
      },
    });
    const doc = JSON.parse(
      upsertMcpJson(existing, "http://127.0.0.1:4444/mcp")
    );
    expect(doc.mcpServers.other).toEqual({ type: "http", url: "http://x" });
    expect(doc.mcpServers.rrequest.url).toBe("http://127.0.0.1:4444/mcp");
    expect(doc.mcpServers.rrequest.headers.Authorization).toContain(
      MCP_TOKEN_ENV
    );
  });
});

describe("upsertShellExport", () => {
  it("appends a managed block to an empty profile", () => {
    const out = upsertShellExport("", "tok");
    expect(out).toContain(`export ${MCP_TOKEN_ENV}='tok'`);
    expect(out.startsWith("# >>> rrequest MCP >>>")).toBe(true);
  });

  it("appends without clobbering a profile lacking a trailing newline", () => {
    const out = upsertShellExport("export FOO=1", "tok");
    expect(out.startsWith("export FOO=1\n\n")).toBe(true);
  });

  it("replaces the existing block in place and keeps the rest", () => {
    const first = upsertShellExport("export FOO=1\n", "old");
    const out = upsertShellExport(first, "new");
    expect(out).toContain("export FOO=1");
    expect(out).toContain(`export ${MCP_TOKEN_ENV}='new'`);
    expect(out).not.toContain("'old'");
    expect(out.match(/# >>> rrequest MCP >>>/g)).toHaveLength(1);
  });

  it("single-quotes the token so shell metacharacters are safe", () => {
    expect(upsertShellExport("", "a'b")).toContain(
      `export ${MCP_TOKEN_ENV}='a'\\''b'`
    );
  });
});

describe("shellProfilePath", () => {
  it("maps zsh and bash to their rc files", () => {
    expect(shellProfilePath("/bin/zsh", "/home/u")).toBe("/home/u/.zshrc");
    expect(shellProfilePath("/bin/bash", "/home/u")).toBe("/home/u/.bashrc");
  });
  it("falls back to .profile for unknown shells", () => {
    expect(shellProfilePath("/usr/bin/fish", "/home/u")).toBe(
      "/home/u/.profile"
    );
    expect(shellProfilePath("", "/home/u")).toBe("/home/u/.profile");
  });
});
