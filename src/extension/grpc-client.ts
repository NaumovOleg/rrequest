import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { KeyValue } from '../shared/types'

export type GrpcParams = {
  address: string
  proto: string
  service: string
  method: string
  message: string
  metadata: KeyValue[]
  plaintext: boolean
}

export type GrpcResult = { ok: boolean; message?: string; error?: string; timeMs: number }

// Walk a dotted path (e.g. "pkg.Service") through the loaded package object.
function resolvePath(root: unknown, dotted: string): any {
  return dotted.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), root as any)
}

/** Invoke a unary gRPC method described by an inline .proto. */
export async function grpcInvoke(p: GrpcParams): Promise<GrpcResult> {
  const started = Date.now()
  const elapsed = () => Date.now() - started
  const tmp = path.join(os.tmpdir(), `restman-${crypto.randomBytes(6).toString('hex')}.proto`)
  try {
    await fs.writeFile(tmp, p.proto, 'utf8')
    const pkgDef = protoLoader.loadSync(tmp, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
    const root = grpc.loadPackageDefinition(pkgDef)
    const ServiceCtor = resolvePath(root, p.service)
    if (typeof ServiceCtor !== 'function') return { ok: false, error: `Service "${p.service}" not found in proto`, timeMs: elapsed() }

    let payload: unknown = {}
    if (p.message.trim()) {
      try { payload = JSON.parse(p.message) } catch { return { ok: false, error: 'Request message is not valid JSON', timeMs: elapsed() } }
    }

    const creds = p.plaintext ? grpc.credentials.createInsecure() : grpc.credentials.createSsl()
    const client: any = new ServiceCtor(p.address, creds)
    const md = new grpc.Metadata()
    for (const m of p.metadata) if (m.enabled && m.key) md.add(m.key, m.value)

    // grpc-js exposes methods camelCased; accept the name as given or camelCased.
    const camel = p.method.charAt(0).toLowerCase() + p.method.slice(1)
    const fn = typeof client[p.method] === 'function' ? client[p.method] : client[camel]
    if (typeof fn !== 'function') return { ok: false, error: `Method "${p.method}" not found on service (unary only)`, timeMs: elapsed() }

    return await new Promise<GrpcResult>((resolve) => {
      try {
        fn.call(client, payload, md, (err: any, resp: unknown) => {
          if (err) resolve({ ok: false, error: `${err.code != null ? `[${err.code}] ` : ''}${err.details ?? err.message ?? String(err)}`, timeMs: elapsed() })
          else resolve({ ok: true, message: JSON.stringify(resp, null, 2), timeMs: elapsed() })
          try { client.close?.() } catch { /* ignore */ }
        })
      } catch (e: any) {
        resolve({ ok: false, error: String(e?.message ?? e), timeMs: elapsed() })
      }
    })
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), timeMs: elapsed() }
  } finally {
    void fs.rm(tmp, { force: true }).catch(() => {})
  }
}
