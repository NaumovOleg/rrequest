import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'

export type StoresPort = {
  getCollections(workspaceId: string): Promise<Collection[]>
  getEnvironments(workspaceId: string): Promise<Environment[]>
  applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void>
}

export class SyncManager {
  constructor(private deps: { client: SyncClient; state: SyncStateStore; stores: StoresPort; email: () => string }) {}

  private async snapshotText(workspaceId: string, name: string): Promise<string> {
    const [collections, environments] = await Promise.all([
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return JSON.stringify(buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() }))
  }

  async enable(workspaceId: string, name: string): Promise<void> {
    const snapshot = await this.snapshotText(workspaceId, name)
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, name, snapshot)
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    // name is carried in the snapshot; re-derive from stores is unnecessary — use the workspace id as the file already exists.
    const snapshot = await this.snapshotText(workspaceId, workspaceId)
    const { revision } = await this.deps.client.push(workspaceId, snapshot)
    await this.deps.state.set(workspaceId, { ...state, lastRevision: revision })
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
