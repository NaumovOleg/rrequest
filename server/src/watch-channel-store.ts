import Database from "better-sqlite3";

export type WatchChannel = { workspaceId: string; channelId: string; resourceId: string; token: string; expiration: number };

type Row = { workspace_id: string; channel_id: string; resource_id: string; token: string; expiration: number };
const toCh = (r: Row): WatchChannel => ({ workspaceId: r.workspace_id, channelId: r.channel_id, resourceId: r.resource_id, token: r.token, expiration: r.expiration });

export class WatchChannelStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS watch_channels (
      workspace_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expiration INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_watch_channel_id ON watch_channels(channel_id)`);
  }

  upsert(c: WatchChannel): void {
    this.db.prepare(`INSERT INTO watch_channels (workspace_id, channel_id, resource_id, token, expiration)
      VALUES (@workspaceId, @channelId, @resourceId, @token, @expiration)
      ON CONFLICT(workspace_id) DO UPDATE SET
        channel_id=excluded.channel_id, resource_id=excluded.resource_id, token=excluded.token, expiration=excluded.expiration`).run(c);
  }
  getByChannelId(channelId: string): WatchChannel | undefined {
    const r = this.db.prepare("SELECT * FROM watch_channels WHERE channel_id = ?").get(channelId) as Row | undefined;
    return r ? toCh(r) : undefined;
  }
  getByWorkspaceId(workspaceId: string): WatchChannel | undefined {
    const r = this.db.prepare("SELECT * FROM watch_channels WHERE workspace_id = ?").get(workspaceId) as Row | undefined;
    return r ? toCh(r) : undefined;
  }
  all(): WatchChannel[] {
    return (this.db.prepare("SELECT * FROM watch_channels").all() as Row[]).map(toCh);
  }
  delete(workspaceId: string): void {
    this.db.prepare("DELETE FROM watch_channels WHERE workspace_id = ?").run(workspaceId);
  }
}
