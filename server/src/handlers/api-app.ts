import "reflect-metadata";
import { Helios } from "@heliosjs/aws";
import { RootController } from "../controllers/root.controller.js";
import { makeAuthPlugin } from "../auth-plugin.js";
import { users, config } from "../deps.js";

const adapter = new Helios(RootController);
adapter.usePlugin(makeAuthPlugin({ users, jwtSecret: config.jwtSecret }));

export const handler = adapter.handler;
