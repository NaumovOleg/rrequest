import * as path from "node:path";
import { Duration, Stack } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export type DataTables = {
  users: Table;
  workspaces: Table;
  memberships: Table;
};

// SSM SecureString parameter NAMES for the 3 backend secrets (created
// out-of-band by the operator -- see RrequestStack). The Lambdas fetch these at
// cold start (src/secrets.ts) and are granted ssm:GetParameter + kms:Decrypt.
export type DataSecrets = {
  googleClientSecret: string;
  jwtSecret: string;
  tokenEncKey: string;
};

export type ApiFunctionConfig = {
  googleClientId: string;
  googleRedirectUri: string;
};

/**
 * Grant a Lambda read on the given SSM SecureString parameter names:
 * `ssm:GetParameter` scoped to each parameter's ARN, plus `kms:Decrypt`
 * scoped (via the `kms:ViaService` condition) to SSM in this region so the
 * AWS-managed `alias/aws/ssm` key can decrypt the SecureString values.
 */
function grantSsmSecretsRead(scope: Construct, fn: NodejsFunction, paramNames: string[]): void {
  const stack = Stack.of(scope);
  const arns = paramNames.map((name) =>
    stack.formatArn({ service: "ssm", resource: "parameter", resourceName: name.replace(/^\//, "") }),
  );
  fn.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter"], resources: arns }));
  fn.addToRolePolicy(
    new PolicyStatement({
      actions: ["kms:Decrypt"],
      resources: ["*"],
      conditions: { StringEquals: { "kms:ViaService": `ssm.${stack.region}.amazonaws.com` } },
    }),
  );
}

// Both handlers import `src/deps.ts`, which wires ALL 3 stores + the auth/
// workspace/member/poll services from the shared env-var contract in
// `src/domain/config.ts` (`loadConfig` throws if any of GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, JWT_SECRET, TOKEN_ENC_KEY is
// missing) -- so both functions need the same base environment. Only the SSM
// parameter NAMES are wired here (no plaintext in the template);
// `ensureSecretsLoaded` (src/secrets.ts) fetches the values from Parameter
// Store at cold start and populates the plaintext vars before `loadConfig`.
function baseEnvironment(tables: DataTables, secrets: DataSecrets, config: ApiFunctionConfig): Record<string, string> {
  return {
    USERS_TABLE: tables.users.tableName,
    WORKSPACES_TABLE: tables.workspaces.tableName,
    MEMBERSHIPS_TABLE: tables.memberships.tableName,
    GOOGLE_CLIENT_ID: config.googleClientId,
    GOOGLE_REDIRECT_URI: config.googleRedirectUri,
    GOOGLE_CLIENT_SECRET_PARAM: secrets.googleClientSecret,
    JWT_SECRET_PARAM: secrets.jwtSecret,
    TOKEN_ENC_KEY_PARAM: secrets.tokenEncKey,
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
  grantSsmSecretsRead(scope, fn, [secrets.googleClientSecret, secrets.jwtSecret, secrets.tokenEncKey]);

  return fn;
}

export type PollFunctionProps = {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

/**
 * The EventBridge-invoked sweep (`src/handlers/poll.ts`). `PollService`'s own
 * code path only reads Workspaces(RW)+Users(R) and needs the Google client
 * secret (Drive OAuth) + token-encryption key. BUT `deps.ts` eagerly
 * constructs every service at import (incl. `AuthService`), and `loadConfig`
 * requires `JWT_SECRET`; since `baseEnvironment` wires `JWT_SECRET_PARAM` into
 * this function too, `ensureSecretsLoaded` fetches it at cold start -- so the
 * function MUST be granted read on the JWT secret param, else cold start fails
 * with AccessDenied. (A tighter footprint would require splitting deps so poll
 * doesn't build AuthService -- tracked as a follow-up.) Memberships table is
 * still correctly not granted (unused by any poll code path).
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
  // All 3 params granted: deps.ts eagerly builds AuthService (needs JWT_SECRET)
  // + PollService needs the Google client secret + token-enc key.
  grantSsmSecretsRead(scope, fn, [secrets.googleClientSecret, secrets.jwtSecret, secrets.tokenEncKey]);

  return fn;
}
