import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import type { Construct } from "constructs";
import { apiFunction, pollFunction, type ApiFunctionConfig, type DataSecrets, type DataTables } from "./functions";

export type RrequestStackProps = StackProps & {
  config: ApiFunctionConfig;
  // Plaintext secret VALUES, supplied at deploy time (see bin/app.ts). Baked
  // into the Lambda environment -- no Parameter Store fetch at cold start.
  secrets: DataSecrets;
  // Physical-name prefix for a stage-isolated deployment (e.g. "development-").
  // Empty for production (keeps the original "Users"/"Workspaces"/... names).
  resourcePrefix?: string;
};

/**
 * The entire rrequest sync backend in ONE stack: the 3 DynamoDB tables the
 * stores query, the Helios HTTP handler Lambda exposed via a **Lambda Function
 * URL** (no API Gateway — Helios speaks the same payload-format-2.0 event that
 * Function URLs deliver), and the EventBridge-scheduled poll Lambda. Table/GSI
 * names below match `src/stores/dynamo/*.ts` exactly.
 */
export class RrequestStack extends Stack {
  public readonly usersTable: Table;
  public readonly workspacesTable: Table;
  public readonly membershipsTable: Table;

  constructor(scope: Construct, id: string, props: RrequestStackProps) {
    super(scope, id, props);

    const prefix = props.resourcePrefix ?? "";

    // --- DynamoDB tables (RETAIN so a stack teardown never drops user data) ---
    this.usersTable = new Table(this, "UsersTable", {
      tableName: `${prefix}Users`,
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
      tableName: `${prefix}Workspaces`,
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
      tableName: `${prefix}Memberships`,
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

    const tables: DataTables = {
      users: this.usersTable,
      workspaces: this.workspacesTable,
      memberships: this.membershipsTable,
    };

    // --- Helios Lambda exposed via a Function URL (no API Gateway) ---
    // Function URLs deliver payload-format-2.0 events (same shape API GW HTTP
    // API used), so the Helios handler routes on rawPath unchanged. Auth is
    // NONE at the URL layer; the app enforces JWT per-route.
    const apiFn = apiFunction(this, { tables, secrets: props.secrets, config: props.config });
    const fnUrl = apiFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    new CfnOutput(this, "ApiUrl", {
      value: fnUrl.url,
      description: "Lambda Function URL base. Set the extension syncServerUrl to <this>api (e.g. https://xxx.lambda-url.eu-west-1.on.aws/api); OAuth redirect = <this>api/auth/callback",
    });

    // --- EventBridge-scheduled poll Lambda (outside-Drive-edit revision bumps) ---
    const pollFn = pollFunction(this, { tables, secrets: props.secrets, config: props.config });
    new Rule(this, "PollRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      description: "Sweeps synced workspaces for outside-Drive-edit revision bumps",
    }).addTarget(new LambdaFunction(pollFn));
  }
}
