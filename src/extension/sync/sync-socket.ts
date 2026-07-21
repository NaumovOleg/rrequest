import WebSocket from 'ws'

export type ChangeMsg = { type: 'workspace-changed'; workspaceId: string; revision: string; updatedBy: string }

export type WsLike = { on(ev: string, cb: (arg?: any) => void): void; close(): void }

export function handleSocketData(raw: string, onChange: (m: ChangeMsg) => void): void {
  try {
    const m = JSON.parse(raw)
    if (m && m.type === 'workspace-changed') onChange(m as ChangeMsg)
  } catch {
    /* ignore malformed frames */
  }
}

export class SyncSocket {
  private ws: WsLike | undefined
  private stopped = false
  private backoff = 1000
  constructor(private opts: {
    url: () => string
    token: () => string | undefined
    onChange: (m: ChangeMsg) => void
    wsFactory?: (url: string) => WsLike
  }) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = undefined
  }

  private connect(): void {
    if (this.stopped) return
    const token = this.opts.token()
    if (!token) { this.scheduleReconnect(); return }
    const url = `${this.opts.url().replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}`
    const factory = this.opts.wsFactory ?? ((u: string) => new WebSocket(u.replace(/^http/, 'ws')) as unknown as WsLike)
    const socket = factory(url)
    this.ws = socket
    socket.on('message', (data: unknown) => handleSocketData(String(data), this.opts.onChange))
    socket.on('open', () => { this.backoff = 1000 })
    socket.on('close', () => this.scheduleReconnect())
    socket.on('error', () => { try { socket.close() } catch { /* ignore */ } })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 30000)
    setTimeout(() => this.connect(), delay)
  }
}
