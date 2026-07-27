export type ToastLevel = 'error' | 'info'
export type ToastEmit = (level: ToastLevel, message: string) => void

/**
 * Wraps a toast emitter so repeat calls with the SAME message within
 * `intervalMs` are dropped. Keyed by message (not global): a different
 * message emits immediately and starts its own window, so an unrelated
 * toast is never suppressed by an in-flight one. `now` is injectable for
 * tests; defaults to Date.now.
 */
export function makeToastThrottle(emit: ToastEmit, intervalMs: number, now: () => number = Date.now): ToastEmit {
  const lastEmittedAt = new Map<string, number>()
  return (level, message) => {
    const t = now()
    const last = lastEmittedAt.get(message)
    if (last !== undefined && t - last < intervalMs) return
    lastEmittedAt.set(message, t)
    emit(level, message)
  }
}
