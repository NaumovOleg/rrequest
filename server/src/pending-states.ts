export class PendingStates {
  private map = new Map<string, { cb: string; at: number }>();
  constructor(private ttlMs: number = 5 * 60_000) {}

  put(state: string, cb: string): void {
    this.sweep();
    this.map.set(state, { cb, at: Date.now() });
  }

  take(state: string): string | undefined {
    const entry = this.map.get(state);
    if (!entry) return undefined;
    this.map.delete(state);
    if (Date.now() - entry.at > this.ttlMs) return undefined;
    return entry.cb;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (now - v.at > this.ttlMs) this.map.delete(k);
  }
}
