export type DiffLine = { t: 'same' | 'add' | 'del'; text: string }

// Line diff via LCS (backtracking on the DP table). Bodies are small in
// practice; anything past the cell cap falls back to "everything changed" so a
// 10 MB body doesn't allocate a quadratic table.
const DIFF_MAX_CELLS = 4_000_000
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  if ((n + 1) * (m + 1) > DIFF_MAX_CELLS) {
    return [
      ...A.map((text): DiffLine => ({ t: 'del', text })),
      ...B.map((text): DiffLine => ({ t: 'add', text })),
    ]
  }
  const dp = new Int32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const at = i * (m + 1) + j
      if (A[i] === B[j]) dp[at] = dp[(i + 1) * (m + 1) + (j + 1)] + 1
      else dp[at] = Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: 'same', text: A[i] }); i++; j++ }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) { out.push({ t: 'del', text: A[i] }); i++ }
    else { out.push({ t: 'add', text: B[j] }); j++ }
  }
  while (i < n) { out.push({ t: 'del', text: A[i] }); i++ }
  while (j < m) { out.push({ t: 'add', text: B[j] }); j++ }
  return out
}