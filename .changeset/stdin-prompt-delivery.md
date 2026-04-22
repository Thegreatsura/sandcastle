---
"@ai-hero/sandcastle": patch
---

Deliver prompts via stdin instead of argv to avoid Linux E2BIG when prompts exceed 128 KB

`AgentProvider.buildPrintCommand()` now returns `{ command, stdin? }` instead of a bare string. When `stdin` is set, the sandbox pipes the prompt to the child process's stdin rather than inlining it in the command-line arguments. This removes the 128 KB per-arg ceiling imposed by `execve(2)` on Linux.

- `claudeCode()`, `pi()`, and `codex()` providers set `stdin` to the prompt and omit it from argv
- `opencode()` provider keeps the prompt in argv (`stdin` undefined) — accepted limitation
- Docker, Podman, and no-sandbox `exec()` implementations accept `stdin?: string` and pipe it when set
- Orchestrator destructures `buildPrintCommand()` and forwards `stdin` to `sandbox.exec()`
