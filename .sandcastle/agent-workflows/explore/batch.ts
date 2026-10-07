import type { StandardSchemaV1 } from "@standard-schema/spec";
import { asArray, asRecord, asString, standardSchema } from "../shared/common";

/**
 * Pure model of one batch explore run: the issues it covers, the agent's
 * output shapes, the whole-batch validation rules, and the effects a valid
 * plan turns into. No I/O — `explore.ts` and `apply.ts` own that.
 */

export const TAGS = ["easy-call", "needs-a-human", "blocked"] as const;
export type Tag = (typeof TAGS)[number];

export interface BatchIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly createdAt: string;
  readonly url: string;
  readonly comments: readonly {
    readonly author: string;
    readonly body: string;
  }[];
}

export interface PlanEntry {
  readonly number: number;
  readonly tag: Tag;
  readonly shape: string;
  readonly one_liner: string;
  readonly duplicate_of: number | null;
  readonly comment: string;
}

export interface Plan {
  readonly issues: readonly PlanEntry[];
  readonly patterns: string;
}

export type GitHubEffect =
  | {
      readonly kind: "comment";
      readonly issue: number;
      readonly body: string;
    }
  | {
      readonly kind: "swap-label";
      readonly issue: number;
      readonly to: "agent:implement" | "agent:blocked";
    }
  | {
      readonly kind: "close-duplicate";
      readonly issue: number;
      readonly duplicateOf: number;
    };

export const EXPLORE_LABEL = "agent:explore";

// ---------------------------------------------------------------------------
// Parsing primitives
// ---------------------------------------------------------------------------

const asIssueNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

const asTag = (value: unknown, label: string): Tag => {
  if (!TAGS.includes(value as Tag)) {
    throw new Error(`${label} must be one of ${TAGS.join(" | ")}`);
  }
  return value as Tag;
};

const asOneLine = (value: unknown, label: string): string => {
  const text = asString(value, label).trim();
  if (text.includes("\n")) {
    throw new Error(`${label} must be a single line`);
  }
  return text;
};

/** Throws unless `numbers` contains every batch issue exactly once and nothing else. */
const assertCoversBatch = (
  numbers: readonly number[],
  batch: ReadonlySet<number>,
  label: string,
): void => {
  const seen = new Set<number>();
  for (const number of numbers) {
    if (!batch.has(number)) {
      throw new Error(`${label}: #${number} is not in this batch`);
    }
    if (seen.has(number)) {
      throw new Error(`${label}: #${number} appears more than once`);
    }
    seen.add(number);
  }
  const missing = [...batch].filter((number) => !seen.has(number));
  if (missing.length > 0) {
    throw new Error(
      `${label}: missing ${missing.map((n) => `#${n}`).join(", ")}`,
    );
  }
};

// ---------------------------------------------------------------------------
// Batch input (written by the workflow from `gh issue list --json`)
// ---------------------------------------------------------------------------

/** Parse the raw `gh issue list --json` array into batch issues, oldest first. */
export const parseBatch = (raw: unknown): BatchIssue[] =>
  asArray(raw, "issues")
    .map((value): BatchIssue => {
      const record = asRecord(value, "issue");
      const author = asRecord(record.author ?? {}, "issue author");
      return {
        number: asIssueNumber(record.number, "issue number"),
        title: String(record.title ?? ""),
        body: String(record.body ?? ""),
        author: String(author.login ?? "unknown"),
        createdAt: String(record.createdAt ?? ""),
        url: String(record.url ?? ""),
        comments: asArray(record.comments ?? [], "issue comments").map(
          (comment) => {
            const c = asRecord(comment, "issue comment");
            const commentAuthor = asRecord(c.author ?? {}, "comment author");
            return {
              author: String(commentAuthor.login ?? "unknown"),
              body: String(c.body ?? ""),
            };
          },
        ),
      };
    })
    .sort((a, b) => a.number - b.number);

/** Render issues as delimited, clearly-untrusted text for an agent prompt. */
export const renderIssues = (issues: readonly BatchIssue[]): string =>
  issues
    .map((issue) =>
      [
        `<issue number="${issue.number}">`,
        `Title: ${issue.title}`,
        `Author: @${issue.author} · Opened: ${issue.createdAt}`,
        "",
        issue.body.trim() || "(no body)",
        ...issue.comments.flatMap((comment) => [
          "",
          `--- comment by @${comment.author} ---`,
          comment.body.trim(),
        ]),
        `</issue>`,
      ].join("\n"),
    )
    .join("\n\n");

// ---------------------------------------------------------------------------
// Agent output schemas
// ---------------------------------------------------------------------------

/**
 * The final plan, validated as a whole against the batch. This is both the
 * agent's output schema (so a bad plan earns one repair attempt) and the gate
 * `apply.ts` re-runs before touching GitHub.
 *
 * Rules: every batch issue exactly once; `duplicate_of` points at another
 * batch issue that is older (lower number) and is not itself a duplicate — so
 * every duplicate group collapses onto its oldest issue, with no chains.
 */
export const planSchema = (batch: readonly BatchIssue[]) => {
  const numbers = new Set(batch.map((issue) => issue.number));
  return standardSchema<Plan>((value) => {
    const record = asRecord(value, "plan");
    const issues = asArray(record.issues, "issues").map((e, i): PlanEntry => {
      const entry = asRecord(e, `issues[${i}]`);
      const duplicateOf = entry.duplicate_of ?? null;
      return {
        number: asIssueNumber(entry.number, `issues[${i}].number`),
        tag: asTag(entry.tag, `issues[${i}].tag`),
        shape: asOneLine(entry.shape, `issues[${i}].shape`),
        one_liner: asOneLine(entry.one_liner, `issues[${i}].one_liner`),
        duplicate_of:
          duplicateOf === null
            ? null
            : asIssueNumber(duplicateOf, `issues[${i}].duplicate_of`),
        comment: asString(entry.comment, `issues[${i}].comment`),
      };
    });

    assertCoversBatch(
      issues.map((entry) => entry.number),
      numbers,
      "issues",
    );

    const byNumber = new Map(issues.map((entry) => [entry.number, entry]));
    for (const entry of issues) {
      const target = entry.duplicate_of;
      if (target === null) continue;
      const label = `#${entry.number} duplicate_of #${target}`;
      if (target === entry.number) {
        throw new Error(`${label}: an issue cannot duplicate itself`);
      }
      const targetEntry = byNumber.get(target);
      if (!targetEntry) {
        throw new Error(`${label}: target is not in this batch`);
      }
      if (targetEntry.duplicate_of !== null) {
        throw new Error(
          `${label}: target is itself a duplicate of #${targetEntry.duplicate_of} — point straight at the oldest issue, no chains`,
        );
      }
      if (target > entry.number) {
        throw new Error(
          `${label}: target must be the oldest issue in its group, but #${target} is newer`,
        );
      }
    }

    return {
      issues,
      patterns: typeof record.patterns === "string" ? record.patterns : "",
    };
  });
};

/** Run a schema built by `standardSchema` synchronously, throwing on failure. */
export const validate = <T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): T => {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new Error("Schema validation must be synchronous");
  }
  if (result.issues) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const NEXT_STEP: Record<Tag, string> = {
  "easy-call": "Handing off to `agent:implement`.",
  "needs-a-human": "Labelled `agent:blocked` — needs a human decision.",
  blocked: "Labelled `agent:blocked` — blocked on something outside the repo.",
};

/** Render the comment posted on an issue that survives (is not a duplicate). */
export const renderSurvivorComment = (
  entry: PlanEntry,
  duplicates: readonly number[],
): string => {
  const lines = [
    `**Explore verdict:** \`${entry.tag}\` · **Shape:** ${entry.shape}`,
    "",
    `> ${entry.one_liner}`,
    "",
    entry.comment.trim(),
  ];
  if (duplicates.length > 0) {
    lines.push(
      "",
      `**Closed as duplicates of this issue:** ${duplicates.map((n) => `#${n}`).join(", ")}`,
    );
  }
  lines.push("", `_${NEXT_STEP[entry.tag]}_`);
  return lines.join("\n");
};

/** Render the comment posted on an issue being closed as a duplicate. */
export const renderDuplicateComment = (entry: PlanEntry): string =>
  `Closed as duplicate of #${entry.duplicate_of}.\n\n${entry.comment.trim()}`;

/**
 * Turn a validated plan into the ordered list of GitHub effects: survivors
 * first (comment + label swap), then duplicates (comment + close).
 */
export const planEffects = (plan: Plan): GitHubEffect[] => {
  const survivors = plan.issues
    .filter((entry) => entry.duplicate_of === null)
    .sort((a, b) => a.number - b.number);
  const duplicates = plan.issues
    .filter((entry) => entry.duplicate_of !== null)
    .sort((a, b) => a.number - b.number);

  const effects: GitHubEffect[] = [];
  for (const entry of survivors) {
    const dupes = duplicates
      .filter((dupe) => dupe.duplicate_of === entry.number)
      .map((dupe) => dupe.number);
    effects.push(
      {
        kind: "comment",
        issue: entry.number,
        body: renderSurvivorComment(entry, dupes),
      },
      {
        kind: "swap-label",
        issue: entry.number,
        to: entry.tag === "easy-call" ? "agent:implement" : "agent:blocked",
      },
    );
  }
  for (const entry of duplicates) {
    effects.push(
      {
        kind: "comment",
        issue: entry.number,
        body: renderDuplicateComment(entry),
      },
      {
        kind: "close-duplicate",
        issue: entry.number,
        duplicateOf: entry.duplicate_of!,
      },
    );
  }
  return effects;
};
