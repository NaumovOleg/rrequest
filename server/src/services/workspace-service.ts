import type { WorkspaceStore, MembershipStore, UserStore, User, SyncedWorkspace } from "../stores/types.js";
import type { DriveClient } from "../domain/drive-client.js";
import { folderNameForUser, DriveAuthError } from "../domain/drive-factory.js";
import { stripSnapshotSecrets } from "../domain/snapshot.js";
import { resolveRole, ownerDriveFor, type WorkspaceRole } from "./authz.js";

export type WorkspaceServiceDeps = {
  workspaces: WorkspaceStore;
  memberships: MembershipStore;
  users: UserStore;
  driveFor: (user: User) => DriveClient;
};

export type EnableResult = { driveFileId: string; revision: string } | { status: 401 | 403 };
export type PullResult =
  | { snapshot: string; revision: string; role: WorkspaceRole }
  | { status: 401 | 403 | 404 | 500 };
export type PushResult =
  | { revision: string }
  | { status: 400 | 401 | 403 | 404 }
  | { status: 409; body: { snapshot: string; revision: string } }
  | { status: 500 };
export type DeleteSyncResult = { ok: true } | { status: 403 | 404 };
export type RecoverResult = { recovered: string[]; total: number } | { status: 401 };

/** The `name` field of a snapshot JSON string, or undefined if unparseable. */
function snapshotName(snapshot: string): string | undefined {
  try {
    const v = JSON.parse(snapshot) as { name?: unknown };
    return typeof v.name === "string" ? v.name : undefined;
  } catch {
    return undefined;
  }
}

export class WorkspaceService {
  constructor(private deps: WorkspaceServiceDeps) {}

  async list(user: User): Promise<Array<SyncedWorkspace & { role: WorkspaceRole }>> {
    const owned = (await this.deps.workspaces.listByOwner(user.id)).map((w) => ({ ...w, role: "owner" as const }));
    const ownedIds = new Set(owned.map((w) => w.id));
    const memberships = await this.deps.memberships.listByUser(user.id);
    const shared: Array<SyncedWorkspace & { role: WorkspaceRole }> = [];
    for (const m of memberships) {
      if (ownedIds.has(m.workspaceId)) continue;
      const w = await this.deps.workspaces.get(m.workspaceId);
      if (w) shared.push({ ...w, role: m.role });
    }
    return [...owned, ...shared];
  }

  async enable(
    user: User,
    input: { workspaceId: string; name: string; snapshot: string },
  ): Promise<EnableResult> {
    const { workspaceId, name, snapshot } = input;
    const existing = await this.deps.workspaces.get(workspaceId);
    if (existing && existing.ownerUserId !== user.id) return { status: 403 };
    const clean = stripSnapshotSecrets(snapshot);
    const drive = this.deps.driveFor(user);
    let fileId: string;
    let hashFolderId: string;
    let revision: string;
    try {
      if (existing) {
        const updated = await drive.updateFile(existing.driveFileId, clean);
        fileId = existing.driveFileId;
        hashFolderId = existing.hashFolderId;
        revision = updated.revision;
      } else {
        hashFolderId = await drive.ensureFolder(folderNameForUser(user.id));
        const created = await drive.createFile(hashFolderId, `${name}-${workspaceId}.json`, clean);
        fileId = created.fileId;
        revision = created.revision;
      }
    } catch (e) {
      if (e instanceof DriveAuthError) return { status: 401 };
      throw e;
    }
    await this.deps.workspaces.upsert({
      id: workspaceId,
      name,
      ownerUserId: user.id,
      driveFileId: fileId,
      hashFolderId,
      revision,
      updatedAt: Date.now(),
    });
    return { driveFileId: fileId, revision };
  }

  async pull(user: User, id: string): Promise<PullResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    const role = await resolveRole(this.deps, id, user.id);
    if (!role) return { status: 403 };
    const drive = await ownerDriveFor(this.deps, ws);
    if (!drive) return { status: 500 };
    try {
      const snapshot = await drive.readFile(ws.driveFileId);
      return { snapshot, revision: ws.revision, role };
    } catch (e) {
      if (e instanceof DriveAuthError) return { status: 401 };
      throw e;
    }
  }

  async push(
    user: User,
    id: string,
    input: { snapshot?: string; baseRevision?: string },
  ): Promise<PushResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    const role = await resolveRole(this.deps, id, user.id);
    if (role !== "owner" && role !== "editor") return { status: 403 };
    const { snapshot, baseRevision } = input;
    if (typeof snapshot !== "string" || typeof baseRevision !== "string") return { status: 400 };
    const drive = await ownerDriveFor(this.deps, ws);
    if (!drive) return { status: 500 };
    const clean = stripSnapshotSecrets(snapshot);
    let revision: string;
    try {
      if (baseRevision !== ws.revision) {
        const current = await drive.readFile(ws.driveFileId);
        return { status: 409, body: { snapshot: current, revision: ws.revision } };
      }
      ({ revision } = await drive.updateFile(ws.driveFileId, clean));
    } catch (e) {
      if (e instanceof DriveAuthError) return { status: 401 };
      throw e;
    }
    // Keep the workspace row's name in step with the snapshot (a rename only
    // changes the name inside the pushed file; without this the DynamoDB row —
    // and therefore listWorkspaces — keeps the stale name).
    const name = snapshotName(clean) ?? ws.name;
    await this.deps.workspaces.upsert({ ...ws, name, revision, updatedAt: Date.now() });
    return { revision };
  }

  // Rebuild the workspace index from Drive: scan the caller's own sync folder
  // for workspace files whose DynamoDB row is missing (the desync that happens
  // when the tables are cleared/recreated but the Drive files survive) and
  // recreate the rows. Only ADDS rows for the caller's own, un-indexed files —
  // never touches an existing row or another user's workspace.
  async recover(user: User): Promise<RecoverResult> {
    const drive = this.deps.driveFor(user);
    let hashFolderId: string;
    let files: Awaited<ReturnType<DriveClient["listFiles"]>>;
    try {
      hashFolderId = await drive.ensureFolder(folderNameForUser(user.id));
      files = await drive.listFiles(hashFolderId);
    } catch (e) {
      if (e instanceof DriveAuthError) return { status: 401 };
      throw e;
    }
    const recovered: string[] = [];
    for (const f of files) {
      if (!f.name.endsWith(".json")) continue;
      let parsed: { workspaceId?: unknown; name?: unknown };
      try {
        parsed = JSON.parse(await drive.readFile(f.id)) as { workspaceId?: unknown; name?: unknown };
      } catch {
        continue; // unreadable / not JSON — skip
      }
      const wsId = typeof parsed.workspaceId === "string" ? parsed.workspaceId : undefined;
      if (!wsId) continue;
      if (await this.deps.workspaces.get(wsId)) continue; // already indexed — leave it
      await this.deps.workspaces.upsert({
        id: wsId,
        name: typeof parsed.name === "string" ? parsed.name : wsId,
        ownerUserId: user.id,
        driveFileId: f.id,
        hashFolderId,
        revision: f.headRevision || "1",
        updatedAt: Date.now(),
      });
      recovered.push(wsId);
    }
    return { recovered, total: files.length };
  }

  async deleteSync(user: User, id: string): Promise<DeleteSyncResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    const role = await resolveRole(this.deps, id, user.id);
    if (role !== "owner") return { status: 403 };
    const drive = await ownerDriveFor(this.deps, ws);
    if (drive) {
      try {
        await drive.trashFile(ws.driveFileId);
      } catch {
        // Best-effort: proceed with cleanup even if the Drive trash fails
        // (e.g. auth revoked, file already gone). Members must still lose
        // their sync rows and the row must still be reclaimed.
      }
    }
    const memberships = await this.deps.memberships.listByWorkspace(id);
    for (const m of memberships) {
      await this.deps.memberships.remove(m.id);
    }
    await this.deps.workspaces.delete(id);
    return { ok: true };
  }
}
