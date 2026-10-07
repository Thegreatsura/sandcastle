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
      "shape": "A few words on the shape of the change, e.g. 'bug: one-line guard' or 'feature: new run() option'.",
      "one_liner": "One sentence summarising the issue and its verdict.",
      "duplicate_of": null,
      "comment": "The full markdown comment for a surviving issue. Cover the topics you explored (difficulty, relevant files, claims, open questions, possible approach), including only those you have something useful to say about."
    },
    {
      "number": 117,
      "tag": "easy-call",
      "shape": "bug: one-line guard",
      "one_liner": "Same crash as #101, reported from the CLI.",
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
- `duplicate_of` names another issue in the batch, older (lower number) than the duplicate, which is not itself a duplicate.
- `tag` is one of `easy-call`, `needs-a-human`, `blocked`. `shape` and `one_liner` are single lines. `comment` is non-empty.
