import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from '../../src/webview/elements/ContextMenu'

describe('ContextMenu', () => {
  it('opens at the clamped position so it never runs past the viewport edge', () => {
    // Stub a menu big enough that a right-click near the right/bottom edge
    // would overflow without clamping.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    render(
      <ContextMenu
        x={390}
        y={290}
        items={[{ label: 'Delete', onClick: () => {} }]}
        onClose={() => {}}
      />,
    )
    const menu = screen.getByRole('menu')
    const rect = menu.getBoundingClientRect()
    // clamp keeps the menu inside the viewport with a 6px margin
    expect(rect.right).toBeLessThanOrEqual(400)
    expect(rect.bottom).toBeLessThanOrEqual(300)
  })

  it('keeps the clicked position when there is room', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: 'Delete', onClick: () => {} }]}
        onClose={() => {}}
      />,
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('10px')
    expect(menu.style.top).toBe('10px')
  })

  it('fires the item and closes', () => {
    const onClick = vi.fn()
    const onClose = vi.fn()
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: 'Delete', onClick }]}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Delete'))
    expect(onClick).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})