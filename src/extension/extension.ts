import * as vscode from "vscode";
import {
  RrequestPanel,
  ensureBootstrap,
  getSyncRuntime,
  getSyncControl,
  getMcpPort,
  syncLog,
  deactivateRuntime,
} from "./panel";
import { SidebarViewProvider } from "./sidebar-view";
import { McpRuntime } from "./mcp/runtime";

// Opens the bundled usage guide (docs/usage.md) in the editor — as rendered
// Markdown preview when the built-in Markdown extension is available (it is by
// default), plain text otherwise.
async function openDocs(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, "docs", "usage.md");
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("rrequest.open", () => {
      RrequestPanel.createOrShow(context);
    }),
    // Palette/keybinding entry points (share the same open paths as the sidebar
    // buttons): New Request = blank request tab, Change Environment = the
    // Environments editor, Import cURL = new tab parsed from clipboard.
    vscode.commands.registerCommand("rrequest.newRequest", () => {
      RrequestPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand("rrequest.changeEnvironment", () => {
      RrequestPanel.openOrReveal(context, "env", "Environments", {
        type: "showEnvironments",
      });
    }),
    vscode.commands.registerCommand("rrequest.importCurl", async () => {
      const text = await vscode.env.clipboard.readText().then(
        (t) => t,
        () => ""
      );
      if (!text.trim())
        return void vscode.window.showWarningMessage(
          "RREQUEST: clipboard is empty"
        );
      RrequestPanel.openOrReveal(
        context,
        `req:${Date.now().toString(36)}`,
        "Import cURL",
        { type: "importCurl", text }
      );
    }),
    // Gear in the sidebar view title bar -> open the two rrequest settings.
    vscode.commands.registerCommand("rrequest.openSettings", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "rrequest"
      );
    }),
    vscode.commands.registerCommand("rrequest.openDocs", () =>
      openDocs(context)
    ),
    vscode.commands.registerCommand("rrequest.newSse", () => {
      RrequestPanel.openOrReveal(context, "sse", "SSE", { type: "showSse" });
    }),
    vscode.window.registerWebviewViewProvider(
      "rrequest.sidebar",
      new SidebarViewProvider(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rrequest.signInToSync", async () => {
      await ensureBootstrap(context);
      try {
        await getSyncControl()?.signIn();
      } catch (e: any) {
        void vscode.window.showErrorMessage(
          `rrequest sign-in failed: ${e?.message ?? e}`
        );
      }
    })
  );

  const activeWorkspaceId = (): string =>
    context.globalState.get<string>("rrequest.activeWorkspaceId", "");

  // --- MCP server (opt-in: rrequest.mcpEnabled) ---------------------------------
  // Off until the user checks the box; the runtime converges to the settings on
  // startup and on every relevant config change. Registration in subscriptions
  // means dispose() (-> stop()) runs on deactivate, releasing the socket.
  const mcp = new McpRuntime({
    context,
    getPort: getMcpPort,
    ensurePort: async () => {
      await ensureBootstrap(context);
    },
    log: (m) => syncLog().appendLine(m),
    version: context.extension.packageJSON.version,
  });
  context.subscriptions.push(
    mcp,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("rrequest.mcpEnabled") ||
        e.affectsConfiguration("rrequest.mcpPort")
      ) {
        void mcp.applyConfig();
      }
    }),
    vscode.commands.registerCommand("rrequest.mcpStatus", async () => {
      const info = mcp.info();
      if (!info) {
        const open = await vscode.window.showInformationMessage(
          'RREQUEST: MCP server is off. Turn on "MCP: Enable local MCP server" in Settings to start it.',
          "Open settings"
        );
        if (open === "Open settings")
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "rrequest.mcpEnabled"
          );
        return;
      }
      // Commit-safe: the token never lands in the pasted file. VS Code prompts
      // for `${input:rrequest-token}` once and remembers it, so a shared
      // `.vscode/mcp.json` can be checked in without leaking the secret.
      const config = JSON.stringify(
        {
          inputs: [
            {
              type: "promptString",
              id: "rrequest-token",
              description:
                "RREQUEST MCP token — run 'RREQUEST: MCP copy token' and paste it here",
              password: true,
            },
          ],
          servers: {
            rrequest: {
              type: "http",
              url: info.url,
              headers: { Authorization: "Bearer ${input:rrequest-token}" },
            },
          },
        },
        null,
        2
      );
      const pick = await vscode.window.showInformationMessage(
        `RREQUEST MCP server: ${info.url}`,
        "Copy client config",
        "Copy token",
        "Regenerate token"
      );
      if (pick === "Copy client config") {
        await vscode.env.clipboard.writeText(config);
        void vscode.window.showInformationMessage(
          "RREQUEST: MCP client config copied — paste it into .vscode/mcp.json (VS Code will ask for the token on first run)."
        );
      } else if (pick === "Copy token") {
        await vscode.env.clipboard.writeText(info.token);
        void vscode.window.showInformationMessage(
          "RREQUEST: MCP token copied to clipboard."
        );
      } else if (pick === "Regenerate token") {
        await vscode.commands.executeCommand("rrequest.mcpRegenerateToken");
      }
    }),
    vscode.commands.registerCommand("rrequest.mcpCopyToken", async () => {
      const token = await mcp.readToken();
      if (!token) {
        void vscode.window.showInformationMessage(
          'RREQUEST: no MCP token yet. Turn on "MCP: Enable local MCP server" in Settings first.'
        );
        return;
      }
      await vscode.env.clipboard.writeText(token);
      void vscode.window.showInformationMessage(
        "RREQUEST: MCP token copied to clipboard."
      );
    }),
    vscode.commands.registerCommand("rrequest.mcpRegenerateToken", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "RREQUEST: regenerate the MCP token? Any client config you already pasted keeps the old token and will stop working until you update it.",
        { modal: true },
        "Regenerate"
      );
      if (confirm !== "Regenerate") return;
      const token = await mcp.regenerateToken();
      if (token) await vscode.env.clipboard.writeText(token);
      const info = mcp.info();
      void vscode.window.showInformationMessage(
        `RREQUEST: new MCP token copied to clipboard.${
          info ? ` Server at ${info.url}.` : ""
        }`
      );
    }),
    vscode.commands.registerCommand("rrequest.mcpRevokeAccess", async () => {
      const grants = mcp.grants();
      if (grants.length === 0) {
        void vscode.window.showInformationMessage(
          "RREQUEST: no MCP access grants to revoke."
        );
        return;
      }
      const revokeAll = "Revoke all";
      type Pick = vscode.QuickPickItem & {
        ref?: (typeof grants)[number]["ref"];
      };
      const items: Pick[] = [
        { label: revokeAll, description: "drop every grant" },
        ...grants.map((g) => ({
          label: `$(lock) ${g.ref.type}: ${g.ref.name}`,
          description: g.grant.write ? "read & write" : "read",
          ref: g.ref,
        })),
      ];
      const pick = await vscode.window.showQuickPick(items, {
        title: "RREQUEST: MCP access grants",
        placeHolder: "Choose a grant to revoke",
      });
      if (!pick) return;
      if (pick.label === revokeAll) mcp.revokeAll();
      else if (pick.ref) mcp.revoke(pick.ref);
      void vscode.window.showInformationMessage(
        "RREQUEST: MCP access revoked."
      );
    })
  );
  void mcp.applyConfig();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rrequest.enableWorkspaceSync",
      async () => {
        const id = activeWorkspaceId();
        if (!id)
          return void vscode.window.showWarningMessage(
            "RREQUEST: no active workspace"
          );
        await ensureBootstrap(context);
        const rt = getSyncRuntime();
        if (!rt)
          return void vscode.window.showWarningMessage(
            "RREQUEST: sync not ready"
          );
        const control = getSyncControl();
        if (!control) return;
        // With several accounts connected, enable() can't guess which one owns
        // this workspace — ask, instead of failing with "choose an account".
        const accounts = control.accounts();
        if (accounts.length === 0)
          return void vscode.window.showWarningMessage(
            "RREQUEST: sign in with Google first"
          );
        let accountId = accounts[0].id;
        if (accounts.length > 1) {
          const picked = await vscode.window.showQuickPick(
            accounts.map((a) => ({ label: a.email, id: a.id })),
            { title: "Sync this workspace to which account?" }
          );
          if (!picked) return;
          accountId = picked.id;
        }
        await control.enable(id, accountId);
      }
    ),
    vscode.commands.registerCommand("rrequest.syncDiagnostics", async () => {
      await ensureBootstrap(context);
      await getSyncControl()?.diagnostics();
    }),
    vscode.commands.registerCommand("rrequest.syncNow", async () => {
      const id = activeWorkspaceId();
      if (!id)
        return void vscode.window.showWarningMessage(
          "RREQUEST: no active workspace"
        );
      await ensureBootstrap(context);
      const rt = getSyncRuntime();
      if (!rt)
        return void vscode.window.showWarningMessage(
          "RREQUEST: sync not ready"
        );
      await getSyncControl()?.syncNow(id);
    })
  );
}

// Perf: VS Code gives us one shutdown hook — use it. Stops the sync poll
// interval and closes live WS/SSE connections so nothing keeps polling or
// holding sockets after the extension host tears the extension down
// (previously deactivate() was empty and the poll loop ran on forever).
export function deactivate() {
  deactivateRuntime();
}
