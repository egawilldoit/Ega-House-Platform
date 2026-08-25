---
name: code-truth-audit
description: >
  Use for disputed repository truth, architecture contradictions, deep current-behavior mapping, or agent-context changes; matching terms include audit, map, reconcile, architecture, and source of truth. Do not use for a small localized issue whose ownership and behavior are already known.
---

# Code Truth Audit

## Purpose

Establish current repository truth before changing architecture or agent guidance.

## Authority model

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). For product semantics also read [`../../../CONTEXT.md`](../../../CONTEXT.md). Use current-behavior evidence to establish what exists and normative product authority to establish what is required. Search [`../../../docs/agent-context/decision-log.md`](../../../docs/agent-context/decision-log.md) before creating a new defect/unresolved-decision classification.

## Workflow

1. Record branch, commit, status, worktrees, remotes, and the applicable root→leaf `AGENTS.md` chains without destructive cleanup.
2. Pass 1: map topology, entry points, package boundaries, persistence, integrations, scoped instructions, tests, and documented claims.
3. Save evidence with `PROVEN`, `SUPPORTED`, `DOCUMENTATION_ONLY`, `INFERRED`, or `UNRESOLVED` confidence.
4. Pass 2: reopen canonical files and attack every important hypothesis; find bypasses, duplicate owners, stale docs, historical snapshots presented as current, instruction-scope drift, and failure semantics.
5. Pass 3: resolve contradictions, classify current behavior, compare it with normative authority, and design the smallest correction at the canonical owner.
6. Edit only after Pass 3.
7. If the task authorizes governance/docs writes, append a material new conflict classification to the decision log; otherwise include the proposed entry in the handoff.
8. Validate local instruction discovery, links, commands, skills, architecture boundaries, affected tests, and final diff.

## Forbidden actions

Do not run the evidence passes in parallel, treat plans/audit snapshots as implementation evidence, ignore a deeper scoped `AGENTS.md`, erase pre-existing work, invent unresolved product decisions, or let the decision log override higher authority.

## Output contract

Pass comparison, current-behavior map, normative authority, instruction scopes, existing/new decision-log classifications, contradictions, changed files, exact validation results, remaining gaps, and an evidence-based verdict.
