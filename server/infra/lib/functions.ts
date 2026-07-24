import * as path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import type { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export type DataTables = {
  users: Table;
  workspaces: Table;
  memberships: Table;
};

export type DataSecrets = {
  googleClientSecret: Secret;
  jwtSecret: Secret;
  tokenEncKey: Secret;
};

export type ApiFunctionConfig = {
  googleClientId: string;
  googleRedirectUri: string;
};

// Both handlers import `src/deps.ts`, which wires ALL 3 stores + the auth/
// workspace/member/poll services from the shared env-var contract in
// `src/domain/config.ts` (`loadConfig` throws if any of GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, JWT_SECRET, TOKEN_ENC_KEY is
// missing) -- so both functions need the same base environment. Per the
// task brief, only secret ARNs are wired here (no plaintext in the
// template); the handler fetching secret values from Secrets Manager at
// cold start is a follow-up. `*_SECRET_ARN` are set for that follow-up to
// read from; they are NOT yet consumed by `loadConfig`.
function baseEnvironment(tables: DataTables, secrets: DataSecrets, config: ApiFunctionConfig): Record<string, string> {
  return {
    USERS_TABLE: tables.users.tableName,
    WORKSPACES_TABLE: tables.workspaces.tableName,
    MEMBERSHIPS_TABLE: tables.memberships.tableName,
    GOOGLE_CLIENT_ID: config.googleClientId,
    GOOGLE_REDIRECT_URI: config.googleRedirectUri,
    GOOGLE_CLIENT_SECRET_ARN: secrets.googleClientSecret.secretArn,
    JWT_SECRET_ARN: secrets.jwtSecret.secretArn,
    TOKEN_ENC_KEY_ARN: secrets.tokenEncKey.secretArn,
  };
}

export type ApiFunctionProps = {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

/** The Helios HTTP handler (`src/handlers/api.ts`) behind the HttpApi. Touches all 3 tables (auth/workspace/member services) and all 3 secrets. */
export function apiFunction(scope: Construct, props: ApiFunctionProps): NodejsFunction {
  const { tables, secrets, config } = props;
  const fn = new NodejsFunction(scope, "ApiFunction", {
    entry: path.join(__dirname, "../../src/handlers/api.ts"),
    handler: "handler",
    runtime: Runtime.NODEJS_22_X,
    timeout: Duration.seconds(29),
    memorySize: 256,
    bundling: { externalModules: ["@aws-sdk/*"] },
    environment: baseEnvironment(tables, secrets, config),
  });

  tables.users.grantReadWriteData(fn);
  tables.workspaces.grantReadWriteData(fn);
  tables.memberships.grantReadWriteData(fn);
  secrets.googleClientSecret.grantRead(fn);
  secrets.jwtSecret.grantRead(fn);
  secrets.tokenEncKey.grantRead(fn);

  return fn;
}

export type PollFunctionProps = {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

/**
 * The EventBridge-invoked sweep (`src/handlers/poll.ts`). `PollService` only
 * reads/writes Workspaces + Users (see `src/services/poll-service.ts`), and
 * only needs the Google client secret (Drive OAuth refresh, via
 * `makeDriveFactory`) + the token-encryption key (decrypting stored refresh
 * tokens in `DynamoUserStore`) -- not Memberships or the JWT secret. IAM is
 * scoped to that narrower footprint even though `deps.ts` eagerly
 * constructs the membership store too (unused by this handler's code path).
 */
export function pollFunction(scope: Construct, props: PollFunctionProps): NodejsFunction {
  const { tables, secrets, config } = props;
  const fn = new NodejsFunction(scope, "PollFunction", {
    entry: path.join(__dirname, "../../src/handlers/poll.ts"),
    handler: "handler",
    runtime: Runtime.NODEJS_22_X,
    timeout: Duration.seconds(60),
    memorySize: 256,
    bundling: { externalModules: ["@aws-sdk/*"] },
    environment: baseEnvironment(tables, secrets, config),
  });

  tables.workspaces.grantReadWriteData(fn);
  tables.users.grantReadData(fn); // pollFn only reads Users (owner lookup)
  secrets.googleClientSecret.grantRead(fn);
  secrets.tokenEncKey.grantRead(fn);

  return fn;
}
