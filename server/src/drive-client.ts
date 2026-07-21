export type WatchOpts = { channelId: string; address: string; token: string; ttlSeconds?: number };
export type WatchInfo = { channelId: string; resourceId: string; expiration: number };

export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }>;
  updateFile(fileId: string, content: string): Promise<{ revision: string }>;
  readFile(fileId: string): Promise<string>;
  getHeadRevision(fileId: string): Promise<string>;
  watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo>;
  stopChannel(opts: { channelId: string; resourceId: string }): Promise<void>;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class GoogleDriveClient implements DriveClient {
  constructor(private getAccessToken: () => Promise<string>, private fetchImpl: typeof fetch = fetch) {}

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.getAccessToken()}` };
  }

  async ensureFolder(name: string): Promise<string> {
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const listRes = await this.fetchImpl(`${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`, { headers: await this.auth() });
    if (!listRes.ok) throw new Error(`Drive list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { files?: { id: string }[] };
    if (list.files && list.files[0]) return list.files[0].id;
    const createRes = await this.fetchImpl(`${DRIVE}/files?fields=id`, {
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
    const res = await this.fetchImpl(`${UPLOAD}/files?uploadType=multipart&fields=id,headRevisionId`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const j = (await res.json()) as { id: string; headRevisionId?: string };
    return { fileId: j.id, revision: j.headRevisionId ?? "" };
  }

  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const res = await this.fetchImpl(`${UPLOAD}/files/${fileId}?uploadType=media&fields=headRevisionId`, {
      method: "PATCH",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: content,
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    return { revision: ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "" };
  }

  async readFile(fileId: string): Promise<string> {
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}?alt=media`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    return await res.text();
  }

  async getHeadRevision(fileId: string): Promise<string> {
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}?fields=headRevisionId`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive head-revision failed: ${res.status}`);
    return ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "";
  }

  async watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo> {
    const body: Record<string, unknown> = { id: opts.channelId, type: "web_hook", address: opts.address, token: opts.token };
    if (opts.ttlSeconds) body.expiration = Date.now() + opts.ttlSeconds * 1000;
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}/watch?fields=resourceId,expiration`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Drive watch failed: ${res.status}`);
    const j = (await res.json()) as { resourceId: string; expiration?: string };
    return { channelId: opts.channelId, resourceId: j.resourceId, expiration: j.expiration ? Number(j.expiration) : Date.now() + 3600_000 };
  }

  async stopChannel(opts: { channelId: string; resourceId: string }): Promise<void> {
    const res = await this.fetchImpl(`${DRIVE}/channels/stop`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ id: opts.channelId, resourceId: opts.resourceId }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive channel stop failed: ${res.status}`);
  }
}

// In-memory DriveClient for tests.
export class FakeDriveClient implements DriveClient {
  private folders = new Map<string, string>();
  private files = new Map<string, { content: string; revision: number }>();
  private channels = new Map<string, { fileId: string; resourceId: string; token: string; expiration: number }>();
  private seq = 0;

  async ensureFolder(name: string): Promise<string> {
    if (!this.folders.has(name)) this.folders.set(name, `folder-${name}`);
    return this.folders.get(name)!;
  }
  async createFile(_folderId: string, _name: string, content: string): Promise<{ fileId: string; revision: string }> {
    const fileId = `file-${++this.seq}`;
    this.files.set(fileId, { content, revision: 1 });
    return { fileId, revision: "1" };
  }
  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    f.content = content;
    f.revision += 1;
    return { revision: String(f.revision) };
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
}
