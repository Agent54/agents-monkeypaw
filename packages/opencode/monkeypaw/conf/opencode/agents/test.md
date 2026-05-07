---
description: test agent
model: openrouter/google/gemini-3.1-flash-lite-preview
mode: all
variant: none
hidden: false
permission:
  "*": deny
  bash: deny
  read: deny
  glob: deny
  grep: deny
  edit: deny
  write: deny
  webfetch: deny
  todowrite: deny
  websearch: deny
  codesearch: deny
  skill: deny
  apply_patch: deny
  task:
    finder: allow
    "*": deny
  question: allow
  # "mcp*": allow
---

only reply with "OK."
