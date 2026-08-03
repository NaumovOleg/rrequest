import * as path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export type DataTables = {
  users: Table;
  workspaces: Table;
  memberships: Table;
};

// Plaintext VALUES of the 3 backend secrets, supplied at deploy time (from
// GitHub environment secrets, see bin/app.ts). They are baked directly into
// the Lambda environment -- so `deps.ts`'s top-level `loadConfig()` sees them
// immediately at cold start, no Parameter Store fetch. NOTE: env-var values
// land in plaintext in the CloudFormation template and are readable via
// lambda:GetFunctionConfiguration -- weaker at rest than SSM SecureString+KMS.
export type DataSecrets = {
  googleClientSecret: string;
  jwtSecret: string;
  tokenEncKey: string;
};

export type ApiFunctionConfig = {
  googleClientId: string;
  googleRedirectUri: string;
};

// Both handlers import `src/deps.ts`, which wires ALL 3 stores + the auth/
// workspace/member/poll services from the shared env-var contract in
// `src/domain/config.ts` (`loadConfig` throws if any of GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, JWT_SECRET, TOKEN_ENC_KEY is
// missing) -- so both functions need the same base environment with the
// secret values present.
function baseEnvironment(tables: DataTables, secrets: DataSecrets, config: ApiFunctionConfig): Record<string, string> {
  return {
    USERS_TABLE: tables.users.tableName,
    WORKSPACES_TABLE: tables.workspaces.tableName,
    MEMBERSHIPS_TABLE: tables.memberships.tableName,
    GOOGLE_CLIENT_ID: config.googleClientId,
    GOOGLE_REDIRECT_URI: config.googleRedirectUri,
    GOOGLE_CLIENT_SECRET: secrets.googleClientSecret,
    JWT_SECRET: secrets.jwtSecret,
    TOKEN_ENC_KEY: secrets.tokenEncKey,
  };
}

export type ApiFunctionProps = {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

/** The Helios HTTP handler (`src/handlers/api-app.ts`) behind a Lambda Function URL. Touches all 3 tables (auth/workspace/member services) and all 3 secrets. */
export function apiFunction(scope: Construct, props: ApiFunctionProps): NodejsFunction {
  const { tables, secrets, config } = props;
  const fn = new NodejsFunction(scope, "ApiFunction", {
    entry: path.join(__dirname, "../../server/src/handlers/api-app.ts"),
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

  return fn;
}

export type PollFunctionProps = {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

/**
 * The EventBridge-invoked sweep (`src/handlers/poll-app.ts`). `PollService`'s
 * own code path only reads Workspaces(RW)+Users(R) and needs the Google client
 * secret (Drive OAuth) + token-encryption key. `deps.ts` eagerly constructs
 * every service at import (incl. `AuthService`, needing JWT_SECRET), so the
 * full secret set is present in the env via `baseEnvironment`. Memberships
 * table is still correctly not granted (unused by any poll code path).
 */
export function pollFunction(scope: Construct, props: PollFunctionProps): NodejsFunction {
  const { tables, secrets, config } = props;
  const fn = new NodejsFunction(scope, "PollFunction", {
    entry: path.join(__dirname, "../../server/src/handlers/poll-app.ts"),
    handler: "handler",
    runtime: Runtime.NODEJS_22_X,
    timeout: Duration.seconds(60),
    memorySize: 256,
    bundling: { externalModules: ["@aws-sdk/*"] },
    environment: baseEnvironment(tables, secrets, config),
  });

  tables.workspaces.grantReadWriteData(fn);
  tables.users.grantReadData(fn); // pollFn only reads Users (owner lookup)

  return fn;
}
