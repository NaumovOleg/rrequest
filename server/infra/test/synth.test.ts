import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DataStack } from "../lib/data-stack";
import { ApiStack } from "../lib/api-stack";
import { SchedulerStack } from "../lib/scheduler-stack";

// Mirrors bin/app.ts's wiring so the synthesized templates match what
// `cdk synth` actually produces.
function buildStacks() {
  const app = new App();
  const env = { account: "000000000000", region: "us-east-1" };
  const dataStack = new DataStack(app, "TestDataStack", { env });
  const tables = {
    users: dataStack.usersTable,
    workspaces: dataStack.workspacesTable,
    memberships: dataStack.membershipsTable,
  };
  const secrets = {
    googleClientSecret: dataStack.secretParamNames.googleClientSecret,
    jwtSecret: dataStack.secretParamNames.jwtSecret,
    tokenEncKey: dataStack.secretParamNames.tokenEncKey,
  };
  const config = { googleClientId: "test-client-id", googleRedirectUri: "https://example.com/callback" };
  const apiStack = new ApiStack(app, "TestApiStack", { env, tables, secrets, config });
  const schedulerStack = new SchedulerStack(app, "TestSchedulerStack", { env, tables, secrets, config });
  return { dataStack, apiStack, schedulerStack };
}

describe("DataStack", () => {
  const { dataStack } = buildStacks();
  const template = Template.fromStack(dataStack);

  it("provisions exactly 3 PAY_PER_REQUEST DynamoDB tables", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 3);
    template.allResourcesProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("Users table has PK userId + GSIs gsi_googleSub/gsi_email", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "Users",
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "gsi_googleSub",
          KeySchema: [{ AttributeName: "googleSub", KeyType: "HASH" }],
        }),
        Match.objectLike({
          IndexName: "gsi_email",
          KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        }),
      ]),
    });
  });

  it("Workspaces table has PK workspaceId + GSI gsi_owner", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "Workspaces",
      KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "gsi_owner",
          KeySchema: [{ AttributeName: "ownerUserId", KeyType: "HASH" }],
        }),
      ]),
    });
  });

  it("Memberships table has PK membershipId + GSIs gsi_ws/gsi_user/gsi_pendingEmail", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "Memberships",
      KeySchema: [{ AttributeName: "membershipId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: "gsi_ws", KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }] }),
        Match.objectLike({ IndexName: "gsi_user", KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }] }),
        Match.objectLike({
          IndexName: "gsi_pendingEmail",
          KeySchema: [{ AttributeName: "pendingEmail", KeyType: "HASH" }],
        }),
      ]),
    });
  });

  it("all GSIs project ALL attributes", () => {
    const tables = template.findResources("AWS::DynamoDB::Table");
    for (const table of Object.values(tables)) {
      const gsis = (table as { Properties: { GlobalSecondaryIndexes?: Array<{ Projection: { ProjectionType: string } }> } })
        .Properties.GlobalSecondaryIndexes;
      for (const gsi of gsis ?? []) {
        expect(gsi.Projection.ProjectionType).toBe("ALL");
      }
    }
  });

  it("provisions no Secrets Manager secrets (secrets are out-of-band SSM SecureString params)", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    // CloudFormation can't create SecureString SSM params, so none here either.
    template.resourceCountIs("AWS::SSM::Parameter", 0);
  });
});

describe("ApiStack", () => {
  const { apiStack } = buildStacks();
  const template = Template.fromStack(apiStack);

  it("creates an HttpApi", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      ProtocolType: "HTTP",
    });
  });

  it("wires a Lambda integration on ANY /{proxy+}", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      IntegrationType: "AWS_PROXY",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "ANY /{proxy+}",
    });
  });

  it("outputs the API URL", () => {
    template.hasOutput("ApiUrl", {});
  });

  it("scopes IAM policy to the 3 tables + the 3 SSM params (least privilege)", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) => (p as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown; Condition?: unknown }> } } })
        .Properties.PolicyDocument.Statement,
    );
    const actionOf = (s: { Action: unknown }): string[] => (Array.isArray(s.Action) ? s.Action.map(String) : [String(s.Action)]);
    // dynamodb: + ssm:GetParameter statements must be resource-scoped (never "*").
    // The single kms:Decrypt statement is intentionally Resource:"*" but is
    // constrained by a kms:ViaService condition to SSM in this region.
    for (const stmt of statements) {
      const actions = actionOf(stmt);
      const isKmsDecrypt = actions.some((a) => a.startsWith("kms:"));
      if (isKmsDecrypt) {
        expect(stmt.Condition).toBeDefined();
      } else {
        expect(stmt.Resource).not.toBe("*");
      }
    }
    const hasDynamoAction = statements.some((s) => actionOf(s).some((a) => a.startsWith("dynamodb:")));
    const hasSsmAction = statements.some((s) => actionOf(s).includes("ssm:GetParameter"));
    const hasKmsDecrypt = statements.some((s) => actionOf(s).includes("kms:Decrypt"));
    expect(hasDynamoAction).toBe(true);
    expect(hasSsmAction).toBe(true);
    expect(hasKmsDecrypt).toBe(true);
  });
});

describe("SchedulerStack", () => {
  const { schedulerStack } = buildStacks();
  const template = Template.fromStack(schedulerStack);

  it("creates an EventBridge rule at rate(1 minute) targeting the poll function", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: Match.anyValue(),
        }),
      ]),
    });
  });

  it("resourceCountIs exactly 1 rule", () => {
    template.resourceCountIs("AWS::Events::Rule", 1);
  });
});
