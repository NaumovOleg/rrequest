import { methodClass } from '../../method-color'

export function MethodBadge({ method }: { method: string }) {
  return <span className={`rm-method ${methodClass(method)}`}>{method}</span>
}
