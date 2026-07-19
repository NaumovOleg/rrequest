import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconButton } from '../../src/webview/elements/IconButton'
describe('IconButton', () => {
  it('renders a codicon with an aria-label and fires onClick', () => {
    const onClick = vi.fn()
    render(<IconButton icon="edit" label="rename" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'rename' })
    expect(btn.querySelector('.codicon.codicon-edit')).toBeTruthy()
    fireEvent.click(btn); expect(onClick).toHaveBeenCalled()
  })
})
