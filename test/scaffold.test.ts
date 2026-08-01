import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'

describe('scaffold', () => {
  it('has a package.json declaring the rrequest.open command', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const cmds = pkg.contributes?.commands ?? []
    expect(cmds.some((c: any) => c.command === 'rrequest.open')).toBe(true)
    expect(pkg.engines?.vscode).toBeTruthy()
  })
})
