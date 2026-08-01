import { App } from "aws-cdk-lib";
import { RrequestStack } from "../lib/rrequest-stack";

// Deploys the backend as a single stack: DynamoDB tables + the Helios Lambda
// (behind a Lambda Function URL) + the EventBridge-scheduled poll Lambda.
// Account/region come from the AWS profile / CI credentials. GOOGLE_CLIENT_ID
// and GOOGLE_REDIRECT_URI are baked into the Lambda env at deploy (set them on
// the second deploy once the Function URL is known); the 3 SSM SecureString
// secret params are created out-of-band by the operator (see server/README.md).
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1",
};

new RrequestStack(app, "RrequestStack", {
  env,
  config: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  },
});

app.synth();
