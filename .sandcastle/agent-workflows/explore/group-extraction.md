Emit a single `<output>` block as the last thing in your response.

Do not change files.
Do not run commands.
Do not include text outside the `<output>` block.

```json
<output>
{
  "groups": [
    { "issues": [101, 117], "hypothesis": "Both report X failing when Y; likely the same root cause in Z." },
    { "issues": [104], "hypothesis": "Standalone feature request for W." }
  ]
}
</output>
```

Every issue number in the batch must appear in exactly one group. `issues` holds integers, never strings.
