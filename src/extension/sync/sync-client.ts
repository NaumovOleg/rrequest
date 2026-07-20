export type RemoteWorkspace = {
  id: string
  name: string
  ownerUserId: string
  driveFileId: string
  revision: string
  updatedAt: number
}

export class SyncClient {
  private baseUrl: string
  private getToken: () => string | undefined
  private fetchImpl: typeof fetch
  constructor(opts: { baseUrl: string; getToken: () => string | undefined; fetchImpl?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.getToken = opts.getToken
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.getToken() ?? ''}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) throw new Error(`sync request failed: ${res.status}`)
    return (await res.json()) as T
  }

  me(): Promise<{ id: string; email: string }> {
    return this.call('/me')
  }
  listWorkspaces(): Promise<RemoteWorkspace[]> {
    return this.call('/workspaces')
  }
  enableSync(workspaceId: string, name: string, snapshot: string): Promise<{ driveFileId: string; revision: string }> {
    return this.call('/workspaces', { method: 'POST', body: { workspaceId, name, snapshot } })
  }
  push(id: string, snapshot: string): Promise<{ revision: string }> {
    return this.call(`/workspaces/${id}`, { method: 'PUT', body: { snapshot } })
  }
  pull(id: string): Promise<{ snapshot: string; revision: string }> {
    return this.call(`/workspaces/${id}`)
  }
}
