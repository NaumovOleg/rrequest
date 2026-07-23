import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toaster } from '../../src/webview/elements/Toaster'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => { useStore.getState().__reset(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('Toaster', () => {
  it('renders queued toasts and auto-dismisses them', () => {
    render(<Toaster />)
    act(() => { useStore.getState().pushToast('error', 'read only') })
    expect(screen.getByText('read only')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText('read only')).toBeNull()
  })
})
