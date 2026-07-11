import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { Tabs } from '../../src/webview/components/Tabs/Tabs'

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
})
