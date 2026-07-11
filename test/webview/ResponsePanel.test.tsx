import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { ResponsePanel } from '../../src/webview/components/ResponsePanel/ResponsePanel'

beforeEach(() => { useStore.getState().__reset(); useStore.getState().openNewTab() })
function activeId() { return useStore.getState().tabs[0].id }

describe('ResponsePanel', () => {
  it('renders status, time and size', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: '{"a":1}',
      bodyTruncated: false, timeMs: 42, sizeBytes: 7, cookies: [],
    })
    render(<ResponsePanel />)
    expect(screen.getByText(/200/)).toBeInTheDocument()
    expect(screen.getByText(/42 ms/)).toBeInTheDocument()
    expect(screen.getByText(/7 B/)).toBeInTheDocument()
  })

  it('shows an error banner when error is set', () => {
    useStore.getState().setResponse(activeId(), {
      status: 0, statusText: '', headers: [], body: '',
      bodyTruncated: false, timeMs: 5, sizeBytes: 0, cookies: [],
      error: { kind: 'connection', message: 'fetch failed' },
    })
    render(<ResponsePanel />)
    expect(screen.getByRole('alert')).toHaveTextContent(/fetch failed/)
  })

  it('shows a truncation note when bodyTruncated', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: 'xxxx',
      bodyTruncated: true, timeMs: 1, sizeBytes: 9999999, cookies: [],
    })
    render(<ResponsePanel />)
    expect(screen.getByText(/too large|truncated/i)).toBeInTheDocument()
  })
})
