import { App } from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { ApiStack } from "../lib/api-stack";
import { SchedulerStack } from "../lib/scheduler-stack";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI are public OAuth app config (not
// secret) -- they're read from the deploy-time environment and baked into
// the Lambdas' env vars. GOOGLE_CLIENT_SECRET/JWT_SECRET/TOKEN_ENC_KEY are
// SSM SecureString parameters (names from DataStack; created by the operator
// post-deploy) -- only the param names + IAM ssm:GetParameter/kms:Decrypt
// grants flow to the functions (see functions.ts).
const config = {
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
};

const dataStack = new DataStack(app, "RestmanDataStack", { env });

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

new ApiStack(app, "RestmanApiStack", { env, tables, secrets, config });
new SchedulerStack(app, "RestmanSchedulerStack", { env, tables, secrets, config });

app.synth();
