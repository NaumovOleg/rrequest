import { describe, it, expect } from 'vitest'
import { buildHtml } from '../../src/extension/panel'

describe('buildHtml', () => {
  it('embeds the script + stylesheet uris and a strict CSP with the nonce', () => {
    const html = buildHtml('https://cdn/webview.js', 'https://cdn/webview.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC123')
    expect(html).toContain('https://cdn/webview.js')
    expect(html).toContain('https://cdn/webview.css')
    expect(html).toContain('rel="stylesheet"')
    expect(html).toContain('nonce="ABC123"')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('<div id="root">')
  })

  it('loads the script as a classic script, not an ES module (webview blocks cross-origin module fetch)', () => {
    const html = buildHtml('https://cdn/webview.js', 'https://cdn/webview.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC123')
    expect(html).not.toContain('type="module"')
  })

  it('links codicons and allows font-src', () => {
    const html = buildHtml('https://cdn/editor.js', 'https://cdn/editor.css', 'https://cdn/codicon.css', 'vscode-webview://x', 'ABC')
    expect(html).toContain('https://cdn/codicon.css')
    expect(html).toContain('font-src vscode-webview://x')
  })
})
