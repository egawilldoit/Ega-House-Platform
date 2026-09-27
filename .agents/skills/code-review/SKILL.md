---
name: code-review
description: >
  Use to identify correctness, regression, security, state-authority, queue, lease, worktree, or evidence defects in a proposed EGA House diff or pull request; matching terms include review, PR, diff, regression, and finding. Do not use as the final completion-certification workflow.
---

# Code Review

Review correctness before style.

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). Compare the proposed change with both current-behavior evidence and normative product authority; do not approve an existing pattern when it conflicts with higher authority.

## General review

Apply the [quality workflow's review procedure](../../../docs/agent-context/quality-workflow.md#review-procedure) to every diff, including web, mobile, API, packages, database, tooling, and documentation changes.

Record the base/head revisions and review scope. Trace affected callers and contracts beyond changed lines. Check acceptance criteria, correctness and failure paths, authorization, persistence/cache effects, test sensitivity, maintainability, and measured performance where applicable. Verify decisive safety assumptions with a focused check when feasible; report missing evidence and current-head CI gaps.

## Additional Runner review

Only when the change affects autonomous delivery or its consumers, also check:

1. Queue archive, retry, and idempotency behavior.
2. Lease ownership and effects after loss or ambiguity.
3. Protected branch, worktree ownership, stale attempt reuse, and cleanup.
4. Hermes self-claims versus independent Git/validation evidence.
5. Terminal success prerequisites and persistence row-count checks.
6. GitHub PR/check/merge and Vercel synchronization.
7. Failure classification and reconciliation.

## Finding format

Severity, exact file/line, concrete failure scenario, violated authority/invariant, smallest safe correction, and missing regression test.
