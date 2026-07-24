import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { decrypt, encrypt } from "../../domain/crypto.js";
import type { User, UserStore } from "../types.js";

export type DynamoUserStoreConfig = {
  doc: DynamoDBDocumentClient;
  table: string;
  encKey: string;
};

type UserItem = {
  userId: string;
  email: string;
  googleSub: string;
  refreshTokenEnc: string;
};

/**
 * DynamoDB-backed UserStore. Table `Users`: PK `userId`, GSI `gsi_googleSub`
 * (PK `googleSub`) and GSI `gsi_email` (PK `email`). The refresh token is
 * encrypted at rest (`refreshTokenEnc`) and decrypted on every read so the
 * store's public contract matches the in-memory/sqlite implementations.
 */
export class DynamoUserStore implements UserStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly encKey: string;

  constructor(cfg: DynamoUserStoreConfig) {
    this.doc = cfg.doc;
    this.table = cfg.table;
    this.encKey = cfg.encKey;
  }

  async upsertByGoogle(input: { googleSub: string; email: string; refreshToken: string }): Promise<User> {
    const existing = await this.findItemByGoogleSub(input.googleSub);
    const item: UserItem = {
      userId: existing?.userId ?? randomUUID(),
      email: input.email,
      googleSub: input.googleSub,
      refreshTokenEnc: encrypt(input.refreshToken, this.encKey),
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
    return this.toUser(item);
  }

  async getById(id: string): Promise<User | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { userId: id } }));
    return res.Item ? this.toUser(res.Item as UserItem) : undefined;
  }

  async getByEmail(email: string): Promise<User | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_email",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
      }),
    );
    const item = res.Items?.[0] as UserItem | undefined;
    return item ? this.toUser(item) : undefined;
  }

  private async findItemByGoogleSub(googleSub: string): Promise<UserItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "gsi_googleSub",
        KeyConditionExpression: "googleSub = :googleSub",
        ExpressionAttributeValues: { ":googleSub": googleSub },
        Limit: 1,
      }),
    );
    return res.Items?.[0] as UserItem | undefined;
  }

  private toUser(item: UserItem): User {
    return {
      id: item.userId,
      email: item.email,
      googleSub: item.googleSub,
      refreshToken: decrypt(item.refreshTokenEnc, this.encKey),
    };
  }
}
