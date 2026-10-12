import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isHeartbeatFresh, startHeartbeat } from "./heartbeat";

const path = join(mkdtempSync(join(tmpdir(), "hb-")), "hb");
it("is stale when missing", () => expect(isHeartbeatFresh(path)).toBe(false));
it("is fresh right after start and stale after 60s", () => {
  const stop = startHeartbeat(path, 15_000);
  expect(isHeartbeatFresh(path)).toBe(true);
  stop();
  const old = (Date.now() - 61_000) / 1000;
  utimesSync(path, old, old);
  expect(isHeartbeatFresh(path)).toBe(false);
});
