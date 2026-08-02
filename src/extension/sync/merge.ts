import type { Collection, Folder, CollectionItem, Environment } from '../../shared/types'
import type { WorkspaceSnapshot } from './snapshot'

function addMissingRequests(target: CollectionItem[], local: CollectionItem[]): void {
  for (const r of local) if (!target.some((x) => x.id === r.id)) target.push(r)
}

function mergeFolders(remote: Folder[], local: Folder[]): Folder[] {
  const out = remote.map((f) => ({ ...f, requests: [...f.requests] }))
  for (const lf of local) {
    const rf = out.find((f) => f.id === lf.id)
    if (!rf) out.push({ ...lf, requests: [...lf.requests] })
    else addMissingRequests(rf.requests, lf.requests)
  }
  return out
}

function mergeCollections(remote: Collection[], local: Collection[]): Collection[] {
  const out = remote.map((c) => ({ ...c, requests: [...c.requests], folders: [...(c.folders ?? [])] }))
  for (const lc of local) {
    const rc = out.find((c) => c.id === lc.id)
    if (!rc) { out.push({ ...lc, requests: [...lc.requests], folders: [...(lc.folders ?? [])] }); continue }
    addMissingRequests(rc.requests, lc.requests)
    rc.folders = mergeFolders(rc.folders ?? [], lc.folders ?? [])
  }
  return out
}

function mergeEnvironments(remote: Environment[], local: Environment[]): Environment[] {
  const out = remote.map((e) => ({ ...e, variables: [...e.variables] }))
  for (const le of local) {
    const re = out.find((e) => e.id === le.id)
    if (!re) { out.push({ ...le, variables: [...le.variables] }); continue }
    for (const lv of le.variables) if (!re.variables.some((v) => v.key === lv.key)) re.variables.push(lv)
  }
  return out
}

// Union merge: the FIRST arg wins for items present on both sides (matched by
// id / env-var key); items present on only one side are always kept. So this
// never drops data — for a PULL pass `mergeSnapshots(remote, local)` (remote
// wins concurrent edits); for a PUSH pass `mergeSnapshots(local, remote)`
// (the user's local edits win, but remote-only items are preserved, so a
// stale/empty local can never wipe the remote file).
export function mergeSnapshots(remote: WorkspaceSnapshot, local: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...remote,
    collections: mergeCollections(remote.collections, local.collections),
    environments: mergeEnvironments(remote.environments, local.environments),
  }
}

// Remove explicitly-deleted ids (collections, folders, requests, environments)
// from a merged snapshot before pushing. The union above re-adds anything the
// remote still has; this is how an explicit delete actually propagates to the
// remote (only ids the user deleted are dropped — nothing else).
export function pruneDeleted(snap: WorkspaceSnapshot, deleted: Set<string>): WorkspaceSnapshot {
  if (deleted.size === 0) return snap
  const keep = (id: string): boolean => !deleted.has(id)
  return {
    ...snap,
    collections: snap.collections
      .filter((c) => keep(c.id))
      .map((c) => ({
        ...c,
        requests: c.requests.filter((r) => keep(r.id)),
        folders: (c.folders ?? [])
          .filter((f) => keep(f.id))
          .map((f) => ({ ...f, requests: f.requests.filter((r) => keep(r.id)) })),
      })),
    environments: snap.environments.filter((e) => keep(e.id)),
  }
}
