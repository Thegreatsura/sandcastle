---
"@ai-hero/sandcastle": patch
---

Add sandbox provider selection (Docker / Podman) to `sandcastle init`. Selecting Podman writes `Containerfile` instead of `Dockerfile` and uses Podman-specific build commands.
