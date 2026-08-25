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

1. Record repository/branch/HEAD/worktree state and discover the complete applicable root→leaf `AGENTS.md` chain for every intended target path.
2. Read the issue, relevant product context/ADR/architecture documents, scoped agent instructions, and existing related decision-log entries.
3. Identify current behavior, canonical owner, callers, persistence, package/transport boundary, public exports, and tests.
4. Separate already implemented behavior from missing work, defects, and unresolved authority conflicts.
5. Create/use an authorized task branch or verified Runner worktree; never `main`.
6. Make the smallest coherent change through the canonical domain/application/persistence/transport boundary. Prefer an existing local pattern documented by the scoped `AGENTS.md` over a parallel abstraction.
7. Add a behavior-focused test or executable guardrail at the closest reliable seam.
8. Run the scoped validation in the nearest `AGENTS.md`, plus architecture/security/global gates when the change crosses those boundaries.
9. Inspect changed files, diff, generated files, secrets, migrations, and unrelated changes.
10. If the implementation resolves/creates a material code-vs-authority classification and docs writes are authorized, update the decision log/ADR appropriately.
11. Produce a `final-verification` verdict with exact observed evidence and anything still unverified.

## Forbidden actions

Do not choose another issue, implement a whole backlog, bypass state/queue/authorization owners, put shared workflow authority into transport/UI convenience code, ignore a deeper scoped `AGENTS.md`, weaken governance, force-reuse stale attempts, or claim runtime success from static checks.
