import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RenameInput } from '../../src/webview/components/common/RenameInput'
describe('RenameInput', () => {
  it('commits on Enter and cancels on Escape', () => {
    const onCommit = vi.fn(); const onCancel = vi.fn()
    render(<RenameInput initial="Old" onCommit={onCommit} onCancel={onCancel} />)
    const input = screen.getByDisplayValue('Old')
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('New')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not let keydowns bubble to an ancestor row handler', () => {
    const onCommit = vi.fn(); const onCancel = vi.fn()
    const wrapperKeyDown = vi.fn()
    render(
      <div onKeyDown={wrapperKeyDown}>
        <RenameInput initial="Old" onCommit={onCommit} onCancel={onCancel} />
      </div>
    )
    const input = screen.getByDisplayValue('Old')

    fireEvent.keyDown(input, { key: ' ' })
    expect(wrapperKeyDown).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('New')
    expect(wrapperKeyDown).not.toHaveBeenCalled()
  })
})
