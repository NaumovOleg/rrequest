import { describe, expect, it } from 'vitest'
import { SseClient } from '../../src/extension/net/sse-client'
import type { HostMessage } from '../../src/shared/types'

function streamOf(chunks: string[], status = 200): { ok: boolean; status: number; statusText: string; body: ReadableStream<Uint8Array> | null } {
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      },
    }),
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SseClient', () => {
  it('parses named events with single and multi-line data', async () => {
    const got: HostMessage[] = []
    const fetcher = (async () =>
      streamOf([
        'event: message\ndata: {"a":1}\n\n',
        'event: update\ndata: line1\ndata: line2\n\n',
      ])) as unknown as typeof fetch
    const c = new SseClient((m) => got.push(m), fetcher)
    c.connect('c1', 'http://x/events', [])
    await wait(20)
    const events = got.filter((m) => m.type === 'sseEvent')
    expect(events).toEqual([
      { type: 'sseEvent', connId: 'c1', event: 'message', data: '{"a":1}', at: expect.any(Number) },
      { type: 'sseEvent', connId: 'c1', event: 'update', data: 'line1\nline2', at: expect.any(Number) },
    ])
    expect(got.filter((m) => m.type === 'sseClosed')).toEqual([
      { type: 'sseClosed', connId: 'c1', reason: 'stream ended' },
    ])
  })

  it('defaults the event name to message and drops field-less comment frames', async () => {
    const got: HostMessage[] = []
    const fetcher = (async () =>
      streamOf([': keep-alive\n\ndata: hello\n\nevent: ping\n\n'])) as unknown as typeof fetch
    const c = new SseClient((m) => got.push(m), fetcher)
    c.connect('c1', 'http://x/events', [])
    await wait(20)
    const events = got.filter((m) => m.type === 'sseEvent') as { event: string; data: string }[]
    expect(events).toMatchObject([
      { event: 'message', data: 'hello' },
      { event: 'ping', data: '' },
    ])
  })

  it('handles CRLF framing and a final unterminated block', async () => {
    const got: HostMessage[] = []
    const fetcher = (async () =>
      streamOf(['event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2'])) as unknown as typeof fetch
    const c = new SseClient((m) => got.push(m), fetcher)
    c.connect('c1', 'http://x/events', [])
    await wait(20)
    const events = got.filter((m) => m.type === 'sseEvent') as { event: string; data: string }[]
    expect(events).toMatchObject([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ])
  })

  it('emits an error + closed on a non-200 response', async () => {
    const got: HostMessage[] = []
    const fetcher = (async () => streamOf([], 404)) as unknown as typeof fetch
    const c = new SseClient((m) => got.push(m), fetcher)
    c.connect('c1', 'http://x/events', [])
    await wait(20)
    expect(got).toContainEqual({ type: 'sseError', connId: 'c1', message: 'HTTP 404 Not Found' })
    expect(got).toContainEqual({ type: 'sseClosed', connId: 'c1', reason: 'HTTP 404 Not Found' })
  })

  it('disconnect aborts the stream and reports closed', async () => {
    const got: HostMessage[] = []
    let captured: AbortSignal | undefined
    const fetcher = (async (_u: string, init?: RequestInit) => {
      captured = init?.signal ?? undefined
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'))
            })
          },
        }),
      }
    }) as unknown as typeof fetch
    const c = new SseClient((m) => got.push(m), fetcher)
    c.connect('c1', 'http://x/events', [])
    await wait(10)
    c.disconnect('c1')
    await wait(20)
    expect(captured?.aborted).toBe(true)
    expect(got).toContainEqual({ type: 'sseClosed', connId: 'c1', reason: 'disconnected' })
  })
})
