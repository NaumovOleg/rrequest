export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'QUERY' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type KeyValue = { key: string; value: string; enabled: boolean; description?: string; secret?: boolean }

export type Auth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }

export type FormDataItem =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | { kind: 'file'; key: string; filename: string; path: string; enabled: boolean }

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json' | 'text' | 'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }
  | { mode: 'graphql'; query: string; variables: string }
  | { mode: 'formdata'; items: FormDataItem[] }

export type RestRequest = {
  id: string
  name: string
  kind?: 'http'
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
  auth?: Auth
  cookies?: KeyValue[]
  preRequestScript?: string
  testScript?: string
}

export type GrpcRequest = {
  id: string
  name: string
  kind: 'grpc'
  address: string
  proto: string
  service: string
  method: string
  message: string
  metadata: KeyValue[]
  plaintext: boolean
}

export type WsRequest = {
  id: string
  name: string
  kind: 'ws'
  url: string
  headers: KeyValue[]
}

/** Anything that can live in a collection/folder. */
export type CollectionItem = RestRequest | GrpcRequest | WsRequest

export function itemKind(i: CollectionItem): 'http' | 'grpc' | 'ws' {
  return i.kind ?? 'http'
}

/** Standard headers a fresh request starts with (all safe to set under Node fetch). */
export function defaultHeaders(): KeyValue[] {
  return [
    { key: 'Accept', value: '*/*', enabled: true },
    { key: 'User-Agent', value: 'rrequest', enabled: true },
    { key: 'Cache-Control', value: 'no-cache', enabled: true },
  ]
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

export type Folder = { id: string; name: string; requests: CollectionItem[] }

export type Collection = { id: string; name: string; workspaceId: string; requests: CollectionItem[]; folders?: Folder[]; environmentId?: string }

export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }

export type Account = { id: string; email: string }
export type Workspace = { id: string; name: string; role?: WorkspaceRole; synced?: boolean; accountId?: string; accountEmail?: string }

// A deleted thing kept for restore. `data` is the full snapshot (collections and
// folders keep their children); `path` records ancestors so a folder/request can
// be restored back into (or recreate) its collection/folder.
export type TrashEntry = {
  id: string
  at: number
  workspaceId: string
  kind: 'collection' | 'folder' | 'request' | 'environment'
  data: Collection | Folder | CollectionItem | Environment
  path?: { collectionId: string; collectionName: string; folderId?: string; folderName?: string }
}

export type Environment = {
  id: string
  name: string
  workspaceId: string
  variables: KeyValue[]
}

export type HistoryEntry = {
  id: string
  workspaceId: string
  request: RestRequest
  status: number
  at: number
}

// webview -> host
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendRequest'; requestId: string; payload: RestRequest }
  | { type: 'loadTree' }
  | { type: 'saveRequest'; collectionId: string; folderId?: string | null; request: CollectionItem }
  | { type: 'createRequest'; collectionId: string; folderId: string | null; request: CollectionItem }
  | { type: 'duplicateRequest'; collectionId: string; folderId: string | null; requestId: string }
  | { type: 'duplicateCollection'; id: string }
  | { type: 'duplicateFolder'; collectionId: string; folderId: string }
  | { type: 'setCollectionEnvironment'; collectionId: string; environmentId: string | null }
  | { type: 'createCollection'; name: string }
  | { type: 'loadHistory' }
  | { type: 'loadEnvironments' }
  | { type: 'createEnvironment'; name: string }
  | { type: 'saveEnvironment'; environment: Environment }
  | { type: 'deleteEnvironment'; id: string }
  | { type: 'setActiveEnv'; id: string | null }
  | { type: 'importCollection' }
  | { type: 'exportCollection'; id: string; format: 'native' | 'postman' | 'openapi' }
  | { type: 'pickFile' }
  | { type: 'openRequest'; request: CollectionItem; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'loadWorkspaces' }
  | { type: 'createWorkspace'; name: string; accountId?: string }
  | { type: 'renameWorkspace'; id: string; name: string }
  | { type: 'deleteWorkspace'; id: string }
  | { type: 'setActiveWorkspace'; id: string }
  | { type: 'wsConnect'; connId: string; url: string; headers: KeyValue[] }
  | { type: 'wsSend'; connId: string; data: string }
  | { type: 'wsDisconnect'; connId: string }
  | { type: 'renameCollection'; id: string; name: string }
  | { type: 'deleteCollection'; id: string }
  | { type: 'renameRequest'; collectionId: string; folderId: string | null; requestId: string; name: string }
  | { type: 'deleteRequest'; collectionId: string; folderId: string | null; requestId: string }
  | { type: 'createFolder'; collectionId: string; name: string }
  | { type: 'renameFolder'; collectionId: string; folderId: string; name: string }
  | { type: 'deleteFolder'; collectionId: string; folderId: string }
  | { type: 'moveRequest'; fromCollectionId: string; fromFolderId: string | null; toCollectionId: string; toFolderId: string | null; requestId: string }
  | { type: 'moveFolder'; fromCollectionId: string; toCollectionId: string; folderId: string }
  | { type: 'loadTrash' }
  | { type: 'restoreTrash'; entryId: string; folderId?: string; requestId?: string }
  | { type: 'purgeTrash'; entryId: string }
  | { type: 'openEnvironments'; id?: string }
  | { type: 'openWebSocket' }
  | { type: 'openGrpc' }
  | { type: 'grpcInvoke'; requestId: string; address: string; proto: string; service: string; method: string; message: string; metadata: KeyValue[]; plaintext: boolean }
  | { type: 'setTitle'; title: string; icon?: string }
  | { type: 'openMembers'; workspaceId: string }
  | { type: 'loadMembers'; workspaceId: string }
  | { type: 'addMember'; workspaceId: string; email: string; role: 'editor' | 'viewer' }
  | { type: 'removeMember'; workspaceId: string; memberId: string }
  | { type: 'signIn' }
  | { type: 'emptyTrash' }
  | { type: 'signOut'; accountId?: string }
  | { type: 'syncAccount'; accountId: string }
  | { type: 'enableSync'; workspaceId: string; accountId?: string }
  | { type: 'syncNow'; workspaceId: string }

// host -> webview
export type HostMessage =
  | { type: 'response'; requestId: string; payload: HttpResponse }
  | { type: 'tree'; collections: Collection[] }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'environments'; environments: Environment[]; activeId: string | null }
  | { type: 'pickedFile'; path: string; filename: string }
  | { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'openGrpcRequest'; request: GrpcRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'openWsRequest'; request: WsRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'workspaces'; workspaces: Workspace[]; activeId: string }
  | { type: 'trash'; entries: TrashEntry[] }
  | { type: 'wsOpen'; connId: string }
  | { type: 'wsMessage'; connId: string; data: string; at: number }
  | { type: 'wsClosed'; connId: string; code: number; reason: string }
  | { type: 'wsError'; connId: string; message: string }
  | { type: 'showEnvironments'; id?: string }
  | { type: 'showWebSocket' }
  | { type: 'showGrpc' }
  | { type: 'grpcResponse'; requestId: string; ok: boolean; message?: string; error?: string; timeMs: number }
  | { type: 'toast'; level: 'error' | 'info'; message: string }
  | { type: 'showMembers'; workspaceId: string }
  | { type: 'members'; members: Member[] }
  | { type: 'authState'; accounts: Account[] }
  | { type: 'syncStatus'; loading: boolean }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
