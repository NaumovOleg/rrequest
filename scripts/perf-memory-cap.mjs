#!/usr/bin/env node
/**
 * Quick memory profile: pushes 10k entries into capped structures and
 * measures heap growth vs a naive unbounded baseline.
 *
 * Run:  node scripts/perf-memory-cap.mjs
 */
import { performance } from 'node:perf_hooks'

function pushCapped(arr, entry, max) {
  const next = arr.length >= max ? arr.slice(arr.length - max + 1) : arr.slice()
  next.push(entry)
  return next
}

function memMB() { return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) }

const N = 10_000
const entry = { dir: 'in', data: 'x'.repeat(200), at: Date.now() }

// --- unbounded (the old leak) ---
const before = performance.now()
let arr = []
const h0 = +memMB()
for (let i = 0; i < N; i++) arr.push(entry)
const h1 = +memMB()
console.log(`unbounded  push ${N}: ${h1 - h0} MB  (${arr.length} entries)`)

// --- capped (the fix) ---
arr = []
const h2 = +memMB()
for (let i = 0; i < N; i++) arr = pushCapped(arr, entry, 500)
const h3 = +memMB()
console.log(`capped 500 push ${N}: ${h3 - h2} MB  (${arr.length} entries)`)
console.log(`heap saved:  ${(h1 - h0) - (h3 - h2)} MB  (${(((h1-h0)-(h3-h2))/(h1-h0)*100).toFixed(0)}%)`)
