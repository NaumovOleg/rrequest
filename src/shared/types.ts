// A known method, or any custom string (Postman-style: the method dropdown is
// a free-text input, so WebDAV/GraphQL/legacy verbs work). `string & {}` keeps
// autocomplete for the common ones while allowing arbitrary values.
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'QUERY' | 'DELETE' | 'HEAD' | 'OPTIONS'
  | (string & {})

export type KeyValue = { key: string; value: string; enabled: boolean; description?: string; secret?: boolean }

export type Auth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
  | { type: 'oauth2'; grant: 'authorization-code' | 'client-credentials'; authUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scope?: string }

/** A stored OAuth2 token payload (kept in VS Code Secret Storage, never in the workspace JSON). */
export type OAuthToken = {
  access: string
  refresh?: string
  exp?: number // epoch ms of expiry; absent = no expiry known
  at: number
}

export type FormDataItem =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | { kind: 'file'; key: string; filename: string; path: string; enabled: boolean }

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json' | 'text' | 'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }
  | { mode: 'graphql'; query: string; variables: string }
  | { mode: 'formdata'; items: FormDataItem[] }

/** A saved response snapshot attached to a request ("save response as example"). */
export type Example = {
  id: string
  at: number
  name: string
  status: number
  statusText: string
  headers: KeyValue[]
  body: string
  bodyIsBinary?: boolean
  bodyBase64?: string
}

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
  examples?: Example[]
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
  kind: 'dns' | 'connection' | 'timeout' | 'canceled' | 'unknown' | 'script'
  message: string
}

export type TestResult = { name: string; passed: boolean; error?: string }

// Per-phase timing, in ms from the moment sending started:
//   ttfbMs     — until response headers arrived (fetch() resolves)
//   downloadMs — from headers until the body was fully read
//   timeMs     — total (kept as the flat field, timings is a breakdown)
export type ResponseTimings = { ttfbMs: number; downloadMs: number }

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
  timings?: ResponseTimings
  // Binary payloads (images, octet-stream, …) can't travel as UTF-8 text:
  // body stays empty and the (possibly truncated) bytes come as base64 here.
  bodyIsBinary?: boolean
  bodyBase64?: string
}

export type Folder = { id: string; name: string; requests: CollectionItem[]; preRequestScript?: string; testScript?: string }

export type Collection = { id: string; name: string; workspaceId: string; requests: CollectionItem[]; folders?: Folder[]; environmentId?: string; preRequestScript?: string; testScript?: string }

export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Member = { id?: string; email: string; role: WorkspaceRole; pending: boolean }

export type Account = { id: string; email: string }
export type Workspace = { id: string; name: string; role?: WorkspaceRole; synced?: boolean; accountId?: string; accountEmail?: string; pollEnabled?: boolean }

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
  | { type: 'sendRequest'; requestId: string; payload: RestRequest; collectionId?: string; folderId?: string | null }
  | { type: 'cancelRequest'; requestId: string }
  | { type: 'loadTree' }
  | { type: 'saveRequest'; collectionId: string; folderId?: string | null; request: CollectionItem }
  | { type: 'createRequest'; collectionId: string; folderId: string | null; request: CollectionItem }
  | { type: 'duplicateRequest'; collectionId: string; folderId: string | null; requestId: string }
  | { type: 'duplicateCollection'; id: string }
  | { type: 'moveCollection'; id: string; toWorkspaceId: string }
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
  | { type: 'saveCollectionScript'; collectionId: string; preRequestScript?: string; testScript?: string }
  | { type: 'saveFolderScript'; collectionId: string; folderId: string; preRequestScript?: string; testScript?: string }
  | { type: 'deleteFolder'; collectionId: string; folderId: string }
  | { type: 'moveRequest'; fromCollectionId: string; fromFolderId: string | null; toCollectionId: string; toFolderId: string | null; requestId: string }
  | { type: 'moveFolder'; fromCollectionId: string; toCollectionId: string; folderId: string }
  | { type: 'reorderRequest'; collectionId: string; folderId: string | null; requestId: string; delta: 'up' | 'down' }
  | { type: 'reorderFolder'; collectionId: string; folderId: string; delta: 'up' | 'down' }
  | { type: 'clearHistory' }
  | { type: 'openTextDocument'; content: string; language: string }
  | { type: 'saveBody'; requestId: string; fallbackContent?: string; fallbackIsBase64?: boolean; suggestName?: string }
  | { type: 'loadTrash' }
  | { type: 'restoreTrash'; entryId: string; folderId?: string; requestId?: string }
  | { type: 'purgeTrash'; entryId: string }
  | { type: 'openEnvironments'; id?: string }
  | { type: 'openWebSocket' }
  | { type: 'openGrpc' }
  | { type: 'openSse' }
  | { type: 'sseConnect'; connId: string; url: string; headers: KeyValue[] }
  | { type: 'sseDisconnect'; connId: string }
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
  | { type: 'setWorkspacePolling'; workspaceId: string; enabled: boolean }
  | { type: 'openDocs' }
  | { type: 'oauthGetToken'; requestId: string; auth: Auth }
  | { type: 'oauthStatus'; requestId: string }
  | { type: 'saveExample'; requestId: string; example: Example }
  | { type: 'deleteExample'; requestId: string; exampleId: string }

// host -> webview
export type HostMessage =
  | { type: 'response'; requestId: string; payload: HttpResponse }
  | { type: 'tree'; collections: Collection[] }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'environments'; environments: Environment[]; activeId: string | null }
  | { type: 'pickedFile'; path: string; filename: string }
  | { type: 'openInEditor'; request: RestRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'openGrpcRequest'; request: GrpcRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'importCurl'; text: string }
  | { type: 'openWsRequest'; request: WsRequest; targetCollectionId?: string; targetFolderId?: string | null }
  | { type: 'workspaces'; workspaces: Workspace[]; activeId: string }
  | { type: 'trash'; entries: TrashEntry[] }
  | { type: 'wsOpen'; connId: string }
  | { type: 'wsMessage'; connId: string; data: string; at: number }
  | { type: 'wsClosed'; connId: string; code: number; reason: string }
  | { type: 'wsError'; connId: string; message: string }
  | { type: 'sseEvent'; connId: string; event: string; data: string; id?: string; at: number }
  | { type: 'sseClosed'; connId: string; reason: string }
  | { type: 'sseError'; connId: string; message: string }
  | { type: 'showEnvironments'; id?: string }
  | { type: 'showWebSocket' }
  | { type: 'showGrpc' }
  | { type: 'showSse' }
  | { type: 'grpcResponse'; requestId: string; ok: boolean; message?: string; error?: string; timeMs: number }
  | { type: 'toast'; level: 'error' | 'info'; message: string }
  | { type: 'showMembers'; workspaceId: string }
  | { type: 'members'; members: Member[] }
  | { type: 'authState'; accounts: Account[] }
  | { type: 'oauthResult'; requestId: string; ok: boolean; error?: string; expiresInSec?: number }
  | { type: 'oauthStatusResult'; requestId: string; ok: boolean; expiresInSec?: number }
  | { type: 'syncStatus'; loading: boolean; scope: SyncScope }

// Which item a sync operation covers, so only the matching widget shows its
// spinner: 'all' during startup/sign-in (every surface), an account (its head
// row + all its workspaces), or one workspace (just that row).
export type SyncScope =
  | { kind: 'all' }
  | { kind: 'account'; id: string }
  | { kind: 'workspace'; id: string }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
