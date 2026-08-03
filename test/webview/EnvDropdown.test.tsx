import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  getUiState: (_k: string, fb: any) => fb,
  setUiState: () => {},
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { EnvDropdown } from '../../src/webview/components/EnvDropdown'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('EnvDropdown', () => {
  it('lists environments plus No Environment and reflects the active id', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    useStore.getState().setActiveEnvId('e1')
    render(<EnvDropdown />)
    const sel = screen.getByLabelText(/active environment/i) as HTMLSelectElement
    expect(sel.value).toBe('e1')
    expect(screen.getByText('No Environment')).toBeInTheDocument()
    expect(screen.getByText('Dev')).toBeInTheDocument()
  })

  it('posts setActiveEnv with the chosen id', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    render(<EnvDropdown />)
    fireEvent.change(screen.getByLabelText(/active environment/i), { target: { value: 'e1' } })
    expect(posted).toContainEqual({ type: 'setActiveEnv', id: 'e1' })
  })

  it('posts setActiveEnv with null when No Environment is chosen', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    useStore.getState().setActiveEnvId('e1')
    render(<EnvDropdown />)
    fireEvent.change(screen.getByLabelText(/active environment/i), { target: { value: '' } })
    expect(posted).toContainEqual({ type: 'setActiveEnv', id: null })
  })
})
