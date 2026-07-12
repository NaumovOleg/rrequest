import * as vm from 'node:vm'
import { expect } from './pm-expect'
import type { HttpResponse, KeyValue, RestRequest, TestResult } from '../shared/types'

const TIMEOUT = 5000

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

export function runPreScript(script: string, ctx: { request: RestRequest; vars: KeyValue[] }): { request: RestRequest; envSets: KeyValue[]; logs: string[]; error?: string } {
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
  const sandbox: any = { pm: { request: pmRequest, environment: env, variables: { get: (k: string) => map.get(k) } }, console: makeConsole(logs) }
  try {
    vm.runInNewContext(script, sandbox, { timeout: TIMEOUT })
  } catch (e: any) {
    return { request, envSets, logs, error: String(e?.message ?? e) }
  }
  return { request, envSets, logs }
}

export function runTestScript(script: string, ctx: { response: HttpResponse; vars: KeyValue[] }): { tests: TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string } {
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
    json: () => JSON.parse(r.body),
  }
  const pmTest = (name: string, fn: () => void) => {
    try { fn(); tests.push({ name, passed: true }) }
    catch (e: any) { tests.push({ name, passed: false, error: String(e?.message ?? e) }) }
  }
  const sandbox: any = {
    pm: { response: pmResponse, test: pmTest, expect, environment: makeEnv(map, envSets), variables: { get: (k: string) => map.get(k) } },
    console: makeConsole(logs),
  }
  try {
    vm.runInNewContext(script, sandbox, { timeout: TIMEOUT })
  } catch (e: any) {
    return { tests, envSets, logs, error: String(e?.message ?? e) }
  }
  return { tests, envSets, logs }
}
