---
name: issue-implementation
description: >
  Use for one authorized, bounded EGA House implementation issue when the user supplies an issue or explicit contract and expects a code patch or PR; matching terms include implement, fix, ticket, issue, and acceptance criteria. Do not use for broad repository audits, incident diagnosis without an implementation request, or backlog selection.
---

# Issue Implementation

## Required inputs

Issue identifier/content, acceptance criteria, authorized scope/paths, target branch policy, and required evidence.

## Authority model

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md) and the relevant architecture. Read [`../../../CONTEXT.md`](../../../CONTEXT.md) when product workflow semantics are involved. Current code explains present behavior; the authorized issue and higher normative authority define required behavior. Search [`../../../docs/agent-context/decision-log.md`](../../../docs/agent-context/decision-log.md) before re-classifying a known conflict.

## Workflow

1. Read `AGENTS.md`, the issue, relevant product context/ADR/architecture documents, and existing related decision-log entries.
2. Identify current behavior, canonical owner, callers, persistence, package/transport boundary, and tests.
3. Separate already implemented behavior from missing work, defects, and unresolved authority conflicts.
4. Create/use an authorized task branch or verified Runner worktree; never `main`.
5. Make the smallest coherent change through the canonical domain/application/persistence/transport boundary.
6. Add a behavior-focused test or executable guardrail at the closest reliable seam.
7. Run the validation matrix for every changed subsystem, including architecture checks when imports/ownership move.
8. Inspect changed files, diff, generated files, secrets, and unrelated changes.
9. If the implementation resolves/creates a material code-vs-authority classification and docs writes are authorized, update the decision log/ADR appropriately.
10. Produce a `final-verification` verdict with observed evidence.

## Forbidden actions

Do not choose another issue, implement a whole backlog, bypass state/queue/authorization owners, put shared workflow authority into transport/UI convenience code, weaken governance, force-reuse stale attempts, or claim runtime success from static checks.