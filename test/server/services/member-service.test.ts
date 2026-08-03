import { describe, it, expect } from "vitest";
import { MemberService } from "../../../server/src/services/member-service.js";
import { WorkspaceService } from "../../../server/src/services/workspace-service.js";
import { MemoryWorkspaceStore } from "../../../server/src/stores/memory/workspace-store.js";
import { MemoryUserStore } from "../../../server/src/stores/memory/user-store.js";
import { MemoryMembershipStore } from "../../../server/src/stores/memory/membership-store.js";
import { FakeDriveClient } from "../../../server/src/domain/drive-client.js";
import type { User } from "../../../server/src/stores/types.js";

function makeService() {
  const workspaces = new MemoryWorkspaceStore();
  const users = new MemoryUserStore();
  const memberships = new MemoryMembershipStore();
  const drive = new FakeDriveClient();
  const driveFor = () => drive;
  const workspaceService = new WorkspaceService({ workspaces, memberships, users, driveFor });
  const memberService = new MemberService({ workspaces, memberships, users, driveFor });
  return { memberService, workspaceService, workspaces, users, memberships, drive };
}

async function makeUser(users: MemoryUserStore, email: string): Promise<User> {
  return users.upsertByGoogle({ googleSub: `sub-${email}`, email, refreshToken: `rt-${email}` });
}

describe("MemberService.add", () => {
  it("404s for an unknown workspace", async () => {
    const { memberService, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const result = await memberService.add(owner, "missing", { email: "a@x.com", role: "editor" });
    expect(result).toEqual({ status: 404 });
  });

  it("403s for a non-owner", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const editor = await makeUser(users, "editor@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "p0" });
    const result = await memberService.add(editor, "w1", { email: "c@x.com", role: "viewer" });
    expect(result).toEqual({ status: 403 });
  });

  it("400s for an invalid role", async () => {
    const { memberService, workspaceService, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const result = await memberService.add(owner, "w1", { email: "a@x.com", role: "owner" as never });
    expect(result).toEqual({ status: 400 });
  });

  it("adds a member with an existing account as editor -> Drive writer role, resolved (non-pending)", async () => {
    const { memberService, workspaceService, users, drive, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const bob = await makeUser(users, "bob@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const result = await memberService.add(owner, "w1", { email: "bob@x.com", role: "editor" });
    expect("status" in result).toBe(false);
    const ok = result as { member: { id: string; email: string; role: string; pending: boolean } };
    expect(ok.member.email).toBe("bob@x.com");
    expect(ok.member.role).toBe("editor");
    expect(ok.member.pending).toBe(false);
    const ws = await workspaces.get("w1");
    const perms = drive.permissions(ws!.driveFileId);
    expect(perms).toHaveLength(1);
    expect(perms[0].role).toBe("writer");
    expect(perms[0].email).toBe("bob@x.com");
    void bob;
  });

  it("adds a member with no account yet as viewer -> Drive reader role, pending", async () => {
    const { memberService, workspaceService, users, drive, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const result = await memberService.add(owner, "w1", { email: "unknown@x.com", role: "viewer" });
    expect("status" in result).toBe(false);
    const ok = result as { member: { id: string; email: string; role: string; pending: boolean } };
    expect(ok.member.email).toBe("unknown@x.com");
    expect(ok.member.role).toBe("viewer");
    expect(ok.member.pending).toBe(true);
    const ws = await workspaces.get("w1");
    const perms = drive.permissions(ws!.driveFileId);
    expect(perms).toHaveLength(1);
    expect(perms[0].role).toBe("reader");
  });

  it("re-invites the same email with a different role: single row, role updated, single permission", async () => {
    const { memberService, workspaceService, users, drive, workspaces, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const first = await memberService.add(owner, "w1", { email: "bob@x.com", role: "viewer" });
    const firstOk = first as { member: { id: string } };
    const second = await memberService.add(owner, "w1", { email: "bob@x.com", role: "editor" });
    const secondOk = second as { member: { id: string; email: string; role: string; pending: boolean } };
    expect(secondOk.member.id).toBe(firstOk.member.id);
    expect(secondOk.member.role).toBe("editor");
    const rows = await memberships.listByWorkspace("w1");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("editor");
    const ws = await workspaces.get("w1");
    const perms = drive.permissions(ws!.driveFileId);
    expect(perms).toHaveLength(1);
    expect(perms[0].role).toBe("writer");
  });

  it("re-invites resolving an existing account by pending email dedupe", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberService.add(owner, "w1", { email: "later@x.com", role: "viewer" });
    // account created after the pending invite
    const later = await makeUser(users, "later@x.com");
    const result = await memberService.add(owner, "w1", { email: "later@x.com", role: "editor" });
    const ok = result as { member: { id: string; role: string; pending: boolean } };
    expect(ok.member.role).toBe("editor");
    expect(ok.member.pending).toBe(true); // dedupe finds by email first since findByWorkspaceUser is not matched w/ the now-existing account row (still pendingEmail based)
    const rows = await memberships.listByWorkspace("w1");
    expect(rows).toHaveLength(1);
    void later;
  });
});

describe("MemberService.list", () => {
  it("404s for an unknown workspace", async () => {
    const { memberService, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    expect(await memberService.list(owner, "missing")).toEqual({ status: 404 });
  });

  it("403s for a non-member", async () => {
    const { memberService, workspaceService, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const stranger = await makeUser(users, "stranger@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    expect(await memberService.list(stranger, "w1")).toEqual({ status: 403 });
  });

  it("lists the owner first, then membership rows with email/role/pending", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const editor = await makeUser(users, "editor@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "p1" });
    await memberships.add({ workspaceId: "w1", pendingEmail: "pending@x.com", role: "viewer", permissionId: "p2" });
    const result = await memberService.list(owner, "w1");
    expect("status" in result).toBe(false);
    const ok = result as { members: Array<{ id?: string; email: string; role: string; pending: boolean }> };
    expect(ok.members[0]).toEqual({ email: "owner@x.com", role: "owner", pending: false });
    expect(ok.members).toHaveLength(3);
    const byEmail = Object.fromEntries(ok.members.map((m) => [m.email, m]));
    expect(byEmail["editor@x.com"]).toMatchObject({ role: "editor", pending: false });
    expect(byEmail["pending@x.com"]).toMatchObject({ role: "viewer", pending: true });
  });

  it("allows a member (non-owner) to list", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const viewer = await makeUser(users, "viewer@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p1" });
    const result = await memberService.list(viewer, "w1");
    expect("status" in result).toBe(false);
  });
});

describe("MemberService.remove", () => {
  it("404s for an unknown workspace", async () => {
    const { memberService, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    expect(await memberService.remove(owner, "missing", "m1")).toEqual({ status: 404 });
  });

  it("403s for a non-owner", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const editor = await makeUser(users, "editor@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const m = await memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "p1" });
    const result = await memberService.remove(editor, "w1", m.id);
    expect(result).toEqual({ status: 403 });
  });

  it("404s when the membership belongs to a different workspace (cross-workspace guard)", async () => {
    const { memberService, workspaceService, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS1", snapshot: "{}" });
    await workspaceService.enable(owner, { workspaceId: "w2", name: "WS2", snapshot: "{}" });
    const m = await memberships.add({ workspaceId: "w2", pendingEmail: "x@x.com", role: "viewer", permissionId: "p1" });
    const result = await memberService.remove(owner, "w1", m.id);
    expect(result).toEqual({ status: 404 });
  });

  it("owner removes a member: row and permission are gone", async () => {
    const { memberService, workspaceService, users, drive, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await workspaceService.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const added = await memberService.add(owner, "w1", { email: "bob@x.com", role: "editor" });
    const addedOk = added as { member: { id: string } };
    const ws = await workspaces.get("w1");
    expect(drive.permissions(ws!.driveFileId)).toHaveLength(1);
    const result = await memberService.remove(owner, "w1", addedOk.member.id);
    expect(result).toEqual({ ok: true });
    expect(drive.permissions(ws!.driveFileId)).toHaveLength(0);
    const listed = await memberService.list(owner, "w1");
    const ok = listed as { members: Array<{ email: string }> };
    expect(ok.members).toHaveLength(1); // owner only
  });
});
