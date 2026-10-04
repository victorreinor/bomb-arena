/**
 * Token bucket: allows `ratePerSecond` events on average with bursts up to `burst`.
 * Used by the server to shrug off clients that flood it with messages or connections.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private ratePerSecond: number,
    private burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Spend one token if available. `now` in milliseconds. */
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
