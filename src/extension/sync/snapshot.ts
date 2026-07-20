import type { Collection, Environment } from '../../shared/types'

export type WorkspaceSnapshot = {
  version: 1
  workspaceId: string
  name: string
  collections: Collection[]
  environments: Environment[]
  updatedAt: number
  updatedBy: string
}

export function buildSnapshot(input: {
  workspaceId: string
  name: string
  collections: Collection[]
  environments: Environment[]
  updatedBy: string
}): WorkspaceSnapshot {
  const environments = input.environments.map((e) => ({
    ...e,
    variables: e.variables.map((v) => (v.secret ? { ...v, value: '' } : { ...v })),
  }))
  return {
    version: 1,
    workspaceId: input.workspaceId,
    name: input.name,
    collections: JSON.parse(JSON.stringify(input.collections)) as Collection[],
    environments,
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  }
}

export function mergeEnvironmentsPreservingSecrets(incoming: Environment[], local: Environment[]): Environment[] {
  return incoming.map((env) => {
    const localEnv = local.find((l) => l.id === env.id)
    if (!localEnv) return env
    return {
      ...env,
      variables: env.variables.map((v) => {
        if (v.secret && !v.value) {
          const localVar = localEnv.variables.find((lv) => lv.key === v.key)
          if (localVar && localVar.value) return { ...v, value: localVar.value }
        }
        return v
      }),
    }
  })
}
