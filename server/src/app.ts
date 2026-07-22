import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { GoogleOAuth } from "./google-oauth.js";
import type { PendingStates } from "./pending-states.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { Realtime } from "./realtime.js";
import type { WatchService } from "./watch-service.js";
import { randomUUID } from "node:crypto";
import { signSession } from "./jwt.js";
import { requireUser } from "./auth.js";
import { folderNameForUser } from "./drive-factory.js";
import type { MembershipStore } from "./membership-store.js";
import { resolveRole, ownerDriveFor } from "./authz.js";

export type AppDeps = {
  config: Config;
  users: UserStore;
  google: GoogleOAuth;
  states: PendingStates;
  workspaces: WorkspaceStore;
  driveFor: DriveFactory;
  realtime: Realtime;
  watchService?: WatchService;
  memberships: MembershipStore;
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

  // Google Drive `files.watch` push notifications arrive with headers set but
  // an empty body, sometimes tagged `content-type: application/json`.
  // Fastify's default JSON body parser 400s on an empty JSON body
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which would make Google retry and
  // eventually disable the channel. This route never reads req.body, so we
  // scope a permissive no-op content-type parser to this route only via an
  // encapsulated child plugin -- the parent app's JSON parser (needed by
  // /workspaces etc.) is untouched.
  app.register(async (webhook) => {
    webhook.removeAllContentTypeParsers();
    webhook.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined));
    webhook.post("/webhook", async (req, reply) => {
      const h = req.headers as Record<string, string | undefined>;
      const channelId = h["x-goog-channel-id"] ?? "";
      const token = h["x-goog-channel-token"] ?? "";
      const resourceState = h["x-goog-resource-state"] ?? "";
      await deps.watchService?.handleNotification({ channelId, token, resourceState });
      return reply.code(200).send({ ok: true });
    });
  });

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
    await deps.watchService?.ensureWatch(workspaceId);
    return reply.code(201).send({ driveFileId: fileId, revision });
  });

  app.get("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const owned = deps.workspaces.listByOwner(user.id).map((w) => ({ ...w, role: "owner" as const }));
    const ownedIds = new Set(owned.map((w) => w.id));
    const shared = deps.memberships.listByUser(user.id)
      .filter((m) => !ownedIds.has(m.workspaceId))
      .map((m) => { const w = deps.workspaces.get(m.workspaceId); return w ? { ...w, role: m.role } : undefined; })
      .filter((w): w is NonNullable<typeof w> => !!w);
    return [...owned, ...shared];
  });

  app.put("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    const role = resolveRole(deps, id, user.id);
    if (role !== "owner" && role !== "editor") return reply.code(403).send({ error: "forbidden" });
    const { snapshot, baseRevision } = req.body as { snapshot?: string; baseRevision?: string };
    if (typeof snapshot !== "string" || typeof baseRevision !== "string") return reply.code(400).send({ error: "snapshot + baseRevision required" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
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
    const role = resolveRole(deps, id, user.id);
    if (!role) return reply.code(403).send({ error: "forbidden" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
    const snapshot = await drive.readFile(ws.driveFileId);
    return { snapshot, revision: ws.revision, role };
  });

  app.post("/workspaces/:id/members", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (resolveRole(deps, id, user.id) !== "owner") return reply.code(403).send({ error: "forbidden" });
    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || (role !== "editor" && role !== "viewer")) return reply.code(400).send({ error: "email + role (editor|viewer) required" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
    const { permissionId } = await drive.createPermission(ws.driveFileId, { email, role: role === "editor" ? "writer" : "reader", sendNotificationEmail: true });
    const account = deps.users.getByEmail(email);
    const m = deps.memberships.add(account
      ? { workspaceId: id, userId: account.id, role, permissionId }
      : { workspaceId: id, pendingEmail: email, role, permissionId });
    return reply.code(201).send({ id: m.id, email, role, pending: !account });
  });

  app.get("/workspaces/:id/members", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (!resolveRole(deps, id, user.id)) return reply.code(403).send({ error: "forbidden" });
    const ownerEmail = deps.users.getById(ws.ownerUserId)?.email ?? "";
    const members = [
      { email: ownerEmail, role: "owner" as const, pending: false },
      ...deps.memberships.listByWorkspace(id).map((m) => ({
        id: m.id,
        email: m.userId ? (deps.users.getById(m.userId)?.email ?? "") : (m.pendingEmail ?? ""),
        role: m.role,
        pending: !m.userId,
      })),
    ];
    return { members };
  });

  app.delete("/workspaces/:id/members/:memberId", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id, memberId } = req.params as { id: string; memberId: string };
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (resolveRole(deps, id, user.id) !== "owner") return reply.code(403).send({ error: "forbidden" });
    const m = deps.memberships.getById(memberId);
    if (!m || m.workspaceId !== id) return reply.code(404).send({ error: "member not found" });
    const drive = ownerDriveFor(deps, ws);
    if (drive) { try { await drive.deletePermission(ws.driveFileId, m.permissionId); } catch { /* best-effort */ } }
    deps.memberships.remove(memberId);
    return { ok: true };
  });

  return app;
}
