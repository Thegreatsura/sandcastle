---
"@ai-hero/sandcastle": patch
---

Fix Docker sandbox failing when run from a git worktree. When `.git` is a worktree file (not a directory), also mount the parent repository's `.git` directory so git can resolve the repository inside the container.
