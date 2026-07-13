import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'

describe('theme.css', () => {
  it('uses vscode css variables and no hard-coded hex on body', () => {
    const css = fs.readFileSync('src/webview/theme.css', 'utf8')
    expect(css).toContain('var(--vscode-editor-background)')
    expect(css).toContain('var(--vscode-foreground)')
    expect(css).toContain('--vscode-button-background')
    expect(/body\s*{[^}]*#[0-9a-fA-F]{3,6}/.test(css)).toBe(false)
  })

  it('defines the design-system custom properties and component classes', () => {
    const css = fs.readFileSync('src/webview/theme.css', 'utf8')
    expect(css).toContain('--rm-accent')
    expect(css).toContain('--rm-m-get')
    expect(css).toContain('.rm-method--GET')
    expect(css).toContain('.rm-tab')
    expect(css).toContain('.rm-kvtable')
    expect(css).toContain('.rm-status-pill')
    expect(css).toContain('.rm-log-row')
  })
})
