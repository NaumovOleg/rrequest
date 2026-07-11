import { describe, it, expect } from 'vitest'
import type { RequestBody, FormDataItem, WebviewMessage, HostMessage } from '../../src/shared/types'

describe('io types', () => {
  it('formdata body and FormDataItem type-check', () => {
    const text: FormDataItem = { kind: 'text', key: 'a', value: '1', enabled: true }
    const file: FormDataItem = { kind: 'file', key: 'f', filename: 'x.png', path: '/tmp/x.png', enabled: true }
    const body: RequestBody = { mode: 'formdata', items: [text, file] }
    expect(body.mode).toBe('formdata')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'importCollection' }
    const b: WebviewMessage = { type: 'exportCollection', id: 'c1', format: 'postman' }
    const c: WebviewMessage = { type: 'pickFile' }
    const d: HostMessage = { type: 'pickedFile', path: '/tmp/x', filename: 'x' }
    expect([a.type, b.type, c.type, d.type]).toEqual(['importCollection', 'exportCollection', 'pickFile', 'pickedFile'])
  })
})
