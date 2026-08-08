import * as vm from 'node:vm'
import { expect } from './pm-expect'
import type { HttpResponse, KeyValue, RestRequest, TestResult } from '../../shared/types'

const TIMEOUT = 5000

// The raw, unformatted error as the script saw it (message + full stack), so
// the user can see exactly what threw and where.
function errText(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`
  return String(e)
}

// Scripts can run async (e.g. `await fetch(...)` to obtain a token before the
// request fires). The script is wrapped in an async IIFE; `vm`'s timeout only
// guards synchronous execution, so an overall async deadline is enforced here.
async function runScript(script: string, sandbox: Record<string, unknown>): Promise<void> {
  const promise = vm.runInNewContext(`(async () => {\n${script}\n})()`, sandbox, { timeout: TIMEOUT }) as Promise<unknown>
  await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('script timed out')), TIMEOUT)),
  ])
}

function varsMap(vars: KeyValue[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const v of vars) if (v.enabled && v.key) m.set(v.key, v.value)
  return m
}

function makeConsole(logs: string[]) {
  return { log: (...args: any[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) }
}

function makeEnv(map: Map<string, string>, envSets: KeyValue[]) {
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: any) => { const val = String(v); map.set(k, val); envSets.push({ key: k, value: val, enabled: true }) },
  }
}

export async function runPreScript(
  script: string,
  ctx: { request: RestRequest; vars: KeyValue[] },
  deps: { fetch?: typeof fetch } = {},
): Promise<{ request: RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }> {
  const request: RestRequest = JSON.parse(JSON.stringify(ctx.request))
  const envSets: KeyValue[] = []
  const logs: string[] = []
  if (!script.trim()) return { request, envSets, logs }
  const map = varsMap(ctx.vars)
  const env = makeEnv(map, envSets)
  const pmRequest = {
    get method() { return request.method }, set method(v: any) { request.method = v },
    get url() { return request.url }, set url(v: any) { request.url = v },
    get body() { return request.body }, set body(v: any) { request.body = v },
    headers: {
      add: (h: { key: string; value: string }) => { request.headers.push({ key: h.key, value: h.value, enabled: true }) },
      get: (k: string) => request.headers.find((h) => h.key === k)?.value,
    },
    params: request.params,
  }
  const doFetch = deps.fetch ?? globalThis.fetch
  const sandbox: any = { pm: { request: pmRequest, environment: env, variables: { get: (k: string) => map.get(k) } }, console: makeConsole(logs), fetch: (input: any, init?: any) => doFetch(input, init) }
  try {
    await runScript(script, sandbox)
  } catch (e: any) {
    return { request, envSets, logs, error: errText(e) }
  }
  return { request, envSets, logs }
}

export async function runTestScript(script: string, ctx: { response: HttpResponse; vars: KeyValue[] }, deps: { fetch?: typeof fetch } = {}): Promise<{ tests: TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }> {
  const tests: TestResult[] = []
  const envSets: KeyValue[] = []
  const logs: string[] = []
  if (!script.trim()) return { tests, envSets, logs }
  const map = varsMap(ctx.vars)
  const r = ctx.response
  const pmResponse = {
    code: r.status, status: r.statusText, responseTime: r.timeMs,
    headers: r.headers,
    text: () => r.body,
    json: () => { try { return JSON.parse(r.body) } catch (e: any) { throw new Error(`response body is not JSON: ${e?.message ?? e}`) } },
  }
  const pmTest = (name: string, fn: () => void) => {
    try { fn(); tests.push({ name, passed: true }) }
    catch (e: any) { tests.push({ name, passed: false, error: errText(e) }) }
  }
  const doFetch = deps.fetch ?? globalThis.fetch
  const sandbox: any = {
    pm: { response: pmResponse, test: pmTest, expect, environment: makeEnv(map, envSets), variables: { get: (k: string) => map.get(k) } },
    console: makeConsole(logs),
    fetch: (input: any, init?: any) => doFetch(input, init),
  }
  try {
    await runScript(script, sandbox)
  } catch (e: any) {
    return { tests, envSets, logs, error: String(e?.message ?? e) }
  }
  return { tests, envSets, logs }
}