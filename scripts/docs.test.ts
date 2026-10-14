import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { USAGE } from "../apps/worker/src/cli";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(join(root, file), "utf8");
const DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/architecture.md",
  "docs/adding-a-skill.md",
  "docs/adding-a-provider.md",
  "docs/memory-model.md",
  "docs/self-hosting.md",
];

it.each(DOCS)("%s exists and its relative links resolve", (file) => {
  const text = read(file).replace(/<!--[\s\S]*?-->/g, "");
  for (const [, target] of text.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)/g)) {
    assert(target);
    expect(existsSync(join(root, dirname(file), target)), `${file} → ${target}`).toBe(true);
  }
});

it("documents the complete CLI usage and only commands that exist", () => {
  const guide = read("docs/self-hosting.md");
  expect(guide).toContain(USAGE);
  const commands = [
    ...guide.matchAll(/pathwise ((?:admin|seed|checkin) [a-z-]+|healthcheck)/g),
  ].map((match) => {
    assert(match[1]);
    return match[1];
  });
  expect(commands).toEqual(
    expect.arrayContaining(["admin reset-password", "admin rotate-encryption-key", "seed demo"]),
  );
  for (const command of commands) expect(USAGE).toContain(command);
});

it("credits the bundled O*NET version and truthfully describes the absent ESCO bundle", () => {
  const manifest = JSON.parse(read("data/taxonomy/manifest.json"));
  const notice = read("NOTICE");
  expect(notice).toContain(`O*NET ${manifest.sources.onet.version} Database`);
  expect(notice).toMatch(/O\*NET.*CC BY 4\.0/s);
  expect(notice).toContain("This service uses the ESCO classification of the European Commission.");
  if (manifest.sources.esco === null) {
    expect(notice).toContain("ESCO is not bundled");
    expect(notice).toContain("version is not available");
  }
});

it("backs up the database, files and secrets", () => {
  const guide = read("docs/self-hosting.md");
  for (const volume of ["pg_dump", "pathwise-files", "pathwise-secrets"]) {
    expect(guide).toContain(volume);
  }
});

it("ships the license and attribution in the runtime image", () => {
  expect(read("Dockerfile").split("AS runtime")[1]).toContain("COPY LICENSE NOTICE /app/");
});

import assert from "node:assert/strict";
