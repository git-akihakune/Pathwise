/** Minimal in-memory fixed-window limiter. `allow` returns false once `limit` hits are used up. */
export function createRateLimiter(opts: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string, now = Date.now()): boolean {
      for (const [k, w] of windows) if (now - w.start >= opts.windowMs) windows.delete(k);
      const w = windows.get(key);
      if (!w) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (w.count >= opts.limit) return false;
      w.count += 1;
      return true;
    },
  };
}
