import type { HostMessage, WebviewMessage } from '../shared/types'

type SurfaceId = 'editor' | 'sidebar'
type Sink = (m: HostMessage) => void

export class Hub {
  private readonly sinks = new Map<SurfaceId, Sink>()
  private onOpenInEditor?: () => void
  // openInEditor messages routed while no 'editor' sink exists yet are queued
  // here and flushed when the editor registers (fixes the first-click race).
  private readonly pendingEditor: HostMessage[] = []
  constructor(
    private readonly route: (m: WebviewMessage) => Promise<HostMessage | undefined>,
    private readonly snapshot: () => Promise<HostMessage[]>,
  ) {}

  register(id: SurfaceId, post: Sink): () => void {
    this.sinks.set(id, post)
    if (id === 'editor' && this.pendingEditor.length > 0) {
      for (const m of this.pendingEditor) post(m)
      this.pendingEditor.length = 0
    }
    return () => { if (this.sinks.get(id) === post) this.sinks.delete(id) }
  }

  // The editor panel provider sets this so the Hub can reveal/create the editor
  // panel before routing an openInEditor message to it.
  setEditorReveal(fn: () => void) { this.onOpenInEditor = fn }

  emitToEditor(m: HostMessage): void { this.postTo('editor', m) }

  private postTo(id: SurfaceId, m: HostMessage) { this.sinks.get(id)?.(m) }
  private broadcast(m: HostMessage) { for (const s of this.sinks.values()) s(m) }

  async dispatch(fromId: SurfaceId, msg: WebviewMessage): Promise<void> {
    const reply = await this.route(msg)
    if (reply) {
      if (reply.type === 'response' || reply.type === 'pickedFile') this.postTo(fromId, reply)
      else if (reply.type === 'openInEditor' || reply.type === 'showEnvironments') {
        this.onOpenInEditor?.()
        if (this.sinks.has('editor')) this.postTo('editor', reply)
        else this.pendingEditor.push(reply)
      }
      // tree/environments/workspaces/history replies are covered by the snapshot below
    }
    for (const m of await this.snapshot()) this.broadcast(m)
  }
}
