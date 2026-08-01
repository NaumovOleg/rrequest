import { App } from "aws-cdk-lib";
import { RrequestStack } from "../lib/rrequest-stack";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
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

// One stack: tables + HTTP API + apiFn + poll Lambda + EventBridge rule.
new RrequestStack(app, "RrequestStack", { env, config });

app.synth();
