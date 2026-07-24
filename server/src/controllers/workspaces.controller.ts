import { Controller, Get, Post, Put, Body, Params, Req } from "@heliosjs/core";
import type { Request } from "@heliosjs/core";
import { workspaceService } from "../deps.js";
import { requireUser } from "../auth-plugin.js";
import { toHttpResult } from "./http-result.js";

@Controller("/workspaces")
export class WorkspacesController {
  @Post("/")
  async enable(@Req() req: Request, @Body() body: { workspaceId?: string; name?: string; snapshot?: string }) {
    const user = requireUser(req);
    const { workspaceId, name, snapshot } = body ?? {};
    if (!workspaceId || !name || typeof snapshot !== "string") {
      return { status: 400, error: "workspaceId, name, snapshot required" };
    }
    const result = await workspaceService.enable(user, { workspaceId, name, snapshot });
    return toHttpResult(result);
  }

  @Get("/")
  async list(@Req() req: Request) {
    const user = requireUser(req);
    return workspaceService.list(user);
  }

  @Get("/:id")
  async pull(@Req() req: Request, @Params("id") id: string) {
    const user = requireUser(req);
    const result = await workspaceService.pull(user, id);
    return toHttpResult(result);
  }

  @Put("/:id")
  async push(
    @Req() req: Request,
    @Params("id") id: string,
    @Body() body: { snapshot?: string; baseRevision?: string },
  ) {
    const user = requireUser(req);
    const result = await workspaceService.push(user, id, body ?? {});
    return toHttpResult(result);
  }
}
