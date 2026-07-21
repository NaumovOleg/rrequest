import type { Collection, Environment } from '../../shared/types'
import type { CollectionStore } from '../collection-store'
import type { EnvironmentStore } from '../environment-store'
import type { WorkspaceStore } from '../workspace-store'
import type { StoresPort } from './sync-manager'

export function buildStoresPort(collections: CollectionStore, environments: EnvironmentStore, workspaces: WorkspaceStore): StoresPort {
  return {
    async getName(workspaceId: string): Promise<string> {
      const ws = (await workspaces.list()).find((w) => w.id === workspaceId)
      return ws?.name ?? workspaceId
    },
    async getCollections(workspaceId: string): Promise<Collection[]> {
      return (await collections.list()).filter((c) => (c.workspaceId || workspaceId) === workspaceId)
    },
    async getEnvironments(workspaceId: string): Promise<Environment[]> {
      return (await environments.list()).filter((e) => (e.workspaceId || workspaceId) === workspaceId)
    },
    async applyPulled(_workspaceId: string, cols: Collection[], envs: Environment[]): Promise<void> {
      for (const c of cols) await collections.saveCollection(c)
      for (const e of envs) await environments.saveEnvironment(e)
    },
  }
}
