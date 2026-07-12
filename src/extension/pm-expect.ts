function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual(a[k], b[k]))
}

function fail(msg: string): never { throw new Error(msg) }

function makeChain(actual: any, negate: boolean) {
  const check = (ok: boolean, msg: string) => {
    if (negate ? ok : !ok) fail(negate ? `expected NOT: ${msg}` : msg)
  }
  const be: any = {
    a: (t: string) => check(typeof actual === t, `expected ${JSON.stringify(actual)} to be a ${t}`),
    an: (t: string) => check(typeof actual === t, `expected ${JSON.stringify(actual)} to be an ${t}`),
    above: (n: number) => check(actual > n, `expected ${actual} to be above ${n}`),
    below: (n: number) => check(actual < n, `expected ${actual} to be below ${n}`),
    get ok() { check(!!actual, `expected ${JSON.stringify(actual)} to be ok`); return undefined },
    get true() { check(actual === true, `expected ${JSON.stringify(actual)} to be true`); return undefined },
    get false() { check(actual === false, `expected ${JSON.stringify(actual)} to be false`); return undefined },
  }
  return {
    equal: (v: any) => check(actual === v, `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(v)}`),
    eql: (v: any) => check(deepEqual(actual, v), `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(v)}`),
    include: (v: any) => check(
      typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.includes(v) : false,
      `expected ${JSON.stringify(actual)} to include ${JSON.stringify(v)}`),
    be,
  }
}

export function expect(actual: any) {
  return { to: { ...makeChain(actual, false), not: makeChain(actual, true) } }
}
