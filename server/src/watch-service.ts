import type { UserStore } from "./user-store.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { WatchChannelStore } from "./watch-channel-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { Realtime } from "./realtime.js";

export type WatchDeps = {
  // NOTE: Config does not yet have `publicWebhookUrl` (added in a later task).
  // Using an inline structural type here (instead of `Pick<Config, "publicWebhookUrl">`)
  // keeps this compiling now and remains compatible once Config gains the field.
  config: { publicWebhookUrl?: string };
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
}
