import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { grpcInvoke } from '../../src/extension/net/grpc-client'

const PROTO = `syntax = "proto3";
package hello;
service Greeter { rpc SayHello (Req) returns (Res) {} }
message Req { string name = 1; }
message Res { string message = 1; }`

describe('grpcInvoke', () => {
  it('errors when the service is not found in the proto', async () => {
    const r = await grpcInvoke({ address: 'localhost:1', proto: PROTO, service: 'hello.Nope', method: 'SayHello', message: '{}', metadata: [], plaintext: true })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found/i)
  })
  it('errors on invalid request JSON', async () => {
    const r = await grpcInvoke({ address: 'localhost:1', proto: PROTO, service: 'hello.Greeter', method: 'SayHello', message: '{not json', metadata: [], plaintext: true })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/json/i)
  })
  it('errors on an unparseable proto', async () => {
    const r = await grpcInvoke({ address: 'localhost:1', proto: 'this is not a proto', service: 'x.Y', method: 'M', message: '{}', metadata: [], plaintext: true })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it('resolves via deadline instead of hanging forever when the server never responds', async () => {
    const protoPath = path.join(os.tmpdir(), `grpc-test-${Date.now()}.proto`)
    await fs.writeFile(protoPath, PROTO, 'utf8')
    const pkgDef = protoLoader.loadSync(protoPath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
    const proto: any = grpc.loadPackageDefinition(pkgDef)
    const server = new grpc.Server()
    server.addService(proto.hello.Greeter.service, {
      SayHello: () => { /* never calls back — simulates a hung server */ },
    })
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)))
    })
    try {
      const r = await grpcInvoke({
        address: `127.0.0.1:${port}`, proto: PROTO, service: 'hello.Greeter', method: 'SayHello',
        message: '{}', metadata: [], plaintext: true, deadlineMs: 200,
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/deadline/i)
    } finally {
      server.forceShutdown()
      await fs.rm(protoPath, { force: true })
    }
  }, 10_000)
})
