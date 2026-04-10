---
"@ai-hero/sandcastle": patch
---

**BREAKING:** Make `sandbox` a required option on `run()` and `createSandbox()`. Remove `imageName` from top-level `RunOptions` and `CreateSandboxOptions` — image configuration now lives inside the sandbox provider (e.g. `docker({ imageName })`). The `docker()` factory is exported exclusively from `@ai-hero/sandcastle/sandboxes/docker`. Add pluggable sandbox provider abstraction with bind-mount and isolated provider types, `createBindMountSandboxProvider` and `createIsolatedSandboxProvider` factories, filesystem-based test isolated provider, git bundle sync-in for isolated providers, and git format-patch/am sync-out to extract committed changes back to the host. Namespace Docker CLI commands under `sandcastle docker` — `sandcastle build-image` and `sandcastle remove-image` are now `sandcastle docker build-image` and `sandcastle docker remove-image`.
