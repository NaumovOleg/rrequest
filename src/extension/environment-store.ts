import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Environment } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class EnvironmentStore {
  private readonly dir: string
  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'environments')
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<Environment[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const out: Environment[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const e = await readJsonSafe<Environment>(path.join(this.dir, n))
      if (e && e.id && Array.isArray(e.variables)) out.push(e)
    }
    return out
  }

  async createEnvironment(name: string): Promise<Environment> {
    const e: Environment = { id: newId(), name, variables: [] }
    await writeJsonAtomic(this.file(e.id), e)
    return e
  }

  async saveEnvironment(env: Environment): Promise<Environment> {
    await writeJsonAtomic(this.file(env.id), env)
    return env
  }

  async deleteEnvironment(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
}
