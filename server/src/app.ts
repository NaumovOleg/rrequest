import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { GoogleOAuth } from "./google-oauth.js";
import type { PendingStates } from "./pending-states.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { Realtime } from "./realtime.js";
import { randomUUID } from "node:crypto";
import { signSession } from "./jwt.js";
import { requireUser } from "./auth.js";
import { folderNameForUser } from "./drive-factory.js";

export type AppDeps = {
  config: Config;
  users: UserStore;
  google: GoogleOAuth;
  states: PendingStates;
  workspaces: WorkspaceStore;
  driveFor: DriveFactory;
  realtime: Realtime;
};

function stripSnapshotSecrets(snapshot: string): string {
  try {
    const obj = JSON.parse(snapshot) as { environments?: { variables?: { secret?: boolean; value?: string }[] }[] };
    for (const env of obj.environments ?? []) {
      for (const v of env.variables ?? []) if (v.secret === true) v.value = "";
    }
    return JSON.stringify(obj);
  } catch {
    return snapshot;
  }
}

function isLoopbackCb(cb: string): boolean {
  try {
    const u = new URL(cb);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "::1");
  } catch {
    return false;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get("/auth/start", async (req, reply) => {
    const cb = (req.query as { cb?: string }).cb;
    if (!cb || !isLoopbackCb(cb)) return reply.code(400).send({ error: "cb must be an http loopback url" });
    const state = randomUUID();
    deps.states.put(state, cb);
    return reply.redirect(deps.google.authUrl(state));
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const cb = state ? deps.states.take(state) : undefined;
    if (!code || !cb) return reply.code(400).send({ error: "invalid or expired state" });
    try {
      const profile = await deps.google.exchange(code);
      const user = deps.users.upsertByGoogle(profile);
      const token = signSession(user.id, deps.config.jwtSecret);
      const url = new URL(cb);
      url.searchParams.set("token", token);
      return reply.redirect(url.toString());
    } catch {
      return reply.code(400).send({ error: "authentication failed" });
    }
  });

  app.get("/me", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { id: user.id, email: user.email };
  });

  app.post("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { workspaceId, name, snapshot } = req.body as { workspaceId?: string; name?: string; snapshot?: string };
    if (!workspaceId || !name || typeof snapshot !== "string") return reply.code(400).send({ error: "workspaceId, name, snapshot required" });
    const existing = deps.workspaces.get(workspaceId);
    if (existing && existing.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const clean = stripSnapshotSecrets(snapshot);
    const drive = deps.driveFor(user);
    let fileId: string;
    let hashFolderId: string;
    let revision: string;
    if (existing) {
      const updated = await drive.updateFile(existing.driveFileId, clean);
      fileId = existing.driveFileId;
      hashFolderId = existing.hashFolderId;
      revision = updated.revision;
    } else {
      hashFolderId = await drive.ensureFolder(folderNameForUser(user.id));
      const created = await drive.createFile(hashFolderId, `${name}-${workspaceId}.json`, clean);
      fileId = created.fileId;
      revision = created.revision;
    }
    const now = Date.now();
    deps.workspaces.upsert({ id: workspaceId, name, ownerUserId: user.id, driveFileId: fileId, hashFolderId, revision, updatedAt: now });
    return reply.code(201).send({ driveFileId: fileId, revision });
  });

  app.get("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return deps.workspaces.listByOwner(user.id);
  });

  app.put("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (ws.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const { snapshot, baseRevision } = req.body as { snapshot?: string; baseRevision?: string };
    if (typeof snapshot !== "string" || typeof baseRevision !== "string") return reply.code(400).send({ error: "snapshot + baseRevision required" });
    const drive = deps.driveFor(user);
    if (baseRevision !== ws.revision) {
      const current = await drive.readFile(ws.driveFileId);
      return reply.code(409).send({ snapshot: current, revision: ws.revision });
    }
    const clean = stripSnapshotSecrets(snapshot);
    const { revision } = await drive.updateFile(ws.driveFileId, clean);
    deps.workspaces.setRevision(id, revision, Date.now());
    deps.realtime.broadcast(id, { type: "workspace-changed", workspaceId: id, revision, updatedBy: user.email });
    return { revision };
  });

  app.get("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (ws.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const snapshot = await deps.driveFor(user).readFile(ws.driveFileId);
    return { snapshot, revision: ws.revision };
  });

  return app;
}
