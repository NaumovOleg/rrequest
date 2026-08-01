import { App } from "aws-cdk-lib";

import { PipelineStack } from "../lib/pipeline-stack";

const app = new App();

const env = {
  account: "389151907894",
  region: "eu-west-1",
};

// GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI are public OAuth app config (not
// secret) -- read from the deploy-time environment and baked into the
// Lambdas' env. GOOGLE_CLIENT_SECRET/JWT_SECRET/TOKEN_ENC_KEY are SSM
// SecureString parameters created by the operator post-deploy (names in
// RrequestStack; only the names + IAM grants flow to the functions).
const config = {
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
};

new PipelineStack(app, "RrequestPipelineStack", {
  env,
  githubRepo:
    app.node.tryGetContext("githubRepo") ??
    process.env.GITHUB_REPO ??
    "OWNER/rrequest",
  branch:
    app.node.tryGetContext("branch") ?? process.env.GITHUB_BRANCH ?? "master",
  githubTokenSecret: "rrequest/ci/github-token",
  vscePatSecret: "rrequest/ci/vsce-pat",
  config: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  },
});

app.synth();
