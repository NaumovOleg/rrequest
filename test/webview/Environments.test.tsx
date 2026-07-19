import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { Environments } from '../../src/webview/views/Environments/Environments'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('Environments', () => {
  it('add environment posts createEnvironment', () => {
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /add environment/i }))
    expect(posted).toContainEqual({ type: 'createEnvironment', name: 'New Environment' })
  })

  it('adding a plain variable and clicking Save posts saveEnvironment with the edited vars', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))       // select env
    fireEvent.click(screen.getByRole('button', { name: /^Variable$/ })) // add plain var row 0
    fireEvent.change(screen.getByLabelText('var key 0'), { target: { value: 'base' } })
    fireEvent.change(screen.getByLabelText('var value 0'), { target: { value: 'https://api.dev' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg).toBeTruthy()
    expect(msg.environment.id).toBe('e1')
    expect(msg.environment.variables[0]).toMatchObject({ key: 'base', value: 'https://api.dev', enabled: true, secret: false })
  })

  it('adding a secret variable marks it secret and masks the value input', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))
    fireEvent.click(screen.getByRole('button', { name: /^Secret$/ }))   // add secret var row 0
    fireEvent.change(screen.getByLabelText('var key 0'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('var value 0'), { target: { value: 's3cr3t' } })
    expect((screen.getByLabelText('var value 0') as HTMLInputElement).type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg.environment.variables[0]).toMatchObject({ key: 'token', value: 's3cr3t', secret: true })
  })

  it('toggling a variable type flips secret', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [{ key: 'k', value: 'v', enabled: true }] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))
    fireEvent.click(screen.getByRole('button', { name: /toggle secret 0/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg.environment.variables[0].secret).toBe(true)
  })

  it('auto-opens the environment named by envEditId', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [{ key: 'k', value: 'v', enabled: true }] }])
    useStore.getState().setEnvEditId('e1')
    render(<Environments />)
    // editor head shows the env title + its variable row is present
    expect(screen.getByLabelText('var key 0')).toBeInTheDocument()
  })

  it('Delete posts deleteEnvironment', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /delete Dev/i }))
    expect(posted).toContainEqual({ type: 'deleteEnvironment', id: 'e1' })
  })
})
