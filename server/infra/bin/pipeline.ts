import { App } from "aws-cdk-lib";
import { PipelineStack } from "../lib/pipeline-stack";

// Separate CDK app for the CI/CD pipeline (the default app in cdk.json,
// bin/app.ts, is the direct manual-deploy path). Deploy this ONCE by hand:
//
//   cd server/infra
//   export CDK_DEFAULT_ACCOUNT=... CDK_DEFAULT_REGION=...
//   export GITHUB_REPO=owner/rrequest GOOGLE_CLIENT_ID=... GOOGLE_REDIRECT_URI=...
//   npx cdk --app 'npx tsx bin/pipeline.ts' deploy RrequestPipelineStack
//
// Thereafter every push to the branch self-mutates the pipeline, deploys the
// backend, and publishes the extension. Requires two Secrets Manager secrets:
//   rrequest/ci/github-token  (GitHub PAT: repo scope, for source + tag push)
//   rrequest/ci/vsce-pat      (VS Code Marketplace PAT for `vsce publish`)
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new PipelineStack(app, "RrequestPipelineStack", {
  env,
  githubRepo: app.node.tryGetContext("githubRepo") ?? process.env.GITHUB_REPO ?? "OWNER/rrequest",
  branch: app.node.tryGetContext("branch") ?? process.env.GITHUB_BRANCH ?? "master",
  githubTokenSecret: "rrequest/ci/github-token",
  vscePatSecret: "rrequest/ci/vsce-pat",
  config: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  },
});

app.synth();
