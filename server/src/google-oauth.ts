import { OAuth2Client } from "google-auth-library";

export type GoogleProfile = { googleSub: string; email: string; refreshToken: string };

export interface OAuthClientLike {
  generateAuthUrl(opts: object): string;
  getToken(code: string): Promise<{ tokens: { id_token?: string | null; refresh_token?: string | null } }>;
  verifyIdToken(opts: { idToken: string; audience: string }): Promise<{ getPayload(): { sub?: string; email?: string } | undefined }>;
}

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
  "profile",
];

export class GoogleOAuth {
  constructor(private client: OAuthClientLike, private clientId: string) {}

  static create(cfg: { clientId: string; clientSecret: string; redirectUri: string }): GoogleOAuth {
    const client = new OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
    return new GoogleOAuth(client, cfg.clientId);
  }

  authUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      scope: SCOPES,
    });
  }

  async exchange(code: string): Promise<GoogleProfile> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");
    if (!tokens.id_token) throw new Error("Google did not return an id token");
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error("Google id token missing sub/email");
    return { googleSub: payload.sub, email: payload.email, refreshToken: tokens.refresh_token };
  }
}
