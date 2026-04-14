---
"@ai-hero/sandcastle": patch
---

Add interactive() API for launching interactive agent sessions inside sandboxes. Adds optional interactiveExec method to sandbox handle interfaces, implements it for Docker, and updates all agent providers' buildInteractiveArgs to include the prompt.
