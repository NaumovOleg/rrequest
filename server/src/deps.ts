// Module singletons: Dynamo-backed stores + drive factory + services, wired
// from environment/config. Imported once by handlers/api.ts (and reused
// across warm Lambda invocations).
import { loadConfig } from "./domain/config.js";
import { makeDocClient } from "./stores/dynamo/ddb-client.js";
import { DynamoUserStore } from "./stores/dynamo/user-store.js";
import { DynamoWorkspaceStore } from "./stores/dynamo/workspace-store.js";
import { DynamoMembershipStore } from "./stores/dynamo/membership-store.js";
import { makeDriveFactory } from "./domain/drive-factory.js";
import { GoogleOAuth } from "./domain/google-oauth.js";
import { AuthService } from "./services/auth-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import { MemberService } from "./services/member-service.js";
import type { AuthzDeps } from "./services/authz.js";

export const config = loadConfig();

const doc = makeDocClient({ endpoint: process.env.DYNAMO_ENDPOINT, region: process.env.AWS_REGION });

export const users = new DynamoUserStore({
  doc,
  table: process.env.USERS_TABLE ?? "Users",
  encKey: config.tokenEncKey,
});

export const workspaces = new DynamoWorkspaceStore({
  doc,
  table: process.env.WORKSPACES_TABLE ?? "Workspaces",
});

export const memberships = new DynamoMembershipStore({
  doc,
  table: process.env.MEMBERSHIPS_TABLE ?? "Memberships",
});

export const driveFor = makeDriveFactory(config);

const google = GoogleOAuth.create({
  clientId: config.googleClientId,
  clientSecret: config.googleClientSecret,
  redirectUri: config.googleRedirectUri,
});

// AuthService also needs a `stateSecret` (HMAC key for the stateless OAuth
// `state` param). No dedicated secret is provisioned for it (the CDK plan
// only ships GOOGLE_CLIENT_SECRET/JWT_SECRET/TOKEN_ENC_KEY) so it reuses
// JWT_SECRET -- both are backend-only secrets never exposed to the client.
export const authzDeps: AuthzDeps = { workspaces, users, memberships, driveFor };

export const authService = new AuthService({
  users,
  memberships,
  google,
  config: { jwtSecret: config.jwtSecret, stateSecret: config.jwtSecret },
});

export const workspaceService = new WorkspaceService({ workspaces, memberships, users, driveFor });

export const memberService = new MemberService(authzDeps);
