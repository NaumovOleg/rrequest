import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./jwt.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { MembershipStore } from "./membership-store.js";
import type { Realtime, ChangeMsg } from "./realtime.js";

export function subscriptionsFor(userId: string, workspaces: WorkspaceStore, memberships: MembershipStore): string[] {
  const owned = workspaces.listByOwner(userId).map((w) => w.id);
  const shared = memberships.listByUser(userId).map((m) => m.workspaceId);
  return [...new Set([...owned, ...shared])];
}

let seq = 0;

export function handleWsConnection(
  socket: { close(code?: number, reason?: string): void; on(ev: string, cb: (...a: any[]) => void): void; send?(data: string): void },
  reqUrl: string | undefined,
  deps: { jwtSecret: string; workspaces: WorkspaceStore; memberships: MembershipStore; realtime: Realtime },
): void {
  const url = new URL(reqUrl ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const session = verifySession(token, deps.jwtSecret);
  if (!session) { socket.close(4001, "unauthorized"); return; }
  const connId = `c${++seq}`;
  const off = deps.realtime.register(connId, session.userId, subscriptionsFor(session.userId, deps.workspaces, deps.memberships), (m: ChangeMsg) => {
    try { socket.send?.(JSON.stringify(m)); } catch { /* socket closing */ }
  });
  socket.on("close", off);
  socket.on("error", off);
}

export function attachWsServer(opts: { server: Server; jwtSecret: string; workspaces: WorkspaceStore; memberships: MembershipStore; realtime: Realtime }): void {
  const wss = new WebSocketServer({ server: opts.server, path: "/ws" });
  wss.on("connection", (socket: WebSocket, req) => {
    handleWsConnection(socket as any, req.url, { jwtSecret: opts.jwtSecret, workspaces: opts.workspaces, memberships: opts.memberships, realtime: opts.realtime });
  });
}
