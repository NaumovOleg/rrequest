import { describe, it, expect } from 'vitest'
import { Hub } from '../../src/extension/hub'
import type { HostMessage } from '../../src/shared/types'

const snapshot = async (): Promise<HostMessage[]> => []

describe('Hub members reply delivery', () => {
  it('delivers a members reply to the requesting panel (was silently dropped)', async () => {
    const membersReply: HostMessage = {
      type: 'members',
      members: [{ id: 'm1', email: 'a@example.com', role: 'editor', pending: false }],
    }
    const hub = new Hub(async () => membersReply, snapshot)
    const got: HostMessage[] = []
    hub.register('members', (m) => got.push(m))
    await hub.dispatch('members', { type: 'loadMembers', workspaceId: 'w1' })
    expect(got).toContainEqual(membersReply)
  })
})
