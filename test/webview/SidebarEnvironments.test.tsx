import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { SidebarEnvironments } from '../../src/webview/views/SidebarEnvironments/SidebarEnvironments'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('SidebarEnvironments', () => {
  it('add posts createEnvironment', () => {
    render(<SidebarEnvironments />)
    fireEvent.click(screen.getByRole('button', { name: /add environment/i }))
    expect(posted).toContainEqual({ type: 'createEnvironment', name: 'New Environment' })
  })
  it('clicking an env opens it in the editor via openEnvironments', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<SidebarEnvironments />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))
    expect(posted).toContainEqual({ type: 'openEnvironments', id: 'e1' })
  })
  it('rename posts saveEnvironment with the new name', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<SidebarEnvironments />)
    fireEvent.click(screen.getByRole('button', { name: /rename Dev/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Prod' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg.environment).toMatchObject({ id: 'e1', name: 'Prod' })
  })
  it('delete posts deleteEnvironment', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<SidebarEnvironments />)
    fireEvent.click(screen.getByRole('button', { name: /delete Dev/i }))
    expect(posted).toContainEqual({ type: 'deleteEnvironment', id: 'e1' })
  })
})
