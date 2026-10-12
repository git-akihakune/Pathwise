import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSnapshot } from "../../../packages/core/src/taxonomy/snapshot";
import { FIXTURE } from "./records";

await writeSnapshot(dirname(fileURLToPath(import.meta.url)), FIXTURE, {
  onet: null,
  esco: null,
  crosswalk: null,
});
