import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type Role = "editor" | "viewer";
export type Membership = { id: string; workspaceId: string; userId?: string; pendingEmail?: string; role: Role; permissionId: string };

type Row = { id: string; workspace_id: string; user_id: string | null; pending_email: string | null; role: Role; permission_id: string };
const toM = (r: Row): Membership => ({
  id: r.id, workspaceId: r.workspace_id, userId: r.user_id ?? undefined,
  pendingEmail: r.pending_email ?? undefined, role: r.role, permissionId: r.permission_id,
});

export class MembershipStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      pending_email TEXT,
      role TEXT NOT NULL,
      permission_id TEXT NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_membership_ws ON memberships(workspace_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_membership_user ON memberships(user_id)`);
  }

  add(m: Omit<Membership, "id">): Membership {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO memberships (id, workspace_id, user_id, pending_email, role, permission_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, m.workspaceId, m.userId ?? null, m.pendingEmail ?? null, m.role, m.permissionId);
    return { id, ...m };
  }
  getById(id: string): Membership | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE id = ?").get(id) as Row | undefined;
    return r ? toM(r) : undefined;
  }
  listByWorkspace(workspaceId: string): Membership[] {
    return (this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ?").all(workspaceId) as Row[]).map(toM);
  }
  listByUser(userId: string): Membership[] {
    return (this.db.prepare("SELECT * FROM memberships WHERE user_id = ?").all(userId) as Row[]).map(toM);
  }
  roleForUser(workspaceId: string, userId: string): Role | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
    return r?.role;
  }
  findByWorkspaceEmail(workspaceId: string, email: string): Membership | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ? AND pending_email = ?").get(workspaceId, email) as Row | undefined;
    return r ? toM(r) : undefined;
  }
  findByWorkspaceUser(workspaceId: string, userId: string): Membership | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
    return r ? toM(r) : undefined;
  }
  update(id: string, patch: { role?: Role; permissionId?: string }): void {
    const cur = this.getById(id);
    if (!cur) return;
    const role = patch.role ?? cur.role;
    const permissionId = patch.permissionId ?? cur.permissionId;
    this.db.prepare("UPDATE memberships SET role = ?, permission_id = ? WHERE id = ?").run(role, permissionId, id);
  }
  resolvePending(email: string, userId: string): number {
    const info = this.db.prepare("UPDATE memberships SET user_id = ?, pending_email = NULL WHERE pending_email = ?").run(userId, email);
    return info.changes;
  }
  remove(id: string): void {
    this.db.prepare("DELETE FROM memberships WHERE id = ?").run(id);
  }
}
