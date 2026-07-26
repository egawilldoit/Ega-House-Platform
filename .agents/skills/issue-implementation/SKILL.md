---
name: issue-implementation
description: >
  Use for one authorized, bounded EGA House implementation issue when the user supplies an issue or explicit contract and expects a code patch or PR; matching terms include implement, fix, ticket, issue, and acceptance criteria. Do not use for broad repository audits, incident diagnosis without an implementation request, or backlog selection.
---

# Issue Implementation

## Required inputs

Issue identifier/content, acceptance criteria, authorized scope/paths, target branch policy, and required evidence.

## Authority model

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). Current code explains present behavior; the authorized issue and higher normative authority define required behavior. Report conflicts instead of silently copying either side.

## Workflow

1. Read `AGENTS.md`, the issue, and relevant architecture documents.
2. Identify current behavior, canonical owner, callers, persistence, and tests.
3. Separate already implemented behavior from missing work and authority conflicts.
4. Create or use a task branch or verified Runner worktree; never `main`.
5. Make the smallest coherent change through the canonical path.
6. Add a behavior-focused test at the closest reliable seam.
7. Run the validation matrix for every changed subsystem.
8. Inspect changed files, diff, generated files, secrets, and unrelated changes.
9. Produce a `final-verification` verdict with observed evidence.

## Forbidden actions

Do not choose another issue, implement a whole backlog, bypass state/queue/authorization owners, weaken governance, force-reuse stale attempts, or claim runtime success from static checks.
