/**
 * Sync-out: extract committed changes from an isolated sandbox back to the host
 * via git format-patch and git am.
 *
 * 1. `git format-patch` inside the sandbox to generate patch files
 * 2. Filter out empty/header-only patches (e.g. from merge commits)
 * 3. `copyOut` each patch file to the host
 * 4. `git am --3way` on the host to apply them
 */

import { exec } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { IsolatedSandboxHandle } from "./SandboxProvider.js";

const execAsync = promisify(exec);

/** Execute a command on the host side, returning stdout. Throws on non-zero exit. */
const execHost = async (command: string, cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Host command failed: ${command}\n${message}`);
  }
};

/** Execute a command in the sandbox, throwing if it fails. */
const execOk = async (
  handle: IsolatedSandboxHandle,
  command: string,
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const result = await handle.exec(command, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `Sandbox command failed (exit ${result.exitCode}): ${command}\n${result.stderr}`,
    );
  }
  return result;
};

/**
 * Check if a patch file is empty or header-only.
 * Merge commits produce patches with headers but no diff content.
 * A patch is considered empty if it has no lines starting with "diff --git".
 */
const isEmptyPatch = async (patchPath: string): Promise<boolean> => {
  const info = await stat(patchPath);
  if (info.size === 0) return true;

  const content = await readFile(patchPath, "utf-8");
  return !content.includes("diff --git");
};

/**
 * Sync committed changes from an isolated sandbox back to the host repo.
 *
 * Compares the sandbox HEAD against the host HEAD to determine new commits,
 * generates patches via `git format-patch`, transfers them to the host via
 * `copyOut`, filters out empty patches, and applies them with `git am --3way`.
 *
 * No-op if the sandbox has no new commits.
 */
export const syncOut = async (
  hostRepoDir: string,
  handle: IsolatedSandboxHandle,
): Promise<void> => {
  const workspacePath = handle.workspacePath;

  // Get the host HEAD — this is the base commit that was synced in
  const hostHead = (await execHost("git rev-parse HEAD", hostRepoDir)).trim();

  // Get the sandbox HEAD
  const sandboxHead = (
    await execOk(handle, "git rev-parse HEAD", { cwd: workspacePath })
  ).stdout.trim();

  // No new commits — nothing to sync
  if (hostHead === sandboxHead) return;

  // Generate patches inside the sandbox
  const mkTempResult = await execOk(
    handle,
    "mktemp -d -t sandcastle-patches-XXXXXX",
  );
  const sandboxPatchDir = mkTempResult.stdout.trim();

  await execOk(
    handle,
    `git format-patch "${hostHead}..HEAD" -o "${sandboxPatchDir}"`,
    { cwd: workspacePath },
  );

  // List generated patch files (sorted by name — git format-patch numbers them)
  const lsResult = await execOk(handle, `ls -1 "${sandboxPatchDir}"`);
  const patchNames = lsResult.stdout
    .trim()
    .split("\n")
    .filter((name) => name.length > 0);

  if (patchNames.length === 0) return;

  // Copy patches to host and filter out empty ones
  const hostPatchDir = await mkdtemp(join(tmpdir(), "sandcastle-patches-"));
  try {
    const nonEmptyPatches: string[] = [];

    for (const patchName of patchNames) {
      const sandboxPatchPath = `${sandboxPatchDir}/${patchName}`;
      const hostPatchPath = join(hostPatchDir, patchName);

      await handle.copyOut(sandboxPatchPath, hostPatchPath);

      if (!(await isEmptyPatch(hostPatchPath))) {
        nonEmptyPatches.push(hostPatchPath);
      }
    }

    // Apply non-empty patches on host
    if (nonEmptyPatches.length > 0) {
      const patchArgs = nonEmptyPatches.map((p) => `"${p}"`).join(" ");
      await execHost(`git am --3way ${patchArgs}`, hostRepoDir);
    }
  } finally {
    // Clean up host-side patch temp dir
    await rm(hostPatchDir, { recursive: true, force: true });
    // Clean up sandbox-side patch temp dir
    await handle.exec(`rm -rf "${sandboxPatchDir}"`);
  }
};
