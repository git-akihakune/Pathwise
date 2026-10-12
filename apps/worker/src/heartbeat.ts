import { statSync, writeFileSync } from "node:fs";

export const HEARTBEAT_PATH = "/tmp/pathwise-worker.heartbeat";

export function startHeartbeat(path: string, intervalMs = 15_000): () => void {
  const beat = () => writeFileSync(path, String(Date.now()));
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function isHeartbeatFresh(path: string, maxAgeMs = 60_000, now = Date.now()): boolean {
  try {
    return now - statSync(path).mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}
