import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PopupMenu } from '../../src/webview/components/common/PopupMenu'
describe('PopupMenu', () => {
  it('opens on click and fires an item', () => {
    const onClick = vi.fn()
    render(<PopupMenu icon="gear" label="settings" items={[{ label: 'Delete', onClick }]} />)
    expect(screen.queryByText('Delete')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    fireEvent.click(screen.getByText('Delete'))
    expect(onClick).toHaveBeenCalled()
    expect(screen.queryByText('Delete')).toBeNull()   // closed after click
  })
})
