import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { EnvVarInput } from '../../src/webview/elements/EnvVarInput'

describe('EnvVarInput', () => {
  it('highlights only variables that exist in the active environment', () => {
    const { container } = render(
      <EnvVarInput
        value="https://{{base}}/x?t={{missing}}"
        onChange={() => {}}
        knownVars={new Set(['base'])}
      />,
    )
    const marks = Array.from(container.querySelectorAll('.rm-envvar')).map((e) => e.textContent)
    expect(marks).toEqual(['{{base}}'])          // base is known → highlighted
    // the unknown token is present as text but not highlighted
    expect(container.querySelector('.rm-envinput-mirror')?.textContent).toContain('{{missing}}')
  })

  it('hovers the field to show each variable resolved to its value, or “not set”', () => {
    const { container } = render(
      <EnvVarInput
        value="https://{{base}}/x?t={{token}}"
        onChange={() => {}}
        knownVars={new Set(['base', 'token'])}
        values={new Map([['base', 'https://api.test']])}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.rm-envinput')!)
    const hintNames = Array.from(container.querySelectorAll('.rm-env-hint-name')).map((e) => e.textContent)
    expect(hintNames).toContain('{{base}}')
    expect(hintNames).toContain('{{token}}')
    expect(screen.getByText('https://api.test')).toBeInTheDocument()
    const missing = Array.from(container.querySelectorAll('.rm-env-hint-value'))
      .find((e) => e.textContent === 'not set')
    expect(missing?.className).toContain('is-missing')
  })
})
