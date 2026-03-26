---
"@ai-hero/sandcastle": patch
---

Remove stale `patches/` entry from scaffolded `.sandcastle/.gitignore`. Nothing in Sandcastle creates a `.sandcastle/patches/` directory — the worktree-based architecture eliminated patch-based sync.
