import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PopupMenu } from '../../src/webview/elements/PopupMenu'

const open = (label = 'settings') => fireEvent.click(screen.getByRole('button', { name: label }))

describe('PopupMenu', () => {
  it('opens on click and fires an item', () => {
    const onClick = vi.fn()
    render(<PopupMenu icon="gear" label="settings" items={[{ label: 'Delete', onClick }]} />)
    expect(screen.queryByText('Delete')).toBeNull()
    open()
    fireEvent.click(screen.getByText('Delete'))
    expect(onClick).toHaveBeenCalled()
    expect(screen.queryByText('Delete')).toBeNull() // closed after click
  })

  it('renders headers and separators as structure, not as clickable menu items', () => {
    render(<PopupMenu icon="gear" label="settings" items={[
      { kind: 'header', label: 'Environment' },
      { label: 'Dev', onClick: () => {} },
      { kind: 'separator' },
      { label: 'Standalone', onClick: () => {} },
    ]} />)
    open()
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Dev', 'Standalone'])
    expect(screen.getByText('Environment')).toBeInTheDocument()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('indents only the rows that belong to a section', () => {
    render(<PopupMenu icon="gear" label="settings" items={[
      { kind: 'header', label: 'Section' },
      { label: 'Inside', onClick: () => {} },
      { kind: 'separator' },
      { label: 'Outside', onClick: () => {} },
    ]} />)
    open()
    expect(screen.getByRole('menuitem', { name: 'Inside' }).className).toContain('rm-popup-item--sub')
    expect(screen.getByRole('menuitem', { name: 'Outside' }).className).not.toContain('rm-popup-item--sub')
  })

  it('exposes checked state and renders a hint alongside the label', () => {
    render(<PopupMenu icon="gear" label="settings" items={[
      { label: 'Prod', checked: true, onClick: () => {} },
      { label: 'Team', hint: 'me@x.com', onClick: () => {} },
    ]} />)
    open()
    expect(screen.getByRole('menuitem', { name: /Prod/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('me@x.com').className).toContain('rm-popup-hint')
  })

  it('a disabled item is inert', () => {
    const onClick = vi.fn()
    render(<PopupMenu icon="gear" label="settings" items={[{ label: 'No environments yet', disabled: true, onClick }]} />)
    open()
    fireEvent.click(screen.getByText('No environments yet'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByText('No environments yet')).toBeInTheDocument() // stays open
  })

  it('Escape closes the menu', () => {
    render(<PopupMenu icon="gear" label="settings" items={[{ label: 'Delete', onClick: () => {} }]} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Delete')).toBeNull()
  })
})
