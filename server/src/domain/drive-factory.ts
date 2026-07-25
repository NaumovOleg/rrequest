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

export function makeDriveFactory(config: Config): DriveFactory {
  return (user: User): DriveClient => {
    const oauth = new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
    oauth.setCredentials({ refresh_token: user.refreshToken });
    const getAccessToken = async (): Promise<string> => {
      const { token } = await oauth.getAccessToken();
      if (!token) throw new Error("could not obtain a Google access token");
      return token;
    };
    return new GoogleDriveClient(getAccessToken);
  };
}
