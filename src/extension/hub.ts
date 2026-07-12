import type { HostMessage, WebviewMessage } from '../shared/types'

type SurfaceId = 'editor' | 'sidebar'
type Sink = (m: HostMessage) => void

export class Hub {
  private readonly sinks = new Map<SurfaceId, Sink>()
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
  ) {}

  register(id: SurfaceId, post: Sink): () => void {
    this.sinks.set(id, post)
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id) }
  }

  private postTo(id: SurfaceId, m: HostMessage) { this.sinks.get(id)?.(m) }
  private broadcast(m: HostMessage) { for (const s of this.sinks.values()) s(m) }

  async dispatch(fromId: SurfaceId, msg: WebviewMessage): Promise<void> {
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor') this.postTo('editor', reply)
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
  }
}
