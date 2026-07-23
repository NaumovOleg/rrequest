export class SyncForbiddenError extends Error {
  constructor(message = 'forbidden') { super(message); this.name = 'SyncForbiddenError' }
}

export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }

export type RemoteWorkspace = {
  id: string
  name: string
  ownerUserId: string
  driveFileId: string
  revision: string
  updatedAt: number
  role?: WorkspaceRole
}

export type PushResult =
  | { ok: true; revision: string }
  | { ok: false; conflict: true; snapshot: string; revision: string }

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
    if (res.status === 403) throw new SyncForbiddenError()
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
  async push(id: string, snapshot: string, baseRevision: string): Promise<PushResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/workspaces/${id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.getToken() ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot, baseRevision }),
    })
    if (res.status === 409) {
      const body = (await res.json()) as { snapshot: string; revision: string }
      return { ok: false, conflict: true, snapshot: body.snapshot, revision: body.revision }
    }
    if (res.status === 403) throw new SyncForbiddenError()
    if (!res.ok) throw new Error(`sync request failed: ${res.status}`)
    const body = (await res.json()) as { revision: string }
    return { ok: true, revision: body.revision }
  }
  pull(id: string): Promise<{ snapshot: string; revision: string; role?: WorkspaceRole }> {
    return this.call(`/workspaces/${id}`)
  }
  async listMembers(id: string): Promise<Member[]> {
    const body = await this.call<{ members: Member[] }>(`/workspaces/${id}/members`)
    return body.members
  }
  addMember(id: string, input: { email: string; role: 'editor' | 'viewer' }): Promise<Member> {
    return this.call(`/workspaces/${id}/members`, { method: 'POST', body: input })
  }
  async removeMember(id: string, memberId: string): Promise<void> {
    await this.call(`/workspaces/${id}/members/${memberId}`, { method: 'DELETE' })
  }
}
