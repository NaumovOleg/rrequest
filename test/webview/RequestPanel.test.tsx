import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    fireEvent.change(screen.getByPlaceholderText(/url/i), { target: { value: 'https://api.test/x' } })
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
})
