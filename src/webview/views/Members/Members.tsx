import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { IconButton } from '../../elements'

export function Members() {
  const members = useStore((s) => s.members)
  const workspaceId = useStore((s) => s.membersWorkspaceId)
  const activeRole = useStore((s) => s.activeWorkspace()?.role)
  const synced = useStore((s) => s.activeSynced())
  const authEmail = useStore((s) => s.authEmail)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')

  // A non-owner member (editor/viewer) can only view. Everyone else on a synced
  // workspace can manage it — that's the owner. We intentionally don't require
  // role === 'owner' here: an owner's role can be momentarily unknown in the
  // webview (stale role cache), and the server is the real gate (owner-only,
  // 403 otherwise). Inviting shares the Drive file, so it needs sync first;
  // a local (not-yet-synced) workspace shows an Enable-Sync prompt instead.
  const isNonOwnerMember = activeRole === 'editor' || activeRole === 'viewer'
  const canManage = synced && !isNonOwnerMember
  const needsSync = !synced && !!authEmail && !isNonOwnerMember

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
  const enableSync = () => { if (workspaceId) postToHost({ type: 'enableSync', workspaceId }) }

  return (
    <div className="rm-members">
      <div className="rm-members-head">
        <span className="rm-members-title">{canManage ? 'Invite to Workspace' : 'Members'}</span>
      </div>

      {needsSync && (
        <div className="rm-invite-block">
          <div className="rm-invite-banner">
            <span className="codicon codicon-cloud-upload" />
            <span>Enable sync to share this workspace and invite people.</span>
          </div>
          <div className="rm-invite-actions">
            <button className="rm-btn rm-btn--primary" onClick={enableSync}>Enable Sync</button>
          </div>
        </div>
      )}

      {canManage && (
        <div className="rm-invite-banner">
          <span className="codicon codicon-info" />
          <span>Inviting people makes this a team workspace.</span>
        </div>
      )}

      {canManage && (
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
            {canManage && m.id && m.role !== 'owner' && (
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
