import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Socket } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpPort } from "./port";
import type { McpAccess } from "./access";
import { registerTools } from "./tools";

// Big enough for any realistic tool payload, small enough that a random local
// caller can't make us buffer unbounded memory.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Builds a fresh McpServer wired to the port. Called once per POST because a
 * `Protocol` refuses a second `connect()` unless the previous transport closed —
 * a per-request instance is also what the SDK recommends for stateless mode and
 * makes concurrent tool calls safe. Registering tools is cheap.
 */
export function createServer(
  port: McpPort,
  access: McpAccess,
  meta: { version: string }
): McpServer {
  const server = new McpServer({ name: "rrequest", version: meta.version });
  registerTools(server, port, access, meta);
  return server;
}

type Body =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

function send(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (b: Body): void => {
      if (done) return;
      done = true;
      resolve(b);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ ok: false, status: 413, message: "Payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      finish({ ok: true, text: Buffer.concat(chunks).toString("utf8") })
    );
    req.on("error", (e) =>
      finish({ ok: false, status: 400, message: String(e?.message ?? e) })
    );
  });
}

// DNS-rebinding defence: we never expect a browser to talk to this service, so
// any Origin header is refused, and the Host header must be loopback (an
// attacker's domain would show up there instead).
function trusted(req: http.IncomingMessage): boolean {
  if (req.headers.origin) return false;
  const host = (req.headers.host ?? "").toLowerCase();
  return (
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "localhost" ||
    host.startsWith("localhost:")
  );
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header || !token) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1], "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Serves one stateless Streamable-HTTP MCP endpoint on loopback only. */
export class McpHttpServer {
  private server: http.Server | undefined;
  private readonly sockets = new Set<Socket>();
  private url_ = "";
  private readonly makeServer: () => McpServer;

  constructor(createServer: () => McpServer) {
    this.makeServer = createServer;
  }

  get url(): string {
    return this.url_;
  }
  get running(): boolean {
    return !!this.server;
  }

  async start(opts: {
    port: number;
    host?: string;
    token: string;
    onError?: (e: Error) => void;
  }): Promise<string> {
    if (this.server) throw new Error("MCP server already running");
    const host = opts.host ?? "127.0.0.1";
    const srv = http.createServer((req, res) => {
      void this.handle(req, res, opts.token);
    });
    srv.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    // Post-listen errors (rare) must not crash the extension host.
    srv.on("error", (e) => opts.onError?.(e as Error));

    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException): void => {
        reject(
          e.code === "EADDRINUSE"
            ? new Error(
                `MCP port ${opts.port} is already in use — pick another in rrequest.mcpPort`
              )
            : e
        );
      };
      srv.once("error", onError);
      srv.listen(opts.port, host, () => {
        srv.removeListener("error", onError);
        resolve();
      });
    });

    this.server = srv;
    // Read the bound port back from the address so `port: 0` (ephemeral, used by
    // tests) yields the real one.
    const bound = srv.address();
    const actualPort =
      bound && typeof bound === "object" ? bound.port : opts.port;
    this.url_ = `http://${host}:${actualPort}/mcp`;
    return this.url_;
  }

  async stop(): Promise<void> {
    const srv = this.server;
    if (!srv) return;
    this.server = undefined;
    this.url_ = "";
    // Drop live sockets so close() can't hang on a client's keep-alive
    // connection and leave the extension host unable to release the port.
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    token: string
  ): Promise<void> {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/mcp") return send(res, 404, "Not found");
      if (req.method !== "POST") return send(res, 405, "Method not allowed");
      if (!trusted(req)) return send(res, 403, "Origin/host not allowed");
      if (!authorized(req.headers.authorization, token))
        return send(res, 401, "Unauthorized");

      const body = await readBody(req);
      if (!body.ok) return send(res, body.status, body.message);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.text);
      } catch {
        return send(res, 400, "Invalid JSON");
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = this.makeServer();
      // Cleanup on response end (and on early failure) — closing the transport
      // releases the Protocol so nothing stays pinned after the request.
      const cleanup = (): void => {
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      };
      res.on("close", cleanup);

      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (e: any) {
      send(res, 500, String(e?.message ?? e));
    }
  }
}
