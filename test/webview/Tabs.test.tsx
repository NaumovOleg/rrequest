import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { Tabs } from '../../src/webview/components/Tabs'

beforeEach(() => useStore.getState().__reset())

describe('Tabs', () => {
  it('the + button opens a new tab', () => {
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(useStore.getState().tabs).toHaveLength(1)
  })

  it('close removes a tab', () => {
    useStore.getState().openNewTab()
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(useStore.getState().tabs).toHaveLength(0)
  })

  it('renders a method badge and marks the active tab', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ method: 'POST' })
    render(<Tabs />)
    expect(document.querySelector('.rm-method--POST')).toBeTruthy()
    expect(document.querySelector('.rm-tab.is-active')).toBeTruthy()
  })
})
