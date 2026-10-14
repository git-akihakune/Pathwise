import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parseArgs } from "./run";
import { summarize } from "./summary";

it("parses offline comparison and filters", () => {
  expect(parseArgs(["compare", "base.json", "head.json"])).toEqual({
    mode: "compare",
    base: "base.json",
    head: "head.json",
  });
  expect(
    parseArgs([
      "--persona",
      "new-grad",
      "--scenario",
      "fabrication-bait",
      "--compare",
      "base.json",
    ]),
  ).toEqual({
    mode: "run",
    persona: "new-grad",
    scenario: "fabrication-bait",
    compare: "base.json",
  });
});
it.each(
  [
    ["--persona"],
    ["--scenario", "unknown"],
    ["--persona", "unknown"],
    ["--wat"],
    ["compare", "a"],
    ["compare", "a", "b", "c"],
    ["--scenario", "first-direction", "--scenario", "ask-for-plan"],
    ["--compare", "--persona", "new-grad"],
  ].map((args) => ({ args })),
)("rejects malformed arguments $args", ({ args }) => {
  expect(parseArgs(args)).toEqual({ error: expect.any(String) });
});
it("compares offline from INIT_CWD without model env, and rejects malformed results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pathwise-evals-"));
  try {
    const run = {
      startedAt: "t",
      models: { kind: "openai", main: "m", fast: "f", judge: "j" },
      cases: [],
      summary: summarize([]),
    };
    await writeFile(join(dir, "base.json"), JSON.stringify(run));
    await writeFile(join(dir, "head.json"), JSON.stringify(run));
    const command = promisify(execFile);
    const options = {
      cwd: join(process.cwd(), "evals"),
      env: { PATH: process.env.PATH, INIT_CWD: dir, EVAL_PROVIDER_KIND: "invalid" },
    };
    const result = await command(
      process.execPath,
      ["--import", "tsx", "src/run.ts", "compare", "base.json", "head.json"],
      options,
    );
    expect(result.stdout).toContain('"regressions": []');
    expect(result.stderr).toBe("");
    const failed = {
      persona: "p",
      scenario: "s",
      transcript: [],
      proposals: [],
      scores: {},
      error: "provider timeout",
    };
    await writeFile(join(dir, "head.json"), JSON.stringify({ ...run, cases: [failed] }));
    await expect(
      command(
        process.execPath,
        ["--import", "tsx", "src/run.ts", "compare", "base.json", "head.json"],
        options,
      ),
    ).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("provider timeout") });
    await writeFile(join(dir, "head.json"), '{"cases":[]}');
    await expect(
      command(
        process.execPath,
        ["--import", "tsx", "src/run.ts", "compare", "base.json", "head.json"],
        options,
      ),
    ).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("Invalid run result") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
