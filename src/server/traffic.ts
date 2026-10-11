/** Bounded shared token buckets. Tabs and HTTP retries share the same allowance. */
export class TrafficBudget {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private cleanedAt = 0;
  constructor(
    private burst: number,
    private perSecond: number,
    private maxKeys = 8192,
  ) {}
  allow(key: string, now = Date.now()) {
    if (now - this.cleanedAt > 60_000 || this.buckets.size >= this.maxKeys) {
      for (const [id, bucket] of this.buckets) if (now - bucket.at > 300_000) this.buckets.delete(id);
      this.cleanedAt = now;
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) return false;
      bucket = { tokens: this.burst, at: now };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + (Math.max(0, now - bucket.at) * this.perSecond) / 1000,
    );
    bucket.at = Math.max(now, bucket.at);
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  }
}
