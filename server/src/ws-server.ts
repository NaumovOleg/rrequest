import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./jwt.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { Realtime, ChangeMsg } from "./realtime.js";

export function subscriptionsFor(userId: string, workspaces: WorkspaceStore): string[] {
  return workspaces.listByOwner(userId).map((w) => w.id);
}

let seq = 0;

export function attachWsServer(opts: { server: Server; jwtSecret: string; workspaces: WorkspaceStore; realtime: Realtime }): void {
  const wss = new WebSocketServer({ server: opts.server, path: "/ws" });
  wss.on("connection", (socket: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? "";
    const session = verifySession(token, opts.jwtSecret);
    if (!session) { socket.close(4001, "unauthorized"); return; }
    const connId = `c${++seq}`;
    const off = opts.realtime.register(connId, session.userId, subscriptionsFor(session.userId, opts.workspaces), (m: ChangeMsg) => {
      try { socket.send(JSON.stringify(m)); } catch { /* socket closing */ }
    });
    socket.on("close", off);
    socket.on("error", off);
  });
}
