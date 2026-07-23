import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { IconButton } from '../../elements'

export function Members() {
  const members = useStore((s) => s.members)
  const workspaceId = useStore((s) => s.membersWorkspaceId)
  const isOwner = useStore((s) => s.activeWorkspace()?.role === 'owner')
  const pushToast = useStore((s) => s.pushToast)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')

  useEffect(() => {
    if (workspaceId) postToHost({ type: 'loadMembers', workspaceId })
  }, [workspaceId])

  const valid = /\S+@\S+\.\S+/.test(email)
  const invite = () => {
    if (!workspaceId || !valid) return
    postToHost({ type: 'addMember', workspaceId, email, role })
    setEmail('')
  }
  const remove = (memberId: string) => { if (workspaceId) postToHost({ type: 'removeMember', workspaceId, memberId }) }
  const copyLink = () => {
    if (!workspaceId) return
    void navigator.clipboard.writeText(`restman://invite/${workspaceId}`)
    pushToast('info', 'Invite link copied')
  }

  return (
    <div className="rm-members">
      <div className="rm-members-head">
        <span className="rm-members-title">{isOwner ? 'Invite to Workspace' : 'Members'}</span>
        <IconButton icon="close" label="close" />
      </div>

      {isOwner && (
        <div className="rm-invite-banner">
          <span className="codicon codicon-info" />
          <span>Inviting people makes this a team workspace.</span>
        </div>
      )}

      {isOwner && (
        <div className="rm-invite-block">
          <div className="rm-invite-form">
            <input
              className="rm-input"
              placeholder="Name, email, or group name"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && valid) invite() }}
            />
            <select className="rm-select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div className="rm-invite-actions">
            <button className="rm-btn rm-btn--tertiary" onClick={copyLink}>Copy Invite Link</button>
            <button className="rm-btn rm-btn--primary" disabled={!valid} onClick={invite}>Send Invite</button>
          </div>
        </div>
      )}

      <div className="rm-members-list-head">
        <span className="rm-section-title">Who has access</span>
      </div>
      <div className="rm-members-list">
        {members.map((m) => (
          <div key={m.id ?? m.email} className="rm-member-row">
            <span className="rm-member-email">{m.email}</span>
            <div className="rm-member-badges">
              {m.pending && <span className="rm-pending-tag">Pending</span>}
              <span className="rm-role-badge">{m.role}</span>
            </div>
            {isOwner && m.id && m.role !== 'owner' && (
              <div className="rm-actions">
                <IconButton icon="close" label={`remove ${m.email}`} onClick={() => remove(m.id!)} />
              </div>
            )}
          </div>
        ))}
        {members.length === 0 && <div className="rm-empty">No members yet.</div>}
      </div>
    </div>
  )
}
