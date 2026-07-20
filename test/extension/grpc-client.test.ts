import { describe, it, expect } from 'vitest'
import { grpcInvoke } from '../../src/extension/grpc-client'

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
})
