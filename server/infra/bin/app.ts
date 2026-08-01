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
    "NaumovOleg/rrequest",
  branch:
    app.node.tryGetContext("branch") ?? process.env.GITHUB_BRANCH ?? "master",
  githubConnectionArn:
    app.node.tryGetContext("githubConnectionArn") ??
    process.env.GITHUB_CONNECTION_ARN ??
    "arn:aws:codeconnections:eu-west-1:389151907894:connection/6b3db8aa-3ea8-4152-a027-939625f7d7ab",
  githubTokenSecret: "rrequest-github-token",
  vscePatSecret: "rrequest-vsce-pat",
  config: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  },
});

app.synth();
