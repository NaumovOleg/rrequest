import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { RrequestStack } from "../lib/rrequest-stack";

// Mirrors bin/app.ts: one stack with tables + Function URL + apiFn + poll
// Lambda + EventBridge rule, so the synthesized template matches `cdk synth`.
function buildTemplate(): Template {
  const app = new App();
  const env = { account: "000000000000", region: "us-east-1" };
  const config = { googleClientId: "test-client-id", googleRedirectUri: "https://example.com/callback" };
  const secrets = { googleClientSecret: "test-google-secret", jwtSecret: "test-jwt", tokenEncKey: "test-enc-key" };
  const stack = new RrequestStack(app, "TestRrequestStack", { env, config, secrets });
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

  it("provisions no Secrets Manager secrets nor SSM params (secret values baked into Lambda env)", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    template.resourceCountIs("AWS::SSM::Parameter", 0);
  });
});

describe("RrequestStack — secrets baked into Lambda env", () => {
  it("both Lambdas get the 3 secret VALUES + OAuth config in their environment", () => {
    const fns = template.findResources("AWS::Lambda::Function");
    const envs = Object.values(fns).map(
      (f) => (f as { Properties: { Environment?: { Variables?: Record<string, unknown> } } }).Properties.Environment?.Variables ?? {},
    );
    expect(envs).toHaveLength(2);
    for (const vars of envs) {
      expect(vars.GOOGLE_CLIENT_SECRET).toBe("test-google-secret");
      expect(vars.JWT_SECRET).toBe("test-jwt");
      expect(vars.TOKEN_ENC_KEY).toBe("test-enc-key");
      expect(vars.GOOGLE_CLIENT_ID).toBe("test-client-id");
      // the old param-name indirection is gone
      expect(vars.GOOGLE_CLIENT_SECRET_PARAM).toBeUndefined();
      expect(vars.JWT_SECRET_PARAM).toBeUndefined();
      expect(vars.TOKEN_ENC_KEY_PARAM).toBeUndefined();
    }
  });
});

describe("RrequestStack — Function URL (no API Gateway)", () => {
  it("exposes the api Lambda via a public Function URL", () => {
    template.resourceCountIs("AWS::Lambda::Url", 1);
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
  });

  it("provisions NO API Gateway", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);
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
  it("scopes dynamodb actions to table resources (never \"*\") and grants no ssm/kms (secrets are in env now)", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) => (p as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown; Condition?: unknown }> } } })
        .Properties.PolicyDocument.Statement,
    );
    const actionOf = (s: { Action: unknown }): string[] => (Array.isArray(s.Action) ? s.Action.map(String) : [String(s.Action)]);
    for (const stmt of statements) {
      const actions = actionOf(stmt);
      if (actions.some((a) => a.startsWith("dynamodb:"))) {
        expect(stmt.Resource).not.toBe("*");
      }
    }
    expect(statements.some((s) => actionOf(s).some((a) => a.startsWith("dynamodb:")))).toBe(true);
    // secrets moved to Lambda env -> no Parameter Store / KMS grants remain
    expect(statements.some((s) => actionOf(s).includes("ssm:GetParameter"))).toBe(false);
    expect(statements.some((s) => actionOf(s).some((a) => a.startsWith("kms:")))).toBe(false);
  });
});
