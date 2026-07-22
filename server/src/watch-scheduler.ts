import type { WatchService } from "./watch-service.js";

export class WatchScheduler {
  private pollTimer?: ReturnType<typeof setInterval>;
  private renewTimer?: ReturnType<typeof setInterval>;
  constructor(private opts: { service: WatchService; pollIntervalMs: number; renewIntervalMs?: number; renewWithinMs?: number }) {}

  start(): void {
    const renewInterval = this.opts.renewIntervalMs ?? 3600_000;
    const renewWithin = this.opts.renewWithinMs ?? 86_400_000;
    this.pollTimer = setInterval(() => { void this.opts.service.pollAll().catch(() => {}); }, this.opts.pollIntervalMs);
    this.renewTimer = setInterval(() => { void this.opts.service.renewExpiring(renewWithin).catch(() => {}); }, renewInterval);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.pollTimer = undefined;
    this.renewTimer = undefined;
  }
}
