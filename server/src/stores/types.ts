export type Role = "editor" | "viewer";

export type User = { id: string; email: string; googleSub: string; refreshToken: string };

export type SyncedWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
  driveFileId: string;
  hashFolderId: string;
  revision: string;
  updatedAt: number;
};

export type Membership = {
  id: string;
  workspaceId: string;
  userId?: string;
  pendingEmail?: string;
  role: Role;
  permissionId: string;
};

export interface UserStore {
  getById(id: string): Promise<User | undefined>;
  getByEmail(email: string): Promise<User | undefined>;
  upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): Promise<User>;
}

export interface WorkspaceStore {
  get(id: string): Promise<SyncedWorkspace | undefined>;
  listByOwner(ownerUserId: string): Promise<SyncedWorkspace[]>;
  upsert(w: SyncedWorkspace): Promise<SyncedWorkspace>;
  setRevision(id: string, revision: string, updatedAt: number): Promise<void>;
  allIds(): Promise<string[]>;
}

export interface MembershipStore {
  add(m: Omit<Membership, "id">): Promise<Membership>;
  getById(id: string): Promise<Membership | undefined>;
  listByWorkspace(workspaceId: string): Promise<Membership[]>;
  listByUser(userId: string): Promise<Membership[]>;
  roleForUser(workspaceId: string, userId: string): Promise<Role | undefined>;
  findByWorkspaceEmail(workspaceId: string, email: string): Promise<Membership | undefined>;
  findByWorkspaceUser(workspaceId: string, userId: string): Promise<Membership | undefined>;
  update(id: string, patch: { role?: Role; permissionId?: string }): Promise<void>;
  resolvePending(email: string, userId: string): Promise<number>;
  remove(id: string): Promise<void>;
}
