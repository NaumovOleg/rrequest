import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { SidebarHeader } from '../../src/webview/views/SidebarHeader/SidebarHeader'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

const noop = () => {}

describe('SidebarHeader', () => {
  it('primary New HTTP Request button fires onNewHttp', () => {
    const onNewHttp = vi.fn()
    render(<SidebarHeader tab="collections" onTab={noop} onNewHttp={onNewHttp} onNewWs={noop} onNewGrpc={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'New HTTP Request' }))
    expect(onNewHttp).toHaveBeenCalled()
  })
  it('split menu exposes New WebSocket', () => {
    const onNewWs = vi.fn()
    render(<SidebarHeader tab="collections" onTab={noop} onNewHttp={noop} onNewWs={onNewWs} onNewGrpc={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /new http request options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /new websocket/i }))
    expect(onNewWs).toHaveBeenCalled()
  })
  it('split menu exposes New gRPC Request', () => {
    const onNewGrpc = vi.fn()
    render(<SidebarHeader tab="collections" onTab={noop} onNewHttp={noop} onNewWs={noop} onNewGrpc={onNewGrpc} />)
    fireEvent.click(screen.getByRole('button', { name: /new http request options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /new grpc/i }))
    expect(onNewGrpc).toHaveBeenCalled()
  })
  it('Collections and History tabs switch via onTab', () => {
    const onTab = vi.fn()
    render(<SidebarHeader tab="collections" onTab={onTab} onNewHttp={noop} onNewWs={noop} onNewGrpc={noop} />)
    fireEvent.click(screen.getByRole('tab', { name: /history/i }))
    expect(onTab).toHaveBeenCalledWith('history')
  })
  it('Trash tab switches via onTab', () => {
    const onTab = vi.fn()
    render(<SidebarHeader tab="collections" onTab={onTab} onNewHttp={noop} onNewWs={noop} onNewGrpc={noop} />)
    fireEvent.click(screen.getByRole('tab', { name: /trash/i }))
    expect(onTab).toHaveBeenCalledWith('trash')
  })
  it('Environments tab switches via onTab', () => {
    const onTab = vi.fn()
    render(<SidebarHeader tab="collections" onTab={onTab} onNewHttp={noop} onNewWs={noop} onNewGrpc={noop} />)
    fireEvent.click(screen.getByRole('tab', { name: /environments/i }))
    expect(onTab).toHaveBeenCalledWith('environments')
  })
})
