import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { FormDataItem } from '../../../shared/types'

export function FormDataEditor() {
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const update = useStore((s) => s.updateActive)
  const setPendingFilePick = useStore((s) => s.setPendingFilePick)
  if (!active) return null

  const items: FormDataItem[] = active.body.mode === 'formdata' ? active.body.items : []
  const setItems = (next: FormDataItem[]) => update({ body: { mode: 'formdata', items: next } })
  const patch = (i: number, next: FormDataItem) => setItems(items.map((r, j) => (j === i ? next : r)))
  const rows: FormDataItem[] = [...items, { kind: 'text', key: '', value: '', enabled: true }]

  return (
    <table><tbody>
      {rows.map((r, i) => (
        <tr key={i} className="rm-row">
          <td>
            <input type="checkbox" checked={r.enabled}
              onChange={(e) => i < items.length && patch(i, { ...r, enabled: e.target.checked })} />
          </td>
          <td>
            <select className="rm-select" aria-label={`form type ${i}`} value={r.kind}
              onChange={(e) => {
                if (i >= items.length) return
                const kind = e.target.value as 'text' | 'file'
                patch(i, kind === 'file'
                  ? { kind: 'file', key: r.key, filename: '', path: '', enabled: r.enabled }
                  : { kind: 'text', key: r.key, value: '', enabled: r.enabled })
              }}>
              <option value="text">text</option>
              <option value="file">file</option>
            </select>
          </td>
          <td>
            <input className="rm-input" aria-label={`form key ${i}`} placeholder="key" value={r.key}
              onChange={(e) => {
                if (i < items.length) patch(i, { ...r, key: e.target.value })
                else setItems([...items, { kind: 'text', key: e.target.value, value: '', enabled: true }])
              }} />
          </td>
          <td>
            {r.kind === 'text' ? (
              <input className="rm-input" aria-label={`form value ${i}`} placeholder="value" value={r.value}
                onChange={(e) => i < items.length && patch(i, { ...r, value: e.target.value })} />
            ) : (
              <span className="rm-row">
                <button className="rm-btn" onClick={() => {
                  if (i >= items.length) return
                  setPendingFilePick({ tabId: active.id, index: i })
                  postToHost({ type: 'pickFile' })
                }}>Choose file</button>
                <span>{r.filename || 'no file'}</span>
              </span>
            )}
          </td>
        </tr>
      ))}
    </tbody></table>
  )
}
