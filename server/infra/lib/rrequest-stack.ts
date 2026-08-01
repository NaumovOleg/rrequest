import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import type { Construct } from "constructs";
import { apiFunction, pollFunction, type ApiFunctionConfig, type DataSecrets, type DataTables } from "./functions";

// SSM SecureString parameter NAMES for the 3 backend secrets. CloudFormation
// can't create SecureString params, so they are NOT provisioned here -- the
// operator creates them post-deploy (see the deploy runbook). The Lambdas get
// the names in env + IAM ssm:GetParameter/kms:Decrypt and fetch the values at
// cold start (src/secrets.ts).
export const SSM_PARAM_NAMES: DataSecrets = {
  googleClientSecret: "/rrequest/GOOGLE_CLIENT_SECRET",
  jwtSecret: "/rrequest/JWT_SECRET",
  tokenEncKey: "/rrequest/TOKEN_ENC_KEY",
};

export type RrequestStackProps = StackProps & {
  config: ApiFunctionConfig;
};

/**
 * The entire rrequest sync backend in ONE stack: the 3 DynamoDB tables the
 * stores query, the Helios HTTP API Lambda behind an API Gateway HTTP API
 * (`ANY /{proxy+}`), and the EventBridge-scheduled poll Lambda. A single
 * env/deployment, so one stack keeps deploy/rollback atomic and the wiring in
 * one place. Table/GSI names below match `src/stores/dynamo/*.ts` exactly.
 */
export class RrequestStack extends Stack {
  public readonly usersTable: Table;
  public readonly workspacesTable: Table;
  public readonly membershipsTable: Table;
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: RrequestStackProps) {
    super(scope, id, props);

    // --- DynamoDB tables (RETAIN so a stack teardown never drops user data) ---
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

    const tables: DataTables = {
      users: this.usersTable,
      workspaces: this.workspacesTable,
      memberships: this.membershipsTable,
    };

    // --- HTTP API + Helios Lambda (one catch-all proxy route; Helios routes internally) ---
    const apiFn = apiFunction(this, { tables, secrets: SSM_PARAM_NAMES, config: props.config });
    this.httpApi = new HttpApi(this, "RrequestHttpApi", { apiName: "rrequest-sync-api" });
    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", apiFn),
    });
    new CfnOutput(this, "ApiUrl", {
      value: this.httpApi.apiEndpoint,
      description: "Base URL of the rrequest sync HTTP API (extension syncServerUrl = <this>/api)",
    });

    // --- EventBridge-scheduled poll Lambda (outside-Drive-edit revision bumps) ---
    const pollFn = pollFunction(this, { tables, secrets: SSM_PARAM_NAMES, config: props.config });
    new Rule(this, "PollRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      description: "Sweeps synced workspaces for outside-Drive-edit revision bumps",
    }).addTarget(new LambdaFunction(pollFn));
  }
}
