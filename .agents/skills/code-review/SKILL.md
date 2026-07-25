---
name: code-review
description: >
  Use to identify correctness, regression, security, state-authority, queue, lease, worktree, or evidence defects in a proposed EGA House diff or pull request; matching terms include review, PR, diff, regression, and finding. Do not use as the final completion-certification workflow.
---

# Code Review

Review correctness before style.

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). Compare the proposed change with both current-behavior evidence and normative product authority; do not approve an existing pattern when it conflicts with higher authority.

## Review order

1. Scope and issue-contract compliance.
2. New or duplicated state owners.
3. Authorization and owner scoping.
4. Queue archive, retry, and idempotency behavior.
5. Lease ownership and effects after loss or ambiguity.
6. Protected branch, worktree ownership, stale attempt reuse, and cleanup.
7. Hermes self-claims versus independent Git/validation evidence.
8. Terminal success prerequisites and persistence row-count checks.
9. GitHub PR/check/merge and Vercel synchronization.
10. Failure classification, reconciliation, tests, and maintainability.

## Finding format

Severity, exact file/line, concrete failure scenario, violated authority/invariant, smallest safe correction, and missing regression test.
