---
name: issue-implementation
description: Implement one authorized EGA House issue through the existing canonical path. Use when the user supplies a specific issue or bounded implementation contract and expects a code patch or PR.
---

# Issue Implementation

## Required inputs
Issue identifier/content, acceptance criteria, authorized scope/paths, target branch policy, and required evidence.

## Workflow
1. Read `AGENTS.md`, the issue, and relevant architecture documents.
2. Identify current behavior, canonical service/module, callers, persistence, and tests.
3. Separate already implemented behavior from missing work.
4. Create/use a task branch or verified Runner worktree; never `main`.
5. Make the smallest coherent change. Reuse existing transitions/services/contracts.
6. Add a behavior-focused test at the closest reliable seam.
7. Run the validation matrix for every changed subsystem.
8. Inspect changed files, diff, generated files, secrets, and unrelated changes.
9. Produce a final-verification verdict with evidence.

## Forbidden actions
Do not choose another issue, implement a whole backlog, bypass state/queue/authorization services, weaken governance, force-reuse stale attempts, or claim runtime success from static checks.

## Completion criteria
Acceptance criteria are traceably addressed, scope is clean, validation evidence is recorded, limitations are explicit, and the patch is reviewable.
