export class PendingStates {
  private map = new Map<string, { cb: string; at: number }>();

  put(state: string, cb: string): void {
    this.map.set(state, { cb, at: Date.now() });
  }

  take(state: string): string | undefined {
    const entry = this.map.get(state);
    if (!entry) return undefined;
    this.map.delete(state);
    return entry.cb;
  }
}
