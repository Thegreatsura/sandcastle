---
"@ai-hero/sandcastle": patch
---

Fall back to resultText then tail of stdout when stderr is empty on non-zero agent exit, so providers like OpenCode surface error details in `AgentError`
