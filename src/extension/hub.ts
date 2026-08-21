import type { Account, HostMessage, SyncScope, WebviewMessage } from '../shared/types'

type Sink = (m: HostMessage) => void

// How often the idle sweep may run when piggybacked on register/dispatch.
const SWEEP_EVERY_MS = 60_000
const DEFAULT_SINK_IDLE_MS = 30 * 60_000
/**
 * Fan-out hub shared by every surface. Each surface registers a sink under a
 * unique id: the sidebar as 'sidebar', and every editor panel under its own key
 * (e.g. `req:<id>`, 'env', 'ws'). Responses route back to the sender; "open"
 * replies are handed to the host via onOpen so it can create/reveal the right
 * panel; state snapshots broadcast to everyone.
 *
 * Perf: a sink whose unregister() was forgotten used to live forever. Safety
 * net: sinks idle for 30 min are evicted. "Idle" means no dispatches FROM that
 * surface AND no deliveries TO it — since every dispatch broadcasts to all
 * sinks, ANY hub traffic keeps every sink warm, so eviction only happens after
 * half an hour of total silence. Live-but-evicted surfaces self-heal: they
 * re-register on their next message (RrequestPanel / SidebarViewProvider).
 * The sweep piggybacks on register/dispatch calls instead of owning a timer,
 * so the hub never keeps the event loop alive.
 */
export class Hub {
  private readonly sinks = new Map<string, Sink>()
  private readonly lastSeen = new Map<string, number>()
  private lastSweep = 0
  private onOpen?: (m: HostMessage) => void
  private afterDispatch?: (msg: WebviewMessage) => void
  private clearSnapshotCache?: () => void
  // Serialise dispatches so concurrent webview messages don't overlap on
  // snapshot() or afterDispatch (which may trigger schedulePush).
  private dispatchChain: Promise<void> = Promise.resolve()
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
    // Injectable for tests; production uses the 30-min defaults below.
    private readonly gc: { sinkIdleMs?: number; sweepEveryMs?: number } = {},
  ) {}
  private get sinkIdleMs(): number { return this.gc.sinkIdleMs ?? DEFAULT_SINK_IDLE_MS }

  register(id: string, post: Sink): () => void {
    this.sinks.set(id, post)
    this.touch(id)
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id); this.lastSeen.delete(id) }
  }

  // True while the surface's sink is registered (used for self-heal re-registration).
  has(id: string): boolean { return this.sinks.has(id) }

  private touch(id: string): void { this.lastSeen.set(id, Date.now()) }

  private sweep(): void {
    const now = Date.now()
    if (now - this.lastSweep < (this.gc.sweepEveryMs ?? SWEEP_EVERY_MS)) return
    this.lastSweep = now
    for (const id of this.sinks.keys()) {
      // ponytail: time-based eviction can't prove the webview is dead — a
      // surface silent for 30 min loses its sink until its next message
      // re-registers. If that ever bites, plumb a real liveness signal here.
      if (now - (this.lastSeen.get(id) ?? now) > this.sinkIdleMs) {
        this.sinks.delete(id)
        this.lastSeen.delete(id)
      }
    }
  }

  // The host wires this to create/reveal the panel a reply should open in.
  setOpen(fn: (m: HostMessage) => void) { this.onOpen = fn }

  // The host wires this to trigger sync (e.g. schedule a push) after a mutation.
  setAfterDispatch(fn: (msg: WebviewMessage) => void): void { this.afterDispatch = fn }

  // Wire a cache-clearing callback so refresh() always reads fresh data.
  setSnapshotCacheClearer(fn: () => void): void { this.clearSnapshotCache = fn }

  // Re-broadcast the current snapshot to all sinks (used after an incoming sync pull).
  async refresh(): Promise<void> {
    this.clearSnapshotCache?.()
    for (const m of await this.snapshot()) this.broadcast(m)
  }

  // Direct post to one sink (used by the WsManager to reach the ws panel).
  emitTo(id: string, m: HostMessage): void { this.postTo(id, m) }

  // Broadcast a toast to every sink (used by the host to surface e.g. a 403 from a member op).
  toast(level: 'error' | 'info', message: string): void { this.broadcast({ type: 'toast', level, message }) }

  // Broadcast the current auth state to every sink (used by the host after sign-in/out).
  authState(accounts: Account[]): void { this.broadcast({ type: 'authState', accounts }) }
  syncStatus(loading: boolean, scope: SyncScope = { kind: 'all' }): void {
    this.broadcast({ type: 'syncStatus', loading, scope })
  }

  private postTo(id: string, m: HostMessage) {
    const sink = this.sinks.get(id)
    if (!sink) return
    // A successful delivery counts as activity — keeps warm sinks warm.
    this.touch(id)
    sink(m)
  }
  // Every broadcast touches each recipient so the idle sweep can't evict a
  // live panel whose only activity is *receiving* snapshots.
  private broadcast(m: HostMessage) { for (const id of this.sinks.keys()) this.postTo(id, m) }

  dispatch(fromId: string, msg: WebviewMessage): Promise<void> {
    this.dispatchChain = this.dispatchChain.then(() => this.doDispatch(fromId, msg))
    return this.dispatchChain
  }

  private async doDispatch(fromId: string, msg: WebviewMessage): Promise<void> {
    this.touch(fromId)
    this.sweep()
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile' || reply.type === 'grpcResponse' || reply.type === 'members' || reply.type === 'toast') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor' || reply.type === 'openGrpcRequest' || reply.type === 'openWsRequest' || reply.type === 'showEnvironments' || reply.type === 'showWebSocket' || reply.type === 'showGrpc' || reply.type === 'showSse' || reply.type === 'showMembers') {
        this.onOpen?.(reply)
      }
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
    this.afterDispatch?.(msg)
  }
}
