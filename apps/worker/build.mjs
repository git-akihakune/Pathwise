import { cp, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: {
    main: "src/main.ts",
    // Worker-thread entry used by the document reader (resolved beside main.js).
    "read-worker": "../../packages/core/src/services/documents/read-worker.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as __pathwiseCreateRequire } from "module"; const require = __pathwiseCreateRequire(import.meta.url);',
  },
  external: ["pg-native"],
});
await cp("../../packages/core/drizzle", "dist/drizzle", { recursive: true });
