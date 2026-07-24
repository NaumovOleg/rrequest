import type { WorkspaceStore, UserStore, User } from "../stores/types.js";
import type { DriveClient } from "../domain/drive-client.js";

export type PollServiceDeps = {
  workspaces: WorkspaceStore;
  users: UserStore;
  driveFor: (user: User) => DriveClient;
};

// Outside-edit detector: no realtime push. A scheduled poll (EventBridge)
// re-reads each workspace's Drive head revision and bumps the stored
// revision when it has moved -- clients discover the change on their own
// next poll (SyncClient.listWorkspaces).
export class PollService {
  constructor(private deps: PollServiceDeps) {}

  async pollAll(): Promise<number> {
    let bumped = 0;
    const ids = await this.deps.workspaces.allIds();
    for (const id of ids) {
      try {
        const ws = await this.deps.workspaces.get(id);
        if (!ws) continue;
        const owner = await this.deps.users.getById(ws.ownerUserId);
        if (!owner) continue;
        const drive = this.deps.driveFor(owner);
        const head = await drive.getHeadRevision(ws.driveFileId);
        if (head !== ws.revision) {
          await this.deps.workspaces.setRevision(id, head, Date.now());
          bumped++;
        }
      } catch {
        // One bad workspace (missing Drive file, transient API error, ...)
        // must not abort the sweep over the rest.
      }
    }
    return bumped;
  }
}
