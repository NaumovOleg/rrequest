import type { WorkspaceStore, MembershipStore, UserStore, User } from "../stores/types.js";
import type { DriveClient } from "../domain/drive-client.js";

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type AuthzDeps = {
  workspaces: WorkspaceStore;
  users: UserStore;
  memberships: MembershipStore;
  driveFor: (user: User) => DriveClient;
};

export async function resolveRole(
  deps: AuthzDeps,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const ws = await deps.workspaces.get(workspaceId);
  if (!ws) return null;
  if (ws.ownerUserId === userId) return "owner";
  return (await deps.memberships.roleForUser(workspaceId, userId)) ?? null;
}

export async function ownerDriveFor(
  deps: AuthzDeps,
  ws: { ownerUserId: string },
): Promise<DriveClient | undefined> {
  const owner = await deps.users.getById(ws.ownerUserId);
  return owner ? deps.driveFor(owner) : undefined;
}
