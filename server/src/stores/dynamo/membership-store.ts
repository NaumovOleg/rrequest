import { randomUUID } from "node:crypto";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { Membership, MembershipStore, Role } from "../types.js";

export type DynamoMembershipStoreConfig = {
  doc: DynamoDBDocumentClient;
  table: string;
};

type MembershipItem = {
  membershipId: string;
  workspaceId: string;
  userId?: string;
  pendingEmail?: string;
  role: Role;
  permissionId: string;
};

/**
 * DynamoDB-backed MembershipStore. Table `Memberships`: PK `membershipId`,
 * GSI `gsi_ws` (PK `workspaceId`), GSI `gsi_user` (PK `userId`), GSI
 * `gsi_pendingEmail` (PK `pendingEmail`). A membership is either resolved
 * (has `userId`, no `pendingEmail`) or pending (has `pendingEmail`, no
 * `userId`) — DynamoDB rejects `undefined` attribute values, so whichever
 * of the two is absent is simply omitted from the item rather than written
 * as null/undefined. That also means a GSI only "sees" items that carry its
 * key attribute: a resolved membership won't show up in gsi_pendingEmail,
 * and a pending one won't show up in gsi_user — which is the desired
 * behavior (pending invites are invisible to roleForUser etc. until
 * resolved).
 */
export class DynamoMembershipStore implements MembershipStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(cfg: DynamoMembershipStoreConfig) {
    this.doc = cfg.doc;
    this.table = cfg.table;
  }

  async add(m: Omit<Membership, "id">): Promise<Membership> {
    const id = randomUUID();
    const item: MembershipItem = {
      membershipId: id,
      workspaceId: m.workspaceId,
      role: m.role,
      permissionId: m.permissionId,
      ...(m.userId !== undefined ? { userId: m.userId } : {}),
      ...(m.pendingEmail !== undefined ? { pendingEmail: m.pendingEmail } : {}),
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
    return this.toMembership(item);
  }

  async getById(id: string): Promise<Membership | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { membershipId: id } }));
    return res.Item ? this.toMembership(res.Item as MembershipItem) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Membership[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_ws",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":workspaceId": workspaceId },
      }),
    );
    return (res.Items as MembershipItem[] | undefined ?? []).map((i) => this.toMembership(i));
  }

  async listByUser(userId: string): Promise<Membership[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_user",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      }),
    );
    return (res.Items as MembershipItem[] | undefined ?? []).map((i) => this.toMembership(i));
  }

  async roleForUser(workspaceId: string, userId: string): Promise<Role | undefined> {
    const item = await this.findItemByWorkspaceUser(workspaceId, userId);
    return item?.role;
  }

  async findByWorkspaceEmail(workspaceId: string, email: string): Promise<Membership | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_pendingEmail",
        KeyConditionExpression: "pendingEmail = :pendingEmail",
        FilterExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":pendingEmail": email, ":workspaceId": workspaceId },
      }),
    );
    const item = res.Items?.[0] as MembershipItem | undefined;
    return item ? this.toMembership(item) : undefined;
  }

  async findByWorkspaceUser(workspaceId: string, userId: string): Promise<Membership | undefined> {
    const item = await this.findItemByWorkspaceUser(workspaceId, userId);
    return item ? this.toMembership(item) : undefined;
  }

  async update(id: string, patch: { role?: Role; permissionId?: string }): Promise<void> {
    const sets: string[] = [];
    const values: Record<string, unknown> = {};
    if (patch.role !== undefined) {
      sets.push("#role = :role");
      values[":role"] = patch.role;
    }
    if (patch.permissionId !== undefined) {
      sets.push("permissionId = :permissionId");
      values[":permissionId"] = patch.permissionId;
    }
    if (sets.length === 0) return;
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { membershipId: id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: patch.role !== undefined ? { "#role": "role" } : undefined,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async resolvePending(email: string, userId: string): Promise<number> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_pendingEmail",
        KeyConditionExpression: "pendingEmail = :pendingEmail",
        ExpressionAttributeValues: { ":pendingEmail": email },
      }),
    );
    const items = (res.Items as MembershipItem[] | undefined) ?? [];
    for (const item of items) {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { membershipId: item.membershipId },
          UpdateExpression: "SET userId = :userId REMOVE pendingEmail",
          ExpressionAttributeValues: { ":userId": userId },
        }),
      );
    }
    return items.length;
  }

  async remove(id: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { membershipId: id } }));
  }

  private async findItemByWorkspaceUser(workspaceId: string, userId: string): Promise<MembershipItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_user",
        KeyConditionExpression: "userId = :userId",
        FilterExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":userId": userId, ":workspaceId": workspaceId },
      }),
    );
    return res.Items?.[0] as MembershipItem | undefined;
  }

  private toMembership(item: MembershipItem): Membership {
    return {
      id: item.membershipId,
      workspaceId: item.workspaceId,
      userId: item.userId,
      pendingEmail: item.pendingEmail,
      role: item.role,
      permissionId: item.permissionId,
    };
  }
}
