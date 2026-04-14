import { NodeFileSystem } from "@effect/platform-node";
import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import type { AgentProvider } from "./AgentProvider.js";
import type {
  SandboxProvider,
  BindMountSandboxHandle,
  IsolatedSandboxHandle,
} from "./SandboxProvider.js";
import { resolveGitMounts, SANDBOX_WORKSPACE_DIR } from "./SandboxFactory.js";
import { startSandbox } from "./startSandbox.js";
import * as WorktreeManager from "./WorktreeManager.js";

const execAsync = promisify(exec);

export interface InteractiveOptions {
  /** Agent provider to use (e.g. claudeCode("claude-opus-4-6")) */
  readonly agent: AgentProvider;
  /** Sandbox provider (e.g. docker()). */
  readonly sandbox: SandboxProvider;
  /** Inline prompt string. */
  readonly prompt: string;
  /** Optional name for the interactive session. */
  readonly name?: string;
}

export interface InteractiveResult {
  /** List of commits made during the interactive session. */
  readonly commits: { sha: string }[];
  /** The branch name the agent worked on. */
  readonly branch: string;
  /** Host path to the preserved worktree, if worktree had uncommitted changes. */
  readonly preservedWorktreePath?: string;
  /** Exit code of the interactive process. */
  readonly exitCode: number;
}

/**
 * Launch an interactive agent session inside a sandbox.
 *
 * The user sees the agent's TUI directly. When the session ends,
 * Sandcastle collects commits and handles branch merging, just like run().
 */
export const interactive = async (
  options: InteractiveOptions,
): Promise<InteractiveResult> => {
  const { agent: provider, sandbox: sandboxProvider, prompt, name } = options;

  if (sandboxProvider.tag !== "bind-mount") {
    throw new Error(
      "interactive() currently only supports bind-mount sandbox providers",
    );
  }

  const hostRepoDir = process.cwd();

  // Generate a branch for the interactive session
  const branch = WorktreeManager.generateTempBranchName(name);

  // 1. Create worktree
  const worktreeInfo = await Effect.runPromise(
    WorktreeManager.pruneStale(hostRepoDir).pipe(
      Effect.catchAll(() => Effect.void),
      Effect.andThen(WorktreeManager.create(hostRepoDir, { name })),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

  let handle: BindMountSandboxHandle | IsolatedSandboxHandle | undefined;
  let exitCode = 1;
  let preservedWorktreePath: string | undefined;

  try {
    // 2. Start sandbox
    const gitPath = join(hostRepoDir, ".git");
    const gitMounts = await Effect.runPromise(
      resolveGitMounts(gitPath).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    const startResult = await Effect.runPromise(
      startSandbox({
        provider: sandboxProvider,
        hostRepoDir,
        env: {},
        worktreeOrRepoPath: worktreeInfo.path,
        gitMounts,
        workspaceDir: SANDBOX_WORKSPACE_DIR,
      }),
    );
    handle = startResult.handle;

    // 3. Setup sandbox (safe.directory, git config)
    await handle.exec(
      `git config --global --add safe.directory "${startResult.workspacePath}"`,
    );

    // Read host git identity
    const [hostGitName, hostGitEmail] = await Promise.all([
      execAsync("git config user.name", { cwd: hostRepoDir })
        .then((r) => r.stdout.trim())
        .catch(() => ""),
      execAsync("git config user.email", { cwd: hostRepoDir })
        .then((r) => r.stdout.trim())
        .catch(() => ""),
    ]);
    if (hostGitName) {
      await handle.exec(
        `git config --global user.name "${hostGitName.replace(/"/g, '\\"')}"`,
      );
    }
    if (hostGitEmail) {
      await handle.exec(
        `git config --global user.email "${hostGitEmail.replace(/"/g, '\\"')}"`,
      );
    }

    // 4. Record base HEAD
    const { stdout: baseHeadOut } = await execAsync("git rev-parse HEAD", {
      cwd: worktreeInfo.path,
    });
    const baseHead = baseHeadOut.trim();

    // 5. Check interactiveExec is available
    if (!handle.interactiveExec) {
      throw new Error(
        `Sandbox provider does not support interactiveExec. ` +
          `The provider must implement the optional interactiveExec method to use interactive().`,
      );
    }

    // 6. Run interactive session
    const interactiveArgs = provider.buildInteractiveArgs(prompt);
    const result = await handle.interactiveExec(interactiveArgs, {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      cwd: startResult.workspacePath,
    });
    exitCode = result.exitCode;

    // 7. Collect commits
    let commits: { sha: string }[] = [];
    try {
      const { stdout: revListOut } = await execAsync(
        `git rev-list "${baseHead}..refs/heads/${worktreeInfo.branch}" --reverse`,
        { cwd: hostRepoDir },
      );
      const lines = revListOut.trim();
      if (lines) {
        commits = lines.split("\n").map((sha) => ({ sha }));
      }
    } catch {
      // No commits made — that's fine
    }

    // 8. Check for uncommitted changes
    const hasUncommitted = await Effect.runPromise(
      WorktreeManager.hasUncommittedChanges(worktreeInfo.path).pipe(
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    );
    if (hasUncommitted) {
      preservedWorktreePath = worktreeInfo.path;
    }

    return {
      commits,
      branch: worktreeInfo.branch,
      preservedWorktreePath,
      exitCode,
    };
  } finally {
    // Clean up: close handle
    if (handle) {
      await handle.close().catch(() => {});
    }

    // Remove worktree if not preserved
    if (!preservedWorktreePath) {
      await Effect.runPromise(
        WorktreeManager.remove(worktreeInfo.path).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    }
  }
};
