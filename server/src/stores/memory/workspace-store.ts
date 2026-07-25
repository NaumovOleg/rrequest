import type { WorkspaceStore, SyncedWorkspace } from "../types.js";

export class MemoryWorkspaceStore implements WorkspaceStore {
  private byId = new Map<string, SyncedWorkspace>();

  async upsert(w: SyncedWorkspace): Promise<SyncedWorkspace> {
    this.byId.set(w.id, { ...w });
    return w;
  }

  async get(id: string): Promise<SyncedWorkspace | undefined> {
    const w = this.byId.get(id);
    return w ? { ...w } : undefined;
  }

  async listByOwner(ownerUserId: string): Promise<SyncedWorkspace[]> {
    return [...this.byId.values()].filter((w) => w.ownerUserId === ownerUserId).map((w) => ({ ...w }));
  }

  async setRevision(id: string, revision: string, updatedAt: number): Promise<void> {
    const w = this.byId.get(id);
    if (!w) return;
    this.byId.set(id, { ...w, revision, updatedAt });
  }

  async allIds(): Promise<string[]> {
    return [...this.byId.keys()];
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
