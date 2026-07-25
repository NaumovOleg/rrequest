import type { User, Role } from "../stores/types.js";
import { DriveAuthError } from "../domain/drive-factory.js";
import { resolveRole, ownerDriveFor, type AuthzDeps } from "./authz.js";

export type MemberDto = { id?: string; email: string; role: Role | "owner"; pending: boolean };

export type ListResult = { members: MemberDto[] } | { status: 403 | 404 };
export type AddResult = { member: MemberDto } | { status: 400 | 401 | 403 | 404 };
export type RemoveResult = { ok: true } | { status: 401 | 403 | 404 };

const DRIVE_ROLE: Record<Role, "writer" | "reader"> = { editor: "writer", viewer: "reader" };

export class MemberService {
  constructor(private deps: AuthzDeps) {}

  async list(user: User, id: string): Promise<ListResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    if (!(await resolveRole(this.deps, id, user.id))) return { status: 403 };
    const owner = await this.deps.users.getById(ws.ownerUserId);
    const memberships = await this.deps.memberships.listByWorkspace(id);
    const rows: MemberDto[] = [];
    for (const m of memberships) {
      const email = m.userId ? ((await this.deps.users.getById(m.userId))?.email ?? "") : (m.pendingEmail ?? "");
      rows.push({ id: m.id, email, role: m.role, pending: !m.userId });
    }
    return { members: [{ email: owner?.email ?? "", role: "owner", pending: false }, ...rows] };
  }

  async add(user: User, id: string, input: { email: string; role: Role }): Promise<AddResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    if ((await resolveRole(this.deps, id, user.id)) !== "owner") return { status: 403 };
    const { email, role } = input;
    if (!email || (role !== "editor" && role !== "viewer")) return { status: 400 };
    const drive = await ownerDriveFor(this.deps, ws);
    if (!drive) return { status: 404 };
    const account = await this.deps.users.getByEmail(email);
    const driveRole = DRIVE_ROLE[role];
    const existing =
      (account ? await this.deps.memberships.findByWorkspaceUser(id, account.id) : undefined) ??
      (await this.deps.memberships.findByWorkspaceEmail(id, email));
    try {
      if (existing) {
        try {
          await drive.deletePermission(ws.driveFileId, existing.permissionId);
        } catch (e) {
          if (e instanceof DriveAuthError) throw e;
          // best-effort otherwise
        }
        const { permissionId } = await drive.createPermission(ws.driveFileId, {
          email,
          role: driveRole,
          sendNotificationEmail: false,
        });
        await this.deps.memberships.update(existing.id, { role, permissionId });
        return { member: { id: existing.id, email, role, pending: !existing.userId } };
      }
      const { permissionId } = await drive.createPermission(ws.driveFileId, {
        email,
        role: driveRole,
        sendNotificationEmail: true,
      });
      const m = await this.deps.memberships.add(
        account
          ? { workspaceId: id, userId: account.id, role, permissionId }
          : { workspaceId: id, pendingEmail: email, role, permissionId },
      );
      return { member: { id: m.id, email, role, pending: !account } };
    } catch (e) {
      if (e instanceof DriveAuthError) return { status: 401 };
      throw e;
    }
  }

  async remove(user: User, id: string, memberId: string): Promise<RemoveResult> {
    const ws = await this.deps.workspaces.get(id);
    if (!ws) return { status: 404 };
    if ((await resolveRole(this.deps, id, user.id)) !== "owner") return { status: 403 };
    const m = await this.deps.memberships.getById(memberId);
    if (!m || m.workspaceId !== id) return { status: 404 };
    const drive = await ownerDriveFor(this.deps, ws);
    if (drive) {
      try {
        await drive.deletePermission(ws.driveFileId, m.permissionId);
      } catch (e) {
        if (e instanceof DriveAuthError) return { status: 401 };
        // best-effort otherwise
      }
    }
    await this.deps.memberships.remove(memberId);
    return { ok: true };
  }
}
