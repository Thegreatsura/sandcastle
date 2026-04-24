---
"@ai-hero/sandcastle": patch
---

Show context window size per iteration in the run summary. Each iteration with usage data emits a `Context window: NNNk` line (tokens rounded up to the nearest 1000) in both terminal and log-to-file mode.
