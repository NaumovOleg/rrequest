import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('renders test results and console logs', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: '{}',
      bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
      testResults: [{ name: 'status is 200', passed: true }, { name: 'has id', passed: false, error: 'expected undefined to equal 1' }],
      consoleLogs: ['log line one'],
    })
    render(<ResponsePanel />)
    fireEvent.click(screen.getByRole('button', { name: /test results/i }))
    expect(screen.getByText(/PASS/)).toBeInTheDocument()
    expect(screen.getByText(/status is 200/)).toBeInTheDocument()
    expect(screen.getByText(/FAIL/)).toBeInTheDocument()
    expect(screen.getByText(/expected undefined to equal 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /console/i }))
    expect(screen.getByText('log line one')).toBeInTheDocument()
  })

  it('shows a status pill colored by range and PASS/FAIL badges', () => {
    useStore.getState().setResponse(activeId(), {
      status: 404, statusText: 'Not Found', headers: [], body: '{}', bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
      testResults: [{ name: 'x', passed: true }],
    })
    render(<ResponsePanel />)
    expect(document.querySelector('.rm-status-pill.is-4xx')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /test results/i }))
    expect(document.querySelector('.rm-pill-badge.is-pass')).toBeTruthy()
  })

  it('filters test results with the Passed/Failed chips', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: '{}', bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
      testResults: [{ name: 'ok test', passed: true }, { name: 'bad test', passed: false }],
    })
    render(<ResponsePanel />)
    fireEvent.click(screen.getByRole('button', { name: /test results/i }))
    fireEvent.click(screen.getByRole('button', { name: /failed \(1\)/i }))
    expect(screen.queryByText('ok test')).toBeNull()
    expect(screen.getByText('bad test')).toBeInTheDocument()
  })

  it('formats size in KB', () => {
    useStore.getState().setResponse(activeId(), {
      status: 200, statusText: 'OK', headers: [], body: 'x', bodyTruncated: false, timeMs: 1, sizeBytes: 2048, cookies: [],
    })
    render(<ResponsePanel />)
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
  })
})
