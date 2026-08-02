export type WatchOpts = { channelId: string; address: string; token: string; ttlSeconds?: number };
export type WatchInfo = { channelId: string; resourceId: string; expiration: number };

export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }>;
  updateFile(fileId: string, content: string): Promise<{ revision: string }>;
  renameFile(fileId: string, name: string): Promise<void>;
  readFile(fileId: string): Promise<string>;
  getHeadRevision(fileId: string): Promise<string>;
  listFiles(folderId: string): Promise<{ id: string; name: string; headRevision: string }[]>;
  watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo>;
  stopChannel(opts: { channelId: string; resourceId: string }): Promise<void>;
  createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }>;
  deletePermission(fileId: string, permissionId: string): Promise<void>;
  trashFile(fileId: string): Promise<void>;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export type GoogleDriveClientOpts = {
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 250;
const MAX_BACKOFF_DELAY_MS = 8000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GoogleDriveClient implements DriveClient {
  private maxRetries: number;
  private baseDelayMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private getAccessToken: () => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
    opts?: GoogleDriveClientOpts,
  ) {
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = opts?.sleep ?? realSleep;
  }

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.getAccessToken()}` };
  }

  private backoffDelay(attempt: number, retryAfterSeconds: number | null): number {
    if (retryAfterSeconds !== null && !Number.isNaN(retryAfterSeconds)) {
      return Math.max(0, retryAfterSeconds * 1000);
    }
    const exp = Math.min(this.baseDelayMs * 2 ** attempt, MAX_BACKOFF_DELAY_MS);
    const jitter = Math.random() * exp * 0.25;
    return exp + jitter;
  }

  private parseRetryAfter(res: { headers?: { get(name: string): string | null } }): number | null {
    const raw = res.headers?.get?.("retry-after");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private async fetchWithRetry(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let res: Response | undefined;
      let thrown: unknown;
      try {
        res = await this.fetchImpl(url, init);
      } catch (e) {
        thrown = e;
      }

      const retryableStatus = res !== undefined && (res.status === 429 || res.status >= 500);
      const attemptsRemain = attempt < this.maxRetries;

      if (thrown !== undefined) {
        if (!attemptsRemain) throw thrown;
        await this.sleep(this.backoffDelay(attempt, null));
        attempt++;
        continue;
      }

      if (retryableStatus && attemptsRemain) {
        const retryAfter = this.parseRetryAfter(res!);
        await this.sleep(this.backoffDelay(attempt, retryAfter));
        attempt++;
        continue;
      }

      return res!;
    }
  }

  async ensureFolder(name: string): Promise<string> {
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const listRes = await this.fetchWithRetry(`${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`, { headers: await this.auth() });
    if (!listRes.ok) throw new Error(`Drive list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { files?: { id: string }[] };
    if (list.files && list.files[0]) return list.files[0].id;
    const createRes = await this.fetchWithRetry(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!createRes.ok) throw new Error(`Drive folder create failed: ${createRes.status}`);
    return ((await createRes.json()) as { id: string }).id;
  }

  async createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }> {
    const boundary = "rmbnd" + Math.random().toString(36).slice(2);
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\ncontent-type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.fetchWithRetry(`${UPLOAD}/files?uploadType=multipart&fields=id,headRevisionId`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const j = (await res.json()) as { id: string; headRevisionId?: string };
    return { fileId: j.id, revision: j.headRevisionId ?? "" };
  }

  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const res = await this.fetchWithRetry(`${UPLOAD}/files/${fileId}?uploadType=media&fields=headRevisionId`, {
      method: "PATCH",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: content,
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    return { revision: ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "" };
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}?fields=id`, {
      method: "PATCH",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Drive rename failed: ${res.status}`);
  }

  async readFile(fileId: string): Promise<string> {
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}?alt=media`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    return await res.text();
  }

  async getHeadRevision(fileId: string): Promise<string> {
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}?fields=headRevisionId`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive head-revision failed: ${res.status}`);
    return ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "";
  }

  async listFiles(folderId: string): Promise<{ id: string; name: string; headRevision: string }[]> {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await this.fetchWithRetry(`${DRIVE}/files?q=${q}&fields=files(id,name,headRevisionId)&spaces=drive`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const j = (await res.json()) as { files?: { id: string; name: string; headRevisionId?: string }[] };
    return (j.files ?? []).map((f) => ({ id: f.id, name: f.name, headRevision: f.headRevisionId ?? "" }));
  }

  async watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo> {
    const body: Record<string, unknown> = { id: opts.channelId, type: "web_hook", address: opts.address, token: opts.token };
    if (opts.ttlSeconds) body.expiration = Date.now() + opts.ttlSeconds * 1000;
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}/watch?fields=resourceId,expiration`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Drive watch failed: ${res.status}`);
    const j = (await res.json()) as { resourceId: string; expiration?: string };
    return { channelId: opts.channelId, resourceId: j.resourceId, expiration: j.expiration ? Number(j.expiration) : Date.now() + 3600_000 };
  }

  async stopChannel(opts: { channelId: string; resourceId: string }): Promise<void> {
    const res = await this.fetchWithRetry(`${DRIVE}/channels/stop`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ id: opts.channelId, resourceId: opts.resourceId }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive channel stop failed: ${res.status}`);
  }

  async createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }> {
    const q = `sendNotificationEmail=${opts.sendNotificationEmail ? "true" : "false"}&fields=id`;
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}/permissions?${q}`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ role: opts.role, type: "user", emailAddress: opts.email }),
    });
    if (!res.ok) throw new Error(`Drive permission create failed: ${res.status}`);
    return { permissionId: ((await res.json()) as { id: string }).id };
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}/permissions/${permissionId}`, {
      method: "DELETE",
      headers: await this.auth(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive permission delete failed: ${res.status}`);
  }

  async trashFile(fileId: string): Promise<void> {
    const res = await this.fetchWithRetry(`${DRIVE}/files/${fileId}`, {
      method: "PATCH",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive trash failed: ${res.status}`);
  }
}

// In-memory DriveClient for tests.
export class FakeDriveClient implements DriveClient {
  private folders = new Map<string, string>();
  private files = new Map<string, { content: string; revision: number; folderId: string; name: string }>();
  private channels = new Map<string, { fileId: string; resourceId: string; token: string; expiration: number }>();
  private perms = new Map<string, { permissionId: string; email: string; role: "writer" | "reader" }[]>();
  private seq = 0;
  private permSeq = 0;

  async ensureFolder(name: string): Promise<string> {
    if (!this.folders.has(name)) this.folders.set(name, `folder-${name}`);
    return this.folders.get(name)!;
  }
  async createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }> {
    const fileId = `file-${++this.seq}`;
    this.files.set(fileId, { content, revision: 1, folderId, name });
    return { fileId, revision: "1" };
  }
  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    f.content = content;
    f.revision += 1;
    return { revision: String(f.revision) };
  }
  async renameFile(fileId: string, name: string): Promise<void> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    f.name = name;
  }
  async readFile(fileId: string): Promise<string> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    return f.content;
  }
  async getHeadRevision(fileId: string): Promise<string> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    return String(f.revision);
  }
  async listFiles(folderId: string): Promise<{ id: string; name: string; headRevision: string }[]> {
    const out: { id: string; name: string; headRevision: string }[] = [];
    for (const [id, f] of this.files) if (f.folderId === folderId) out.push({ id, name: f.name, headRevision: String(f.revision) });
    return out;
  }
  async watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo> {
    const resourceId = `res-${opts.channelId}`;
    const expiration = Date.now() + (opts.ttlSeconds ?? 3600) * 1000;
    this.channels.set(opts.channelId, { fileId, resourceId, token: opts.token, expiration });
    return { channelId: opts.channelId, resourceId, expiration };
  }
  async stopChannel(opts: { channelId: string; resourceId: string }): Promise<void> {
    this.channels.delete(opts.channelId);
  }
  // test helper
  watched(channelId: string) { return this.channels.get(channelId); }

  async createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }> {
    const permissionId = `perm-${++this.permSeq}`;
    const list = this.perms.get(fileId) ?? [];
    list.push({ permissionId, email: opts.email, role: opts.role });
    this.perms.set(fileId, list);
    return { permissionId };
  }
  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    this.perms.set(fileId, (this.perms.get(fileId) ?? []).filter((p) => p.permissionId !== permissionId));
  }
  // test helper
  permissions(fileId: string) { return this.perms.get(fileId) ?? []; }

  private trashedIds = new Set<string>();
  async trashFile(fileId: string): Promise<void> {
    this.files.delete(fileId);
    this.trashedIds.add(fileId);
  }
  // test helper
  trashed(fileId: string): boolean { return this.trashedIds.has(fileId); }
}
