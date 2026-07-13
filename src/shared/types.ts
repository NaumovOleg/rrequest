export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type KeyValue = { key: string; value: string; enabled: boolean }

export type FormDataItem =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | { kind: 'file'; key: string; filename: string; path: string; enabled: boolean }

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json' | 'text' | 'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }
  | { mode: 'formdata'; items: FormDataItem[] }

export type RestRequest = {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
  preRequestScript?: string
  testScript?: string
}

export type HttpError = {
  kind: 'dns' | 'connection' | 'timeout' | 'unknown'
  message: string
}

export type TestResult = { name: string; passed: boolean; error?: string }

export type HttpResponse = {
  status: number
  statusText: string
  headers: KeyValue[]
  body: string
  bodyTruncated: boolean
  timeMs: number
  sizeBytes: number
  cookies: KeyValue[]
  error?: HttpError
  testResults?: TestResult[]
  consoleLogs?: string[]
}

export type Collection = { id: string; name: string; workspaceId: string; requests: RestRequest[] }

export type Workspace = { id: string; name: string }

export type Environment = {
  id: string
  name: string
  variables: KeyValue[]
}

export type HistoryEntry = {
  id: string
  request: RestRequest
  status: number
  at: number
}

// webview -> host
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendRequest'; requestId: string; payload: RestRequest }
  | { type: 'loadTree' }
  | { type: 'saveRequest'; collectionId: string; request: RestRequest }
  | { type: 'createCollection'; name: string }
  | { type: 'loadHistory' }
  | { type: 'loadEnvironments' }
  | { type: 'createEnvironment'; name: string }
  | { type: 'saveEnvironment'; environment: Environment }
  | { type: 'deleteEnvironment'; id: string }
  | { type: 'setActiveEnv'; id: string | null }
  | { type: 'importCollection' }
  | { type: 'exportCollection'; id: string; format: 'native' | 'postman' }
  | { type: 'pickFile' }
  | { type: 'openRequest'; request: RestRequest; targetCollectionId?: string }
  | { type: 'loadWorkspaces' }
  | { type: 'createWorkspace'; name: string }
  | { type: 'renameWorkspace'; id: string; name: string }
  | { type: 'deleteWorkspace'; id: string }
  | { type: 'setActiveWorkspace'; id: string }
  | { type: 'wsConnect'; connId: string; url: string; headers: KeyValue[] }
  | { type: 'wsSend'; connId: string; data: string }
  | { type: 'wsDisconnect'; connId: string }

// host -> webview
export type HostMessage =
  | { type: 'response'; requestId: string; payload: HttpResponse }
  | { type: 'tree'; collections: Collection[] }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'environments'; environments: Environment[]; activeId: string | null }
  | { type: 'pickedFile'; path: string; filename: string }
  | { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string }
  | { type: 'workspaces'; workspaces: Workspace[]; activeId: string }
  | { type: 'wsOpen'; connId: string }
  | { type: 'wsMessage'; connId: string; data: string; at: number }
  | { type: 'wsClosed'; connId: string; code: number; reason: string }
  | { type: 'wsError'; connId: string; message: string }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
