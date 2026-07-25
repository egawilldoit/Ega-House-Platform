---
name: code-review
description: EGA House correctness and governance review for a diff or pull request. Use when reviewing changes to product services, agent APIs, Runner, queue/lease logic, worktrees, Hermes, GitHub, Vercel, Slack, or agent context.
---

# Code Review

Review correctness before style.

## Review order
1. Scope and issue-contract compliance.
2. New or duplicated sources of truth.
3. Authorization and owner scoping.
4. Queue consumption, archive preconditions, retry/idempotency.
5. Lease ownership and side effects after loss/ambiguity.
6. Protected branch, worktree ownership, stale attempt reuse, cleanup.
7. Hermes self-claims versus independent Git/validation evidence.
8. Terminal success prerequisites and row-count checks.
9. GitHub PR/check/merge and Vercel synchronization.
10. Slack as reporting only.
11. Failure classification, partial-effect reconciliation, and observability.
12. Tests at a real behavior seam, then maintainability/style.

## Required findings format
Severity, exact file/line, concrete failure scenario, violated authority/invariant, smallest safe correction, and missing test.

## Forbidden review behavior
Do not approve because tests merely exist, prioritize cosmetic issues over correctness, or request speculative refactors outside the issue.
