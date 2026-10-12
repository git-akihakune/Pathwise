import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const repoRoot = join(import.meta.dirname, "../..");

// Local development only: load the repo's dev.env. loadEnvFile does not override
// variables that are already set, so the absolute paths below win over dev.env's relative ones.
const devEnv = join(repoRoot, "dev.env");
if (process.env.NODE_ENV !== "production" && existsSync(devEnv)) {
  process.env.SECRETS_DIR ||= join(repoRoot, ".data/secrets");
  process.env.FILES_DIR ||= join(repoRoot, ".data/files");
  process.loadEnvFile(devEnv);
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@pathwise/core"],
  serverExternalPackages: ["pg", "pg-boss"],
  agentRules: false,
};

export default nextConfig;
