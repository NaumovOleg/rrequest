import { App } from "aws-cdk-lib";
import { RrequestStack } from "../lib/rrequest-stack";

// Pull local deploy config from the single ROOT env file (STAGE, GOOGLE_*,
// GOOGLE_CLIENT_SECRET/JWT_SECRET/TOKEN_ENC_KEY, CDK_DEFAULT_*), so a local
// `cdk deploy` doesn't need everything exported. CI sets these in the
// environment directly, which wins over the file. `ENV_FILE=.env.prod cdk
// deploy` selects prod values. (tsx runs this as CommonJS, so `require` is
// available; the loader resolves the repo root from its own location.)
require("../../../scripts/load-root-env.cjs")();

// Deploys the backend as a single stack: DynamoDB tables + the Helios Lambda
// (behind a Lambda Function URL) + the EventBridge-scheduled poll Lambda.
// Account/region come from the AWS profile / CI credentials. GOOGLE_CLIENT_ID,
// GOOGLE_REDIRECT_URI, and the 3 secret VALUES (GOOGLE_CLIENT_SECRET,
// JWT_SECRET, TOKEN_ENC_KEY) are all read from the deploy environment (GitHub
// environment secrets in CI) and baked into the Lambda env. Set them before
// `cdk deploy`; on the first deploy GOOGLE_REDIRECT_URI can be a placeholder
// until the Function URL is known (see server/README.md).
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1",
};

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required deploy env var: ${name}`);
  return v;
};

// STAGE picks a fully isolated deployment: "development" gets its own stack name
// and a "development-" prefix on every physical resource name (DynamoDB tables),
// so dev and prod can live side by side in the same AWS account without
// colliding. Production keeps the original unprefixed names (backwards-compatible
// with the already-deployed stack). Defaults to production.
const isDev = process.env.STAGE === "development";
const stackId = isDev ? "DevelopmentRrequestStack" : "RrequestStack";

new RrequestStack(app, stackId, {
  env,
  resourcePrefix: isDev ? "development-" : "",
  config: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  },
  secrets: {
    googleClientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    jwtSecret: requireEnv("JWT_SECRET"),
    tokenEncKey: requireEnv("TOKEN_ENC_KEY"),
  },
});

app.synth();
