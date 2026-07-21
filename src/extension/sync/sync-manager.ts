import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'
import { mergeSnapshots } from './merge'

export type StoresPort = {
  getName(workspaceId: string): Promise<string>
  getCollections(workspaceId: string): Promise<Collection[]>
  getEnvironments(workspaceId: string): Promise<Environment[]>
  applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void>
}

export class SyncManager {
  constructor(private deps: { client: SyncClient; state: SyncStateStore; stores: StoresPort; email: () => string }) {}

  private async buildLocalSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const [name, collections, environments] = await Promise.all([
      this.deps.stores.getName(workspaceId),
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() })
  }

  async enable(workspaceId: string): Promise<void> {
    const snap = await this.buildLocalSnapshot(workspaceId)
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, snap.name, JSON.stringify(snap))
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    const local = await this.buildLocalSnapshot(workspaceId)
    const first = await this.deps.client.push(workspaceId, JSON.stringify(local), state.lastRevision)
    if (first.ok) { await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision }); return }
    // conflict: merge remote + local, apply locally, retry once against the remote revision
    const remote = JSON.parse(first.snapshot) as WorkspaceSnapshot
    const merged = mergeSnapshots(remote, local)
    const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
    await this.deps.stores.applyPulled(workspaceId, merged.collections, mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs))
    const retry = await this.deps.client.push(workspaceId, JSON.stringify(merged), first.revision)
    if (retry.ok) await this.deps.state.set(workspaceId, { ...state, lastRevision: retry.revision })
  }

  async pull(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    const { snapshot, revision } = await this.deps.client.pull(workspaceId)
    const parsed = JSON.parse(snapshot) as WorkspaceSnapshot
    const local = await this.deps.stores.getEnvironments(workspaceId)
    const environments = mergeEnvironmentsPreservingSecrets(parsed.environments, local)
    await this.deps.stores.applyPulled(workspaceId, parsed.collections, environments)
    await this.deps.state.set(workspaceId, { ...state, lastRevision: revision })
  }
}
