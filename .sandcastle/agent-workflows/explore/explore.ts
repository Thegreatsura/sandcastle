import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { claudeAgent, fail, required, writeJson } from "../shared/common";
import { runWithExtraction } from "../shared/run-with-extraction";
import {
  groupReportSchema,
  groupingSchema,
  parseBatch,
  planSchema,
  renderIssues,
  type Group,
  type GroupReport,
} from "./batch";

/**
 * Batch explore: group every open `agent:explore` issue by likely shared root
 * cause, explore each group in parallel, then reconcile into one validated
 * plan. Read-only — writes `plan.json` to OUTPUT_DIR; `apply.ts` (in a
 * separate job) is the only thing that touches GitHub.
 */

const ISSUES_FILE = required("ISSUES_FILE");

/** Explorer runs in flight at once. Not a batch cap — every group still runs. */
const EXPLORER_CONCURRENCY = 4;

/** One repair attempt on invalid structured output. */
const MAX_RETRIES = 1;

const promptPath = (file: string) => path.join(import.meta.dirname, file);
const readPrompt = (file: string) => fs.readFileSync(promptPath(file), "utf8");

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

try {
  const batch = parseBatch(JSON.parse(fs.readFileSync(ISSUES_FILE, "utf8")));
  if (batch.length === 0) {
    fail("No open agent:explore issues in the batch file.");
  }
  const byNumber = new Map(batch.map((issue) => [issue.number, issue]));
  const allIssues = renderIssues(batch);

  console.log(
    `Batch: ${batch.length} issue(s): ${batch.map((i) => `#${i.number}`).join(", ")}`,
  );

  // 1. Orchestrator reads every issue and groups aggressively.
  const grouping = await runWithExtraction({
    name: "explore-batch (group)",
    agent: claudeAgent(),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: promptPath("group.md"),
    promptArgs: {
      ISSUE_COUNT: String(batch.length),
      ISSUES: allIssues,
    },
    output: sandcastle.Output.object({
      tag: "output",
      schema: groupingSchema(batch),
    }),
    extractionPrompt: readPrompt("group-extraction.md"),
    maxRetries: MAX_RETRIES,
  });
  const groups = grouping.output.groups;
  writeJson("groups.json", groups);
  console.log(
    `Groups: ${groups.map((g) => `[${g.issues.map((n) => `#${n}`).join(" ")}]`).join(" ")}`,
  );

  // 2. One explorer per group, confirming membership per issue.
  const reports = await mapWithConcurrency(
    groups,
    EXPLORER_CONCURRENCY,
    async (group: Group, index: number): Promise<GroupReport> => {
      const numbers = group.issues.map((n) => `#${n}`).join(", ");
      const result = await runWithExtraction({
        name: `explore-batch (group ${index + 1}: ${numbers})`,
        agent: claudeAgent(),
        sandbox: noSandbox(),
        logging: { type: "stdout" },
        promptFile: promptPath("prompt.md"),
        promptArgs: {
          GROUP_ISSUE_NUMBERS: numbers,
          GROUP_HYPOTHESIS: group.hypothesis,
          GROUP_ISSUES: renderIssues(group.issues.map((n) => byNumber.get(n)!)),
        },
        output: sandcastle.Output.object({
          tag: "output",
          schema: groupReportSchema(group),
        }),
        extractionPrompt: readPrompt("extraction.md"),
        maxRetries: MAX_RETRIES,
      });
      return result.output;
    },
  );
  writeJson(
    "group-reports.json",
    groups.map((group, i) => ({ ...group, ...reports[i] })),
  );

  // 3. Orchestrator splits misgrouped issues, closes duplicates onto the
  // oldest, and notes cross-group patterns. The schema enforces the
  // whole-batch rules, so an invalid plan earns one repair attempt.
  const plan = await runWithExtraction({
    name: "explore-batch (reconcile)",
    agent: claudeAgent(),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: promptPath("reconcile.md"),
    promptArgs: {
      ISSUE_COUNT: String(batch.length),
      ISSUES: allIssues,
      GROUP_REPORTS: JSON.stringify(
        groups.map((group, i) => ({
          issues: group.issues,
          hypothesis: group.hypothesis,
          findings: reports[i]!.findings,
          notes: reports[i]!.notes,
        })),
        null,
        2,
      ),
    },
    output: sandcastle.Output.object({
      tag: "output",
      schema: planSchema(batch),
    }),
    extractionPrompt: readPrompt("reconcile-extraction.md"),
    maxRetries: MAX_RETRIES,
  });

  writeJson("plan.json", plan.output);
  console.log(`Plan written for ${plan.output.issues.length} issue(s).`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
