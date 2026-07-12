import { describe, it, expect } from 'vitest'
import { buildSidebarHtml } from '../../src/extension/sidebar-view'

describe('buildSidebarHtml', () => {
  it('embeds script + style with a strict CSP and a classic script', () => {
    const html = buildSidebarHtml('https://cdn/sidebar.js', 'https://cdn/sidebar.css', 'vscode-webview://x', 'ABC')
    expect(html).toContain('https://cdn/sidebar.js')
    expect(html).toContain('https://cdn/sidebar.css')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('nonce="ABC"')
    expect(html).not.toContain('type="module"')
    expect(html).toContain('<div id="root">')
  })
})
