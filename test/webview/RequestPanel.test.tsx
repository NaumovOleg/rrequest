import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { RequestPanel } from '../../src/webview/components/RequestPanel/RequestPanel'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; useStore.getState().openNewTab() })

describe('RequestPanel', () => {
  it('disables Send when URL is empty', () => {
    render(<RequestPanel />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('enables Send and posts a sendRequest with folded params', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'https://api.test/x' } })
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('sendRequest')
    expect(posted[0].payload.url).toBe('https://api.test/x')
  })

  it('changing method updates the active request', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByLabelText(/method/i), { target: { value: 'POST' } })
    expect(useStore.getState().tabs[0].method).toBe('POST')
  })

  it('disables Save when no collection chosen', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: '', requests: [] }])
    render(<RequestPanel />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('choosing a collection enables Save and posts saveRequest', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: '', requests: [] }])
    render(<RequestPanel />)
    fireEvent.change(screen.getByLabelText(/save to collection/i), { target: { value: 'c1' } })
    const save = screen.getByRole('button', { name: /save/i })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('saveRequest')
    expect(posted[0].collectionId).toBe('c1')
    expect(posted[0].request.id).toBe(useStore.getState().activeTabId)
  })

  it('typing into the name input updates the active request', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByLabelText(/request name/i), { target: { value: 'My Req' } })
    expect(useStore.getState().tabs[0].name).toBe('My Req')
  })

  it('Copy as cURL writes the request as a curl command to the clipboard', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    useStore.getState().updateActive({ method: 'GET', url: 'https://api.test/x' })
    render(<RequestPanel />)
    fireEvent.click(screen.getByRole('button', { name: /copy as curl/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`curl -X GET 'https://api.test/x'`))
  })

  it('Import from cURL creates a new tab from the pasted command', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getByLabelText(/curl command/i), { target: { value: 'curl -X POST https://api.test/y' } })
    fireEvent.click(screen.getByRole('button', { name: /import from curl/i }))
    const s = useStore.getState(); const active = s.tabs.find((t) => t.id === s.activeTabId)!
    expect(active.url).toBe('https://api.test/y'); expect(active.method).toBe('POST')
  })

  it('edits the pre-request and test scripts', () => {
    render(<RequestPanel />)
    fireEvent.click(screen.getByRole('button', { name: /pre-request/i }))
    fireEvent.change(screen.getByLabelText(/pre-request script/i), { target: { value: 'pm.environment.set("a","1")' } })
    expect(useStore.getState().tabs[0].preRequestScript).toBe('pm.environment.set("a","1")')
    fireEvent.click(screen.getByRole('button', { name: /^tests$/i }))
    fireEvent.change(screen.getByLabelText(/test script/i), { target: { value: 'pm.test("t", () => {})' } })
    expect(useStore.getState().tabs[0].testScript).toBe('pm.test("t", () => {})')
  })

  it('the Save collection dropdown initializes from pendingSaveCollectionId', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [] }, { id: 'c2', name: 'C2', workspaceId: 'w1', requests: [] }])
    useStore.getState().setPendingSaveCollectionId('c2')
    render(<RequestPanel />)
    expect((screen.getByLabelText(/save to collection/i) as HTMLSelectElement).value).toBe('c2')
  })

  it('clears the Save collection dropdown when pendingSaveCollectionId is reset to null', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [] }, { id: 'c2', name: 'C2', workspaceId: 'w1', requests: [] }])
    useStore.getState().setPendingSaveCollectionId('c1')
    render(<RequestPanel />)
    expect((screen.getByLabelText(/save to collection/i) as HTMLSelectElement).value).toBe('c1')
    act(() => { useStore.getState().setPendingSaveCollectionId(null) })
    expect((screen.getByLabelText(/save to collection/i) as HTMLSelectElement).value).toBe('')
  })

  it('colors the method select and marks the active sub-tab', () => {
    useStore.getState().updateActive({ method: 'DELETE' })
    render(<RequestPanel />)
    const sel = screen.getByLabelText('method')
    expect(sel.className).toContain('rm-method--DELETE')
    // params sub-tab active by default
    expect(document.querySelector('.rm-subtab.is-active')).toBeTruthy()
  })

  it('Save posts the pending folder id', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
    useStore.getState().setPendingSaveCollectionId('c1')
    useStore.getState().setPendingSaveFolderId('f1')
    render(<RequestPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    const msg = posted.find((m) => m.type === 'saveRequest')
    expect(msg.collectionId).toBe('c1'); expect(msg.folderId).toBe('f1')
  })

  it('params table has a Description column that updates the row', () => {
    render(<RequestPanel />)
    fireEvent.change(screen.getAllByPlaceholderText('key')[0], { target: { value: 'k' } })
    fireEvent.change(screen.getAllByPlaceholderText('description')[0], { target: { value: 'my note' } })
    expect(useStore.getState().tabs[0].params[0].description).toBe('my note')
  })

  it('Authorization tab: choosing Bearer stores a bearer token', () => {
    render(<RequestPanel />)
    fireEvent.click(screen.getByRole('button', { name: /authorization/i }))
    fireEvent.change(screen.getByLabelText(/auth type/i), { target: { value: 'bearer' } })
    fireEvent.change(screen.getByLabelText(/bearer token/i), { target: { value: 'tok' } })
    expect(useStore.getState().tabs[0].auth).toEqual({ type: 'bearer', token: 'tok' })
  })
})
