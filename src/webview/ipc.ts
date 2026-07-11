import type { HostMessage, WebviewMessage } from '../shared/types'

type VsCodeApi = { postMessage(msg: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

let api: VsCodeApi | undefined
try { api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined } catch { api = undefined }

export function postToHost(msg: WebviewMessage): void {
  if (api) api.postMessage(msg)
  else window.postMessage(msg, '*')
}

export function onHostMessage(cb: (m: HostMessage) => void): () => void {
  const handler = (e: MessageEvent) => cb(e.data as HostMessage)
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
