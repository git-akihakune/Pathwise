import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { compareRuns } from "./compare";
import { parseEvalEnv } from "./env";
import { PERSONAS } from "./personas";
import { CRITERIA } from "./rubric";
import { SCENARIOS } from "./scenarios";
import { summarize } from "./summary";
import type { CriterionId, RunResult } from "./types";
export type EvalArgs =
  | { mode: "compare"; base: string; head: string }
  | { mode: "run"; persona?: string; scenario?: string; compare?: string };
export const USAGE =
  "Usage: pnpm evals [--persona <id>] [--scenario <id>] [--compare <base.json>] | pnpm evals compare <base.json> <head.json>";
export function parseArgs(args: string[]): EvalArgs | { error: string } {
  if (args[0] === "compare") {
    if (args.length !== 3 || args.slice(1).some((a) => !a.trim() || a.startsWith("--")))
      return { error: USAGE };
    return { mode: "compare", base: args[1] as string, head: args[2] as string };
  }
  const out: Extract<EvalArgs, { mode: "run" }> = { mode: "run" };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    if (!value?.trim() || value.startsWith("--")) return { error: USAGE };
    if (flag === "--persona" && !out.persona) {
      if (!PERSONAS.some((p) => p.id === value))
        return { error: `Unknown persona. Choose: ${PERSONAS.map((p) => p.id).join(", ")}` };
      out.persona = value;
    } else if (flag === "--scenario" && !out.scenario) {
      if (!SCENARIOS.some((s) => s.id === value))
        return { error: `Unknown scenario. Choose: ${SCENARIOS.map((s) => s.id).join(", ")}` };
      out.scenario = value;
    } else if (flag === "--compare" && !out.compare) out.compare = value;
    else return { error: USAGE };
  }
  return out;
}
// Scores may be a subset, including an empty set on failed cases.
const scores = z.object(
  Object.fromEntries(
    Object.keys(CRITERIA).map((id) => [
      id,
      z
        .object({ score: z.number().int().min(1).max(5), reason: z.string().min(1).max(400) })
        .optional(),
    ]),
  ),
);
const runSchema = z.object({
  startedAt: z.string(),
  models: z.object({ kind: z.string(), main: z.string(), fast: z.string(), judge: z.string() }),
  cases: z.array(
    z.object({
      persona: z.string(),
      scenario: z.string(),
      transcript: z.array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string(),
          toolCalls: z.array(z.string()).optional(),
        }),
      ),
      proposals: z.array(z.object({ kind: z.string(), payload: z.unknown() })),
      scores,
      error: z.string().optional(),
    }),
  ),
});
export async function readRun(path: string, cwd: string): Promise<RunResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(cwd, path), "utf8"));
  } catch {
    throw new Error(`Could not read run result: ${path}`);
  }
  const parsed = runSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid run result: ${path}`);
  const data = parsed.data as Omit<RunResult, "summary">;
  const keys = data.cases.map((c) => `${c.persona}/${c.scenario}`);
  if (new Set(keys).size !== keys.length)
    throw new Error(`Invalid run result (duplicate cases): ${path}`);
  return { ...data, summary: summarize(data.cases) };
}

function variants(secrets: (string | undefined)[]): string[] {
  return [...new Set(secrets.flatMap((s) => [s, s?.trim()]).filter((s): s is string => !!s))].sort(
    (a, b) => b.length - a.length,
  );
}
export function redactText(text: string, secrets: (string | undefined)[]): string {
  for (const secret of variants(secrets)) text = text.replaceAll(secret, "[redacted]");
  return text;
}
export function resultJson(value: unknown, secrets: (string | undefined)[]): string {
  let json = JSON.stringify(value, null, 2);
  for (const secret of variants(secrets))
    json = json.replaceAll(JSON.stringify(secret).slice(1, -1), "[redacted]");
  return json;
}
export function printRun(run: RunResult, output: (line: string) => void): void {
  const ids = Object.keys(CRITERIA) as CriterionId[];
  output(["scenario", ...ids, "errors"].join("\t"));
  for (const scenario of [...new Set(run.cases.map((c) => c.scenario))]) {
    const s = summarize(run.cases.filter((c) => c.scenario === scenario));
    output([scenario, ...ids.map((id) => s.byCriterion[id]?.mean ?? "—"), s.errors].join("\t"));
  }
  output(`Overall: ${run.summary.overall ?? "—"}; errors: ${run.summary.errors}`);
  for (const c of run.cases)
    if (c.error !== undefined) output(`ERROR ${c.persona}/${c.scenario}: ${c.error}`);
  for (const s of run.summary.lowScores)
    output(`LOW ${s.persona}/${s.scenario} ${s.criterion} ${s.score}: ${s.reason}`);
}
export async function main(args = process.argv.slice(2), env = process.env): Promise<number> {
  const secrets = [env.EVAL_API_KEY];
  const log = (line: string) => console.log(redactText(line, secrets));
  const error = (line: string) => console.error(redactText(line, secrets));
  const options = parseArgs(args);
  if ("error" in options) {
    error(options.error);
    return 2;
  }
  const cwd = env.INIT_CWD ?? process.cwd();
  let baseline: RunResult | undefined;
  try {
    if (options.mode === "compare") {
      const head = await readRun(options.head, cwd);
      const comparison = compareRuns(await readRun(options.base, cwd), head);
      if (head.summary.errors) printRun(head, log);
      log(resultJson(comparison, secrets));
      return head.summary.errors || comparison.regressions.length ? 1 : 0;
    }
    if (options.compare) baseline = await readRun(options.compare, cwd);
  } catch (e) {
    error(e instanceof Error ? e.message : "Could not read comparison runs");
    return 2;
  }
  const parsed = parseEvalEnv(env);
  if ("error" in parsed) {
    error(parsed.error);
    return 2;
  }
  try {
    const { runLiveEval } = await import("./live");
    const { run, cleanupFailed } = await runLiveEval(parsed, options, log);
    // Redact before writing or rendering any provider-influenced output.
    const safeRun = JSON.parse(resultJson(run, secrets)) as RunResult;
    const directory = new URL("../results/", import.meta.url);
    await mkdir(directory, { recursive: true });
    const destination = new URL(`${run.startedAt.replaceAll(":", "-")}.json`, directory);
    await writeFile(destination, resultJson(safeRun, secrets));
    log(`Results: ${fileURLToPath(destination)}`);
    printRun(safeRun, log);
    const comparison = baseline ? compareRuns(baseline, safeRun) : undefined;
    if (comparison) log(resultJson(comparison, secrets));
    return safeRun.summary.errors || cleanupFailed || comparison?.regressions.length ? 1 : 0;
  } catch (e) {
    error(`Eval failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main();
