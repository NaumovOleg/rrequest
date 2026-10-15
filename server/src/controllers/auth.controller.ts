import {
  Controller,
  Get,
  Post,
  Body,
  QueryParam,
  Req,
  Res,
} from "@heliosjs/core";
import type { Request, Response } from "@heliosjs/core";
import { authService } from "../deps.js";
import { requireUser } from "../auth-plugin.js";

/**
 * Mounted at `/` under the `/api` root prefix (not `/auth`) so its routes
 * land at `/api/auth/start`, `/api/auth/callback` and `/api/me` -- matching
 * the legacy Fastify app's topology (`server/src/app.ts`) and, critically,
 * `authPlugin`'s `/api/auth/*` skip rule: `/start`/`/callback` are the
 * unauthenticated OAuth entry points, while `/me` must stay outside that
 * skip so the plugin still resolves its caller.
 */
@Controller("/")
export class AuthController {
  @Get("/auth/start")
  start(
    @QueryParam("cb") cb: string | undefined,
    @Res() res: Response
  ): { status: number; error?: string } {
    try {
      const url = authService.startUrl(cb ?? "");
      res.setHeader("location", url);
      return { status: 302 };
    } catch {
      return { status: 400, error: "cb must be an http loopback url" };
    }
  }

  @Get("/auth/callback")
  async callback(
    @QueryParam("code") code: string | undefined,
    @QueryParam("state") state: string | undefined,
    @Res() res: Response
  ): Promise<{ status: number; error?: string }> {
    if (!code || !state)
      return { status: 400, error: "invalid or expired state" };
    try {
      const { redirectUrl } = await authService.callback(code, state);
      res.setHeader("location", redirectUrl);
      return { status: 302 };
    } catch {
      return { status: 400, error: "authentication failed" };
    }
  }

  // Unauthenticated (the access token is what's expired): exchange a refresh
  // token for a fresh access token. Lives under /api/auth/* so authPlugin skips it.
  @Post("/auth/refresh")
  async refresh(
    @Body() body: { refresh?: string }
  ): Promise<{ token: string } | { status: number; error: string }> {
    const refresh = body?.refresh;
    if (!refresh) return { status: 400, error: "refresh token required" };
    const result = await authService.refresh(refresh);
    if (!result) return { status: 401, error: "unauthorized" };
    return result;
  }

  @Get("/me")
  async me(
    @Req() req: Request
  ): Promise<{ id: string; email: string } | { status: 401; error: string }> {
    const authUser = requireUser(req);
    const me = await authService.me(authUser.id);
    if (!me) return { status: 401, error: "unauthorized" };
    return me;
  }
}
