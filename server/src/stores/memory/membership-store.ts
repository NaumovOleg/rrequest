import { randomUUID } from "node:crypto";
import type { MembershipStore, Membership, Role } from "../types.js";

export class MemoryMembershipStore implements MembershipStore {
  private byId = new Map<string, Membership>();

  async add(m: Omit<Membership, "id">): Promise<Membership> {
    const id = randomUUID();
    const membership: Membership = { id, ...m };
    this.byId.set(id, membership);
    return membership;
  }

  async getById(id: string): Promise<Membership | undefined> {
    return this.byId.get(id);
  }

  async listByWorkspace(workspaceId: string): Promise<Membership[]> {
    return [...this.byId.values()].filter((m) => m.workspaceId === workspaceId);
  }

  async listByUser(userId: string): Promise<Membership[]> {
    return [...this.byId.values()].filter((m) => m.userId === userId);
  }

  async roleForUser(workspaceId: string, userId: string): Promise<Role | undefined> {
    return [...this.byId.values()].find((m) => m.workspaceId === workspaceId && m.userId === userId)?.role;
  }

  async findByWorkspaceEmail(workspaceId: string, email: string): Promise<Membership | undefined> {
    return [...this.byId.values()].find((m) => m.workspaceId === workspaceId && m.pendingEmail === email);
  }

  async findByWorkspaceUser(workspaceId: string, userId: string): Promise<Membership | undefined> {
    return [...this.byId.values()].find((m) => m.workspaceId === workspaceId && m.userId === userId);
  }

  async update(id: string, patch: { role?: Role; permissionId?: string }): Promise<void> {
    const cur = this.byId.get(id);
    if (!cur) return;
    this.byId.set(id, {
      ...cur,
      role: patch.role ?? cur.role,
      permissionId: patch.permissionId ?? cur.permissionId,
    });
  }

  async resolvePending(email: string, userId: string): Promise<number> {
    let count = 0;
    for (const [id, m] of this.byId) {
      if (m.pendingEmail === email) {
        this.byId.set(id, { ...m, userId, pendingEmail: undefined });
        count++;
      }
    }
    return count;
  }

  async remove(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
