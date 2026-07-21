export type ChangeMsg = { type: "workspace-changed"; workspaceId: string; revision: string; updatedBy: string };

type Conn = { userId: string; workspaceIds: Set<string>; send: (m: ChangeMsg) => void };

export class Realtime {
  private conns = new Map<string, Conn>();

  register(connId: string, userId: string, workspaceIds: string[], send: (m: ChangeMsg) => void): () => void {
    this.conns.set(connId, { userId, workspaceIds: new Set(workspaceIds), send });
    return () => { this.conns.delete(connId); };
  }

  broadcast(workspaceId: string, msg: ChangeMsg, exceptConnId?: string): void {
    for (const [id, conn] of this.conns) {
      if (id === exceptConnId) continue;
      if (conn.workspaceIds.has(workspaceId)) conn.send(msg);
    }
  }
}
