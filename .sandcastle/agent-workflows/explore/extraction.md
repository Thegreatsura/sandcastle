Emit a single `<output>` block as the last thing in your response.

Do not change files.
Do not run commands.
Do not spawn subagents.
Do not include text outside the `<output>` block.

```json
<output>
{
  "issues": [
    {
      "number": 101,
      "tag": "easy-call | needs-a-human | blocked",
      "duplicate_of": null,
      "comment": "The full markdown comment for a surviving issue, following the COMMENT guidance: verdict + one-liner, blast radius, one-way/two-way door, optional small diagram, findings, closed duplicates and what they added, open questions."
    },
    {
      "number": 117,
      "tag": "easy-call",
      "duplicate_of": 101,
      "comment": "Same missing guard in Z; the CLI path just reaches it first."
    }
  ],
  "patterns": "Optional markdown: cross-group patterns worth a maintainer's attention."
}
</output>
```

Rules the workflow enforces -- the whole plan is rejected if any fails:

- Every issue in the batch appears exactly once. `number` and `duplicate_of` are integers (or `duplicate_of` is `null`).
- `duplicate_of` names another issue in the batch which is not itself a duplicate.
- `tag` is one of `easy-call`, `needs-a-human`, `blocked`. `comment` is non-empty.
