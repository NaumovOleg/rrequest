import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./jwt.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { Realtime, ChangeMsg } from "./realtime.js";

export function subscriptionsFor(userId: string, workspaces: WorkspaceStore): string[] {
  return workspaces.listByOwner(userId).map((w) => w.id);
}

let seq = 0;

export function handleWsConnection(
  socket: { close(code?: number, reason?: string): void; on(ev: string, cb: (...a: any[]) => void): void; send?(data: string): void },
  reqUrl: string | undefined,
  deps: { jwtSecret: string; workspaces: WorkspaceStore; realtime: Realtime },
): void {
  const url = new URL(reqUrl ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const session = verifySession(token, deps.jwtSecret);
  if (!session) { socket.close(4001, "unauthorized"); return; }
  const connId = `c${++seq}`;
  const off = deps.realtime.register(connId, session.userId, subscriptionsFor(session.userId, deps.workspaces), (m: ChangeMsg) => {
    try { socket.send?.(JSON.stringify(m)); } catch { /* socket closing */ }
  });
  socket.on("close", off);
  socket.on("error", off);
}

export function attachWsServer(opts: { server: Server; jwtSecret: string; workspaces: WorkspaceStore; realtime: Realtime }): void {
  const wss = new WebSocketServer({ server: opts.server, path: "/ws" });
  wss.on("connection", (socket: WebSocket, req) => {
    handleWsConnection(socket as any, req.url, { jwtSecret: opts.jwtSecret, workspaces: opts.workspaces, realtime: opts.realtime });
  });
}
