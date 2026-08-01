import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { PipelineStack } from "../lib/pipeline-stack";

function buildTemplate(): Template {
  const app = new App();
  const stack = new PipelineStack(app, "TestPipelineStack", {
    env: { account: "000000000000", region: "us-east-1" },
    githubRepo: "owner/rrequest",
    githubConnectionArn: "arn:aws:codeconnections:us-east-1:000000000000:connection/test",
    branch: "master",
    githubTokenSecret: "rrequest/ci/github-token",
    vscePatSecret: "rrequest/ci/vsce-pat",
    config: { googleClientId: "cid", googleRedirectUri: "https://x/api/auth/callback" },
  });
  return Template.fromStack(stack);
}

describe("PipelineStack", () => {
  const template = buildTemplate();

  it("creates a self-mutating CodePipeline", () => {
    template.resourceCountIs("AWS::CodePipeline::Pipeline", 1);
    template.hasResourceProperties("AWS::CodePipeline::Pipeline", { Name: "rrequest-pipeline" });
  });

  it("has CodeBuild projects (synth, self-mutate, release)", () => {
    // Synth + SelfMutate + ReleaseExtension each become a CodeBuild project.
    const projects = template.findResources("AWS::CodeBuild::Project");
    expect(Object.keys(projects).length).toBeGreaterThanOrEqual(3);
  });

  it("the release step role can read the SSM token params", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) => (p as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown }> } } }).Properties.PolicyDocument.Statement,
    );
    const hasSsmRead = statements.some((s) =>
      (Array.isArray(s.Action) ? s.Action.map(String) : [String(s.Action)]).includes("ssm:GetParameter"),
    );
    expect(hasSsmRead).toBe(true);
  });
});
