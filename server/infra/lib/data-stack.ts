import { Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

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

  public readonly googleClientSecret: Secret;
  public readonly jwtSecret: Secret;
  public readonly tokenEncKey: Secret;

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

    // Placeholder values only -- generated at deploy time, never baked into
    // the CFN template. The operator sets the real values (Google OAuth
    // client secret, a random JWT signing key, a random AES key for
    // encrypting stored refresh tokens) via the Secrets Manager console/CLI
    // after `cdk deploy` (see Task 14's deploy runbook). Lambdas only get
    // the ARNs + IAM `grantRead` -- reading the value at runtime is a
    // follow-up (this task wires the infra, not the handler's secret
    // fetch).
    this.googleClientSecret = new Secret(this, "GoogleClientSecret", {
      description: "Google OAuth client secret (restman sync backend)",
    });
    this.jwtSecret = new Secret(this, "JwtSecret", {
      description: "HMAC signing key for session JWTs + the stateless OAuth `state` param",
    });
    this.tokenEncKey = new Secret(this, "TokenEncKey", {
      description: "AES key encrypting stored Google refresh tokens at rest",
    });
  }
}
