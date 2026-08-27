---
name: code-review
description: >
  Use to identify correctness, regression, security, state-authority, or evidence defects in a proposed EGA House diff or pull request; matching terms include review, PR, diff, regression, and finding. Do not use as the final completion-certification workflow.
---

# Code Review

Review correctness before style.

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). Compare the proposed change with both current-behavior evidence and normative product authority; do not approve an existing pattern when it conflicts with higher authority.

## Review order

1. Issue/acceptance scope.
2. State ownership.
3. Authorization/identity.
4. Idempotency/retries.
5. Persistence consistency.
6. Architecture boundaries.
7. Model/AI authority boundaries.
8. External side effects.
9. Git/PR evidence.
10. Tests/regressions.

## Finding format

Severity, exact file/line, concrete failure scenario, violated authority/invariant, smallest safe correction, and missing regression test.
