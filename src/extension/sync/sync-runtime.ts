import type { SyncManager } from './sync-manager'
import type { SyncSocket, ChangeMsg } from './sync-socket'

const MUTATING = new Set<string>([
  'createCollection', 'renameCollection', 'deleteCollection',
  'createFolder', 'renameFolder', 'deleteFolder', 'moveFolder',
  'createRequest', 'saveRequest', 'renameRequest', 'deleteRequest', 'duplicateRequest', 'moveRequest',
  'setCollectionEnvironment',
  'createEnvironment', 'saveEnvironment', 'deleteEnvironment',
  'importCollection', 'restoreTrash', 'purgeTrash',
])

export function isMutating(msgType: string): boolean {
  return MUTATING.has(msgType)
}

export function createSyncRuntime(deps: {
  manager: SyncManager
  socket: SyncSocket
  onPulled: () => Promise<void>
  debounceMs?: number
}) {
  const debounceMs = deps.debounceMs ?? 1500
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const schedulePush = (workspaceId: string): void => {
    if (!workspaceId) return
    clearTimeout(timers.get(workspaceId))
    timers.set(workspaceId, setTimeout(() => { void deps.manager.push(workspaceId) }, debounceMs))
  }

  return {
    manager: deps.manager,
    schedulePush,
    start(): void {
      deps.socket.start()
    },
    stop(): void {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      deps.socket.stop()
    },
    // exposed so the host can route socket changes → pull → refresh
    async onSocketChange(m: ChangeMsg): Promise<void> {
      const changed = await deps.manager.pullIfNewer(m.workspaceId, m.revision)
      if (changed) await deps.onPulled()
    },
    // manual sync path repaints open webviews the same way auto-pull does
    refresh: () => deps.onPulled(),
  }
}
