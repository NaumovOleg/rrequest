import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'

describe('theme.css', () => {
  it('uses vscode css variables and no hard-coded hex on body', () => {
    const css = fs.readFileSync('src/webview/theme.css', 'utf8')
    expect(css).toContain('var(--vscode-editor-background)')
    expect(css).toContain('var(--vscode-foreground)')
    expect(css).toContain('var(--vscode-button-background)')
    expect(/body\s*{[^}]*#[0-9a-fA-F]{3,6}/.test(css)).toBe(false)
  })
})
