import Database from "better-sqlite3";

export type SyncedWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
  driveFileId: string;
  hashFolderId: string;
  revision: string;
  updatedAt: number;
};

type Row = {
  id: string; name: string; owner_user_id: string; drive_file_id: string;
  hash_folder_id: string; revision: string; updated_at: number;
};

const toWorkspace = (r: Row): SyncedWorkspace => ({
  id: r.id, name: r.name, ownerUserId: r.owner_user_id, driveFileId: r.drive_file_id,
  hashFolderId: r.hash_folder_id, revision: r.revision, updatedAt: r.updated_at,
});

export class WorkspaceStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      hash_folder_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  upsert(w: SyncedWorkspace): SyncedWorkspace {
    this.db.prepare(`INSERT INTO workspaces (id, name, owner_user_id, drive_file_id, hash_folder_id, revision, updated_at)
      VALUES (@id, @name, @ownerUserId, @driveFileId, @hashFolderId, @revision, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, owner_user_id=excluded.owner_user_id, drive_file_id=excluded.drive_file_id,
        hash_folder_id=excluded.hash_folder_id, revision=excluded.revision, updated_at=excluded.updated_at`).run(w);
    return w;
  }

  get(id: string): SyncedWorkspace | undefined {
    const r = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Row | undefined;
    return r ? toWorkspace(r) : undefined;
  }

  listByOwner(ownerUserId: string): SyncedWorkspace[] {
    const rows = this.db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").all(ownerUserId) as Row[];
    return rows.map(toWorkspace);
  }

  setRevision(id: string, revision: string, updatedAt: number): void {
    this.db.prepare("UPDATE workspaces SET revision = ?, updated_at = ? WHERE id = ?").run(revision, updatedAt, id);
  }
}
