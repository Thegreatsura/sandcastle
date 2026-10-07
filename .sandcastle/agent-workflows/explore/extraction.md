Emit a single `<output>` block as the last thing in your response.

Do not change files.
Do not run commands.
Do not include text outside the `<output>` block.

```json
<output>
{
  "findings": [
    {
      "number": 101,
      "belongs": true,
      "belongs_reason": "One sentence on why this issue does or does not share the group's root cause.",
      "tag": "easy-call | needs-a-human | blocked",
      "shape": "A few words on the shape of the change, e.g. 'bug: one-line guard' or 'feature: new run() option'.",
      "one_liner": "One sentence summarising the issue and your verdict.",
      "comment": "The full markdown comment for this issue. Cover the topics you explored (difficulty, relevant files, claims, open questions, possible approach), including only those you have something useful to say about."
    }
  ],
  "notes": "Optional: anything the orchestrator should know when reconciling groups."
}
</output>
```

Include exactly one finding per issue in the group. `number` is an integer. `shape` and `one_liner` are single lines. `comment` is required and must be non-empty markdown.
