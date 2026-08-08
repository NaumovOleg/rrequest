import { useState } from 'react'
import { parseMarkdown, renderInline } from '../../state/markdown'

// Modal for viewing/editing a markdown description (request, collection or
// folder). Edit and Preview tabs; in preview the description renders via the
// dependency-free markdown renderer. readOnly hides the editor (viewer role).
export function DocsModal({ title, initial, readOnly, onClose, onSave }: {
  title: string
  initial: string
  readOnly?: boolean
  onClose: () => void
  onSave: (text: string) => void
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>(readOnly ? 'preview' : 'edit')
  const [text, setText] = useState(initial)
  const blocks = parseMarkdown(text)
  return (
    <div className="rm-modal-scrim" onClick={onClose}>
      <div className="rm-modal rm-scripts-modal" role="dialog" aria-modal="true" aria-label={`${title} description`}
        onClick={(e) => e.stopPropagation()}>
        <div className="rm-modal-title">{title}</div>
        {!readOnly && (
          <div className="rm-chips">
            {(['edit', 'preview'] as const).map((t) => (
              <button key={t} className={`rm-chip ${tab === t ? 'is-active' : ''}`}
                aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'edit' ? 'Edit' : 'Preview'}</button>
            ))}
          </div>
        )}
        {tab === 'edit' && !readOnly ? (
          <textarea
            className="rm-input rm-code-input rm-docs-textarea"
            aria-label="description (markdown)"
            placeholder={'Description in Markdown:\n# Endpoint\n\nThis request **fetches** the user.\n\n- GET /users\n- auth: bearer'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
          />
        ) : (
          <div className="rm-docs-preview">
            {blocks.length === 0
              ? <div className="rm-blank-hint">No description yet.</div>
              : blocks.map((b, i) => {
                if (b.t === 'h') return <div key={i} className={`rm-docs-h rm-docs-h${b.level}`}>{renderInline(b.text, `h${i}`)}</div>
                if (b.t === 'code') return <pre key={i} className="rm-code rm-docs-code">{b.text}</pre>
                if (b.t === 'list') return (
                  <ul key={i} className="rm-docs-list">
                    {b.items.map((it, j) => <li key={j}>{renderInline(it, `l${i}.${j}`)}</li>)}
                  </ul>
                )
                return <p key={i} className="rm-docs-p">{renderInline(b.text, `p${i}`)}</p>
              })}
          </div>
        )}
        {!readOnly && (
          <div className="rm-modal-actions">
            <button className="rm-btn" onClick={onClose}>Cancel</button>
            <button className="rm-btn rm-btn--primary" onClick={() => onSave(text)}>Save</button>
          </div>
        )}
        {readOnly && (
          <div className="rm-modal-actions">
            <button className="rm-btn" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}