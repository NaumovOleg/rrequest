import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function EnvDropdown() {
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)

  return (
    <select
      className="rm-select"
      aria-label="active environment"
      value={activeEnvId ?? ''}
      onChange={(e) => postToHost({ type: 'setActiveEnv', id: e.target.value === '' ? null : e.target.value })}
    >
      <option value="">No Environment</option>
      {environments.map((env) => (
        <option key={env.id} value={env.id}>{env.name}</option>
      ))}
    </select>
  )
}
