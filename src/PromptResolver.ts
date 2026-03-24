import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PromptError } from "./errors.js";

export interface ResolvePromptOptions {
  readonly prompt?: string;
  readonly promptFile?: string;
  readonly cwd?: string;
}

export const resolvePrompt = (
  options: ResolvePromptOptions,
): Effect.Effect<string, PromptError> => {
  const { prompt, promptFile, cwd = process.cwd() } = options;

  if (prompt !== undefined && promptFile !== undefined) {
    return Effect.fail(
      new PromptError({
        message: "Cannot provide both --prompt and --prompt-file",
      }),
    );
  }

  if (prompt !== undefined) {
    return Effect.succeed(prompt);
  }

  const path = promptFile ?? join(cwd, ".sandcastle", "prompt.md");

  return Effect.tryPromise({
    try: () => readFile(path, "utf-8"),
    catch: (e) =>
      new PromptError({
        message: `Failed to read prompt from ${path}: ${e}`,
      }),
  });
};
