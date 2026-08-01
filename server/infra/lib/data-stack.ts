import { Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

// SSM Parameter Store parameter NAMES for the 3 backend secrets. NOTE:
// CloudFormation cannot create `SecureString` SSM parameters (only String /
// StringList), so these are NOT provisioned by CDK -- the operator creates
// them post-deploy as SecureString via the AWS CLI/console (same step where
// they'd previously have set the Secrets Manager secret values). The api/poll
// Lambdas are granted `ssm:GetParameter` on these names + `kms:Decrypt`
// (see infra/lib/functions.ts) and fetch the values at cold start
// (src/secrets.ts). Parameter Store standard tier is free; Secrets Manager
// charged per secret/month -- these are static config, not rotated creds.
export const SSM_PARAM_NAMES = {
  googleClientSecret: "/rrequest/GOOGLE_CLIENT_SECRET",
  jwtSecret: "/rrequest/JWT_SECRET",
  tokenEncKey: "/rrequest/TOKEN_ENC_KEY",
} as const;

/**
 * The 3 DynamoDB tables the stores under `src/stores/dynamo/*.ts` query, plus
 * the 3 backend-only secrets `src/domain/config.ts` requires
 * (GOOGLE_CLIENT_SECRET, JWT_SECRET, TOKEN_ENC_KEY). Table/GSI/attribute
 * names below match those stores exactly:
 *
 * - Users (PK `userId`): GSI `gsi_googleSub` (PK `googleSub`), GSI
 *   `gsi_email` (PK `email`) -- see `user-store.ts`.
 * - Workspaces (PK `workspaceId`): GSI `gsi_owner` (PK `ownerUserId`) --
 *   see `workspace-store.ts`.
 * - Memberships (PK `membershipId`): GSI `gsi_ws` (PK `workspaceId`), GSI
 *   `gsi_user` (PK `userId`), GSI `gsi_pendingEmail` (PK `pendingEmail`) --
 *   see `membership-store.ts`.
 */
export class DataStack extends Stack {
  public readonly usersTable: Table;
  public readonly workspacesTable: Table;
  public readonly membershipsTable: Table;

  /** SSM SecureString parameter names for the 3 backend secrets (created out-of-band by the operator). */
  public readonly secretParamNames = SSM_PARAM_NAMES;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.usersTable = new Table(this, "UsersTable", {
      tableName: "Users",
      partitionKey: { name: "userId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.usersTable.addGlobalSecondaryIndex({
      indexName: "gsi_googleSub",
      partitionKey: { name: "googleSub", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.usersTable.addGlobalSecondaryIndex({
      indexName: "gsi_email",
      partitionKey: { name: "email", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.workspacesTable = new Table(this, "WorkspacesTable", {
      tableName: "Workspaces",
      partitionKey: { name: "workspaceId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.workspacesTable.addGlobalSecondaryIndex({
      indexName: "gsi_owner",
      partitionKey: { name: "ownerUserId", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.membershipsTable = new Table(this, "MembershipsTable", {
      tableName: "Memberships",
      partitionKey: { name: "membershipId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.membershipsTable.addGlobalSecondaryIndex({
      indexName: "gsi_ws",
      partitionKey: { name: "workspaceId", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.membershipsTable.addGlobalSecondaryIndex({
      indexName: "gsi_user",
      partitionKey: { name: "userId", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.membershipsTable.addGlobalSecondaryIndex({
      indexName: "gsi_pendingEmail",
      partitionKey: { name: "pendingEmail", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Secrets are SSM SecureString parameters, created by the operator
    // post-deploy (CloudFormation can't create SecureString) -- see
    // SSM_PARAM_NAMES above and the deploy runbook. The Lambdas are granted
    // read + kms:Decrypt on these names in infra/lib/functions.ts.
  }
}
