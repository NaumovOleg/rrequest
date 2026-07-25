import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { SyncedWorkspace, WorkspaceStore } from "../types.js";

export type DynamoWorkspaceStoreConfig = {
  doc: DynamoDBDocumentClient;
  table: string;
};

type WorkspaceItem = {
  workspaceId: string;
  name: string;
  ownerUserId: string;
  driveFileId: string;
  hashFolderId: string;
  revision: string;
  updatedAt: number;
};

/**
 * DynamoDB-backed WorkspaceStore. Table `Workspaces`: PK `workspaceId`, GSI
 * `gsi_owner` (PK `ownerUserId`). Attribute names in the item are camelCase
 * and match `SyncedWorkspace` 1:1 except `id` <-> `workspaceId`.
 */
export class DynamoWorkspaceStore implements WorkspaceStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(cfg: DynamoWorkspaceStoreConfig) {
    this.doc = cfg.doc;
    this.table = cfg.table;
  }

  async upsert(w: SyncedWorkspace): Promise<SyncedWorkspace> {
    const item = this.toItem(w);
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
    return w;
  }

  async get(id: string): Promise<SyncedWorkspace | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { workspaceId: id } }));
    return res.Item ? this.toWorkspace(res.Item as WorkspaceItem) : undefined;
  }

  async listByOwner(ownerUserId: string): Promise<SyncedWorkspace[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_owner",
        KeyConditionExpression: "ownerUserId = :ownerUserId",
        ExpressionAttributeValues: { ":ownerUserId": ownerUserId },
      }),
    );
    return (res.Items as WorkspaceItem[] | undefined ?? []).map((i) => this.toWorkspace(i));
  }

  async setRevision(id: string, revision: string, updatedAt: number): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { workspaceId: id },
        UpdateExpression: "SET revision = :revision, updatedAt = :updatedAt",
        ExpressionAttributeValues: { ":revision": revision, ":updatedAt": updatedAt },
      }),
    );
  }

  async allIds(): Promise<string[]> {
    const ids: string[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: "workspaceId",
          ExclusiveStartKey,
        }),
      );
      for (const item of (res.Items as { workspaceId: string }[] | undefined) ?? []) {
        ids.push(item.workspaceId);
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return ids;
  }

  async delete(id: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { workspaceId: id } }));
  }

  private toItem(w: SyncedWorkspace): WorkspaceItem {
    return {
      workspaceId: w.id,
      name: w.name,
      ownerUserId: w.ownerUserId,
      driveFileId: w.driveFileId,
      hashFolderId: w.hashFolderId,
      revision: w.revision,
      updatedAt: w.updatedAt,
    };
  }

  private toWorkspace(item: WorkspaceItem): SyncedWorkspace {
    return {
      id: item.workspaceId,
      name: item.name,
      ownerUserId: item.ownerUserId,
      driveFileId: item.driveFileId,
      hashFolderId: item.hashFolderId,
      revision: item.revision,
      updatedAt: item.updatedAt,
    };
  }
}
