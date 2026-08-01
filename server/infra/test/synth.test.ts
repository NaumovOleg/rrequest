import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { RrequestStack } from "../lib/rrequest-stack";

// Mirrors bin/app.ts: one stack with tables + HTTP API + apiFn + poll Lambda
// + EventBridge rule, so the synthesized template matches `cdk synth`.
function buildTemplate(): Template {
  const app = new App();
  const env = { account: "000000000000", region: "us-east-1" };
  const config = { googleClientId: "test-client-id", googleRedirectUri: "https://example.com/callback" };
  const stack = new RrequestStack(app, "TestRrequestStack", { env, config });
  return Template.fromStack(stack);
}

const template = buildTemplate();

describe("RrequestStack — DynamoDB", () => {
  it("provisions exactly 3 PAY_PER_REQUEST tables", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 3);
    template.allResourcesProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
  });

  it("Users table has PK userId + GSIs gsi_googleSub/gsi_email", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "Users",
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: "gsi_googleSub", KeySchema: [{ AttributeName: "googleSub", KeyType: "HASH" }] }),
        Match.objectLike({ IndexName: "gsi_email", KeySchema: [{ AttributeName: "email", KeyType: "HASH" }] }),
      ]),
    });
  });

  it("Workspaces table has PK workspaceId + GSI gsi_owner", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "Workspaces",
      KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: "gsi_owner", KeySchema: [{ AttributeName: "ownerUserId", KeyType: "HASH" }] }),
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
        Match.objectLike({ IndexName: "gsi_pendingEmail", KeySchema: [{ AttributeName: "pendingEmail", KeyType: "HASH" }] }),
      ]),
    });
  });

  it("all GSIs project ALL attributes", () => {
    const tables = template.findResources("AWS::DynamoDB::Table");
    for (const table of Object.values(tables)) {
      const gsis = (table as { Properties: { GlobalSecondaryIndexes?: Array<{ Projection: { ProjectionType: string } }> } })
        .Properties.GlobalSecondaryIndexes;
      for (const gsi of gsis ?? []) expect(gsi.Projection.ProjectionType).toBe("ALL");
    }
  });

  it("provisions no Secrets Manager secrets nor SSM params (secrets are out-of-band SecureString)", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    template.resourceCountIs("AWS::SSM::Parameter", 0);
  });
});

describe("RrequestStack — HTTP API", () => {
  it("creates an HttpApi", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", { ProtocolType: "HTTP" });
  });

  it("wires a Lambda integration on ANY /{proxy+}", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Integration", { IntegrationType: "AWS_PROXY" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "ANY /{proxy+}" });
  });

  it("outputs the API URL", () => {
    template.hasOutput("ApiUrl", {});
  });
});

describe("RrequestStack — Scheduler", () => {
  it("creates exactly 1 EventBridge rule at rate(1 minute)", () => {
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
      Targets: Match.arrayWith([Match.objectLike({ Arn: Match.anyValue() })]),
    });
  });

  it("provisions 2 Lambda functions (api + poll)", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });
});

describe("RrequestStack — IAM least privilege", () => {
  it("scopes dynamodb + ssm:GetParameter to resources; kms:Decrypt is condition-constrained", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) => (p as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown; Condition?: unknown }> } } })
        .Properties.PolicyDocument.Statement,
    );
    const actionOf = (s: { Action: unknown }): string[] => (Array.isArray(s.Action) ? s.Action.map(String) : [String(s.Action)]);
    for (const stmt of statements) {
      const actions = actionOf(stmt);
      if (actions.some((a) => a.startsWith("kms:"))) {
        expect(stmt.Condition).toBeDefined(); // kms:Decrypt Resource:"*" is ok only with a ViaService condition
      } else if (actions.some((a) => a.startsWith("dynamodb:") || a === "ssm:GetParameter")) {
        expect(stmt.Resource).not.toBe("*");
      }
    }
    expect(statements.some((s) => actionOf(s).some((a) => a.startsWith("dynamodb:")))).toBe(true);
    expect(statements.some((s) => actionOf(s).includes("ssm:GetParameter"))).toBe(true);
    expect(statements.some((s) => actionOf(s).includes("kms:Decrypt"))).toBe(true);
  });
});
