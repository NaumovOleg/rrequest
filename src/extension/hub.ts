import type { HostMessage, WebviewMessage } from '../shared/types'

type SurfaceId = 'editor' | 'sidebar'
type Sink = (m: HostMessage) => void

export class Hub {
  private readonly sinks = new Map<SurfaceId, Sink>()
  private onOpenInEditor?: () => void
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
  ) {}

  register(id: SurfaceId, post: Sink): () => void {
    this.sinks.set(id, post)
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id) }
  }

  // The editor panel provider sets this so the Hub can reveal/create the editor
  // panel before routing an openInEditor message to it.
  setEditorReveal(fn: () => void) { this.onOpenInEditor = fn }

  private postTo(id: SurfaceId, m: HostMessage) { this.sinks.get(id)?.(m) }
  private broadcast(m: HostMessage) { for (const s of this.sinks.values()) s(m) }

  async dispatch(fromId: SurfaceId, msg: WebviewMessage): Promise<void> {
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor') {
        this.onOpenInEditor?.()
        this.postTo('editor', reply)
      }
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
  }
}
