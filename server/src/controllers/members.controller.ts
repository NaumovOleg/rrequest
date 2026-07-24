import { Controller, Get, Post, Delete, Body, Params, Req } from "@heliosjs/core";
import type { Request } from "@heliosjs/core";
import type { Role } from "../stores/types.js";
import { memberService } from "../deps.js";
import { requireUser } from "../auth-plugin.js";
import { toHttpResult } from "./http-result.js";

@Controller("/workspaces")
export class MembersController {
  @Get("/:id/members")
  async list(@Req() req: Request, @Params("id") id: string) {
    const user = requireUser(req);
    const result = await memberService.list(user, id);
    return toHttpResult(result);
  }

  @Post("/:id/members")
  async add(@Req() req: Request, @Params("id") id: string, @Body() body: { email?: string; role?: Role }) {
    const user = requireUser(req);
    const { email, role } = body ?? {};
    if (!email || (role !== "editor" && role !== "viewer")) {
      return { status: 400, error: "email + role (editor|viewer) required" };
    }
    const result = await memberService.add(user, id, { email, role });
    return toHttpResult(result);
  }

  @Delete("/:id/members/:memberId")
  async remove(@Req() req: Request, @Params("id") id: string, @Params("memberId") memberId: string) {
    const user = requireUser(req);
    const result = await memberService.remove(user, id, memberId);
    return toHttpResult(result);
  }
}
