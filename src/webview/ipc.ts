import type { HostMessage, WebviewMessage } from '../shared/types'

type VsCodeApi = {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}
declare function acquireVsCodeApi(): VsCodeApi

let api: VsCodeApi | undefined
try { api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined } catch { api = undefined }

// Persisted per-webview UI state (VS Code keeps this across reloads and
// restarts). Used for view-only preferences like which tree nodes are
// expanded — not domain data, which lives in the extension host.
export function getUiState<T>(key: string, fallback: T): T {
  try {
    const all = (api?.getState() as Record<string, unknown> | undefined) ?? {}
    return key in all ? (all[key] as T) : fallback
  } catch { return fallback }
}

export function setUiState(key: string, value: unknown): void {
  try {
    const all = (api?.getState() as Record<string, unknown> | undefined) ?? {}
    api?.setState({ ...all, [key]: value })
  } catch { /* no vscode api (tests / plain browser) — ignore */ }
}

export function postToHost(msg: WebviewMessage): void {
  if (api) api.postMessage(msg)
  else window.postMessage(msg, '*')
}

export function onHostMessage(cb: (m: HostMessage) => void): () => void {
  const handler = (e: MessageEvent) => cb(e.data as HostMessage)
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
