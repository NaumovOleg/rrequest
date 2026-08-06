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

  it('shows a dirty dot on a tab with unsaved changes', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ url: 'https://api/x' })
    render(<Tabs />)
    expect(screen.getByLabelText('unsaved changes')).toBeTruthy()
  })

  it('closing a dirty tab asks for confirmation, Cancel keeps it', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ url: 'https://api/x' })
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(useStore.getState().tabs).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStore.getState().tabs).toHaveLength(1)
  })

  it('confirming the dialog discards the dirty tab', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ url: 'https://api/x' })
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /close without saving/i }))
    expect(useStore.getState().tabs).toHaveLength(0)
  })

  it('a clean tab closes without a dialog', () => {
    useStore.getState().openNewTab()
    render(<Tabs />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStore.getState().tabs).toHaveLength(0)
  })
})
