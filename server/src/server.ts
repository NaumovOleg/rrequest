import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { UserStore } from "./user-store.js";
import { GoogleOAuth } from "./google-oauth.js";
import { PendingStates } from "./pending-states.js";
import { WorkspaceStore } from "./workspace-store.js";
import { makeDriveFactory } from "./drive-factory.js";
import { Realtime } from "./realtime.js";

const config = loadConfig();
const workspaces = new WorkspaceStore(config.dbPath);
const driveFor = makeDriveFactory(config);
const app = buildApp({
  config,
  users: new UserStore(config.dbPath, config.tokenEncKey),
  google: GoogleOAuth.create({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  }),
  states: new PendingStates(),
  workspaces,
  driveFor,
  realtime: new Realtime(),
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then((addr) => console.log(`restman sync server on ${addr}`))
  .catch((err) => { console.error(err); process.exit(1); });
