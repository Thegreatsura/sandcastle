import { exec } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { testIsolated } from "./sandboxes/test-isolated.js";
import { syncIn } from "./syncIn.js";
import { syncOut } from "./syncOut.js";

const execAsync = promisify(exec);

const initRepo = async (dir: string) => {
  await execAsync("git init -b main", { cwd: dir });
  await execAsync('git config user.email "test@test.com"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
};

const commitFile = async (
  dir: string,
  name: string,
  content: string,
  message: string,
) => {
  await writeFile(join(dir, name), content);
  await execAsync(`git add "${name}"`, { cwd: dir });
  await execAsync(`git commit -m "${message}"`, { cwd: dir });
};

const getLog = async (dir: string) => {
  const { stdout } = await execAsync("git log --oneline", { cwd: dir });
  return stdout.trim().split("\n");
};

describe("syncOut", () => {
  it("extracts a single commit from sandbox back to host", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "host-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "initial.txt", "initial", "initial commit");

    const provider = testIsolated();
    const handle = await provider.create({ env: {} });
    try {
      await syncIn(hostDir, handle);

      // Make a commit inside the sandbox
      const wp = handle.workspacePath;
      await handle.exec('echo "new file" > new.txt', { cwd: wp });
      await handle.exec("git add new.txt", { cwd: wp });
      await handle.exec('git commit -m "add new file"', { cwd: wp });

      await syncOut(hostDir, handle);

      // Verify the commit appears on host
      const log = await getLog(hostDir);
      expect(log).toHaveLength(2);
      expect(log[0]).toContain("add new file");

      // Verify file content
      const content = await readFile(join(hostDir, "new.txt"), "utf-8");
      expect(content.trim()).toBe("new file");
    } finally {
      await handle.close();
    }
  });

  it("extracts multiple commits preserving order", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "host-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "initial.txt", "initial", "initial commit");

    const provider = testIsolated();
    const handle = await provider.create({ env: {} });
    try {
      await syncIn(hostDir, handle);

      const wp = handle.workspacePath;
      await handle.exec('echo "a" > a.txt', { cwd: wp });
      await handle.exec("git add a.txt", { cwd: wp });
      await handle.exec('git commit -m "add a"', { cwd: wp });

      await handle.exec('echo "b" > b.txt', { cwd: wp });
      await handle.exec("git add b.txt", { cwd: wp });
      await handle.exec('git commit -m "add b"', { cwd: wp });

      await handle.exec('echo "c" > c.txt', { cwd: wp });
      await handle.exec("git add c.txt", { cwd: wp });
      await handle.exec('git commit -m "add c"', { cwd: wp });

      await syncOut(hostDir, handle);

      const log = await getLog(hostDir);
      expect(log).toHaveLength(4); // initial + 3 new
      expect(log[0]).toContain("add c");
      expect(log[1]).toContain("add b");
      expect(log[2]).toContain("add a");
    } finally {
      await handle.close();
    }
  });

  it("is a no-op when sandbox has no new commits", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "host-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "initial.txt", "initial", "initial commit");

    const { stdout: hostHeadBefore } = await execAsync("git rev-parse HEAD", {
      cwd: hostDir,
    });

    const provider = testIsolated();
    const handle = await provider.create({ env: {} });
    try {
      await syncIn(hostDir, handle);

      // No commits made — syncOut should be a no-op
      await syncOut(hostDir, handle);

      const { stdout: hostHeadAfter } = await execAsync("git rev-parse HEAD", {
        cwd: hostDir,
      });
      expect(hostHeadAfter.trim()).toBe(hostHeadBefore.trim());
    } finally {
      await handle.close();
    }
  });

  it("handles empty/header-only patches from merge commits gracefully", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "host-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "initial.txt", "initial", "initial commit");

    const provider = testIsolated();
    const handle = await provider.create({ env: {} });
    try {
      await syncIn(hostDir, handle);

      const wp = handle.workspacePath;

      // Create a branch, commit on it, switch back, commit on main, then merge
      await handle.exec("git checkout -b feature", { cwd: wp });
      await handle.exec('echo "feature" > feature.txt', { cwd: wp });
      await handle.exec("git add feature.txt", { cwd: wp });
      await handle.exec('git commit -m "feature commit"', { cwd: wp });

      await handle.exec("git checkout main", { cwd: wp });
      await handle.exec('echo "main-work" > main-work.txt', { cwd: wp });
      await handle.exec("git add main-work.txt", { cwd: wp });
      await handle.exec('git commit -m "main commit"', { cwd: wp });

      // Merge (creates a merge commit)
      await handle.exec("git merge feature --no-ff -m 'merge feature'", {
        cwd: wp,
      });

      // syncOut should handle the merge commit's empty patch
      await syncOut(hostDir, handle);

      // All files should be present on host
      const mainWork = await readFile(join(hostDir, "main-work.txt"), "utf-8");
      expect(mainWork.trim()).toBe("main-work");
      const feature = await readFile(join(hostDir, "feature.txt"), "utf-8");
      expect(feature.trim()).toBe("feature");
    } finally {
      await handle.close();
    }
  });

  it("preserves commit author and message metadata", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "host-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "initial.txt", "initial", "initial commit");

    const provider = testIsolated();
    const handle = await provider.create({ env: {} });
    try {
      await syncIn(hostDir, handle);

      const wp = handle.workspacePath;
      await handle.exec('git config user.email "agent@sandbox.com"', {
        cwd: wp,
      });
      await handle.exec('git config user.name "Agent"', { cwd: wp });
      await handle.exec('echo "authored" > authored.txt', { cwd: wp });
      await handle.exec("git add authored.txt", { cwd: wp });
      await handle.exec('git commit -m "commit from agent"', { cwd: wp });

      await syncOut(hostDir, handle);

      const { stdout: author } = await execAsync(
        'git log -1 --format="%an <%ae>"',
        { cwd: hostDir },
      );
      expect(author.trim()).toBe("Agent <agent@sandbox.com>");

      const { stdout: msg } = await execAsync('git log -1 --format="%s"', {
        cwd: hostDir,
      });
      expect(msg.trim()).toBe("commit from agent");
    } finally {
      await handle.close();
    }
  });
});
