import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host, not
      // under Vitest/Node. Stub it so files that `import * as vscode from
      // 'vscode'` (e.g. panel.ts) can still be loaded to test their pure
      // functions (e.g. buildHtml).
      vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
