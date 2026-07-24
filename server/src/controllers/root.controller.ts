import { Controller } from "@heliosjs/core";
import type { ControllerConfig } from "@heliosjs/core/types";
import { AuthController } from "./auth.controller.js";
import { WorkspacesController } from "./workspaces.controller.js";
import { MembersController } from "./members.controller.js";

// NOTE: `ControllerConfig.controllers` is typed as `ControllerInstance[]`
// (see @heliosjs/core@3.2.0 dist/types/core/controller.d.ts), but the actual
// runtime (dist/descriptors/meta.js: `controller.controllers.map((Controller)
// => new Controller(meta))`) and the decorator's own validation
// (dist/Controller.js: `controllers.some((c) => typeof c !== 'function')`)
// both require *classes*, not instances -- a mismatch between the package's
// .d.ts and its compiled .js. Passing classes (matching runtime behavior) and
// casting through the misdeclared type.
@Controller({
  prefix: "/api",
  controllers: [AuthController, WorkspacesController, MembersController] as unknown as ControllerConfig["controllers"],
})
export class RootController {}
