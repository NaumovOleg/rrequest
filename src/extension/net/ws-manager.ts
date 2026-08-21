import type { HostMessage, KeyValue } from '../../shared/types'

export type WsSocket = {
  on(event: 'open', cb: () => void): void
  on(event: 'message', cb: (data: unknown) => void): void
  on(event: 'close', cb: (code: number, reason: unknown) => void): void
  on(event: 'error', cb: (err: unknown) => void): void
  send(data: string): void
  close(): void
  // Perf: strip all listeners BEFORE close so the handler closures (and
  // everything they capture) are releasable immediately, not at GC mercy.
  removeAllListeners(): void
}
export type WsFactory = (url: string, opts: { headers: Record<string, string> }) => WsSocket

export class WsManager {
  private readonly conns = new Map<string, WsSocket>()
  constructor(
    private readonly emit: (m: HostMessage) => void,
    private readonly factory: WsFactory,
  ) {}

  connect(connId: string, url: string, headers: KeyValue[]): void {
    const hdrs: Record<string, string> = {}
    for (const h of headers) if (h.enabled && h.key) hdrs[h.key] = h.value
    let socket: WsSocket
    try {
      socket = this.factory(url, { headers: hdrs })
    } catch (e: any) {
      this.emit({ type: 'wsError', connId, message: String(e?.message ?? e) })
      this.emit({ type: 'wsClosed', connId, code: 0, reason: 'connect failed' })
      return
    }
    this.conns.set(connId, socket)
    socket.on('open', () => this.emit({ type: 'wsOpen', connId }))
    socket.on('message', (data) => this.emit({ type: 'wsMessage', connId, data: typeof data === 'string' ? data : String(data), at: Date.now() }))
    // Perf: also strip listeners on a server-side close — the socket object
    // becomes garbage as soon as the map entry is gone, and dropping its
    // handler closures lets it collect instead of lingering.
    socket.on('close', (code, reason) => { this.conns.delete(connId); socket.removeAllListeners?.(); this.emit({ type: 'wsClosed', connId, code: code ?? 1006, reason: String(reason ?? '') }) })
    socket.on('error', (err: any) => this.emit({ type: 'wsError', connId, message: String(err?.message ?? err) }))
  }

  send(connId: string, data: string): void { this.conns.get(connId)?.send(data) }

  disconnect(connId: string): void {
    const socket = this.conns.get(connId)
    if (!socket) return
    this.conns.delete(connId)
    // Listeners go first: after close() we emit wsClosed ourselves (the
    // stripped 'close' handler can no longer do it), so the UI learns the
    // connection ended exactly once.
    socket.removeAllListeners?.()
    socket.close()
    this.emit({ type: 'wsClosed', connId, code: 0, reason: 'disconnected' })
  }

  // Perf: bulk teardown for extension deactivate — no sockets outlive the host.
  disconnectAll(): void { for (const id of [...this.conns.keys()]) this.disconnect(id) }
}
