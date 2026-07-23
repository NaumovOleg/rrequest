import type { WorkspaceStore } from "../workspace-store.js";
import type { UserStore } from "../user-store.js";
import type { MembershipStore } from "../membership-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { DriveClient } from "./drive-client.js";

export type AuthzDeps = { workspaces: WorkspaceStore; users: UserStore; memberships: MembershipStore; driveFor: DriveFactory };
export type WorkspaceRole = "owner" | "editor" | "viewer";

export function resolveRole(deps: AuthzDeps, workspaceId: string, userId: string): WorkspaceRole | null {
  const ws = deps.workspaces.get(workspaceId);
  if (!ws) return null;
  if (ws.ownerUserId === userId) return "owner";
  return deps.memberships.roleForUser(workspaceId, userId) ?? null;
}

export function ownerDriveFor(deps: AuthzDeps, ws: { ownerUserId: string }): DriveClient | undefined {
  const owner = deps.users.getById(ws.ownerUserId);
  return owner ? deps.driveFor(owner) : undefined;
}
