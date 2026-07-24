import type { AddressInfo } from "node:net";
import dynalite from "dynalite";
import { CreateTableCommand, DynamoDBClient, type CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type DynaliteHarness = {
  doc: DynamoDBDocumentClient;
  client: DynamoDBClient;
  endpoint: string;
  createTable(params: CreateTableCommandInput): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Starts an in-memory dynalite server on an ephemeral port and returns a
 * ready-to-use DynamoDB DocumentClient pointed at it, plus helpers to
 * create tables and tear the server down. Reused across dynamo store tests
 * (Tasks 3-5).
 */
export async function startDynalite(): Promise<DynaliteHarness> {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, (err?: Error) => {
      if (err) return reject(err);
      const address = server.address() as AddressInfo | null;
      if (!address || typeof address === "string") {
        return reject(new Error("dynalite: could not determine listening port"));
      }
      resolve(address.port);
    });
  });

  const endpoint = `http://localhost:${port}`;
  const client = new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: { accessKeyId: "x", secretAccessKey: "x" },
  });
  const doc = DynamoDBDocumentClient.from(client);

  return {
    doc,
    client,
    endpoint,
    async createTable(params: CreateTableCommandInput): Promise<void> {
      await client.send(new CreateTableCommand(params));
    },
    async stop(): Promise<void> {
      client.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => (err ? reject(err) : resolve()));
      });
    },
  };
}
