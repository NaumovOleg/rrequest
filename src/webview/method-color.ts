import type { HttpMethod } from '../shared/types'

const COLORED: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'QUERY', 'DELETE']

export function methodClass(method: string): string {
  return (COLORED as string[]).includes(method) ? `rm-method--${method}` : 'rm-method--OTHER'
}
