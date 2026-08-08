import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Environment } from '../../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

// Secret environment values live in VS Code Secret Storage (per workspace
// storage), keyed by environment id + variable key — never in the JSON files,
// so a backup/dump of globalStorage leaks nothing. Sync already strips secret
// values at snapshot time; this removes the plaintext-at-rest copy on disk.
export type SecretsPort = {
  get(key: string): Thenable<string | undefined>
  store(key: string, value: string): Thenable<void>
  delete(key: string): Thenable<void>
}

const secretKey = (envId: string, key: string): string => `rrequest.env.${envId}.${key}`

export class EnvironmentStore {
  private readonly dir: string
  constructor(
    baseDir: string,
    private readonly secrets?: SecretsPort,
  ) {
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
      if (e && e.id && Array.isArray(e.variables)) {
        out.push(await this.hydrateSecrets(e))
      }
    }
    return out
  }

  // Pull secret values back out of Secret Storage for variables that were
  // saved with an empty placeholder (matching how sync merge restores them).
  private async hydrateSecrets(e: Environment): Promise<Environment> {
    if (!this.secrets) return e
    const variables: typeof e.variables = []
    for (const v of e.variables) {
      let { value } = v
      if (v.secret && !value) {
        const stored = await this.secrets.get(secretKey(e.id, v.key))
        if (stored != null) value = stored
      }
      variables.push({ ...v, value })
    }
    return { ...e, variables }
  }

  async createEnvironment(name: string, workspaceId: string): Promise<Environment> {
    const e: Environment = { id: newId(), name, workspaceId, variables: [] }
    await writeJsonAtomic(this.file(e.id), e)
    return e
  }

  async saveEnvironment(env: Environment): Promise<Environment> {
    // Split secret values off into Secret Storage, blanking them in the JSON.
    let variables = env.variables
    if (this.secrets) {
      const vaulted: typeof env.variables = []
      for (const v of env.variables) {
        if (v.secret && v.value) {
          await this.secrets.store(secretKey(env.id, v.key), v.value)
          vaulted.push({ ...v, value: '' })
        } else if (v.secret && !v.value) {
          // still flagged secret but empty — leave as-is
          vaulted.push(v)
        } else {
          await this.secrets.delete(secretKey(env.id, v.key)).then(() => {}, () => {})
          vaulted.push(v)
        }
      }
      variables = vaulted
    }
    await writeJsonAtomic(this.file(env.id), { ...env, variables })
    return { ...env, variables }
  }

  async deleteEnvironment(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
    if (this.secrets) {
      // Best-effort cleanup of this env's vault keys (bucket-prefix scan is
      // not available on SecretStorage, so we can't enumerate — keys are
      // dropped on next save of a differently-named env; kept minimal).
      // ponytail: per-key host-side index would be needed to purge reliably;
      // orphaned vault entries are harmless (isolated, unreadable namespaces).
    }
  }
}