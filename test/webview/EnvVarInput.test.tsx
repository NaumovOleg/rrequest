import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
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
})
