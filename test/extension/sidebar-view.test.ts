import { describe, it, expect } from 'vitest'
import { buildSidebarHtml } from '../../src/extension/sidebar-view'

describe('buildSidebarHtml', () => {
  it('embeds script + style with a strict CSP and a classic script', () => {
    const html = buildSidebarHtml('https://cdn/sidebar.js', 'https://cdn/sidebar.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC')
    expect(html).toContain('https://cdn/sidebar.js')
    expect(html).toContain('https://cdn/sidebar.css')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('nonce="ABC"')
    expect(html).not.toContain('type="module"')
    expect(html).toContain('<div id="root">')
  })

  it('links codicons and allows font-src', () => {
    const html = buildSidebarHtml('https://cdn/sidebar.js', 'https://cdn/sidebar.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC')
    expect(html).toContain('https://cdn/codicon.css')
    expect(html).toContain('font-src vscode-webview://x')
  })
})
