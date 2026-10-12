/** Minimal in-memory fixed-window limiter. `allow` returns false once `limit` hits are used up. */
export function createRateLimiter(opts: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = 0;
  return {
    allow(key: string, now = Date.now()): boolean {
      // Evict expired entries at most once per window so a flood of distinct keys stays O(1)/call.
      if (now - lastSweep >= opts.windowMs) {
        lastSweep = now;
        for (const [k, w] of windows) if (now - w.start >= opts.windowMs) windows.delete(k);
      }
      const w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (w.count >= opts.limit) return false;
      w.count += 1;
      return true;
    },
    /** Number of tracked keys (for tests). */
    size: () => windows.size,
  };
}
