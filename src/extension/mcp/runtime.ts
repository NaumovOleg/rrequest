import * as vscode from "vscode";
import type { McpHttpServer } from "./server";
import type { McpPort } from "./port";
import { createServer, McpHttpServer as HttpServer } from "./server";
import { McpAccess, type Grant, type ResourceRef } from "./access";
import { ensureToken, type TokenStore } from "./token";

const TOKEN_KEY = "rrequest.mcp.token";

export type McpRuntimeDeps = {
  context: vscode.ExtensionContext;
  getPort: () => McpPort | undefined;
  /** Builds the stores/Hub (ensureBootstrap) so getPort() has something to return. */
  ensurePort: () => Promise<void>;
  log: (message: string) => void;
  version: string;
};

/**
 * Start/stop of the MCP server in response to the `rrequest.mcpEnabled`
 * checkbox (+ `rrequest.mcpPort`). Nothing runs until the box is checked;
 * unchecking stops the listener; the port change restarts it.
 */
export class McpRuntime {
  private http: McpHttpServer | undefined;
  private runningPort = 0;
  private token = "";
  private statusItem: vscode.StatusBarItem | undefined;
  private busy: Promise<void> = Promise.resolve();
  // Grants are session-scoped: created here, cleared on stop().
  private readonly access = new McpAccess({
    prompt: async (req) => {
      const mode = req.write
        ? req.alreadyRead
          ? "upgrade to read & write"
          : "read & write access"
        : "read access";
      const allow = await vscode.window.showInformationMessage(
        `An AI agent requests ${mode} to the ${req.type} "${req.name}" (RREQUEST MCP).`,
        { modal: true },
        "Allow",
        "Deny"
      );
      return allow === "Allow" ? (req.write ? "allow-write" : "allow") : "deny";
    },
  });

  constructor(private readonly deps: McpRuntimeDeps) {}

  /** Current grants, for the revoke command. */
  grants(): { ref: ResourceRef; grant: Grant }[] {
    return this.access.list();
  }

  revokeAll(): void {
    this.access.revokeAll();
  }

  revoke(ref: ResourceRef): void {
    this.access.revoke(ref);
  }

  /** Reads the settings and converges the server onto that state. Serialized. */
  async applyConfig(): Promise<void> {
    this.busy = this.busy.then(
      () => this.doApply(),
      () => this.doApply()
    );
    return this.busy;
  }

  private config(): { enabled: boolean; port: number } {
    const c = vscode.workspace.getConfiguration("rrequest");
    return {
      enabled: c.get<boolean>("mcpEnabled", false),
      port: c.get<number>("mcpPort", 3333),
    };
  }

  private async doApply(): Promise<void> {
    const { enabled, port } = this.config();
    if (!enabled) {
      if (this.http) await this.stop();
      return;
    }
    if (this.http && port === this.runningPort) return;
    if (this.http) await this.stop();
    await this.start(port);
  }

  private async start(port: number): Promise<void> {
    try {
      await this.deps.ensurePort();
      const mcpPort = this.deps.getPort();
      if (!mcpPort) {
        this.deps.log(
          "[mcp] data port unavailable (bootstrap failed) — not starting"
        );
        return;
      }
      // Stable token: minted once and kept in Secret Storage, so a pasted
      // client config keeps working across restarts. `RREQUEST: MCP
      // regenerate token` drops it; the next start mints a fresh one.
      this.token = await ensureToken(this.tokenStore());

      const http = new HttpServer(() =>
        createServer(mcpPort, this.access, { version: this.deps.version })
      );
      const url = await http.start({
        port,
        token: this.token,
        onError: (e) => this.deps.log(`[mcp] ${e.message}`),
      });
      this.http = http;
      this.runningPort = port;
      this.showStatus(url);
      this.deps.log(`[mcp] listening at ${url} (loopback, bearer token)`);
    } catch (e: any) {
      const message = String(e?.message ?? e);
      this.deps.log(`[mcp] failed to start: ${message}`);
      void vscode.window.showErrorMessage(
        `RREQUEST: MCP server failed to start — ${message}`
      );
    }
  }

  private showStatus(url: string): void {
    const item = vscode.window.createStatusBarItem(
      "rrequest.mcp",
      vscode.StatusBarAlignment.Right,
      100
    );
    item.text = "$(radio-tower) MCP";
    item.tooltip = `RREQUEST MCP server at ${url}\nClick for connection details`;
    item.command = "rrequest.mcpStatus";
    item.show();
    this.statusItem = item;
  }

  async stop(): Promise<void> {
    this.statusItem?.dispose();
    this.statusItem = undefined;
    // Session-scoped grants: dropping them on stop makes the next session ask
    // again (and mirrors "always asks" across reloads/toggles).
    this.access.clear();
    const http = this.http;
    this.http = undefined;
    this.runningPort = 0;
    if (!http) return;
    await http.stop();
    this.deps.log("[mcp] stopped");
  }

  /** For the `rrequest.mcpStatus` command; undefined when the server is off. */
  info(): { url: string; token: string } | undefined {
    if (!this.http) return undefined;
    return { url: this.http.url, token: this.token };
  }

  private tokenStore(): TokenStore {
    const secrets = this.deps.context.secrets;
    return {
      get: async () => await secrets.get(TOKEN_KEY),
      set: async (value) => await secrets.store(TOKEN_KEY, value),
      delete: async () => await secrets.delete(TOKEN_KEY),
    };
  }

  /** The bearer token from Secret Storage; works while the server is off too. */
  async readToken(): Promise<string | undefined> {
    return (await this.deps.context.secrets.get(TOKEN_KEY)) ?? undefined;
  }

  /**
   * Drops the stored token and mints a new one (invalidates every pasted
   * client config). Restarts the server if it is running.
   */
  async regenerateToken(): Promise<string | undefined> {
    await this.deps.context.secrets.delete(TOKEN_KEY);
    if (this.http) {
      const port = this.runningPort;
      await this.stop();
      await this.start(port);
    } else {
      this.token = await ensureToken(this.tokenStore());
    }
    return this.token;
  }

  dispose(): void {
    void this.stop();
  }
}
