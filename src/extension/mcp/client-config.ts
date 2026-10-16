// Writes the portable MCP client config (.mcp.json, the `mcpServers` format
// shared by Claude Code and VS Code/Copilot) and exports the token into the
// shell environment as RREQUEST_MCP_TOKEN. No MCP client reads a project .env
// for a remote HTTP server, so the variable has to live in the process
// environment itself. Pure helpers so they stay testable.

export const MCP_TOKEN_ENV = "RREQUEST_MCP_TOKEN";
export const MCP_JSON = ".mcp.json";

// Ensures .mcp.json has mcpServers.rrequest pointing at the local server with
// the env-var token, leaving any other servers untouched.
export function upsertMcpJson(
  existing: string | undefined,
  url: string
): string {
  const doc: Record<string, any> =
    existing && existing.trim() ? JSON.parse(existing) : {};
  doc.mcpServers = {
    ...(doc.mcpServers ?? {}),
    rrequest: {
      type: "http",
      url,
      headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` },
    },
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

const BLOCK_START = "# >>> rrequest MCP >>>";
const BLOCK_END = "# <<< rrequest MCP <<<";

// Idempotently sets the token export in a shell profile: replaces our managed
// block when present, otherwise appends it. Never touches anything else.
export function upsertShellExport(content: string, token: string): string {
  const block = `${BLOCK_START}\nexport ${MCP_TOKEN_ENV}=${shellQuote(
    token
  )}\n${BLOCK_END}`;
  const re = new RegExp(
    `${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}`
  );
  if (re.test(content)) return content.replace(re, block);
  const base = content && !content.endsWith("\n") ? content + "\n" : content;
  return base + (base ? "\n" : "") + block + "\n";
}

// Which profile file to write, from $SHELL. zsh is the macOS default.
export function shellProfilePath(shell: string, home: string): string {
  const sh = shell.split("/").pop() ?? "";
  if (sh === "zsh") return `${home}/.zshrc`;
  if (sh === "bash") return `${home}/.bashrc`;
  return `${home}/.profile`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
