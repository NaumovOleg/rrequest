import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarHeader } from '../../src/webview/views/SidebarHeader/SidebarHeader'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

const props = { tab: 'collections' as const, onTab: () => {}, onNewHttp: () => {}, onNewWs: () => {}, onNewGrpc: () => {} }
beforeEach(() => useStore.getState().__reset())

describe('account row', () => {
  it('signed out → Sign in with Google posts signIn', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail(null)
    render(<SidebarHeader {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signIn' })
  })
  it('signed in → shows email + Sign out posts signOut', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    render(<SidebarHeader {...props} />)
    expect(screen.getByText(/me@x\.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signOut' })
  })
})
