import type { HostMessage, WebviewMessage } from '../shared/types'

type Sink = (m: HostMessage) => void

/**
 * Fan-out hub shared by every surface. Each surface registers a sink under a
 * unique id: the sidebar as 'sidebar', and every editor panel under its own key
 * (e.g. `req:<id>`, 'env', 'ws'). Responses route back to the sender; "open"
 * replies are handed to the host via onOpen so it can create/reveal the right
 * panel; state snapshots broadcast to everyone.
 */
export class Hub {
  private readonly sinks = new Map<string, Sink>()
  private onOpen?: (m: HostMessage) => void
  private afterDispatch?: (msg: WebviewMessage) => void
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
  ) {}

  register(id: string, post: Sink): () => void {
    this.sinks.set(id, post)
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id) }
  }

  // The host wires this to create/reveal the panel a reply should open in.
  setOpen(fn: (m: HostMessage) => void) { this.onOpen = fn }

  // The host wires this to trigger sync (e.g. schedule a push) after a mutation.
  setAfterDispatch(fn: (msg: WebviewMessage) => void): void { this.afterDispatch = fn }

  // Re-broadcast the current snapshot to all sinks (used after an incoming sync pull).
  async refresh(): Promise<void> {
    for (const m of await this.snapshot()) this.broadcast(m)
  }

  // Direct post to one sink (used by the WsManager to reach the ws panel).
  emitTo(id: string, m: HostMessage): void { this.postTo(id, m) }

  // Broadcast a toast to every sink (used by the host to surface e.g. a 403 from a member op).
  toast(level: 'error' | 'info', message: string): void { this.broadcast({ type: 'toast', level, message }) }

  // Broadcast the current auth state to every sink (used by the host after sign-in/out).
  authState(email: string | null): void { this.broadcast({ type: 'authState', email }) }

  private postTo(id: string, m: HostMessage) { this.sinks.get(id)?.(m) }
  private broadcast(m: HostMessage) { for (const s of this.sinks.values()) s(m) }

  async dispatch(fromId: string, msg: WebviewMessage): Promise<void> {
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile' || reply.type === 'grpcResponse' || reply.type === 'members') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor' || reply.type === 'openGrpcRequest' || reply.type === 'openWsRequest' || reply.type === 'showEnvironments' || reply.type === 'showWebSocket' || reply.type === 'showGrpc' || reply.type === 'showMembers') {
        this.onOpen?.(reply)
      }
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
    this.afterDispatch?.(msg)
  }
}
