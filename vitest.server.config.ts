import { defineConfig } from 'vitest/config'

// Server (AWS Lambda backend) unit tests. Node environment — no jsdom, no
// React, no `vscode` alias. Sources live in server/src; the tests were moved
// out to test/server so server/src stays pure source.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/server/**/*.test.ts'],
  },
})
