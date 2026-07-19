import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WebSocketPanel } from '../../src/webview/views/WebSocket/WebSocketPanel'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('WebSocketPanel', () => {
  it('Connect posts wsConnect and starts connecting', () => {
    useStore.getState().setWsUrl('wss://echo')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    const msg = posted.find((m) => m.type === 'wsConnect')
    expect(msg).toBeTruthy()
    expect(msg.url).toBe('wss://echo')
    expect(useStore.getState().wsStatus).toBe('connecting')
    expect(useStore.getState().wsConnId).toBe(msg.connId)
  })
  it('Connect is disabled on empty URL', () => {
    render(<WebSocketPanel />)
    const connectBtn = screen.getByRole('button', { name: /^connect$/i })
    expect(connectBtn).toBeDisabled()
  })
  it('when open, Send posts wsSend and logs an out entry', () => {
    useStore.getState().setWsUrl('wss://echo')
    useStore.getState().wsStartConnect('c1')
    useStore.getState().wsSetStatus('open')
    useStore.getState().setWsInput('ping')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    expect(posted).toContainEqual({ type: 'wsSend', connId: 'c1', data: 'ping' })
    expect(useStore.getState().wsLog.at(-1)).toMatchObject({ dir: 'out', data: 'ping' })
    expect(useStore.getState().wsInput).toBe('')
  })
  it('Send is disabled when status is not open', () => {
    useStore.getState().setWsUrl('wss://echo')
    useStore.getState().wsStartConnect('c1')
    useStore.getState().wsSetStatus('closed')
    render(<WebSocketPanel />)
    const sendBtn = screen.getByRole('button', { name: /^send$/i })
    expect(sendBtn).toBeDisabled()
  })
  it('when open, Disconnect posts wsDisconnect', () => {
    useStore.getState().wsStartConnect('c1'); useStore.getState().wsSetStatus('open')
    render(<WebSocketPanel />)
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(posted).toContainEqual({ type: 'wsDisconnect', connId: 'c1' })
  })
  it('renders log entries', () => {
    useStore.getState().wsAppendLog({ dir: 'in', data: 'hello-in', at: 1 })
    render(<WebSocketPanel />)
    expect(screen.getByText(/hello-in/)).toBeInTheDocument()
  })
  it('editing the headers table includes the header in wsConnect', () => {
    useStore.getState().setWsUrl('wss://echo')
    render(<WebSocketPanel />)
    fireEvent.change(screen.getByLabelText('ws header key 0'), { target: { value: 'X-Auth' } })
    fireEvent.change(screen.getByLabelText('ws header value 0'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    const msg = posted.find((m) => m.type === 'wsConnect')
    expect(msg).toBeTruthy()
    expect(msg.headers).toContainEqual({ key: 'X-Auth', value: 'tok', enabled: true })
  })
  it('shows a status pill and colored log rows', () => {
    useStore.getState().wsStartConnect('c1'); useStore.getState().wsSetStatus('open')
    useStore.getState().wsAppendLog({ dir: 'in', data: 'hi', at: 1 })
    render(<WebSocketPanel />)
    expect(document.querySelector('.rm-status-pill.is-2xx')).toBeTruthy()
    expect(document.querySelector('.rm-log-row.is-in')).toBeTruthy()
  })
})
