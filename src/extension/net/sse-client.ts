import type { HostMessage, KeyValue } from '../../shared/types'

// Minimal Server-Sent Events client: a plain fetch stream, line-buffered into
// events split on a blank line, with `event:`/`data:`/`id:` field parsing.
// No reconnection or Last-Event-ID bookkeeping — the UI re-connects manually,
// which is the honest UX for an interactive debugger.
export class SseClient {
  private readonly conns = new Map<string, AbortController>()
  constructor(
    private readonly emit: (m: HostMessage) => void,
    private readonly fetcher: typeof fetch,
  ) {}

  connect(connId: string, url: string, headers: KeyValue[]): void {
    const hdrs: Record<string, string> = {}
    for (const h of headers) if (h.enabled && h.key) hdrs[h.key] = h.value
    const ctrl = new AbortController()
    this.conns.set(connId, ctrl)
    void this.open(connId, url, hdrs, ctrl)
  }

  disconnect(connId: string): void {
    this.conns.get(connId)?.abort()
  }

  private async open(
    connId: string,
    url: string,
    headers: Record<string, string>,
    ctrl: AbortController,
  ): Promise<void> {
    const fail = (message: string) => {
      if (this.conns.get(connId) !== ctrl) return
      this.emit({ type: 'sseError', connId, message })
      this.emit({ type: 'sseClosed', connId, reason: message })
    }
    let res: Response
    try {
      res = await this.fetcher(url, { headers, signal: ctrl.signal })
    } catch (e: any) {
      if (ctrl.signal.aborted) {
        this.conns.delete(connId)
        this.emit({ type: 'sseClosed', connId, reason: 'disconnected' })
      } else {
        fail(String(e?.message ?? e))
        this.conns.delete(connId)
      }
      return
    }
    if (!res.ok || !res.body) {
      fail(`HTTP ${res.status} ${res.statusText}`)
      this.conns.delete(connId)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // A block ends at the first empty line (SSE framing: \n\n or \r\n\r\n).
        let sep: number
        while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + (buffer[sep] === '\r' ? 4 : 2))
          this.dispatch(connId, block)
        }
      }
      // Flush a final unterminated block (last event without trailing blank
      // line), then close the stream cleanly.
      if (buffer.trim() !== '') this.dispatch(connId, buffer)
      this.conns.delete(connId)
      this.emit({ type: 'sseClosed', connId, reason: 'stream ended' })
    } catch (e: any) {
      if (ctrl.signal.aborted) {
        this.conns.delete(connId)
        this.emit({ type: 'sseClosed', connId, reason: 'disconnected' })
      } else {
        fail(String(e?.message ?? e))
        this.conns.delete(connId)
      }
    }
  }

  private dispatch(connId: string, block: string): void {
    if (this.conns.get(connId) === undefined || block.length === 0) return
    let event = 'message'
    const lines: string[] = []
    const ids: string[] = []
    let hasField = false
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) { event = line.slice(6).trim(); hasField = true }
      else if (line.startsWith('data:')) { lines.push(line.slice(5).replace(/^ /, '')); hasField = true }
      else if (line.startsWith('id:')) { ids.push(line.slice(3).trim()); hasField = true }
      // 'retry:' and other unknown fields are ignored.
    }
    if (!hasField) return // comment-only frame (e.g. ": keep-alive")
    // data may be empty (e.g. an "event: ping" frame without a data line).
    const data = lines.join('\n')
    const id = ids.length > 0 ? ids.join(' ') : undefined
    this.emit({ type: 'sseEvent', connId, event, data, id, at: Date.now() })
  }
}