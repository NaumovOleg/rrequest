import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { GoogleDriveClient, type DriveClient } from "./drive-client.js";
import type { User } from "../stores/types.js";
import type { Config } from "./config.js";

export function folderNameForUser(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `${hash}-restman`;
}

export type DriveFactory = (user: User) => DriveClient;

// Thrown when Google refuses to mint a fresh access token for a user's
// stored refresh token -- almost always because the user revoked restman's
// Drive access or the refresh token otherwise expired. Callers (services)
// catch this and surface a 401 so the client knows to prompt re-auth,
// instead of a generic 500.
export class DriveAuthError extends Error {
  constructor(message = "drive auth failed") {
    super(message);
    this.name = "DriveAuthError";
  }
}

export function makeDriveFactory(config: Config): DriveFactory {
  return (user: User): DriveClient => {
    const oauth = new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
    oauth.setCredentials({ refresh_token: user.refreshToken });
    const getAccessToken = async (): Promise<string> => {
      let token: string | null | undefined;
      try {
        ({ token } = await oauth.getAccessToken());
      } catch (e) {
        throw new DriveAuthError(e instanceof Error ? e.message : "drive auth failed");
      }
      if (!token) throw new DriveAuthError("could not obtain a Google access token");
      return token;
    };
    return new GoogleDriveClient(getAccessToken);
  };
}
