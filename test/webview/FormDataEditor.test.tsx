import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {}, getUiState: (_k: string, fb: any) => fb, setUiState: () => {} }))

import { FormDataEditor } from '../../src/webview/components/FormDataEditor'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; useStore.getState().openNewTab() })

describe('FormDataEditor', () => {
  it('adds a text field into the active request body', () => {
    render(<FormDataEditor />)
    fireEvent.change(screen.getByLabelText('form key 0'), { target: { value: 'name' } })
    const body = useStore.getState().tabs[0].body
    expect(body).toMatchObject({ mode: 'formdata' })
    expect((body as any).items[0]).toMatchObject({ kind: 'text', key: 'name', enabled: true })
  })

  it('switching a row to file shows Choose file which sets pendingFilePick and posts pickFile', () => {
    // seed one file-row
    useStore.getState().updateActive({ body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: '', path: '', enabled: true }] } })
    render(<FormDataEditor />)
    fireEvent.click(screen.getByRole('button', { name: /choose file/i }))
    expect(posted).toContainEqual({ type: 'pickFile' })
    const tabId = useStore.getState().tabs[0].id
    expect(useStore.getState().pendingFilePick).toEqual({ tabId, index: 0 })
  })
})
