import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MethodBadge } from '../../src/webview/components/common/MethodBadge'

describe('MethodBadge', () => {
  it('renders the method with its color class', () => {
    render(<MethodBadge method="GET" />)
    const el = screen.getByText('GET')
    expect(el.className).toContain('rm-method')
    expect(el.className).toContain('rm-method--GET')
  })
})
