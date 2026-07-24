import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type DdbClientConfig = {
  endpoint?: string;
  region?: string;
};

/**
 * Builds a DynamoDB DocumentClient. With no args, targets real AWS using
 * ambient credentials/region. Pass `endpoint`/`region` to point at a local
 * dynalite instance (see server/test/dynalite.ts) for tests.
 */
export function makeDocClient(cfg: DdbClientConfig = {}): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    endpoint: cfg.endpoint,
    region: cfg.region ?? process.env.AWS_REGION ?? "us-east-1",
  });
  return DynamoDBDocumentClient.from(client);
}
