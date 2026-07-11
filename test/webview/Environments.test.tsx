import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { Environments } from '../../src/webview/components/Environments/Environments'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('Environments', () => {
  it('New Environment posts createEnvironment', () => {
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /new environment/i }))
    expect(posted).toContainEqual({ type: 'createEnvironment', name: 'New Environment' })
  })

  it('editing a variable and clicking Save posts saveEnvironment with the edited vars', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    render(<Environments />)
    // select the env to edit
    fireEvent.click(screen.getByRole('button', { name: 'Dev' }))
    // type a key and value into the trailing blank row
    fireEvent.change(screen.getByPlaceholderText('var key'), { target: { value: 'base' } })
    fireEvent.change(screen.getByPlaceholderText('var value'), { target: { value: 'https://api.dev' } })
    fireEvent.click(screen.getByRole('button', { name: /save environment/i }))
    const msg = posted.find((m) => m.type === 'saveEnvironment')
    expect(msg).toBeTruthy()
    expect(msg.environment.id).toBe('e1')
    expect(msg.environment.variables[0]).toMatchObject({ key: 'base', value: 'https://api.dev', enabled: true })
  })

  it('Delete posts deleteEnvironment', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    render(<Environments />)
    fireEvent.click(screen.getByRole('button', { name: /delete Dev/i }))
    expect(posted).toContainEqual({ type: 'deleteEnvironment', id: 'e1' })
  })
})
