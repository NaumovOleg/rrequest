import { describe, it, expect } from 'vitest'
import { buildHtml } from '../../src/extension/panel'

describe('buildHtml', () => {
  it('embeds the script uri and a strict CSP with the nonce', () => {
    const html = buildHtml('https://cdn/webview.js', 'vscode-webview://x', 'ABC123')
    expect(html).toContain('https://cdn/webview.js')
    expect(html).toContain('nonce="ABC123"')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('<div id="root">')
  })
})
