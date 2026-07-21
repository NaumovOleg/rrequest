import { randomUUID } from "node:crypto";
import type { UserStore } from "./user-store.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { WatchChannelStore } from "./watch-channel-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { Realtime } from "./realtime.js";

export type WatchDeps = {
  // NOTE: Config does not yet have `publicWebhookUrl` / `channelTtlSeconds`
  // (added in a later task). Using an inline structural type here (instead of
  // `Pick<Config, "publicWebhookUrl" | "channelTtlSeconds">`) keeps this
  // compiling now and remains compatible once Config gains the fields.
  config: { publicWebhookUrl?: string; channelTtlSeconds?: number };
  users: UserStore;
  workspaces: WorkspaceStore;
  watch: WatchChannelStore;
  driveFor: DriveFactory;
  realtime: Realtime;
  now?: () => number;
};

const CHANGE_STATES = new Set(["update", "change", "exists"]);

export class WatchService {
  private now: () => number;
  constructor(private deps: WatchDeps) {
    this.now = deps.now ?? Date.now;
  }

  private driveForOwner(ownerUserId: string) {
    const owner = this.deps.users.getById(ownerUserId);
    return owner ? this.deps.driveFor(owner) : undefined;
  }

  async detectAndBroadcast(workspaceId: string): Promise<"broadcast" | "echo" | "unknown"> {
    const ws = this.deps.workspaces.get(workspaceId);
    if (!ws) return "unknown";
    const drive = this.driveForOwner(ws.ownerUserId);
    if (!drive) return "unknown";
    const head = await drive.getHeadRevision(ws.driveFileId);
    if (head === ws.revision) return "echo";
    this.deps.workspaces.setRevision(workspaceId, head, this.now());
    this.deps.realtime.broadcast(workspaceId, { type: "workspace-changed", workspaceId, revision: head, updatedBy: "drive" });
    return "broadcast";
  }

  async handleNotification(input: { channelId: string; token: string; resourceState: string }): Promise<"broadcast" | "echo" | "ignored" | "unauthorized" | "unknown"> {
    if (input.resourceState === "sync" || !CHANGE_STATES.has(input.resourceState)) return "ignored";
    const ch = this.deps.watch.getByChannelId(input.channelId);
    if (!ch) return "unknown";
    if (ch.token !== input.token) return "unauthorized";
    return this.detectAndBroadcast(ch.workspaceId);
  }

  async ensureWatch(workspaceId: string): Promise<void> {
    const address = this.deps.config.publicWebhookUrl;
    if (!address) return;
    const ws = this.deps.workspaces.get(workspaceId);
    if (!ws) return;
    const drive = this.driveForOwner(ws.ownerUserId);
    if (!drive) return;
    const existing = this.deps.watch.getByWorkspaceId(workspaceId);
    if (existing) {
      try { await drive.stopChannel({ channelId: existing.channelId, resourceId: existing.resourceId }); } catch { /* best-effort */ }
    }
    const channelId = randomUUID();
    const token = randomUUID();
    const info = await drive.watchFile(ws.driveFileId, {
      channelId, token, address: `${address.replace(/\/$/, "")}/webhook`, ttlSeconds: this.deps.config.channelTtlSeconds,
    });
    this.deps.watch.upsert({ workspaceId, channelId, resourceId: info.resourceId, token, expiration: info.expiration });
  }
}
