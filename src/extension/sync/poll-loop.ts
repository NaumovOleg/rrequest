export type PollWorkspace = { id: string; revision: string }

export type PollStateStore = {
  get(id: string): Promise<{ lastRevision: string; synced: boolean } | undefined>
}

export function createPollLoop(deps: {
  listWorkspaces: () => Promise<PollWorkspace[]>
  state: PollStateStore
  pullIfNewer: (id: string, revision: string) => Promise<boolean>
  onPulled: () => Promise<void>
  // When absent, always polls. When present, a tick no-ops unless authed, so a
  // signed-out / still-loading session never fires an empty-Bearer request.
  isAuthed?: () => boolean
  intervalMs?: number
}): { start(): void; stop(): void } {
  const intervalMs = deps.intervalMs ?? 45000
  let timer: ReturnType<typeof setInterval> | undefined
  // Guards against overlapping ticks: if a poll is slow (or the interval is
  // set very low), the next scheduled tick is skipped rather than stacking.
  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    if (deps.isAuthed && !deps.isAuthed()) return
    running = true
    try {
      const workspaces = await deps.listWorkspaces()
      let pulledAny = false
      for (const w of workspaces) {
        const st = await deps.state.get(w.id)
        if (st?.synced && st.lastRevision !== w.revision) {
          if (await deps.pullIfNewer(w.id, w.revision)) pulledAny = true
        }
      }
      if (pulledAny) await deps.onPulled()
    } catch {
      // A failed poll (network blip, 401, etc.) must not kill the timer —
      // the next tick will simply try again.
    } finally {
      running = false
    }
  }

  return {
    start(): void {
      timer = setInterval(() => { void tick() }, intervalMs)
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
